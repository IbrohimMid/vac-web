# Plan 36 — Remaining assessor families playbook

**Phase**: 6 · **Depends on**: Plan 31 · **Blocks**: Phase 6 exit · **Est**: 3–4 weeks (can parallelize)

## Goal

Author the 10 remaining assessor families to complete v1 coverage: UX, Frontend, Security, Reliability, Performance, Release, Launch, QA, Docs, Growth. Each family follows the same template as RTD/PM (Plan 31).

## Why this is hard

Each family is its own domain with distinct inputs, evidence sources, synthesizer logic, and expert pattern knowledge. The playbook format prevents re-inventing structure per family; the content per family is what takes time.

## Scope

### In
- Swarm catalogs + agent prompts for 10 families.
- Profile YAMLs for new connectors where needed.
- Check catalogs.
- Per-family fixtures.
- New connectors: Sentry, Datadog, Vercel, Cloudflare, PostHog, GA4, Mixpanel, Snyk, Dependabot, Lighthouse CI, PagerDuty, Grafana.

### Out
- Release plane UI (Plan 37).
- Hosted dispatch (Plan 38).

## Per-family template

Each family produces:
```
vastar-agentic-cli/crates/vac_core/assets/swarms/<family>.yaml
vastar-agentic-cli/crates/vac_core/assets/swarms/<family>/
  ├── <agent_1>.md
  ├── <agent_2>.md
  ├── ...
  └── <family>_synthesizer.md
packages/protocol/v1/checks/<family>.md
tests/fixtures/swarms/<family>-*/
```

## Family specifications

### 36.1 — UX Review (`assessor.ux`)

**Agents**:
- `ux_friction`: excessive steps, unclear CTAs, feedback gaps.
- `cognitive_load`: too many options per screen, decision fatigue signals.
- `mobile_friction`: touch target sizes, viewport issues, gestures.
- `empty_loading_error_states`: coverage + quality.
- `accessibility`: axe-like checks, keyboard, ARIA.
- `ux_synthesizer`.

**Evidence kinds**: file (components), connector:figma (designs), connector:posthog (funnels), screenshot.

**Profile**: `assessor.ux@1.0.0` (inherits base + connectors figma, posthog).

### 36.2 — Frontend Review (`assessor.frontend`)

**Agents**:
- `screen_coverage`: routes vs specced flows.
- `component_reuse`: duplicate implementations, missed primitives.
- `responsive_gaps`: media query holes.
- `state_visualizations`: loading, empty, error states per screen.
- `navigation_integrity`: dead links, 404s, back behaviour.
- `frontend_synthesizer`.

**Evidence**: file, component inventory, connector:figma.

### 36.3 — Security Review (`assessor.security`)

**Agents**:
- `dependency_vulns`: via Snyk/Dependabot.
- `secrets_exposure`: scan repo + CI artifacts.
- `authz_gaps`: common misuse patterns (missing auth decorators, exposed endpoints).
- `input_validation`: XSS/SSRF/CSRF class risks.
- `misconfig`: CORS, CSP, cookie flags.
- `security_synthesizer` (verdict: PASS/WARN/FAIL).

**Evidence**: file, connector:snyk, connector:dependabot, connector:sentry (for runtime exploits).

### 36.4 — Reliability Review (`assessor.reliability`)

**Agents**:
- `crash_risk`: unhandled errors, panics.
- `retry_idempotency`: retryability of write paths.
- `failure_modes`: degradation vs hard fail.
- `health_checks_timeout_cb`: presence + config.
- `incident_blast_radius`: scope analysis.
- `reliability_synthesizer`.

**Evidence**: file, connector:sentry, connector:datadog, connector:grafana, connector:pagerduty.

### 36.5 — Performance Review (`assessor.perf`)

**Agents**:
- `slow_paths`: hot functions, N+1.
- `frontend_weight`: bundle size, LCP/CLS.
- `cold_start`: serverless/SSR startup.
- `query_efficiency`: db access patterns.
- `scale_assumptions`: implicit limits.
- `perf_synthesizer`.

**Evidence**: file, connector:datadog, connector:posthog, connector:lighthouse_ci.

### 36.6 — Release Readiness (`assessor.release`)

**Agents**:
- `release_notes_present`: draft or generator readiness.
- `rollback_documented`: runbook exists + tested.
- `comms_plan`: changelog + user communication.
- `legal_compliance_recap`: any terms, privacy impacting.
- `release_synthesizer` (verdict: READY/CONDITIONAL/BLOCKED).

**Evidence**: file, connector:github (releases API), connector:notion.

### 36.7 — Launch Readiness (`assessor.launch`)

**Agents**:
- `seo_basics`: meta, sitemap, robots.
- `metadata_social`: Open Graph, Twitter cards.
- `analytics_install`: tracker present + fires on key events.
- `legal_pages`: ToS, privacy, cookies.
- `onboarding_first_run`: exists + smooth.
- `support_contact`: reachable.
- `launch_synthesizer` (completion-% based).

**Evidence**: file, http_get to landing page, connector:posthog/ga4.

### 36.8 — QA Plan (`assessor.qa`)

**Agents**:
- `smoke_test_coverage`: critical paths tested.
- `regression_matrix`: past bugs have tests.
- `exploratory_checklist`: suggests areas needing manual.
- `browser_device_risk`: matrix vs target.
- `qa_synthesizer` (coverage risk map).

**Evidence**: file, connector:ci (test results).

### 36.9 — Docs & Handoff (`assessor.docs`)

**Agents**:
- `user_guide_coverage`: features documented.
- `runbook_presence`: ops runbooks up-to-date.
- `api_reference_accuracy`: matches code surface.
- `changelog_ready`: entry exists for pending release.
- `support_handoff`: docs prepped for support team.
- `docs_synthesizer`.

**Evidence**: file, connector:notion, connector:github (wiki).

### 36.10 — Growth Readiness (`assessor.growth`)

**Agents**:
- `activation_path`: primary "aha" moment defined + measurable.
- `referral_shareability`: sharing mechanisms.
- `landing_page_clarity`: value prop comprehensibility.
- `demo_readiness`: demo-able without setup friction.
- `growth_instrumentation`: key events tracked.
- `growth_synthesizer`.

**Evidence**: file, connector:posthog/ga4/mixpanel, http_get landing.

## Stages (per family, can parallelize)

### Per-family stages (repeat 10 times)

- **S1 — Draft swarm catalog** (0.3 day): YAML per family spec above.
- **S2 — Author agent prompts** (1.5 day): one per agent; apply RTD/PM prompt discipline.
- **S3 — Synthesizer prompt** (0.3 day): scoring rules, verdict logic.
- **S4 — Check catalog doc** (0.3 day): user-facing.
- **S5 — Fixtures** (0.4 day): 2 per family (known-issue + clean).
- **S6 — Red-team sanity** (0.2 day): run all profile red-team cases; no writes occur.

Total per family: ~3 days.

## Connector rollout (parallel with families)

New adapters needed: see families' evidence lists.

Each adapter:
- `Connector` trait impl in `apps/local-bridge/src/connectors/`.
- OAuth if applicable; otherwise API-key config.
- Rate limiter config.
- Read method surface enumerated.
- Snapshot capture.
- Integration test with dev account.
- Host allowlist entries in relevant assessor profiles.

Priority order (driven by family dependency):
1. `sentry`, `datadog`, `grafana`, `pagerduty` (Reliability/Security/Perf).
2. `snyk`, `dependabot` (Security).
3. `posthog`, `ga4`, `mixpanel` (UX/Launch/Growth).
4. `vercel`, `cloudflare` (RTD/Release).
5. `lighthouse_ci` (Perf).

## Testing

- Fixture-based regression per family.
- Manual run on 3 real projects per family.
- Connector OAuth end-to-end.
- Red-team coverage: no writes ever.

## Exit criteria

- [ ] All 10 families operational.
- [ ] Fixtures + manual sampling confirm accuracy.
- [ ] Connectors integrated + documented.
- [ ] All profiles shipped + hashed in manifest.
- [ ] Readiness Hub shows all scorecards.

## Risks

| Risk | Mitigation |
|---|---|
| Prompt quality varies across families | Common prompt template + review checklist |
| Connector API drift | Versioned adapters; integration tests |
| Cost blowup with 10+ families | Depth limits + token budgets per family |
| Scorecard fatigue | Guided mode (Plan 39) picks subset per project type |

## Related

- Plan 31 — RTD + PM reference implementation
- Plan 24 — connector infrastructure
- [`capability-profiles.md`](../../capability-profiles.md) §4.1 — family profile inheritance
