#!/usr/bin/env node
// Generate Rust + TypeScript bindings from the command implementation manifest.
//
// Source of truth: config/control-plane/command-manifest.yaml
// Outputs:
//   apps/local-bridge/src/generated/command_catalog.rs
//   apps/web/src/generated/commandCatalog.ts
//
// Run via:
//   node scripts/codegen-command-catalog.mjs
// or `pnpm codegen:catalog`.
//
// The generator is deterministic: identical input produces byte-identical
// output. CI runs `--check` to detect drift.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'config/control-plane/command-manifest.yaml');
const RS_OUT = path.join(ROOT, 'apps/local-bridge/src/generated/command_catalog.rs');
const TS_OUT = path.join(ROOT, 'apps/web/src/generated/commandCatalog.ts');
const HEADER_NOTE =
  'AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: config/control-plane/command-manifest.yaml';

const VALID_STATUSES = new Set([
  'implemented',
  'not_wired',
  'frontend_owned',
  'protocol_only',
  'internal',
  'deprecated',
]);
const VALID_SCOPES = new Set(['sessionless', 'session', 'either']);
const VALID_SIDE_EFFECTS = new Set(['none', 'read_only', 'state', 'external']);
const VALID_TOOL_ENFORCEMENT = new Set(['tool', 'protocol_only', 'payload_action_id', 'payload_action']);

function loadManifest() {
  const raw = fs.readFileSync(MANIFEST, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || !Array.isArray(doc.commands)) {
    throw new Error(`command manifest malformed at ${MANIFEST}`);
  }
  const seen = new Set();
  for (const cmd of doc.commands) {
    if (!cmd.id || typeof cmd.id !== 'string') {
      throw new Error(`command entry missing id: ${JSON.stringify(cmd)}`);
    }
    if (seen.has(cmd.id)) {
      throw new Error(`duplicate command id: ${cmd.id}`);
    }
    seen.add(cmd.id);
    if (!VALID_STATUSES.has(cmd.status)) {
      throw new Error(`command ${cmd.id} has invalid status: ${cmd.status}`);
    }
    if (!VALID_SCOPES.has(cmd.scope)) {
      throw new Error(`command ${cmd.id} has invalid scope: ${cmd.scope}`);
    }
    if (!cmd.side_effect || !VALID_SIDE_EFFECTS.has(cmd.side_effect)) {
      throw new Error(`command ${cmd.id} has invalid side_effect: ${cmd.side_effect}`);
    }
    if (cmd.tool_enforcement && !VALID_TOOL_ENFORCEMENT.has(cmd.tool_enforcement)) {
      throw new Error(`command ${cmd.id} has invalid tool_enforcement: ${cmd.tool_enforcement}`);
    }
  }
  // Sort deterministically for stable output.
  doc.commands.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return doc;
}

function renderRust(doc) {
  const lines = [];
  lines.push('//! ' + HEADER_NOTE);
  lines.push('//!');
  lines.push('//! Run `node scripts/codegen-command-catalog.mjs` to regenerate.');
  lines.push('');
  lines.push('#![allow(dead_code)]');
  lines.push('');
  lines.push('/// Classification status for every protocol/bridge command.');
  lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]');
  lines.push('pub enum CommandStatus {');
  lines.push('    Implemented,');
  lines.push('    NotWired,');
  lines.push('    FrontendOwned,');
  lines.push('    ProtocolOnly,');
  lines.push('    Internal,');
  lines.push('    Deprecated,');
  lines.push('}');
  lines.push('');
  lines.push('impl CommandStatus {');
  lines.push('    pub fn as_str(self) -> &\'static str {');
  lines.push('        match self {');
  lines.push('            Self::Implemented => "implemented",');
  lines.push('            Self::NotWired => "not_wired",');
  lines.push('            Self::FrontendOwned => "frontend_owned",');
  lines.push('            Self::ProtocolOnly => "protocol_only",');
  lines.push('            Self::Internal => "internal",');
  lines.push('            Self::Deprecated => "deprecated",');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('/// Classification scope: when does the command need a session?');
  lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq)]');
  lines.push('pub enum CommandScope {');
  lines.push('    Sessionless,');
  lines.push('    Session,');
  lines.push('    Either,');
  lines.push('}');
  lines.push('');
  lines.push('/// Side-effect classification for every command.');
  lines.push('///');
  lines.push('/// - `None` — no observable bridge state change (frontend_owned, protocol_only).');
  lines.push('/// - `ReadOnly` — queries/fetches; safe to retry, does not mutate bridge state.');
  lines.push('/// - `State` — mutates bridge / session / agent state; default for implemented & not_wired.');
  lines.push('/// - `External` — effects outside the bridge process (deploys, dispatches, connector handshakes).');
  lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]');
  lines.push('pub enum CommandSideEffect {');
  lines.push('    None,');
  lines.push('    ReadOnly,');
  lines.push('    State,');
  lines.push('    External,');
  lines.push('}');
  lines.push('');
  lines.push('impl CommandSideEffect {');
  lines.push('    pub fn as_str(self) -> &\'static str {');
  lines.push('        match self {');
  lines.push('            Self::None => "none",');
  lines.push('            Self::ReadOnly => "read_only",');
  lines.push('            Self::State => "state",');
  lines.push('            Self::External => "external",');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('/// Profile-layer enforcement mode (R08-F02 default-deny).');
  lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]');
  lines.push('pub enum ToolEnforcement {');
  lines.push('    Tool,');
  lines.push('    ProtocolOnly,');
  lines.push('    PayloadActionId,');
  lines.push('    PayloadAction,');
  lines.push('}');
  lines.push('');
  lines.push('impl ToolEnforcement {');
  lines.push('    pub fn as_str(self) -> &\'static str {');
  lines.push('        match self {');
  lines.push('            Self::Tool => "tool",');
  lines.push('            Self::ProtocolOnly => "protocol_only",');
  lines.push('            Self::PayloadActionId => "payload_action_id",');
  lines.push('            Self::PayloadAction => "payload_action",');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Debug, Clone, Copy)]');
  lines.push('pub struct CommandEntry {');
  lines.push('    pub id: &\'static str,');
  lines.push('    pub status: CommandStatus,');
  lines.push('    pub scope: CommandScope,');
  lines.push('    pub side_effect: CommandSideEffect,');
  lines.push('    pub requires_profile_tool: Option<&\'static str>,');
  lines.push('    pub tool_enforcement: Option<ToolEnforcement>,');
  lines.push('}');
  lines.push('');
  const statusToVariant = (s) =>
    ({
      implemented: 'Implemented',
      not_wired: 'NotWired',
      frontend_owned: 'FrontendOwned',
      protocol_only: 'ProtocolOnly',
      internal: 'Internal',
      deprecated: 'Deprecated',
    })[s];
  const scopeToVariant = (s) =>
    ({ sessionless: 'Sessionless', session: 'Session', either: 'Either' })[s];
  const sideEffectToVariant = (s) =>
    ({ none: 'None', read_only: 'ReadOnly', state: 'State', external: 'External' })[s];
  const toolEnforcementToVariant = (s) =>
    ({ tool: 'Tool', protocol_only: 'ProtocolOnly', payload_action_id: 'PayloadActionId', payload_action: 'PayloadAction' })[s];

  lines.push('#[rustfmt::skip]');
  lines.push(`pub const COMMAND_CATALOG: &[CommandEntry] = &[`);
  for (const c of doc.commands) {
    const rpt = c.requires_profile_tool ? `Some("${c.requires_profile_tool}")` : 'None';
    const te = c.tool_enforcement ? `Some(ToolEnforcement::${toolEnforcementToVariant(c.tool_enforcement)})` : 'None';
    lines.push(
      `    CommandEntry { id: "${c.id}", status: CommandStatus::${statusToVariant(c.status)}, scope: CommandScope::${scopeToVariant(c.scope)}, side_effect: CommandSideEffect::${sideEffectToVariant(c.side_effect)}, requires_profile_tool: ${rpt}, tool_enforcement: ${te} },`,
    );
  }
  lines.push('];');
  lines.push('');

  // Convenience constants matching the previous hand-rolled lists.
  const known = doc.commands.filter((c) =>
    ['implemented', 'not_wired', 'protocol_only', 'frontend_owned'].includes(c.status),
  );
  // Bridge accepts these on the wire (excluding pure frontend_owned/protocol_only-which-is-event-only).
  const bridgeAccepted = doc.commands.filter((c) =>
    ['implemented', 'not_wired'].includes(c.status),
  );
  const sessionless = bridgeAccepted.filter(
    (c) => c.scope === 'sessionless' || c.scope === 'either',
  );
  const notWired = doc.commands.filter((c) => c.status === 'not_wired');

  lines.push('/// Every command id the bridge accepts on the WebSocket boundary');
  lines.push('/// (implemented + not_wired). frontend_owned/protocol_only ids are excluded.');
  lines.push('pub const KNOWN_COMMANDS: &[&str] = &[');
  for (const c of bridgeAccepted) {
    lines.push(`    "${c.id}",`);
  }
  lines.push('];');
  lines.push('');

  lines.push('/// Commands acceptable without an active session.');
  lines.push('pub const SESSIONLESS_COMMANDS: &[&str] = &[');
  for (const c of sessionless) {
    lines.push(`    "${c.id}",`);
  }
  lines.push('];');
  lines.push('');

  lines.push('/// Commands declared but not yet implemented; the bridge intercepts');
  lines.push('/// them before forwarding to the agent and returns feature.not_wired.');
  lines.push('pub const NOT_WIRED_COMMANDS: &[&str] = &[');
  for (const c of notWired) {
    lines.push(`    "${c.id}",`);
  }
  lines.push('];');
  lines.push('');

  lines.push('pub fn lookup(cmd: &str) -> Option<&\'static CommandEntry> {');
  lines.push('    COMMAND_CATALOG.iter().find(|e| e.id == cmd)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn status_of(cmd: &str) -> Option<CommandStatus> {');
  lines.push('    lookup(cmd).map(|e| e.status)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn is_known(cmd: &str) -> bool {');
  lines.push('    KNOWN_COMMANDS.contains(&cmd)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn is_sessionless(cmd: &str) -> bool {');
  lines.push('    SESSIONLESS_COMMANDS.contains(&cmd)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn is_not_wired(cmd: &str) -> bool {');
  lines.push('    NOT_WIRED_COMMANDS.contains(&cmd)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn requires_profile_tool(cmd: &str) -> Option<&\'static str> {');
  lines.push('    lookup(cmd).and_then(|e| e.requires_profile_tool)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn tool_enforcement_of(cmd: &str) -> Option<ToolEnforcement> {');
  lines.push('    let entry = lookup(cmd)?;');
  lines.push('    if let Some(te) = entry.tool_enforcement {');
  lines.push('        return Some(te);');
  lines.push('    }');
  lines.push('    if entry.requires_profile_tool.is_some() {');
  lines.push('        return Some(ToolEnforcement::Tool);');
  lines.push('    }');
  lines.push('    None');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function renderTs(doc) {
  const lines = [];
  lines.push('// ' + HEADER_NOTE);
  lines.push('//');
  lines.push('// Run `node scripts/codegen-command-catalog.mjs` to regenerate.');
  lines.push('');
  lines.push(
    "export type CommandStatus = 'implemented' | 'not_wired' | 'frontend_owned' | 'protocol_only' | 'internal' | 'deprecated';",
  );
  lines.push("export type CommandScope = 'sessionless' | 'session' | 'either';");
  lines.push("export type CommandSideEffect = 'none' | 'read_only' | 'state' | 'external';");
  lines.push("export type ToolEnforcement = 'tool' | 'protocol_only' | 'payload_action_id' | 'payload_action';");
  lines.push('');
  lines.push('export interface CommandEntry {');
  lines.push('  readonly id: CommandId;');
  lines.push('  readonly status: CommandStatus;');
  lines.push('  readonly scope: CommandScope;');
  lines.push('  readonly sideEffect: CommandSideEffect;');
  lines.push('  readonly requiresProfileTool?: string;');
  lines.push('  readonly toolEnforcement?: ToolEnforcement;');
  lines.push('  readonly runtime?: string;');
  lines.push('  readonly summary?: string;');
  lines.push('  readonly ui?: { readonly gate?: string; readonly reason?: string };');
  lines.push('}');
  lines.push('');
  lines.push('// Discriminated string-literal union of every classified command id.');
  lines.push('export type CommandId =');
  for (let i = 0; i < doc.commands.length; i++) {
    const c = doc.commands[i];
    const sep = i === doc.commands.length - 1 ? ';' : '';
    lines.push(`  | '${c.id}'${sep}`);
  }
  lines.push('');
  lines.push('export const COMMAND_CATALOG: ReadonlyArray<CommandEntry> = Object.freeze([');
  for (const c of doc.commands) {
    const parts = [
      `id: '${c.id}'`,
      `status: '${c.status}'`,
      `scope: '${c.scope}'`,
      `sideEffect: '${c.side_effect}'`,
    ];
    if (c.requires_profile_tool) parts.push(`requiresProfileTool: '${c.requires_profile_tool}'`);
    if (c.tool_enforcement) parts.push(`toolEnforcement: '${c.tool_enforcement}'`);
    if (c.runtime) parts.push(`runtime: '${c.runtime}'`);
    if (c.summary) parts.push(`summary: ${JSON.stringify(c.summary)}`);
    if (c.ui) {
      const uiParts = [];
      if (c.ui.gate) uiParts.push(`gate: '${c.ui.gate}'`);
      if (c.ui.reason) uiParts.push(`reason: ${JSON.stringify(c.ui.reason)}`);
      parts.push(`ui: Object.freeze({ ${uiParts.join(', ')} })`);
    }
    lines.push(`  Object.freeze({ ${parts.join(', ')} }),`);
  }
  lines.push(']);');
  lines.push('');
  lines.push(
    'export const COMMAND_BY_ID: ReadonlyMap<CommandId, CommandEntry> = new Map(COMMAND_CATALOG.map((e) => [e.id, e]));',
  );
  lines.push('');
  lines.push('export function commandStatus(id: string): CommandStatus | undefined {');
  lines.push('  return COMMAND_BY_ID.get(id as CommandId)?.status;');
  lines.push('}');
  lines.push('');
  lines.push('export function isKnownCommand(id: string): id is CommandId {');
  lines.push('  return COMMAND_BY_ID.has(id as CommandId);');
  lines.push('}');
  lines.push('');
  lines.push('export function isImplemented(id: string): boolean {');
  lines.push("  return commandStatus(id) === 'implemented';");
  lines.push('}');
  lines.push('');
  lines.push('export function isNotWired(id: string): boolean {');
  lines.push("  return commandStatus(id) === 'not_wired';");
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const doc = loadManifest();
  const rs = renderRust(doc);
  const ts = renderTs(doc);
  const targets = [
    [RS_OUT, rs],
    [TS_OUT, ts],
  ];
  let drift = false;
  for (const [outPath, content] of targets) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (check) {
      if (existing !== content) {
        drift = true;
        console.error(`[codegen-command-catalog] DRIFT: ${path.relative(ROOT, outPath)}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (existing !== content) {
      fs.writeFileSync(outPath, content);
      console.log(`[codegen-command-catalog] wrote ${path.relative(ROOT, outPath)}`);
    } else {
      console.log(`[codegen-command-catalog] ok    ${path.relative(ROOT, outPath)}`);
    }
  }
  if (check && drift) {
    console.error('[codegen-command-catalog] run `node scripts/codegen-command-catalog.mjs` and commit the result.');
    process.exit(1);
  }
}

main();
