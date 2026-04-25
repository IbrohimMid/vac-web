// data.jsx — fixtures: gates, transcript, findings, sessions, activity

const GATES = [
  { id: "dev",     label: "Dev Complete",     status: "ok",   detail: "All criteria met • 2h ago" },
  { id: "qa",      label: "QA Complete",      status: "ok",   detail: "Smoke + regression passed" },
  { id: "stage",   label: "Ready for Staging", status: "warn", detail: "1 warning: missing env var" },
  { id: "deploy",  label: "Ready to Deploy",  status: "warn", detail: "3 blockers, 2 warnings" },
  { id: "publish", label: "Ready to Publish", status: "idle", detail: "Awaiting deploy gate" },
];

const PLANES = [
  { id: "build",     label: "Build",     icon: "build",     count: 2 },
  { id: "assess",    label: "Assess",    icon: "assess",    pill: "3 new" },
  { id: "handoff",   label: "Handoff",   icon: "handoff",   count: 1 },
  { id: "release",   label: "Release",   icon: "release" },
  { id: "knowledge", label: "Knowledge", icon: "knowledge" },
  { id: "sessions",  label: "Sessions",  icon: "sessions" },
];

const ASSESS_SUB = [
  { id: "rtd",       label: "Ready to Deploy",   status: "warn" },
  { id: "product",   label: "Product Review",    status: "ok" },
  { id: "ux",        label: "UX Review",         status: "warn" },
  { id: "frontend",  label: "Frontend Review",   status: "ok" },
  { id: "security",  label: "Security Review",   status: "crit" },
  { id: "reliability", label: "Reliability",     status: "ok" },
  { id: "performance", label: "Performance",     status: "warn" },
  { id: "qa",        label: "QA Strategy",       status: "idle" },
  { id: "release",   label: "Release Readiness", status: "idle" },
  { id: "launch",    label: "Launch Readiness",  status: "idle" },
];

const SCORECARDS = [
  { id: "tech",    label: "Technical",  plane: "build",     verdict: "Conditional", score: 78, status: "warn", blockers: 3, warnings: 5, freshness: "12m ago", lastRun: "vac assess rtd --standard" },
  { id: "product", label: "Product",    plane: "assess",    verdict: "Ready",       score: 92, status: "ok",   blockers: 0, warnings: 2, freshness: "1h ago",  lastRun: "vac assess product" },
  { id: "ux",      label: "UX",         plane: "assess",    verdict: "Conditional", score: 71, status: "warn", blockers: 1, warnings: 4, freshness: "1h ago",  lastRun: "vac assess ux" },
  { id: "release", label: "Release",    plane: "release",   verdict: "Blocked",     score: 44, status: "crit", blockers: 4, warnings: 3, freshness: "Stale",   lastRun: "—" },
  { id: "ops",     label: "Ops & Run",  plane: "release",   verdict: "Not run",     score: 0,  status: "idle", blockers: 0, warnings: 0, freshness: "—",       lastRun: "—" },
];

const TRANSCRIPT = [
  {
    id: "m1", who: "user", name: "You", time: "10:42",
    body: <>Add an idempotency-key header to <code>POST /payments/charge</code>. Validate it on the handler and short-circuit duplicates within a 24h window.</>,
  },
  {
    id: "m2", who: "agent", name: "VAC · Planner", time: "10:42",
    body: (
      <>
        <p style={{margin:"0 0 8px"}}>I'll plan this in three steps and ask for approval before any write.</p>
        <ol style={{margin:"0 0 8px 18px", padding:0, fontSize:13}}>
          <li>Add <code>idempotency_key</code> field to the <span className="badge mono">VWFD</span> charge schema</li>
          <li>Generate handler scaffold + Redis-backed dedupe (24h TTL)</li>
          <li>Add semantic test for replay + run <code>vac vil gen --check</code></li>
        </ol>
        <div className="row" style={{gap:6, marginTop:6}}>
          <span className="badge accent"><Icon name="vil" size={12} />vil-expr</span>
          <span className="badge"><Icon name="branch" size={12} />feat/idempotency</span>
          <span className="badge mono">3 files affected</span>
        </div>
      </>
    ),
  },
  {
    id: "m3", who: "agent", name: "VAC · Executor", time: "10:43",
    body: <p style={{margin:0}}>Updating <code>schemas/payments.vwfd.toml</code> with the new field. Awaiting approval.</p>,
    tool: { name: "vil_schema.update", args: "schemas/payments.vwfd.toml", status: "ok",
      out: `+ field idempotency_key: string {\n+   required = true\n+   max_len  = 128\n+   semantic = "request.idempotency"\n+ }` }
  },
  {
    id: "m4", who: "system", name: "Approval", time: "10:43",
    body: (
      <div className="row" style={{gap:8}}>
        <span className="badge ok"><Icon name="check" size={11} />Approved</span>
        <span className="muted">by you · auto-policy <span className="mono">vil_schema.update</span></span>
      </div>
    ),
  },
  {
    id: "m5", who: "agent", name: "VAC · Executor", time: "10:44",
    body: <p style={{margin:0}}>Generating handler scaffold from VWFD spec.</p>,
    tool: { name: "vil_codegen.handler", args: "--target rust --mode service", status: "ok",
      out: `▸ Generated src/handlers/charge.rs (114 lines)\n▸ Generated tests/charge_idempotency.rs\n▸ Updated Cargo.toml\n✓ vac vil gen --check passed (semantic parity OK)` }
  },
  {
    id: "m6", who: "agent", name: "VAC · Reviewer", time: "10:44",
    body: <>Edits look reasonable. <strong>One note:</strong> the dedupe TTL uses wall-clock time. Consider monotonic + jitter in a follow-up. I'll run a quick assess on Reliability before signaling complete.</>,
    streaming: true,
  },
];

const APPROVALS = [
  { id: "a1", icon: "file-code", title: "Edit  src/handlers/charge.rs", sub: "+114 / -3 lines · feat/idempotency", risk: "low" },
  { id: "a2", icon: "terminal",  title: "Run  cargo test --test charge_idempotency", sub: "shell · sandboxed", risk: "low" },
  { id: "a3", icon: "git",       title: "Commit  schema: add idempotency_key", sub: "git · feat/idempotency", risk: "low" },
  { id: "a4", icon: "shield",    title: "Run  vac vil gen --check --strict", sub: "shell · readonly", risk: "low" },
];

const ACTIVITY = [
  { id: "v1", icon: "check", text: <><strong>Executor</strong> applied 1 patch to <code>src/handlers/charge.rs</code></>, when: "now" },
  { id: "v2", icon: "spark", text: <><strong>Reviewer</strong> ran semantic parity check · OK</>, when: "1m ago" },
  { id: "v3", icon: "alert", text: <><strong>Reliability</strong> flagged: TTL wall-clock dependency (medium)</>, when: "2m ago" },
  { id: "v4", icon: "git",   text: <><strong>You</strong> approved <code>vil_schema.update</code></>, when: "3m ago" },
  { id: "v5", icon: "play-line", text: <><strong>Planner</strong> created task plan (3 steps)</>, when: "5m ago" },
  { id: "v6", icon: "github", text: <>GitHub: PR #428 sync completed</>, when: "12m ago" },
  { id: "v7", icon: "sentry", text: <>Sentry: 0 new issues in last 24h on <code>payments-svc</code></>, when: "1h ago" },
];

const FINDINGS = [
  { id: "f1", category: "Security",    severity: "crit", title: "Idempotency keys stored without expiry binding",
    desc: "Redis entries persist beyond the 24h dedupe window; replay window can extend if Redis fails over before TTL elapses. Bind expiry to monotonic store + verify on replay.",
    evidence: [{ src: "src/handlers/charge.rs:47", kind: "code" }, { src: "Sentry · payments-svc", kind: "runtime" }],
    fix: "Use monotonic key with stored fresh_until; verify TTL on read." },
  { id: "f2", category: "Reliability", severity: "high", title: "TTL relies on wall-clock; jitter needed",
    desc: "Wall-clock TTL means replays during NTP skew can dedupe incorrectly. Add a monotonic store + 5s jitter window.",
    evidence: [{ src: "src/handlers/charge.rs:62", kind: "code" }],
    fix: "Wrap with monotonic_clock + small jitter window." },
  { id: "f3", category: "UX",          severity: "high", title: "Duplicate-charge feedback is a 500, not a 409",
    desc: "Clients retrying see a generic server error instead of an idempotent 409 with the original receipt id. Operators on the helpdesk can't disambiguate.",
    evidence: [{ src: "Figma · Charge States v3", kind: "design" }, { src: "src/handlers/charge.rs:88", kind: "code" }],
    fix: "Return 409 + original transaction reference. Add UX state to client." },
  { id: "f4", category: "Performance", severity: "med",  title: "Redis call is on hot path without circuit breaker",
    desc: "If Redis is degraded, charge latency P95 spikes to 800ms+. No fail-open or hedged read.",
    evidence: [{ src: "Grafana · charge p95", kind: "metric" }],
    fix: "Add circuit breaker, hedge reads, fail open with audit log." },
  { id: "f5", category: "Product",     severity: "med",  title: "PRD acceptance #4 not represented in tests",
    desc: "PRD calls out 'merchant-supplied keys must be honored case-insensitively'. No test covers this.",
    evidence: [{ src: "Notion · Payments PRD §3.2", kind: "doc" }],
    fix: "Normalize keys; add property test." },
  { id: "f6", category: "Docs",        severity: "low",  title: "Public API reference missing new header",
    desc: "Reference docs still show the previous request shape.",
    evidence: [{ src: "Notion · API Reference", kind: "doc" }],
    fix: "Update reference + changelog entry." },
];

const SESSIONS_LIST = [
  { id: "s1", title: "Idempotent charge handler", project: "payments-svc", branch: "feat/idempotency", state: "active", turns: 28, ago: "now" },
  { id: "s2", title: "Webhook signing rotation",  project: "payments-svc", branch: "main",            state: "idle",   turns: 14, ago: "3h ago" },
  { id: "s3", title: "Onboarding KYC flow v2",    project: "ident-svc",    branch: "feat/kyc-v2",     state: "review", turns: 41, ago: "yesterday" },
  { id: "s4", title: "VWFD schema cleanup",       project: "shared-vil",   branch: "main",            state: "idle",   turns: 9,  ago: "2d ago" },
];

const RECENT_ASSESSMENTS = [
  { id: "r1", when: "10:51", title: "Ready to Deploy · standard",  who: "VAC swarm", verdict: "Conditional", status: "warn", count: "8 findings · 3 blockers" },
  { id: "r2", when: "10:36", title: "Security Review · quick",     who: "VAC swarm", verdict: "Blocked",     status: "crit", count: "2 critical, 4 high" },
  { id: "r3", when: "10:22", title: "Product Review · standard",   who: "VAC swarm", verdict: "Ready",       status: "ok",   count: "0 blockers, 2 warnings" },
  { id: "r4", when: "Yesterday", title: "UX Review · full",        who: "VAC swarm", verdict: "Conditional", status: "warn", count: "1 blocker, 4 warnings" },
];

Object.assign(window, { GATES, PLANES, ASSESS_SUB, SCORECARDS, TRANSCRIPT, APPROVALS, ACTIVITY, FINDINGS, SESSIONS_LIST, RECENT_ASSESSMENTS });
