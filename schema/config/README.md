# `schema/config/` — control-plane JSON Schemas (skeleton)

This directory will host JSON Schemas for the VIL-inspired
declarative control plane under `config/`. **Nothing here is loaded
by the bridge yet.**

## Planned schemas

| Config file              | Schema file                          |
|--------------------------|--------------------------------------|
| `config/vac.yaml`        | `vac.schema.json`                    |
| `config/agents/*.yaml`   | `agent-registry.schema.json`         |
| `config/profiles/*.yaml` | `capability-profile.schema.json`     |
| `config/workflows/*.yaml`| `workflow.schema.json`               |
| `config/gates/*.yaml`    | `gate-policy.schema.json`            |
| `config/mcp/*.yaml`      | `mcp-servers.schema.json`            |
| `config/sessions/*.yaml` | `session-resume.schema.json`         |

Wiring goes through the future `apps/local-bridge/src/control_plane/`
module (Phases 5–6). Until those land, this directory is purely a
placeholder so file paths in the design doc resolve.

See `config/README.md` for the migration order.
