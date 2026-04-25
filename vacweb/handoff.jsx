// handoff.jsx — Handoff Builder + Approval + Dispatch + small Release/Knowledge/Sessions

const HandoffBuilder = ({ selectedFindings, onApprove, onBack }) => {
  const accepted = FINDINGS.filter(f => selectedFindings.has(f.id));
  const fallback = FINDINGS.slice(0, 3);
  const items = accepted.length ? accepted : fallback;

  return (
    <div className="page" data-screen-label="Handoff builder">
      <div className="page-narrow">
        <div className="page-hd">
          <div>
            <div className="row" style={{gap:8, marginBottom:6}}>
              <button className="btn sm ghost" onClick={onBack}><Icon name="chevron-l" size={12} />Back to report</button>
              <span className="badge"><PlaneDot plane="handoff" />Handoff</span>
            </div>
            <h1>Handoff packet · Draft</h1>
            <div className="sub">{items.length} findings · target executor.code · payments-svc @ 7e3a91f</div>
          </div>
          <div className="right">
            <button className="btn ghost"><Icon name="doc" size={12} />Export blueprint</button>
            <button className="btn primary" onClick={onApprove}><Icon name="check" size={13} />Approve & dispatch</button>
          </div>
        </div>

        <div className="handoff-grid">
          <div>
            <div className="section-hd" style={{margin:"0 0 12px"}}>
              <h2>Tasks · ordered</h2>
              <span className="sub">Drag to reorder. Each task carries its own evidence.</span>
            </div>
            {items.map((f, i) => (
              <div key={f.id} className="task-card">
                <div className="row" style={{gap:10, alignItems:"flex-start"}}>
                  <div className="task-num">{i + 1}</div>
                  <div className="flex1">
                    <div className="row" style={{gap:8}}>
                      <Sev level={f.severity} />
                      <div style={{fontWeight:500, fontSize:13.5}}>{f.title}</div>
                      <span className="badge">{f.category}</span>
                    </div>
                    <div className="muted" style={{fontSize:12.5, marginTop:6, lineHeight:1.5}}>{f.fix}</div>
                    <div className="row" style={{gap:6, marginTop:8, flexWrap:"wrap"}}>
                      {f.evidence.map((e, j) => (
                        <span key={j} className="badge"><Icon name={e.kind === "code" ? "file-code" : e.kind === "design" ? "figma" : e.kind === "doc" ? "notion" : e.kind === "metric" ? "trend-up" : "sentry"} size={10} />{e.src}</span>
                      ))}
                    </div>
                  </div>
                  <div className="col" style={{alignItems:"flex-end", gap:4}}>
                    <button className="icon-btn"><Icon name="more" size={14} /></button>
                    <span className="muted" style={{fontSize:11}}>~{15 + i*5}m est.</span>
                  </div>
                </div>
              </div>
            ))}

            <div className="card" style={{padding:14, marginTop:14, borderStyle:"dashed"}}>
              <div className="row" style={{gap:10}}>
                <Icon name="plus" size={14} style={{color:"var(--ink-3)"}} />
                <span className="muted" style={{fontSize:13}}>Add task or attach an additional finding</span>
              </div>
            </div>

            <div className="section-hd"><h2>Constraints & rationale</h2></div>
            <div className="card" style={{padding:14}}>
              <div className="muted" style={{fontSize:12.5, marginBottom:8}}>Constraints applied to this packet</div>
              <div className="row" style={{gap:6, flexWrap:"wrap", marginBottom:14}}>
                <span className="badge"><Icon name="branch" size={10} />must stay on feat/idempotency</span>
                <span className="badge"><Icon name="lock" size={10} />no schema breaking changes</span>
                <span className="badge"><Icon name="shield" size={10} />profile: executor.code · standard</span>
                <span className="badge"><Icon name="zap" size={10} />wall-clock-free TTL preferred</span>
              </div>
              <div className="muted" style={{fontSize:12.5, marginBottom:6}}>Rationale (visible to executor)</div>
              <div style={{fontSize:13, lineHeight:1.55, color:"var(--ink-2)", padding:10, background:"var(--bg-sunken)", borderRadius:8}}>
                Resolve the security + reliability concerns surfaced by the RTD sweep. Keep changes minimal — the schema and handler signatures are already in review. Prefer monotonic-clock dedupe with a 5s jitter window. Failed Redis lookups should fail open with an audit log entry, never block a charge silently.
              </div>
            </div>
          </div>

          <aside>
            <div className="packet-side">
              <div>
                <div className="muted" style={{fontSize:11.5, textTransform:"uppercase", letterSpacing:".06em", fontWeight:600}}>Packet</div>
                <div className="strong" style={{fontSize:18, marginTop:4}}>VAC-2418</div>
                <div className="muted" style={{fontSize:12, marginTop:2}}>Draft · auto-saved 2s ago</div>
              </div>

              <div className="divider-soft"></div>

              <div>
                <div className="packet-row"><span className="l">Source runs</span><span className="v">RTD #f2 · Sec #f7</span></div>
                <div className="packet-row"><span className="l">Tasks</span><span className="v">{items.length}</span></div>
                <div className="packet-row"><span className="l">Risk</span><span className="v" style={{color:"var(--warn)"}}>Medium</span></div>
                <div className="packet-row"><span className="l">Est. effort</span><span className="v">~45m</span></div>
                <div className="packet-row"><span className="l">Snapshot</span><span className="v" style={{fontFamily:"var(--font-mono)", fontSize:11.5}}>7e3a91f</span></div>
                <div className="packet-row"><span className="l">Fresh until</span><span className="v">tomorrow 10:51</span></div>
              </div>

              <div className="divider-soft"></div>

              <div>
                <div className="muted" style={{fontSize:12, marginBottom:6}}>Dispatch to</div>
                <div className="card" style={{padding:10, display:"flex", gap:10, alignItems:"center", border:"1px solid var(--accent)"}}>
                  <div className="msg-avatar agent" style={{borderRadius:6}}><Icon name="terminal" size={12} /></div>
                  <div className="flex1">
                    <div style={{fontWeight:500, fontSize:13}}>Local VAC executor</div>
                    <div className="muted" style={{fontSize:11.5}}>localhost:5183 · executor.code</div>
                  </div>
                  <Icon name="check-circle" size={14} style={{color:"var(--accent)"}} />
                </div>
                <div className="card" style={{padding:10, display:"flex", gap:10, alignItems:"center", marginTop:6, opacity:.7}}>
                  <div className="msg-avatar system" style={{borderRadius:6}}><Icon name="git" size={12} /></div>
                  <div className="flex1">
                    <div style={{fontWeight:500, fontSize:13}}>Web CLI executor</div>
                    <div className="muted" style={{fontSize:11.5}}>not paired</div>
                  </div>
                </div>
              </div>

              <div className="divider-soft"></div>

              <div>
                <div className="muted" style={{fontSize:12, marginBottom:6}}>Sign-off</div>
                <label className="row" style={{gap:8, fontSize:12.5}}>
                  <input type="checkbox" defaultChecked style={{accentColor:"var(--accent)"}} />
                  Auto-reassess after executor completes
                </label>
                <label className="row" style={{gap:8, fontSize:12.5, marginTop:6}}>
                  <input type="checkbox" style={{accentColor:"var(--accent)"}} />
                  Notify on every approval prompt
                </label>
              </div>

              <button className="btn primary lg" onClick={onApprove} style={{justifyContent:"center"}}>
                <Icon name="check" size={14} />Approve & dispatch
              </button>
              <button className="btn ghost" style={{justifyContent:"center"}}>Save draft</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

// ---- Light Release / Knowledge / Sessions placeholders ----
const ReleasePage = () => (
  <div className="page" data-screen-label="Release">
    <div className="page-narrow">
      <div className="page-hd">
        <div><h1>Release</h1><div className="sub">Deploy, publish, runbooks, and post-release monitoring</div></div>
        <div className="right"><button className="btn"><Icon name="play" size={11} />Run release readiness</button></div>
      </div>
      <div className="next-grid">
        {[
          { t: "Deploy readiness", s: "Env, secrets, migrations, rollback safety", st: "warn", d: "3 blockers" },
          { t: "Publish readiness", s: "Store/web release prerequisites", st: "idle", d: "Awaiting deploy gate" },
          { t: "Release notes", s: "Auto-drafted from merged PRs and findings", st: "ok", d: "Draft ready" },
          { t: "Runbooks", s: "Ops handoff, support notes, incident pack", st: "warn", d: "1 missing runbook" },
        ].map((c, i) => (
          <div key={i} className="next-card">
            <div className="row" style={{gap:8}}>
              <span className={`badge ${c.st}`}>{c.d}</span>
            </div>
            <h3>{c.t}</h3>
            <div className="body">{c.s}</div>
            <div className="foot"><button className="btn sm">Open</button></div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const KnowledgePage = () => (
  <div className="page" data-screen-label="Knowledge">
    <div className="page-narrow">
      <div className="page-hd">
        <div><h1>Knowledge & Connectors</h1><div className="sub">Read-only by default · connectors feed evidence into every assessment</div></div>
        <div className="right"><button className="btn primary"><Icon name="plus" size={11} />Add connector</button></div>
      </div>
      <div className="next-grid">
        {[
          { n: "GitHub", i: "github", s: "payments-svc · 12 commits ahead", st: "ok" },
          { n: "Notion", i: "notion", s: "Payments PRD · 4 docs synced", st: "ok" },
          { n: "Figma", i: "figma", s: "Charge States v3 · 4 frames", st: "ok" },
          { n: "Sentry", i: "sentry", s: "0 new issues 24h", st: "ok" },
          { n: "Grafana", i: "trend-up", s: "12 dashboards", st: "ok" },
          { n: "CI/CD", i: "play-line", s: "GitHub Actions · 8 workflows", st: "warn" },
        ].map(c => (
          <div key={c.n} className="next-card">
            <div className="row" style={{gap:10}}>
              <Icon name={c.i} size={20} />
              <div><h3 style={{margin:0}}>{c.n}</h3><div className="muted" style={{fontSize:12}}>{c.s}</div></div>
              <div className="spacer"></div>
              <span className={`badge ${c.st}`}>{c.st === "ok" ? "connected" : "needs attention"}</span>
            </div>
            <div className="foot"><button className="btn sm ghost">Configure</button><span className="badge">read-only</span></div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const SessionsPage = ({ onOpen }) => (
  <div className="page" data-screen-label="Sessions">
    <div className="page-narrow">
      <div className="page-hd">
        <div><h1>Sessions</h1><div className="sub">All work threads. Resume any of them — VAC restores the full state.</div></div>
        <div className="right"><button className="btn primary"><Icon name="plus" size={11} />New session</button></div>
      </div>
      <div className="timeline-card">
        {SESSIONS_LIST.map(s => (
          <div key={s.id} className="timeline-row" onClick={() => onOpen("build")} style={{gridTemplateColumns:"20px 240px 1fr auto auto"}}>
            <Icon name="dot" size={10} style={{color: s.state === "active" ? "var(--ok)" : "var(--ink-5)"}} />
            <span><strong>{s.title}</strong></span>
            <span className="muted" style={{fontSize:12.5}}>
              {s.project} · <span className="mono">{s.branch}</span> · {s.turns} turns
            </span>
            <span className="badge">{s.state}</span>
            <span className="muted" style={{fontSize:12}}>{s.ago}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ---- Command palette ----
const PALETTE_ITEMS = [
  { section: "Navigate", items: [
    { k: "Open Build", icon: "build", route: "build" },
    { k: "Open Readiness Hub", icon: "assess", route: "assess" },
    { k: "Open Handoff", icon: "handoff", route: "handoff" },
    { k: "Open Sessions", icon: "sessions", route: "sessions" },
  ]},
  { section: "Actions", items: [
    { k: "Run Ready to Deploy · standard", icon: "play", action: "run-rtd" },
    { k: "Run Security Review · quick", icon: "shield", action: "run-sec" },
    { k: "Create handoff from selected findings", icon: "handoff", action: "new-handoff" },
    { k: "Reassess current findings", icon: "refresh", action: "reassess" },
    { k: "New session", icon: "plus", action: "new-session" },
  ]},
  { section: "Workbench", items: [
    { k: "Approvals", icon: "check-circle", action: "wb-approvals" },
    { k: "Review", icon: "diff", action: "wb-review" },
    { k: "Agents", icon: "bot", action: "wb-agents" },
    { k: "VIL inspector", icon: "vil", action: "wb-vil" },
  ]},
];

const Palette = ({ onClose, onAction }) => {
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const flat = [];
  PALETTE_ITEMS.forEach(s => s.items.forEach(it => {
    if (!q || it.k.toLowerCase().includes(q.toLowerCase())) flat.push({ ...it, section: s.section });
  }));
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(flat.length - 1, i + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    if (e.key === "Enter")     { e.preventDefault(); onAction(flat[idx]); }
    if (e.key === "Escape")    onClose();
  };

  let lastSection = null;
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input className="palette-input" autoFocus
               placeholder="Type a command, page, or assessment…"
               value={q} onChange={e => { setQ(e.target.value); setIdx(0); }}
               onKeyDown={onKey} />
        <div className="palette-list">
          {flat.map((it, i) => {
            const showSection = it.section !== lastSection;
            lastSection = it.section;
            return (
              <React.Fragment key={i}>
                {showSection && <div className="palette-section">{it.section}</div>}
                <div className={`palette-item ${i === idx ? "active" : ""}`}
                     onMouseEnter={() => setIdx(i)}
                     onClick={() => onAction(it)}>
                  <span className="icon"><Icon name={it.icon} size={12} /></span>
                  <span>{it.k}</span>
                  {i === idx && <span className="kbd"><Kbd>↵</Kbd></span>}
                </div>
              </React.Fragment>
            );
          })}
          {flat.length === 0 && <div className="empty"><div className="icon-wrap"><Icon name="search" size={18} /></div>No matches</div>}
        </div>
      </div>
    </div>
  );
};

// ---- Toast ----
const Toast = ({ items }) => (
  <div className="toast-stack">
    {items.map(t => (
      <div key={t.id} className="toast">
        <Icon name={t.icon || "check"} size={14} style={{color: t.tone === "ok" ? "var(--ok)" : t.tone === "warn" ? "var(--warn)" : "var(--accent)"}} />
        <span>{t.text}</span>
      </div>
    ))}
  </div>
);

Object.assign(window, { HandoffBuilder, ReleasePage, KnowledgePage, SessionsPage, Palette, Toast });
