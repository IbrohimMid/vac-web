## Summary

<!-- 1-3 sentences: what + why. Link to the plan under docs/plans/ if applicable. -->

## Checklist

- [ ] Docs updated if behaviour or contract changed (`docs/**` is SSOT).
- [ ] Schemas regenerated if `packages/protocol/v1/` edited (`scripts/codegen.sh`).
- [ ] Manifest updated if schemas/profiles edited (`scripts/manifest-verify.sh`).
- [ ] Red-team cases added if capability profile / bridge enforcement / engine policy touched.
- [ ] Perf baseline OK (no `bench:*` regression > 15%).
- [ ] No secrets / credentials in code, tests, or fixtures.
- [ ] CI green.

## Related plans

<!-- e.g., Phase 1 / Plan 07, Plan 10, etc. -->
