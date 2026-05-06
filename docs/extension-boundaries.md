# Extension and plugin boundaries (slice 47)

VAC Web ships with first-party providers, connectors, MCP servers,
workflows, and agents. As we add third-party / user-authored extensions,
the runtime safety bar must not move.

## Hard rule

An extension MAY add commands, events, capabilities, or copy. It MUST
NOT bypass:

* Profile policy in `apps/local-bridge/src/profile_layer/`.
* Auth/WS hardening in `apps/local-bridge/src/auth` + `ws/handler.rs`.
* Audit append-only semantics.
* Persistence redaction.

This is enforced by routing every extension through the same control
plane as built-in features.

## Extension surfaces

| Surface | Declarative source | Runtime authority |
| --- | --- | --- |
| Agents | `config/agents/registry.yaml` | `apps/local-bridge/src/agent_runtime` |
| MCP servers | `config/mcp/servers.yaml` | `apps/local-bridge/src/mcp/` |
| Connectors | `config/connectors/*.yaml` | `apps/local-bridge/src/connectors/` |
| Custom workflows | `examples/workflows/*.yaml` | `apps/local-bridge/src/workflows/` |
| Custom commands | `config/control-plane/command-manifest.yaml` (with
  `owner: extension`) | generated catalog + profile policy |

## Sandboxing tiers

* **Tier 0 (built-in)** — ships in this repo; covered by full test
  suite.
* **Tier 1 (declarative extension)** — YAML-only; declares commands /
  events / capabilities. Validated against schemas. Cannot execute
  arbitrary code.
* **Tier 2 (process extension)** — e.g. an MCP server binary. Runs in a
  separate process; communication is constrained to its declared
  protocol surface. Profile policy gates which tools the agent can call.

There is no Tier 3 (in-process plugin loading) without an explicit ADR.

## Authoring rules

1. Tier 1 extensions add YAML under the relevant config directory and
   ship test fixtures. Schema validation is mandatory.
2. Tier 2 extensions must declare:
   * `id`, `version`, `owner`.
   * Required profile capabilities.
   * Failure mode if the host denies a capability (must be graceful).
3. Every extension passes through the same UX classifier modules, so
   disabled / not-wired states feel consistent.

## Validation gates

* `cargo test -p local-bridge --lib` includes registry / MCP /
  connector loaders with adversarial fixtures.
* `pnpm --filter @vac-web/web test -- --run` covers capability
  classifier pathways used by extension surfaces.
* Schema validation runs in CI for every YAML under `config/` and
  `examples/workflows/`.

## Trust model

This doc defines runtime boundaries — what extensions can do once loaded. The orthogonal question of whether to load a given extension at all is captured in [`docs/extension-trust-model.md`](./extension-trust-model.md), which defines the four-tier trust model (`bundled` / `verified` / `community` / `unsigned`), the sigstore + PGP signing pipeline, the operator allowlist source of truth (`config/extension-trust.yaml`, proposed), and the runtime gate (`profile-core::enforce_extension_trust`, proposed). See [ADR 0003](./adr/0003-extension-trust-model.md) for the design decision record.

## Anti-patterns to refuse

* In-process plugin loading without an ADR.
* Extension YAML that bypasses the command catalog (i.e. introduces an
  ad-hoc handler).
* Audit / persistence shortcuts for extensions.
* UI surfaces that special-case extension errors instead of routing
  through `errorTaxonomy.ts` / `notifyAttention.ts`.
