// shell.jsx — Sidebar, Topbar (with gate ribbon), Right Rail

const Sidebar = ({ active, onNav, sidebarCollapsed }) => {
  return (
    <aside className="sidebar">
      <div className="side-section">Workspace</div>
      {PLANES.slice(0, 2).map(p => (
        <div key={p.id}
             className={`side-item ${active === p.id ? "active" : ""}`}
             onClick={() => onNav(p.id)}>
          <Icon name={p.icon} size={16} />
          <span>{p.label}</span>
          {p.count != null && <span className="count">{p.count}</span>}
          {p.pill && <span className="pill-mini">{p.pill}</span>}
        </div>
      ))}

      {!sidebarCollapsed && active === "assess" && (
        <div style={{margin: "2px 0 6px"}}>
          {ASSESS_SUB.map(s => (
            <div key={s.id} className="side-item side-sub" style={{height: 26, fontSize: 12.5}}>
              <span className={`gate-pill`} style={{padding: 0, height: "auto", background: "transparent"}}>
                <span className={`dot ${s.status}`}></span>
              </span>
              <span style={{color: "var(--ink-2)"}}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {PLANES.slice(2).map(p => (
        <div key={p.id}
             className={`side-item ${active === p.id ? "active" : ""}`}
             onClick={() => onNav(p.id)}>
          <Icon name={p.icon} size={16} />
          <span>{p.label}</span>
          {p.count != null && <span className="count">{p.count}</span>}
          {p.pill && <span className="pill-mini">{p.pill}</span>}
        </div>
      ))}

      <div className="side-section" style={{marginTop: 12}}>Recent</div>
      {SESSIONS_LIST.slice(0, 3).map(s => (
        <div key={s.id} className="side-item" style={{height: 28, fontSize: 12.5}}>
          <Icon name="dot" size={10} style={{color: s.state === "active" ? "var(--ok)" : "var(--ink-5)"}} />
          <span style={{whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{s.title}</span>
        </div>
      ))}

      <div className="side-foot">
        <span className="dot"></span>
        <span>Local engine · 3 agents idle</span>
      </div>
    </aside>
  );
};

const GateRibbon = ({ activeGate, setActiveGate }) => (
  <div className="gate-ribbon" data-screen-label="Gate ribbon">
    {GATES.map(g => (
      <div key={g.id}
           className={`gate-pill ${activeGate === g.id ? "active" : ""}`}
           onClick={() => setActiveGate(g.id)}
           title={g.detail}>
        <span className={`dot ${g.status}`}></span>
        <span>{g.label}</span>
      </div>
    ))}
  </div>
);

const Topbar = ({ project, onCmdK, theme, setTheme, onTweaks, activeGate, setActiveGate }) => (
  <header className="topbar">
    <div className="brand">
      <div className="brand-mark">V</div>
      <span className="brand-name">VAC</span>
      <span className="brand-sep">/</span>
      <span className="brand-project">{project}</span>
      <Icon name="chevron-d" size={13} style={{color: "var(--ink-4)", marginLeft: 2}} />
    </div>
    <div className="topbar-divider"></div>
    <GateRibbon activeGate={activeGate} setActiveGate={setActiveGate} />
    <div className="topbar-spacer"></div>
    <button className="search-trigger" onClick={onCmdK}>
      <Icon name="search" size={14} />
      <span>Search, run, navigate…</span>
      <span className="kbd"><kbd>⌘</kbd><kbd>K</kbd></span>
    </button>
    <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
      <Icon name={theme === "dark" ? "circle-half" : "circle"} size={15} />
    </button>
    <button className="icon-btn" title="Notifications">
      <Icon name="bell" size={15} />
    </button>
    <button className="icon-btn" onClick={onTweaks} title="Tweaks">
      <Icon name="settings" size={15} />
    </button>
    <Avatar name="Asa" />
  </header>
);

// ---------------- Right Rail ----------------
const Rail = ({ tab, setTab }) => {
  const tabs = ["Activity", "Notify", "Context", "Memory"];
  return (
    <aside className="rail">
      <div className="rail-tabs">
        {tabs.map(t => (
          <div key={t}
               className={`rail-tab ${tab === t ? "active" : ""}`}
               onClick={() => setTab(t)}>
            {t}
            {t === "Activity" && <span className="badge accent" style={{padding:"0 5px",fontSize:10,height:14,lineHeight:"14px"}}>live</span>}
            {t === "Notify" && <span style={{color:"var(--crit)"}}>•</span>}
          </div>
        ))}
      </div>
      <div className="rail-body">
        {tab === "Activity" && <RailActivity />}
        {tab === "Notify"   && <RailNotify />}
        {tab === "Context"  && <RailContext />}
        {tab === "Memory"   && <RailMemory />}
      </div>
    </aside>
  );
};

const RailActivity = () => (
  <>
    <div style={{display:"flex", alignItems:"center", gap:8, marginBottom: 8}}>
      <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)"}}>Live activity</div>
      <span className="badge ok"><span className="dot" style={{background:"currentColor"}}></span>Streaming</span>
    </div>
    {ACTIVITY.map(a => (
      <div key={a.id} className="act-item">
        <div className="act-icon"><Icon name={a.icon} size={13} /></div>
        <div className="act-body">
          <div>{a.text}</div>
          <div className="when">{a.when}</div>
        </div>
      </div>
    ))}
  </>
);

const RailNotify = () => (
  <>
    <div className="notif-item">
      <div className="row" style={{gap:6}}>
        <span className="badge crit">Blocker</span>
        <span className="muted" style={{fontSize:11}}>2m ago</span>
      </div>
      <div style={{marginTop:6, fontSize:13, fontWeight:500}}>Security review found a critical finding</div>
      <div className="muted" style={{fontSize:12.5, marginTop:4, lineHeight:1.5}}>
        Idempotency keys stored without expiry binding. Open the report to review evidence.
      </div>
      <div className="row" style={{gap:6, marginTop:10}}>
        <button className="btn sm primary">Open report</button>
        <button className="btn sm ghost">Dismiss</button>
      </div>
    </div>
    <div className="notif-item">
      <div className="row" style={{gap:6}}>
        <span className="badge info">Handoff ready</span>
        <span className="muted" style={{fontSize:11}}>14m ago</span>
      </div>
      <div style={{marginTop:6, fontSize:13, fontWeight:500}}>3 findings ready to send to executor</div>
      <div className="muted" style={{fontSize:12.5, marginTop:4, lineHeight:1.5}}>
        From RTD + Reliability runs. Awaiting your approval.
      </div>
      <div className="row" style={{gap:6, marginTop:10}}>
        <button className="btn sm">Review packet</button>
      </div>
    </div>
    <div className="notif-item">
      <div className="row" style={{gap:6}}>
        <span className="badge ok">Gate update</span>
        <span className="muted" style={{fontSize:11}}>1h ago</span>
      </div>
      <div style={{marginTop:6, fontSize:13, fontWeight:500}}>QA Complete gate passed</div>
      <div className="muted" style={{fontSize:12.5, marginTop:4, lineHeight:1.5}}>Smoke + regression suite passed on staging build #1284.</div>
    </div>
  </>
);

const RailContext = () => (
  <>
    <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)", marginBottom: 8}}>Connectors</div>
    {[
      { name: "GitHub",  icon: "github", sub: "payments-svc · feat/idempotency · 12 commits ahead", status: "ok" },
      { name: "Notion",  icon: "notion", sub: "Payments PRD · §3.2 · 2 unread", status: "ok" },
      { name: "Figma",   icon: "figma",  sub: "Charge States v3 · 4 frames", status: "ok" },
      { name: "Sentry",  icon: "sentry", sub: "payments-svc · 0 new issues 24h", status: "ok" },
    ].map(c => (
      <div key={c.name} className="evidence-card" style={{marginBottom: 6}}>
        <Icon name={c.icon} size={14} />
        <div className="flex1">
          <div style={{fontSize:12.5, fontWeight:500}}>{c.name}</div>
          <div className="src" style={{fontFamily:"var(--font-sans)", fontSize:11.5}}>{c.sub}</div>
        </div>
        <span className="badge ok" style={{padding:"1px 5px"}}>read-only</span>
      </div>
    ))}
    <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)", margin: "14px 0 8px"}}>Active context</div>
    <div className="evidence-card">
      <Icon name="file-code" size={14} />
      <div className="flex1">
        <div style={{fontSize:12.5}}>src/handlers/charge.rs</div>
        <div className="src">+114 / -3 · live</div>
      </div>
    </div>
    <div className="evidence-card">
      <Icon name="vil" size={14} style={{color:"var(--accent-2)"}} />
      <div className="flex1">
        <div style={{fontSize:12.5}}>schemas/payments.vwfd.toml</div>
        <div className="src">VWFD · semantic OK</div>
      </div>
    </div>
  </>
);

const RailMemory = () => (
  <>
    <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)", marginBottom: 8}}>Session memory</div>
    <div className="muted" style={{fontSize:12.5, lineHeight:1.55, marginBottom: 14}}>
      VAC remembers facts across sessions. Pinned items stay forever; auto items decay if unused.
    </div>
    {[
      { type: "pinned", text: "Idempotency keys must be honored case-insensitively (PRD §3.2)" },
      { type: "pinned", text: "Production Redis cluster: redis-prod-payments, region us-east-1" },
      { type: "auto",   text: "Branch convention: feat/* for features, fix/* for hotfixes" },
      { type: "auto",   text: "Reviewer prefers monotonic clocks for TTL-bound dedupe" },
    ].map((m, i) => (
      <div key={i} className="notif-item" style={{padding:"8px 12px"}}>
        <div className="row" style={{gap:6}}>
          <span className={`badge ${m.type === "pinned" ? "accent" : ""}`} style={{padding:"1px 6px",fontSize:10.5}}>
            {m.type === "pinned" ? "Pinned" : "Auto"}
          </span>
        </div>
        <div style={{fontSize:12.5, marginTop:4, lineHeight:1.45}}>{m.text}</div>
      </div>
    ))}
  </>
);

Object.assign(window, { Sidebar, Topbar, Rail });
