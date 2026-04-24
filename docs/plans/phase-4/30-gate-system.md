# Plan 30 — Gate evaluation + ribbon + override

**Phase**: 4 · **Depends on**: Plans 26, 29 · **Blocks**: Phase 4 exit · **Est**: 2 days

## Goal

Implement the two v1 gates (`DevComplete`, `ReadyToDeploy`) end-to-end: policy loading, criterion evaluation, state persistence, topbar ribbon, detail drawer, override dialog with two-party logic, sign-off flow, audit trail.

## Why this is hard

Gates are governance. A bug here that lets someone single-party override a two-party gate is worse than a crash. Every transition audited. UI must make override feel deliberate (not a click-away "OK").

## Scope

### In
- Bridge: `GatePolicy` + `GateStatus` storage, evaluation engine, override + signoff logic.
- Web: GateRibbon, GateDetail drawer, OverrideDialog, SignoffDialog.
- Integration with assessment verdicts.
- Audit log.

### Out
- Remaining 4 gates (Phase 6).
- Per-project policy override UI (post-v1 feature).

## Deliverables

```
apps/local-bridge/src/gate/
├── mod.rs
├── policy.rs
├── evaluator.rs
├── state_store.rs
├── override.rs
├── signoff.rs
└── audit.rs
apps/web/src/
├── components/
│   ├── GateRibbon/
│   │   ├── GateRibbon.tsx
│   │   └── GateChip.tsx
│   └── GateDetail/
│       ├── GateDetail.tsx          # overlay kind=gate_detail
│       ├── CriterionRow.tsx
│       ├── OverridesSection.tsx
│       ├── SignoffsSection.tsx
│       ├── OverrideDialog.tsx      # overlay kind=override_dialog
│       └── SignoffDialog.tsx       # overlay kind=signoff_dialog
├── stores/gates.ts
```

## Stages

### S1 — Policy loader (0.2 day)

```rust
pub fn load_policy(gate: &str) -> Result<GatePolicy> {
    let path = format!("packages/protocol/v1/gate_policies/{}.yaml", gate);
    serde_yaml::from_str(&fs::read_to_string(path)?)
}
```

Per-project override at `.vac-web/gate-policies/<gate>.yaml` checked first.

Hash-pinned; edit requires manifest update.

**Exit**: both gate policies load.

### S2 — Criterion evaluator (0.4 day)

```rust
pub trait Criterion {
    fn id(&self) -> &str;
    async fn evaluate(&self, ctx: &GateContext) -> CriterionResult;
}
```

Implementations for default criteria from `gates.md §5`:
- `rtd_not_blocked`: latest RTD run exists, verdict ≠ BLOCKED.
- `security_pass`: latest Security run verdict = PASS.
- `rollback_plan_present`: file exists at `docs/runbooks/rollback.md` (heuristic) OR handoff pinned with rollback declared.
- `two_party_signed`: 2 distinct-role sign-offs present.
- ...

Registry of criterion implementations keyed by id.

**Exit**: each criterion tested with fixtures.

### S3 — GateState evaluator (0.2 day)

```rust
pub async fn evaluate_gate(gate: &str, scope: GateScope) -> Result<GateStatus> {
    let policy = load_policy(gate)?;
    let mut status = GateStatus::new(gate, scope);
    for crit_id in &policy.required_criteria {
        let crit = registry.get(crit_id)?;
        let result = crit.evaluate(&ctx).await;
        status.criteria.push(result);
    }
    let blockers = ...;  // unsatisfied required
    let warnings = ...;
    status.state = aggregate_state(&blockers, &warnings, &status.overrides);
    Ok(status)
}
```

Apply active overrides: if override exists + not expired + not revoked + covers this scope → state becomes `overridden` (never green unless criteria also met).

**Exit**: gate green/yellow/red/overridden correct across fixture scenarios.

### S4 — State storage + events (0.2 day)

```rust
pub struct GateStateStore {
    root: PathBuf,
}
impl GateStateStore {
    pub async fn load(&self, gate: &str, scope: &GateScope) -> Result<GateStatus>;
    pub async fn save(&self, status: &GateStatus) -> Result<()>;
}
```

On state change: emit `gate.state_changed { gate, before, after, reasons }`.

Debounce: avoid spam on rapid criterion changes.

**Exit**: state persisted; events emitted correctly.

### S5 — Override logic (0.3 day)

```rust
pub async fn apply_override(gate: &str, req: OverrideRequest, by: UserId) -> Result<OverrideId> {
    let policy = load_policy(gate)?;
    let role = lookup_role(by).await?;
    ensure!(policy.allowed_override_roles.contains(&role), "role not allowed");
    ensure!(req.reason.len() >= policy.min_reason_length, "reason too short");
    let max_duration = parse_duration(&policy.max_override_duration)?;
    ensure!(req.expires_at - now() <= max_duration, "duration exceeds policy");
    let absolute_max = parse_duration(&policy.absolute_max_override)?;
    ensure!(req.expires_at - now() <= absolute_max, "exceeds absolute max");
    if policy.require_evidence_on_override {
        ensure!(!req.attached_evidence_refs.is_empty(), "evidence required");
    }
    let id = OverrideId::new();
    // ... store + audit append + re-evaluate gate
    Ok(id)
}
```

Special: cannot override `two_party_signed` criterion — schema-enforced.

Revocation: `revoke_override` appends revoke entry; re-evaluation follows.

**Exit**: override enforcement red-team cases (RT-048, RT-049, RT-050) pass.

### S6 — Sign-off logic (0.2 day)

```rust
pub async fn apply_signoff(gate: &str, role: String, by: UserId, note: Option<String>) -> Result<()> {
    let status = load_status(gate).await?;
    if policy.require_two_party && !status.signoffs.iter().any(|s| s.role != role) {
        // First signoff → advance to partial state
    }
    status.signoffs.push(SignOff { role, by, at: now(), note });
    save(status).await?;
    audit::log(...);
    re_evaluate(gate).await?;
    Ok(())
}
```

Stale rule: if gate state changes to red after signoffs, signoffs remain but expire 24h after state change.

**Exit**: two-party sequencing tested.

### S7 — Audit layer (0.1 day)

Every lifecycle change appends to `audit/gates/<project_hash>/<gate>.jsonl`. Fields per `gates.md §7`.

**Exit**: audit entries on override, revoke, signoff, state_change.

### S8 — Web: GateRibbon (0.2 day)

```tsx
function GateRibbon() {
  const gates = useGates(s => s.relevant);    // filtered to project gates
  return (
    <nav className="gate-ribbon">
      {gates.map(g => <GateChip key={g.gate} status={g} />)}
    </nav>
  );
}

function GateChip({ status }) {
  const severity = stateToSeverity(status.state);
  return (
    <button
      data-state={status.state}
      onClick={() => overlays.open('gate_detail', { gate: status.gate })}
    >
      <SeverityIcon severity={severity} />
      <span>{gateLabel(status.gate)}</span>
    </button>
  );
}
```

Placed in Topbar (Plan 18). Updates via `gate.state_changed` events.

**Exit**: ribbon shows gates; click opens detail.

### S9 — GateDetail drawer (0.3 day)

Overlay kind `gate_detail`. Tabs or sections:
- Summary: state + last evaluated.
- Criteria: list with satisfied checkmark + evidence link.
- Blockers: red sections with "Fix" CTAs → open assessment finding or create handoff.
- Warnings: amber.
- Overrides: active + historical.
- Sign-offs: list.
- Audit trail: link to full log.

Actions:
- Re-evaluate now.
- Override (opens `override_dialog`).
- Sign off (opens `signoff_dialog`).
- Revoke override.

**Exit**: all sections render; CTAs function.

### S10 — OverrideDialog (0.2 day)

```tsx
function OverrideDialog({ gate }) {
  const [reason, setReason] = useState('');
  const [expiresIn, setExpiresIn] = useState('7d');
  const [scope, setScope] = useState<'this_run' | 'until_expiry' | 'branch'>('until_expiry');
  const [evidence, setEvidence] = useState<EvidenceRef[]>([]);
  const submit = async () => {
    const ack = await transport.send(...'gate.override', { gate, reason, scope, expiresAt: computeExpiry(expiresIn), evidenceRefs: evidence });
    if (!ack.ok) ...error...;
    else overlays.dismissAll();
  };
  return (
    <Dialog>
      <h2>Override {gateLabel(gate)}</h2>
      <Warning>Override creates an audited exception. Reason below becomes part of the permanent record.</Warning>
      <textarea minLength={20} placeholder="Reason (min 20 chars)" value={reason} onChange={...} />
      <ExpiryPicker max={policy.max_override_duration} value={expiresIn} onChange={setExpiresIn} />
      <ScopeSelect value={scope} onChange={setScope} />
      {policy.require_evidence_on_override && <EvidenceAttach value={evidence} onChange={setEvidence} />}
      <footer>
        <button onClick={() => overlays.dismiss(...)}>Cancel</button>
        <button onClick={submit} disabled={reason.length < 20}>Apply override</button>
      </footer>
    </Dialog>
  );
}
```

Confirmation micro-copy explicit: "This override will be visible in the audit trail forever."

**Exit**: override dialog complete; denial paths (short reason, excessive expiry) prevented.

### S11 — SignoffDialog (0.1 day)

Similar, with role confirmation + optional note. For two-party gates, shows existing sign-off (if any) with its role; prevents same-role double-signing.

**Exit**: two-party flow completes end-to-end.

### S12 — Visual polish (0.1 day)

Overridden state: purple tint banner "Override active until [date] by [role]. [Revoke]."

Red state: sticky banner (lane: sticky) via notify routing.

**Exit**: visuals distinguishable at glance.

## Testing

- Unit: policy, criterion evaluation, override guard.
- Integration: full override + signoff flow.
- Red-team: RT-047 (override two_party_signed), RT-048, RT-049, RT-050 pass.

## Exit criteria

- [ ] DevComplete + ReadyToDeploy evaluate correctly.
- [ ] Override dialog enforces policy.
- [ ] Two-party working.
- [ ] Audit trail complete.
- [ ] Ribbon + detail UI polished.

## Risks

| Risk | Mitigation |
|---|---|
| Gate state stale | Auto-reevaluate every policy interval + on source-verdict change |
| Override UX too easy | Multi-step dialog; explicit audit warning |
| Signoff role spoofing | Bridge looks up role from user identity; client-claimed role ignored |
| Missing criterion registry entry | CI check: every criterion id in policy must have implementation |

## Related

- [`gates.md`](../../gates.md)
- Plan 26 — assessment runs (source of truth for criteria)
- Plan 33 — handoff approvals also have similar two-party (shared component?)
