# `config/` — declarative control plane (skeleton)

This directory is the future home of VAC's VIL-inspired declarative
control plane. **Nothing here is loaded by the bridge yet.**

The persistence-foundation milestone (Phase 1 of Release 1) lands the
typed Rust trait + file store under
`apps/local-bridge/src/session/persistence/`. This skeleton exists so
later commits have a stable place to drop the YAML files without a
rename churn.

## Planned layout

```
config/
  vac.yaml              # root config
  agents/
    registry.yaml       # agent registry (replaces agents.toml long-term)
    local.override.yaml # admin-local overrides, gitignored
  profiles/
    assessor.yaml
    executor-code.yaml
  workflows/
    observe-tools.yaml
    build-basic.yaml
  gates/
    deploy-ready.yaml
  mcp/
    servers.yaml
  sessions/
    resume-policy.yaml  # session persistence + native ACP load policy
```

## Migration order (current plan)

1. **Phase 1 (now):** persistence trait + file store + tests. No YAML loaded.
2. **Phase 2:** persist `session/new` metadata + events on the active path.
3. **Phase 3:** `session.history.list` / `session.resume` / `session.history.forget`
   bridge commands + frontend Resume UX (replay-only).
4. **Phase 4:** ACP `session/load` runtime + native resume.
5. **Phase 5:** load `sessions/resume-policy.yaml` through a typed loader.
6. **Phase 6+:** broader VIL-style YAML control plane.

See the long-form blueprint in agent thread history for rationale and
acceptance criteria.
