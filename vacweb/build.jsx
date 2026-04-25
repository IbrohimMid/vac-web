// build.jsx — Build Cockpit (transcript + composer + workbench + shell)

const Build = ({ wbTab, setWbTab, shellOpen, setShellOpen, splitFr, transcriptStreaming }) => {
  const [selectedApproval, setSelectedApproval] = React.useState(APPROVALS[0].id);
  const ap = APPROVALS.find(a => a.id === selectedApproval);
  return (
    <div className="main" data-screen-label="Build cockpit">
      <div className={`build-grid ${shellOpen ? "shell-open" : ""}`}
           style={{ "--transcript-fr": `${splitFr}fr`, "--workbench-fr": `${2 - splitFr}fr` }}>
        <Transcript streaming={transcriptStreaming} />
        <Workbench tab={wbTab} setTab={setWbTab}
                   shellOpen={shellOpen} setShellOpen={setShellOpen}
                   selectedApproval={selectedApproval} setSelectedApproval={setSelectedApproval}
                   ap={ap} />
        {shellOpen && <ShellDrawer onClose={() => setShellOpen(false)} />}
      </div>
    </div>
  );
};

const Transcript = ({ streaming }) => {
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streaming]);

  return (
    <div className="transcript-pane">
      <div className="transcript-hd">
        <Icon name="dot" size={10} style={{color: "var(--ok)"}} />
        <span className="session-title">Idempotent charge handler</span>
        <span className="badge mono"><Icon name="branch" size={11} />feat/idempotency</span>
        <span className="badge"><Icon name="vil" size={11} style={{color:"var(--accent-2)"}} />VIL · payments-svc</span>
        <span className="muted" style={{marginLeft:"auto", fontSize:12}}>28 turns · started 2h ago</span>
        <button className="icon-btn" title="Session info"><Icon name="more" size={14} /></button>
      </div>
      <div className="transcript-scroll" ref={scrollRef}>
        <div className="transcript-inner">
          {TRANSCRIPT.map(m => <Message key={m.id} m={m} streaming={streaming && m.streaming} />)}
        </div>
      </div>
      <Composer />
    </div>
  );
};

const Message = ({ m, streaming }) => (
  <div className="msg">
    <div className={`msg-avatar ${m.who}`}>
      {m.who === "user"   ? "Y" : null}
      {m.who === "agent"  ? <Icon name="bot" size={14} /> : null}
      {m.who === "system" ? <Icon name="check" size={13} /> : null}
    </div>
    <div className="msg-body">
      <div className="msg-meta">
        <span className="who">{m.name}</span>
        <span>{m.time}</span>
      </div>
      <div className="msg-content">
        {m.body}
        {streaming && <span className="caret"></span>}
      </div>
      {m.tool && <ToolCall tc={m.tool} />}
    </div>
  </div>
);

const ToolCall = ({ tc }) => {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="tool-call">
      <div className="tool-call-hd" onClick={() => setOpen(o => !o)}>
        <span className="tool-icon"><Icon name="zap" size={12} /></span>
        <span className="name">{tc.name}</span>
        <span className="args">{tc.args}</span>
        <span className="status"><span className="badge ok"><Icon name="check" size={10} />ok</span></span>
        <Icon name={open ? "chevron-d" : "chevron-r"} size={13} style={{color:"var(--ink-4)"}} />
      </div>
      {open && <div className="tool-call-body">{tc.out}</div>}
    </div>
  );
};

const Composer = () => {
  const [text, setText] = React.useState("");
  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="composer-chips">
          <span className="context-chip"><Icon name="folder" size={11} />payments-svc<span className="x">×</span></span>
          <span className="context-chip"><Icon name="file-code" size={11} />charge.rs<span className="x">×</span></span>
          <span className="context-chip"><Icon name="vil" size={11} style={{color:"var(--accent-2)"}} />payments.vwfd<span className="x">×</span></span>
          <span className="context-chip" style={{color:"var(--ink-4)"}}><Icon name="plus" size={11} />Add context</span>
        </div>
        <div className="composer-input"
             contentEditable
             suppressContentEditableWarning
             data-placeholder="Ask, plan, or run a slash command…  type / for actions, @ to mention"
             onInput={(e) => setText(e.currentTarget.textContent)}>
        </div>
        <div className="composer-foot">
          <div className="left">
            <button className="icon-btn" title="Attach"><Icon name="paperclip" size={14} /></button>
            <button className="icon-btn" title="Slash command"><Icon name="slash" size={14} /></button>
            <button className="icon-btn" title="Mention"><Icon name="at" size={14} /></button>
          </div>
          <div className="right">
            <span className="model-pill">
              <Icon name="bot" size={12} />
              VAC swarm · planner+exec
              <Icon name="chevron-d" size={11} />
            </span>
            <span className="model-pill">
              <Icon name="shield" size={12} style={{color:"var(--accent-2)"}} />
              policy: standard
            </span>
            <button className="btn primary"><Icon name="send" size={13} />Send <Kbd>↵</Kbd></button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ----------- Workbench -----------
const WB_TABS = [
  { id: "approvals", label: "Approvals", count: 4 },
  { id: "review",    label: "Review" },
  { id: "agents",    label: "Agents" },
  { id: "runtime",   label: "Runtime" },
  { id: "plan",      label: "Plan" },
  { id: "vil",       label: "VIL" },
  { id: "vwfd",      label: "VWFD" },
  { id: "memory",    label: "Memory" },
];

const Workbench = ({ tab, setTab, shellOpen, setShellOpen, selectedApproval, setSelectedApproval, ap }) => (
  <div className="workbench">
    <div className="tabs">
      {WB_TABS.map(t => (
        <div key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
          {t.label}{t.count != null && <span className="count">{t.count}</span>}
        </div>
      ))}
      <div className="spacer"></div>
      <button className={`icon-btn ${shellOpen ? "bordered" : ""}`} onClick={() => setShellOpen(o => !o)} title="Shell drawer">
        <Icon name="terminal" size={14} />
      </button>
      <button className="icon-btn" title="Dock"><Icon name="panel-b" size={14} /></button>
    </div>
    <div className="wb-body">
      {tab === "approvals" && <ApprovalsView selected={selectedApproval} setSelected={setSelectedApproval} ap={ap} />}
      {tab === "review"    && <ReviewView />}
      {tab === "agents"    && <AgentsView />}
      {tab === "runtime"   && <RuntimeView />}
      {tab === "plan"      && <PlanView />}
      {tab === "vil"       && <VilView />}
      {tab === "vwfd"      && <VwfdView />}
      {tab === "memory"    && <MemoryView />}
    </div>
  </div>
);

const ApprovalsView = ({ selected, setSelected, ap }) => (
  <>
    <div className="approval-list">
      <div style={{padding:"10px 14px", display:"flex", alignItems:"center", gap:8, borderBottom:"1px solid var(--line-soft)"}}>
        <span className="badge accent">{APPROVALS.length} pending</span>
        <span className="muted" style={{fontSize:12}}>Auto-approve policy: <span className="mono">standard</span></span>
        <div className="spacer"></div>
        <button className="btn sm">Approve all</button>
        <button className="btn sm ghost">Reject all</button>
      </div>
      <div style={{flex:1, overflowY:"auto", minHeight:0}}>
        {APPROVALS.map(a => (
          <div key={a.id} className={`approval-row ${selected === a.id ? "selected" : ""}`} onClick={() => setSelected(a.id)}>
            <div className="icon"><Icon name={a.icon} size={13} /></div>
            <div>
              <div className="ttl">{a.title}</div>
              <div className="sub">{a.sub}</div>
              <div className="row" style={{gap:6, marginTop:6}}>
                <span className="badge ok"><span className="dot" style={{background:"currentColor"}}></span>low risk</span>
                <span className="badge"><Icon name="lock" size={10} />sandboxed</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn sm ghost"><Icon name="x" size={12} /></button>
              <button className="btn sm primary"><Icon name="check" size={12} />Approve</button>
            </div>
          </div>
        ))}
      </div>
    </div>
    <div className="approval-detail">
      <div className="approval-detail-hd">
        <div style={{fontSize:13, fontWeight:600}}>{ap.title}</div>
        <div className="muted" style={{fontSize:12, marginTop:2}}>{ap.sub}</div>
        <div className="row" style={{gap:6, marginTop:8}}>
          <span className="badge ok">low risk</span>
          <span className="badge"><Icon name="user" size={10} />Executor</span>
          <span className="badge"><Icon name="branch" size={10} />feat/idempotency</span>
        </div>
      </div>
      <div className="approval-detail-body">
        <div className="muted" style={{marginBottom:6}}>Diff preview · src/handlers/charge.rs</div>
        <pre>{`@@ -42,6 +42,18 @@
 pub async fn charge(req: ChargeRequest) -> Result<ChargeResponse, Error> {
+    // Idempotency key check (24h dedupe window)
+    let key = req.idempotency_key
+        .as_deref()
+        .ok_or(Error::MissingHeader("Idempotency-Key"))?;
+
+    if let Some(prev) = dedupe::lookup(key).await? {
+        return Ok(prev.response);
+    }
+
     let txn = Transaction::new(&req)?;
     let resp = process(txn).await?;
+    dedupe::store(key, &resp, Duration::hours(24)).await?;
     Ok(resp)
 }`}</pre>
        <div className="muted" style={{margin:"12px 0 4px"}}>Affected files</div>
        <div className="kv-row"><span className="k">Edit</span><span className="v">src/handlers/charge.rs (+12, −0)</span></div>
        <div className="kv-row"><span className="k">New</span><span className="v">src/dedupe.rs</span></div>
        <div className="kv-row"><span className="k">New</span><span className="v">tests/charge_idempotency.rs</span></div>
        <div className="muted" style={{margin:"12px 0 4px"}}>Policy match</div>
        <div className="kv-row"><span className="k">Tool</span><span className="v">vil_codegen.handler</span></div>
        <div className="kv-row"><span className="k">Profile</span><span className="v">executor.code · standard</span></div>
        <div className="kv-row"><span className="k">Trust</span><span className="v">internal · signed</span></div>
      </div>
      <div className="approval-detail-foot">
        <button className="btn ghost"><Icon name="x" size={13} />Reject</button>
        <div className="spacer"></div>
        <button className="btn">Modify</button>
        <button className="btn primary"><Icon name="check" size={13} />Approve & run</button>
      </div>
    </div>
  </>
);

const ReviewView = () => (
  <div style={{flex:1, display:"flex", flexDirection:"column", overflow:"hidden"}}>
    <div style={{padding:"10px 14px", display:"flex", gap:8, borderBottom:"1px solid var(--line-soft)"}}>
      <span className="badge"><Icon name="file-code" size={11} />src/handlers/charge.rs</span>
      <span className="badge ok">+12</span>
      <span className="badge crit">−0</span>
      <div className="spacer"></div>
      <button className="btn sm ghost"><Icon name="diff" size={12} />Side-by-side</button>
      <button className="btn sm">Comment</button>
    </div>
    <div style={{flex:1, overflowY:"auto", padding:"14px 18px", fontFamily:"var(--font-mono)", fontSize:12, lineHeight:1.65}}>
      {[
        ["42", "pub async fn charge(req: ChargeRequest) -> Result<ChargeResponse, Error> {", null],
        ["43", "    // Idempotency key check (24h dedupe window)", "add"],
        ["44", "    let key = req.idempotency_key", "add"],
        ["45", "        .as_deref()", "add"],
        ["46", "        .ok_or(Error::MissingHeader(\"Idempotency-Key\"))?;", "add"],
        ["47", "", null],
        ["48", "    if let Some(prev) = dedupe::lookup(key).await? {", "add"],
        ["49", "        return Ok(prev.response);", "add"],
        ["50", "    }", "add"],
        ["51", "", null],
        ["52", "    let txn = Transaction::new(&req)?;", null],
        ["53", "    let resp = process(txn).await?;", null],
        ["54", "    dedupe::store(key, &resp, Duration::hours(24)).await?;", "add"],
        ["55", "    Ok(resp)", null],
        ["56", "}", null],
      ].map(([n, l, k], i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "44px 14px 1fr",
          background: k === "add" ? "rgba(47, 158, 110, 0.08)" : "transparent",
          padding: "0 10px", borderRadius: 4
        }}>
          <span style={{color:"var(--ink-4)", textAlign:"right", paddingRight: 12}}>{n}</span>
          <span style={{color: k === "add" ? "var(--ok)" : "var(--ink-5)"}}>{k === "add" ? "+" : " "}</span>
          <span>{l}</span>
        </div>
      ))}
    </div>
  </div>
);

const AgentsView = () => (
  <div style={{flex:1, padding:18, overflowY:"auto"}}>
    <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12}}>
      {[
        { name: "Planner",  role: "tri-lane", state: "idle",    work: "Awaiting input",       budget: "12.4k / 50k" },
        { name: "Executor", role: "tri-lane", state: "running", work: "Patch charge.rs",      budget: "31.2k / 80k" },
        { name: "Reviewer", role: "tri-lane", state: "running", work: "Semantic parity check", budget: "4.1k / 20k" },
      ].map(a => (
        <div key={a.name} className="card">
          <div className="card-hd">
            <div className="msg-avatar agent" style={{borderRadius:6}}><Icon name="bot" size={13} /></div>
            <div>
              <div className="card-title">{a.name}</div>
              <div className="card-sub">{a.role}</div>
            </div>
            <div className="spacer"></div>
            <span className={`badge ${a.state === "running" ? "accent" : ""}`}>
              <span className="dot" style={{background: a.state === "running" ? "var(--accent)" : "var(--ink-4)"}}></span>
              {a.state}
            </span>
          </div>
          <div className="card-body" style={{fontSize:12.5}}>
            <div className="kv-row"><span className="k">Working on</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>{a.work}</span></div>
            <div className="kv-row"><span className="k">Tokens</span><span className="v">{a.budget}</span></div>
            <div className="kv-row"><span className="k">Lane</span><span className="v">{a.name === "Executor" ? "B (write)" : a.name === "Planner" ? "A (plan)" : "C (review)"}</span></div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const RuntimeView = () => (
  <div style={{flex:1, padding:18, overflowY:"auto", fontSize:13}}>
    <div className="row" style={{gap:8, marginBottom: 14}}>
      <div className="card" style={{flex:1, padding:"10px 14px"}}>
        <div className="muted" style={{fontSize:11.5}}>Engine</div>
        <div className="strong" style={{fontSize:14}}>vac_core 0.42 · local</div>
      </div>
      <div className="card" style={{flex:1, padding:"10px 14px"}}>
        <div className="muted" style={{fontSize:11.5}}>Bridge</div>
        <div className="strong" style={{fontSize:14}}>localhost:5183 · paired</div>
      </div>
      <div className="card" style={{flex:1, padding:"10px 14px"}}>
        <div className="muted" style={{fontSize:11.5}}>Profile</div>
        <div className="strong" style={{fontSize:14}}>executor.code · standard</div>
      </div>
      <div className="card" style={{flex:1, padding:"10px 14px"}}>
        <div className="muted" style={{fontSize:11.5}}>Sandbox</div>
        <div className="strong" style={{fontSize:14}}>container · network=off</div>
      </div>
    </div>
    <div className="card">
      <div className="card-hd"><div className="card-title">Active jobs</div></div>
      <div>
        {[
          { name: "vac vil gen --check", who: "Reviewer", t: "00:04", st: "ok" },
          { name: "cargo test --test charge_idempotency", who: "Executor", t: "00:18", st: "ok" },
          { name: "vac assess reliability --quick", who: "Swarm", t: "01:03", st: "warn" },
        ].map((j, i) => (
          <div key={i} className="approval-row" style={{borderBottom:"1px solid var(--line-soft)"}}>
            <div className="icon"><Icon name="play-line" size={12} /></div>
            <div>
              <div className="ttl mono" style={{fontFamily:"var(--font-mono)", fontSize:12.5}}>{j.name}</div>
              <div className="sub" style={{fontFamily:"var(--font-sans)"}}>{j.who} · running {j.t}</div>
            </div>
            <div className="actions">
              <span className={`badge ${j.st === "ok" ? "ok" : "warn"}`}><span className="dot" style={{background:"currentColor"}}></span>healthy</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const PlanView = () => (
  <div style={{flex:1, padding:18, overflowY:"auto"}}>
    <div className="card">
      <div className="card-hd">
        <div className="card-title">Plan · Idempotent charge handler</div>
        <span className="badge accent">3 / 3 steps drafted</span>
        <div className="spacer"></div>
        <button className="btn sm ghost"><Icon name="edit" size={12} />Edit plan</button>
      </div>
      <div style={{padding:14}}>
        {[
          { n:1, t:"Update VWFD schema for idempotency_key", st:"done" },
          { n:2, t:"Generate handler + Redis-backed dedupe (24h TTL)", st:"running" },
          { n:3, t:"Add semantic test for replay; run vil gen --check", st:"pending" },
        ].map(s => (
          <div key={s.n} className="task-card row" style={{gap:10}}>
            <div className="task-num">{s.n}</div>
            <div className="flex1">
              <div style={{fontWeight:500}}>{s.t}</div>
              <div className="muted" style={{fontSize:12, marginTop:2}}>
                {s.st === "done" && "Completed · 4m"}
                {s.st === "running" && "In progress · ~2m remaining"}
                {s.st === "pending" && "Pending"}
              </div>
            </div>
            <span className={`badge ${s.st === "done" ? "ok" : s.st === "running" ? "accent" : ""}`}>
              {s.st}
            </span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const VilView = () => (
  <div style={{flex:1, padding:18, overflowY:"auto", fontSize:13}}>
    <div className="card">
      <div className="card-hd">
        <Icon name="vil" size={14} style={{color:"var(--accent-2)"}} />
        <div className="card-title">vil-expr · semantic IR</div>
        <span className="badge ok"><Icon name="check" size={10} />parity OK</span>
        <div className="spacer"></div>
        <button className="btn sm">Re-validate</button>
      </div>
      <div style={{padding:14, fontFamily:"var(--font-mono)", fontSize:12, lineHeight:1.6}}>
        <div className="muted" style={{marginBottom:6, fontFamily:"var(--font-sans)"}}>schemas/payments.vwfd.toml → IR</div>
        <pre style={{background:"var(--bg-sunken)", border:"1px solid var(--line)", borderRadius:8, padding:12, margin:0}}>{`(schema payments.charge
  (field amount       :money     :required)
  (field currency     :iso4217   :required)
  (field idempotency_key
                      :string
                      :required
                      :max 128
                      :semantic request.idempotency)
  (invariant
    (==> (present idempotency_key)
         (deduped 24h))))`}</pre>
      </div>
    </div>
  </div>
);

const VwfdView = () => (
  <div style={{flex:1, padding:18, overflowY:"auto"}}>
    <div className="card">
      <div className="card-hd">
        <Icon name="vil" size={14} style={{color:"var(--accent-2)"}} />
        <div className="card-title">VWFD inspector · payments.charge</div>
        <span className="badge ok">v3.2 → v3.3</span>
      </div>
      <div style={{padding:14}}>
        <div className="kv-row"><span className="k">Schema</span><span className="v">payments.charge</span></div>
        <div className="kv-row"><span className="k">Version</span><span className="v">v3.3 (drafted)</span></div>
        <div className="kv-row"><span className="k">Required</span><span className="v">amount, currency, merchant_id, idempotency_key</span></div>
        <div className="kv-row"><span className="k">Invariants</span><span className="v">2 (1 new)</span></div>
        <div className="kv-row"><span className="k">Handlers</span><span className="v">rust:src/handlers/charge.rs</span></div>
        <div className="kv-row"><span className="k">Parity</span><span className="v" style={{color:"var(--ok)"}}>OK · last check 12s ago</span></div>
      </div>
    </div>
  </div>
);

const MemoryView = () => (
  <div style={{flex:1, padding:18, overflowY:"auto"}}>
    <div className="muted" style={{marginBottom:10, fontSize:12.5}}>4 pinned facts · 18 auto facts · 2 contradictions resolved</div>
    {[
      "PRD §3.2: idempotency keys honored case-insensitively",
      "Reviewer prefers monotonic clock for TTL-bound dedupe",
      "Production Redis: redis-prod-payments, us-east-1",
      "Branch convention: feat/* and fix/*",
    ].map((m, i) => (
      <div key={i} className="card" style={{padding:"10px 14px", marginBottom:8, display:"flex", gap:10}}>
        <Icon name="tag" size={14} style={{color:"var(--accent-2)"}} />
        <div className="flex1" style={{fontSize:13}}>{m}</div>
        <span className="badge accent">pinned</span>
      </div>
    ))}
  </div>
);

const ShellDrawer = ({ onClose }) => (
  <div className="shell-drawer">
    <div className="row" style={{gap:8, marginBottom:8}}>
      <span style={{color:"#888"}}>shell · sandbox · payments-svc</span>
      <div className="spacer"></div>
      <button className="icon-btn" onClick={onClose} style={{color:"#888"}}><Icon name="x" size={13} /></button>
    </div>
    <div className="shell-line"><span className="prompt">$</span> cargo test --test charge_idempotency</div>
    <div className="shell-line out">    Compiling payments-svc v0.4.2 (/repo)</div>
    <div className="shell-line out">     Finished test [unoptimized] target(s) in 4.18s</div>
    <div className="shell-line out">      Running tests/charge_idempotency.rs</div>
    <div className="shell-line ok">running 4 tests</div>
    <div className="shell-line ok">test charge_dedupes_within_window ... ok</div>
    <div className="shell-line ok">test charge_replay_returns_original ... ok</div>
    <div className="shell-line ok">test missing_key_rejects_400 ... ok</div>
    <div className="shell-line warn">test ttl_uses_monotonic_clock ... warning (skipped)</div>
    <div className="shell-line ok">test result: ok. 3 passed; 0 failed; 1 ignored</div>
    <div className="shell-line"><span className="prompt">$</span> <span className="caret"></span></div>
  </div>
);

Object.assign(window, { Build });
