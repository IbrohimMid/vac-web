# Schema samples

Fixtures consumed by `scripts/schema-validate.sh`.

Naming: `valid-*.json` must validate; `invalid-*.json` must fail validation.

On CI, validator asserts:
- every `valid-*` passes `ajv`.
- every `invalid-*` fails.

Add samples alongside schema changes. Critical shapes (CapabilityProfile, AssessmentFinding, HandoffPacket, GateStatus, EvidenceRef) should have ≥ 2 valid + 1 invalid each over time.
