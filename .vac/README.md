# `.vac` Declarative Control Plane — `vac-web`

Declarative control plane for the `vac-web` cockpit workspace.

Every manifest in this folder is typed, versioned (`schema_version: 1`), and validated.

---

## Families

| Family | Directory | Schema / Structure | Description |
|---|---|---|---|
| **Registry** | [`.vac/registry/`](registry/) | `kind: product`, `domains`, `status`, `ownership` | Product identity, domain statuses, migration progress, and code ownership. |
| **Capabilities** | [`.vac/capabilities/`](capabilities/) | `kind: capability` | Individual capability files declaring module ownership, risk tier, and policies. |
| **Workflows** | [`.vac/workflows/`](workflows/) | `kind: workflow` | Repeatable operator validation sequences (e.g., local builds, architecture checks). |
| **Policies** | [`.vac/policies/`](policies/) | `kind: policy` | Rules and thresholds (e.g. extension trust, session resume retention). |
| **Surfaces** | [`.vac/surfaces/`](surfaces/) | `kind: surface` | Route maps and WebSocket event maps for cockpit visual alignment. |

---

## Naming Conventions

* **Capability IDs**: Start with `bridge.` (e.g., `bridge.agent_runtime`). File names are kebab-case and omit the `bridge.` prefix (`agent-runtime.yaml`).
* **Workflow IDs**: Start with `maintenance.` or `product.` (e.g., `maintenance.build-check`). File names keep the dotted prefix (`maintenance.build-check.yaml`).
* **Policy IDs**: Start with `bridge.policy.` (e.g., `bridge.policy.session-resume`). File names drop the prefix namespace (`session-resume.yaml`).
* **Surface IDs**: Start with `surface.` (e.g., `surface.web`). File names drop the namespace prefix (`web.yaml`).

---

## Authoritative Rules

1. **Rule #1**: *Runtime authority is Rust + TS code. YAML control plane describes intent only.*
2. **Rule #2**: Do not place legacy script packs or unverified frontend packages in this directory.
