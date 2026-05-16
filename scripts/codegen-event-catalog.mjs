#!/usr/bin/env node
// Generate Rust + TypeScript bindings from the canonical event catalog.
//
// Source of truth: config/control-plane/event-catalog.yaml
// Outputs:
//   apps/local-bridge/src/generated/event_catalog.rs
//   apps/web/src/generated/eventCatalog.ts
//
// Run via:
//   node scripts/codegen-event-catalog.mjs
//   node scripts/codegen-event-catalog.mjs --check (CI drift mode)
//
// Deterministic: identical input produces byte-identical output.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'config/control-plane/event-catalog.yaml');
const RS_OUT = path.join(ROOT, 'apps/local-bridge/src/generated/event_catalog.rs');
const TS_OUT = path.join(ROOT, 'apps/web/src/generated/eventCatalog.ts');
const HEADER_NOTE =
  'AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: config/control-plane/event-catalog.yaml';

const VALID_STATUSES = new Set([
  'implemented',
  'not_wired',
  'planned',
  'legacy_mock_only',
  'deprecated',
]);
const VALID_OWNERS = new Set(['bridge', 'web', 'mock', 'protocol', 'tools']);

function loadCatalog() {
  const raw = fs.readFileSync(SOURCE, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || typeof doc !== 'object') {
    throw new Error('event-catalog.yaml: empty or invalid root');
  }
  if (!Array.isArray(doc.events)) {
    throw new Error('event-catalog.yaml: missing events[] array');
  }
  const ids = new Set();
  for (const e of doc.events) {
    if (!e || typeof e !== 'object') {
      throw new Error('event-catalog.yaml: non-object event entry');
    }
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new Error('event-catalog.yaml: event missing id');
    }
    if (ids.has(e.id)) {
      throw new Error(`event-catalog.yaml: duplicate id ${e.id}`);
    }
    ids.add(e.id);
    if (!VALID_STATUSES.has(e.status)) {
      throw new Error(`event-catalog.yaml: ${e.id} has invalid status ${e.status}`);
    }
    if (e.owner !== undefined && !VALID_OWNERS.has(e.owner)) {
      throw new Error(`event-catalog.yaml: ${e.id} has invalid owner ${e.owner}`);
    }
    if (e.status === 'legacy_mock_only' && typeof e.replacement !== 'string') {
      throw new Error(`event-catalog.yaml: legacy event ${e.id} missing replacement`);
    }
  }
  // Sort events by id for deterministic output.
  const events = [...doc.events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { version: doc.version ?? 1, events };
}

function renderTs(doc) {
  const lines = [];
  lines.push('// ' + HEADER_NOTE);
  lines.push('//');
  lines.push('// Run `node scripts/codegen-event-catalog.mjs` to regenerate.');
  lines.push('');
  lines.push(
    "export type EventStatus = 'implemented' | 'not_wired' | 'planned' | 'legacy_mock_only' | 'deprecated';",
  );
  lines.push("export type EventOwner = 'bridge' | 'web' | 'mock' | 'protocol' | 'tools';");
  lines.push('');
  lines.push('export interface EventEntry {');
  lines.push('  readonly id: EventId;');
  lines.push('  readonly status: EventStatus;');
  lines.push('  readonly owner?: EventOwner;');
  lines.push('  readonly producer?: string;');
  lines.push('  readonly consumers?: ReadonlyArray<string>;');
  lines.push('  readonly replacement?: EventId;');
  lines.push('  readonly internal?: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('// Discriminated string-literal union of every classified event id.');
  lines.push('export type EventId =');
  for (let i = 0; i < doc.events.length; i++) {
    const e = doc.events[i];
    const sep = i === doc.events.length - 1 ? ';' : '';
    lines.push(`  | '${e.id}'${sep}`);
  }
  lines.push('');
  lines.push('export const EVENT_CATALOG: ReadonlyArray<EventEntry> = Object.freeze([');
  for (const e of doc.events) {
    const parts = [`id: '${e.id}'`, `status: '${e.status}'`];
    if (e.owner) parts.push(`owner: '${e.owner}'`);
    if (e.producer) parts.push(`producer: ${JSON.stringify(e.producer)}`);
    if (Array.isArray(e.consumers) && e.consumers.length > 0) {
      const cs = e.consumers.map((c) => JSON.stringify(c)).join(', ');
      parts.push(`consumers: Object.freeze([${cs}])`);
    }
    if (e.replacement) parts.push(`replacement: '${e.replacement}'`);
    if (e.internal === true) parts.push('internal: true');
    lines.push(`  Object.freeze({ ${parts.join(', ')} }),`);
  }
  lines.push(']);');
  lines.push('');
  lines.push(
    'export const EVENT_BY_ID: ReadonlyMap<EventId, EventEntry> = new Map(EVENT_CATALOG.map((e) => [e.id, e]));',
  );
  lines.push('');
  lines.push('export function eventStatus(id: string): EventStatus | undefined {');
  lines.push('  return EVENT_BY_ID.get(id as EventId)?.status;');
  lines.push('}');
  lines.push('');
  lines.push('export function isKnownEvent(id: string): id is EventId {');
  lines.push('  return EVENT_BY_ID.has(id as EventId);');
  lines.push('}');
  lines.push('');
  lines.push('export function isLegacyMockOnly(id: string): boolean {');
  lines.push("  return eventStatus(id) === 'legacy_mock_only';");
  lines.push('}');
  lines.push('');
  lines.push('export function replacementFor(id: string): EventId | undefined {');
  lines.push('  return EVENT_BY_ID.get(id as EventId)?.replacement;');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function rustEnumVariant(s) {
  return s
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function renderRust(doc) {
  const lines = [];
  lines.push('// ' + HEADER_NOTE);
  lines.push('//');
  lines.push('// Run `node scripts/codegen-event-catalog.mjs` to regenerate.');
  lines.push('');
  lines.push('#![allow(dead_code)]');
  lines.push('');
  lines.push('#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]');
  lines.push('pub enum EventStatus {');
  lines.push('    Implemented,');
  lines.push('    NotWired,');
  lines.push('    Planned,');
  lines.push('    LegacyMockOnly,');
  lines.push('    Deprecated,');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]');
  lines.push('pub struct EventEntry {');
  lines.push('    pub id: &\'static str,');
  lines.push('    pub status: EventStatus,');
  lines.push('}');
  lines.push('');
  lines.push('#[rustfmt::skip]');
  lines.push(`pub const EVENT_CATALOG: [EventEntry; ${doc.events.length}] = [`);
  const statusToVariant = {
    implemented: 'Implemented',
    not_wired: 'NotWired',
    planned: 'Planned',
    legacy_mock_only: 'LegacyMockOnly',
    deprecated: 'Deprecated',
  };
  for (const e of doc.events) {
    lines.push(
      `    EventEntry { id: "${e.id}", status: EventStatus::${statusToVariant[e.status]} },`,
    );
  }
  lines.push('];');
  lines.push('');
  lines.push('pub fn event_status(id: &str) -> Option<EventStatus> {');
  lines.push('    EVENT_CATALOG.iter().find(|e| e.id == id).map(|e| e.status)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn is_known_event(id: &str) -> bool {');
  lines.push('    EVENT_CATALOG.iter().any(|e| e.id == id)');
  lines.push('}');
  lines.push('');
  // Suppress "unused" warning on rustEnumVariant — only used for future expansion.
  void rustEnumVariant;
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const doc = loadCatalog();
  const targets = [
    [TS_OUT, renderTs(doc)],
    [RS_OUT, renderRust(doc)],
  ];
  let drift = false;
  for (const [outPath, content] of targets) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (check) {
      if (existing !== content) {
        drift = true;
        console.error(`[codegen-event-catalog] DRIFT: ${path.relative(ROOT, outPath)}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (existing !== content) {
      fs.writeFileSync(outPath, content);
      console.log(`[codegen-event-catalog] wrote ${path.relative(ROOT, outPath)}`);
    } else {
      console.log(`[codegen-event-catalog] ok    ${path.relative(ROOT, outPath)}`);
    }
  }
  if (check && drift) {
    console.error('[codegen-event-catalog] run `node scripts/codegen-event-catalog.mjs` and commit the result.');
    process.exit(1);
  }
}

main();
