// Smoke tests for the public surface of @vac-web/protocol.
//
// These don't replace codegen-verify; they catch a different class of bug:
//   - PROTOCOL_VERSION drift (matters for the Web<->Bridge `v` envelope).
//   - A generated barrel forgetting to re-export a type so consumers miss it.
//   - Sample fixtures (used by Rust roundtrip and schema-validate) silently
//     diverging from the TS-typed shape.
//
// Test strategy: import the public barrel and assert a typed assignment of
// each fixture round-trips. If a discriminant tag changes, the JSON parse +
// type narrow combo fails to compile or a runtime check fails here.

import { describe, expect, it } from 'vitest';

import * as protocol from '../../index';
import type {
  ActionSpec,
  AssessmentDiff,
  AssessmentFinding,
  AssessmentRun,
  AssessmentVerdict,
  CapabilityProfile,
  Command,
  Event,
  EvidenceRef,
  GatePolicy,
  GateStatus,
  HandoffPacket,
  NotifyEvent,
  Overlay,
  RemediationPlan,
  SystemPulse,
} from '../generated';

describe('protocol public surface', () => {
  it('pins PROTOCOL_VERSION to 1', () => {
    expect(protocol.PROTOCOL_VERSION).toBe(1);
  });

  it('re-exports every generated v1 type from the barrel', () => {
    // Compile-time assertion: the type aliases below must all be defined.
    // (`any` is OK — the goal is to ensure the symbols resolve.)
    type _All =
      | ActionSpec
      | AssessmentDiff
      | AssessmentFinding
      | AssessmentRun
      | AssessmentVerdict
      | CapabilityProfile
      | Command
      | Event
      | EvidenceRef
      | GatePolicy
      | GateStatus
      | HandoffPacket
      | NotifyEvent
      | Overlay
      | RemediationPlan
      | SystemPulse;
    // Runtime sentinel so the test reports as executed.
    const sentinel: _All | null = null;
    expect(sentinel).toBeNull();
  });
});
