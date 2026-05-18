// Discriminant tests — ensures the `type` tag on Event/Command unions narrows
// correctly and that consumer-critical surfaces (HandoffPacket, EvidenceRef,
// AssessmentVerdict) parse from the canonical valid-* fixtures.
//
// Runs against the same JSON fixtures used by `pnpm schema:validate` and the
// Rust roundtrip suite. If a sample shape diverges from the generated TS
// type, a future codegen run won't catch it (TS types only); this test does.
//
// Note: the generated types currently use `Record<string, unknown>` for many
// nested objects (target/pin/approval/etc) so we reach into them via index
// access rather than typed dot-access. The point of these tests is shape
// stability, not field-level type narrowing of nested objects.

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type {
  Command,
  Event,
  EvidenceRef,
  HandoffPacket,
  AssessmentVerdict,
  RemediationPlan,
} from '../generated';

const __filename = fileURLToPath(import.meta.url);
const SAMPLES = resolve(
  dirname(__filename),
  '..',
  '..',
  '..',
  '..',
  'protocol',
  'v1',
  '_samples',
);

function load<T>(path: string): T {
  return JSON.parse(readFileSync(join(SAMPLES, path), 'utf8')) as T;
}

describe('Event discriminant narrowing', () => {
  it('narrows transcript.delta payload via `type` tag', () => {
    const ev = load<Event>('event/valid-transcript-delta.json');
    expect(ev.v).toBe(1);
    expect(typeof ev.session_id).toBe('string');
    expect(typeof ev.seq).toBe('number');
    if (ev.type === 'transcript.delta') {
      // Type system narrows here — if the discriminant ever changes shape,
      // this branch silently drops out and the assertion below catches it.
      expect(ev.payload).toBeDefined();
    } else {
      throw new Error(`expected transcript.delta, got ${ev.type as string}`);
    }
  });

  it('narrows assessment.completed event', () => {
    const ev = load<Event>('event/valid-assessment-completed.json');
    expect(ev.type).toMatch(/^assessment\./);
    expect(typeof ev.ts).toBe('string');
  });
});

describe('Command discriminant narrowing', () => {
  it('parses approval.approve command', () => {
    const cmd = load<Command>('command/valid-approval-approve.json');
    expect(cmd.v).toBe(1);
    expect(cmd.type).toContain('approval');
    expect(typeof cmd.id).toBe('string');
  });

  it('parses message.submit command', () => {
    const cmd = load<Command>('command/valid-message-submit.json');
    expect(cmd.type).toBe('message.submit');
  });

  it('parses session.create command (agent-id variant)', () => {
    const cmd = load<Command>('command/valid-session-create-agent-id.json');
    expect(cmd.type).toBe('session.create');
  });
});

describe('handoff and remediation surface shapes', () => {
  it('HandoffPacket fixture has the consumer-required fields', () => {
    const hp = load<HandoffPacket>('handoff_packet/valid-minimal.json');
    expect(typeof hp.id).toBe('string');
    expect(Array.isArray(hp.tasks)).toBe(true);
    expect(hp.tasks.length).toBeGreaterThan(0);
    expect(hp.target).toBeTypeOf('object');
    expect(hp.target.kind).toBe('dispatch_to_local_vac');
    expect(hp.state).toBe('draft');
  });

  it('RemediationPlan fixture exposes grouped tasks', () => {
    const plan = load<RemediationPlan>('remediation_plan/valid-minimal.json');
    expect(typeof plan.id).toBe('string');
    expect(Array.isArray(plan.groups)).toBe(true);
    expect(plan.groups.length).toBeGreaterThan(0);
    const firstGroup = plan.groups[0];
    expect(firstGroup).toBeDefined();
    expect(Array.isArray(firstGroup?.tasks)).toBe(true);
  });

  it('EvidenceRef file fixture has observed_at + kind', () => {
    const ev = load<EvidenceRef>('evidence_ref/valid-file.json');
    expect(typeof ev.observed_at).toBe('string');
    expect(typeof ev.kind).toBe('string');
  });

  it('AssessmentVerdict ready fixture parses with a known status', () => {
    const v = load<AssessmentVerdict>('assessment_verdict/valid-ready.json');
    expect(['READY', 'CONDITIONAL', 'BLOCKED', 'PASS', 'WARN', 'FAIL']).toContain(v.status);
    expect(typeof v.summary).toBe('string');
  });
});
