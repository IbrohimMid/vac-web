// assess.jsx — Readiness Hub, Assessment list/run, Assessment Report, Reassess

const ReadinessHub = ({ onOpen, onRunAssessment }) => (
  <div className="page" data-screen-label="Readiness Hub">
    <div className="page-narrow">
      <div className="page-hd">
        <div>
          <h1>Readiness</h1>
          <div className="sub">payments-svc · feat/idempotency · 5 scorecards · last sweep 12 minutes ago</div>
        </div>
        <div className="right">
          <button className="btn"><Icon name="refresh" size={13} />Refresh all</button>
          <button className="btn primary" onClick={onRunAssessment}><Icon name="play" size={11} />Run full sweep</button>
        </div>
      </div>

      <div className="score-grid">
        {SCORECARDS.map(s => (
          <div key={s.id} className="score-card" onClick={() => onOpen("assess", "report")}>
            <div className="score-hd">
              <span className="label"><PlaneDot plane={s.plane} />{s.label}</span>
              <div className="spacer"></div>
              <span className="muted" style={{fontSize:11.5}}>{s.freshness}</span>
            </div>
            <div>
              <div className={`score-verdict ${s.status}`}>{s.verdict}</div>
              <div className="muted" style={{fontSize:12, marginTop:4}}>
                {s.status === "idle" ? "Not yet evaluated" : `${s.blockers} blockers · ${s.warnings} warnings`}
              </div>
            </div>
            <div className="score-meter"><div className={`fill ${s.status}`} style={{width: `${s.score}%`}}></div></div>
            <div className="score-foot">
              <span className="mono" style={{fontSize:11}}>{s.lastRun}</span>
              <div className="score-actions">
                <button className="btn sm ghost"><Icon name="play-line" size={11} />Run</button>
                <button className="btn sm">Open<Icon name="chevron-r" size={11} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="section-hd">
        <h2>What to do next</h2>
        <span className="sub">Recommended by VAC based on the latest sweep</span>
      </div>
      <div className="next-grid">
        <div className="next-card" style={{borderLeft:"3px solid var(--crit)"}}>
          <div className="row" style={{gap:8}}>
            <span className="badge crit">Blocker · Security</span>
            <span className="muted" style={{fontSize:11.5}}>2 critical findings</span>
          </div>
          <h3>Resolve security blockers before deploy</h3>
          <div className="body">
            Idempotency keys stored without expiry binding can extend the replay window across Redis failover. The handoff packet is ready — just needs your approval.
          </div>
          <div className="foot">
            <button className="btn primary sm" onClick={() => onOpen("handoff")}><Icon name="handoff" size={12} />Review handoff</button>
            <button className="btn sm ghost">View finding</button>
          </div>
        </div>
        <div className="next-card" style={{borderLeft:"3px solid var(--warn)"}}>
          <div className="row" style={{gap:8}}>
            <span className="badge warn">Recommended · UX</span>
            <span className="muted" style={{fontSize:11.5}}>1 high finding</span>
          </div>
          <h3>Map duplicate-charge errors to a 409 + receipt id</h3>
          <div className="body">
            Clients retrying see a generic 500 instead of an idempotent 409 with the original receipt id. Helpdesk operators can't disambiguate today.
          </div>
          <div className="foot">
            <button className="btn sm">Open finding</button>
            <button className="btn sm ghost">Add to handoff</button>
          </div>
        </div>
        <div className="next-card">
          <div className="row" style={{gap:8}}>
            <span className="badge info">Run next</span>
          </div>
          <h3>Release Readiness</h3>
          <div className="body">
            You haven't run release readiness yet. It checks release notes, runbooks, comms, and rollout plan freshness.
          </div>
          <div className="foot">
            <button className="btn sm primary"><Icon name="play" size={11} />Run · standard</button>
          </div>
        </div>
        <div className="next-card">
          <div className="row" style={{gap:8}}>
            <span className="badge accent">Auto-suggested</span>
          </div>
          <h3>Reassess after applying handoff</h3>
          <div className="body">
            Once the executor finishes the security + reliability work, VAC can auto-rerun RTD and show the resolved/persistent/new diff.
          </div>
          <div className="foot">
            <button className="btn sm">Configure auto-reassess</button>
          </div>
        </div>
      </div>

      <div className="section-hd">
        <h2>Recent assessments</h2>
        <div className="right"><button className="btn sm ghost">See all</button></div>
      </div>
      <div className="timeline-card">
        {RECENT_ASSESSMENTS.map(r => (
          <div key={r.id} className="timeline-row">
            <span className={`sev-dot ${r.status === "ok" ? "low" : r.status === "warn" ? "high" : "crit"}`}></span>
            <span className="when">{r.when} · <span className="actor">{r.who}</span></span>
            <span><strong>{r.title}</strong> · <span className="muted">{r.count}</span></span>
            <span className={`badge ${r.status}`}>{r.verdict}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ---------------- Assessment Report ----------------
const AssessmentReport = ({ onCreateHandoff, selectedFindings, toggleFinding }) => {
  const counts = { crit: 0, high: 0, med: 0, low: 0 };
  FINDINGS.forEach(f => counts[f.severity]++);
  return (
    <div className="page" data-screen-label="Assessment report">
      <div className="page-narrow">
        <div className="page-hd">
          <div>
            <div className="row" style={{gap:8, marginBottom:6}}>
              <button className="btn sm ghost"><Icon name="chevron-l" size={12} />Readiness</button>
              <span className="muted">/</span>
              <span className="badge"><PlaneDot plane="assess" />Assess</span>
            </div>
            <h1>Ready to Deploy · standard sweep</h1>
            <div className="sub">payments-svc · base 7e3a91f · 8 findings · 4m 12s · 5 connectors used</div>
          </div>
          <div className="right">
            <button className="btn"><Icon name="refresh" size={13} />Reassess</button>
            <button className="btn primary" onClick={onCreateHandoff} disabled={selectedFindings.size === 0}>
              <Icon name="handoff" size={12} />Create handoff ({selectedFindings.size})
            </button>
          </div>
        </div>

        <div className="report-grid">
          <div>
            <div className="findings-list">
              <div className="findings-toolbar">
                <span className="badge accent">{selectedFindings.size} selected</span>
                <span className="badge"><Icon name="filter" size={11} />All categories</span>
                <span className="badge"><Icon name="filter" size={11} />Severity ≥ medium</span>
                <div className="spacer"></div>
                <button className="btn sm ghost"><Icon name="check" size={12} />Select all blockers</button>
              </div>
              {FINDINGS.map(f => (
                <FindingRow key={f.id} f={f}
                            checked={selectedFindings.has(f.id)}
                            onToggle={() => toggleFinding(f.id)} />
              ))}
            </div>
          </div>

          <aside className="report-side">
            <div className="verdict-card">
              <div className="muted" style={{fontSize:11.5, textTransform:"uppercase", letterSpacing:".06em", fontWeight:600}}>Verdict</div>
              <div className="verdict-big warn">Conditional</div>
              <div className="verdict-sub">3 blockers must be resolved before this gate can pass. The remaining warnings are recommended but not required.</div>
              <div className="verdict-stat-grid">
                <div className="vstat"><div className="n" style={{color:"var(--crit)"}}>{counts.crit}</div><div className="l">Critical</div></div>
                <div className="vstat"><div className="n" style={{color:"var(--warn)"}}>{counts.high}</div><div className="l">High</div></div>
                <div className="vstat"><div className="n" style={{color:"var(--info)"}}>{counts.med}</div><div className="l">Medium</div></div>
                <div className="vstat"><div className="n">{counts.low}</div><div className="l">Low</div></div>
              </div>
            </div>

            <div className="card">
              <div className="card-hd"><div className="card-title">Run details</div></div>
              <div className="card-body" style={{fontSize:12.5}}>
                <div className="kv-row"><span className="k">Profile</span><span className="v">assessor.standard</span></div>
                <div className="kv-row"><span className="k">Repo</span><span className="v">payments-svc @ 7e3a91f</span></div>
                <div className="kv-row"><span className="k">Connectors</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>GitHub, Notion, Sentry, Figma, Grafana</span></div>
                <div className="kv-row"><span className="k">Triggered</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>by Asa · 10:51</span></div>
                <div className="kv-row"><span className="k">Snapshot</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>fresh until 22:51</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-hd"><div className="card-title">Compared to last run</div></div>
              <div className="card-body">
                <div className="kv-row"><span className="k" style={{color:"var(--ok)"}}>Resolved</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>2 findings</span></div>
                <div className="kv-row"><span className="k" style={{color:"var(--warn)"}}>Persistent</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>4 findings</span></div>
                <div className="kv-row"><span className="k" style={{color:"var(--crit)"}}>New</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>2 findings</span></div>
                <div className="kv-row"><span className="k">Regressed</span><span className="v" style={{fontFamily:"var(--font-sans)"}}>0</span></div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

const FindingRow = ({ f, checked, onToggle }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="finding-row" onClick={() => setOpen(o => !o)}>
      <div className={`check ${checked ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        {checked && <Icon name="check" size={12} />}
      </div>
      <div>
        <div className="ttl">
          <Sev level={f.severity} />
          <span>{f.title}</span>
          <span className="badge">{f.category}</span>
        </div>
        <div className="desc">{f.desc}</div>
        {open && (
          <>
            <div style={{marginTop:10}} className="muted">Evidence</div>
            {f.evidence.map((e, i) => (
              <div key={i} className="evidence-card">
                <Icon name={e.kind === "code" ? "file-code" : e.kind === "design" ? "figma" : e.kind === "doc" ? "notion" : e.kind === "metric" ? "trend-up" : "sentry"} size={13} />
                <span className="src">{e.src}</span>
                <div className="spacer"></div>
                <button className="btn sm ghost"><Icon name="eye" size={11} />Open</button>
              </div>
            ))}
            <div style={{marginTop:10, fontSize:12.5}}>
              <span className="muted">Suggested fix · </span>{f.fix}
            </div>
          </>
        )}
        <div className="meta">
          <SeverityBadge level={f.severity} />
          <span className="badge"><Icon name="check-circle" size={10} />evidence: {f.evidence.length}</span>
          <span className="badge accent"><Icon name="zap" size={10} />auto-fixable</span>
        </div>
      </div>
      <div className="right">
        <button className="btn sm"><Icon name="plus" size={11} />Handoff</button>
        <button className="btn sm ghost">Defer</button>
      </div>
    </div>
  );
};

// ---------------- Run Assessment Drawer ----------------
const RunAssessmentDrawer = ({ onClose, onRun, depth, setDepth }) => (
  <>
    <div className="drawer-overlay" onClick={onClose}></div>
    <aside className="drawer">
      <div className="drawer-hd">
        <div className="strong" style={{fontSize:14}}>Run assessment</div>
        <div className="spacer"></div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="drawer-body">
        <div className="muted" style={{fontSize:12.5, marginBottom:10}}>What should VAC look at?</div>
        <div className="col" style={{gap:6, marginBottom: 18}}>
          {[
            { id: "rtd", l: "Ready to Deploy", s: "Deployment prerequisites, infra, rollback, observability" },
            { id: "product", l: "Product Review", s: "Flow logic, business fit, acceptance" },
            { id: "ux", l: "UX Review", s: "User flow, CTA clarity, states, onboarding" },
            { id: "security", l: "Security Review", s: "Auth/authz, secrets, deps, misconfig" },
            { id: "all", l: "All families", s: "Full sweep across all assessors" },
          ].map((o, i) => (
            <label key={o.id} className="card" style={{padding:12, display:"flex", gap:10, alignItems:"flex-start", cursor:"default"}}>
              <input type="radio" name="ftype" defaultChecked={i === 0} style={{marginTop:3, accentColor:"var(--accent)"}} />
              <div>
                <div style={{fontWeight:500}}>{o.l}</div>
                <div className="muted" style={{fontSize:12, marginTop:2, lineHeight:1.45}}>{o.s}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="muted" style={{fontSize:12.5, marginBottom:6}}>Depth</div>
        <div className="row" style={{gap:6, marginBottom: 18}}>
          {["quick", "standard", "full"].map(d => (
            <button key={d}
                    className={`btn ${depth === d ? "primary" : ""}`}
                    onClick={() => setDepth(d)}
                    style={{flex:1}}>
              {d === "quick" ? "Quick · ~1m" : d === "standard" ? "Standard · ~5m" : "Full · ~15m"}
            </button>
          ))}
        </div>

        <div className="muted" style={{fontSize:12.5, marginBottom:6}}>Connectors</div>
        <div className="col" style={{gap:6}}>
          {[
            { name: "GitHub", on: true }, { name: "Notion", on: true },
            { name: "Sentry", on: true }, { name: "Figma", on: false },
            { name: "Grafana", on: true },
          ].map(c => (
            <div key={c.name} className="card" style={{padding:"8px 12px", display:"flex", gap:10, alignItems:"center"}}>
              <Icon name={c.name.toLowerCase()} size={14} />
              <div className="flex1" style={{fontSize:13}}>{c.name}</div>
              <span className="badge ok" style={{padding:"1px 5px"}}>read-only</span>
              <input type="checkbox" defaultChecked={c.on} style={{accentColor:"var(--accent)"}} />
            </div>
          ))}
        </div>
      </div>
      <div className="approval-detail-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <div className="spacer"></div>
        <button className="btn primary" onClick={onRun}><Icon name="play" size={11} />Run assessment</button>
      </div>
    </aside>
  </>
);

// ---------------- Streaming progress (run in progress) ----------------
const AssessmentRunning = ({ progress, onComplete }) => {
  const families = [
    { id: "rtd", l: "Deployment readiness", st: progress >= 1 ? "done" : progress >= 0.6 ? "running" : "pending", findings: 3 },
    { id: "sec", l: "Security checks", st: progress >= 1 ? "done" : progress >= 0.4 ? "running" : "pending", findings: 2 },
    { id: "rel", l: "Reliability checks", st: progress >= 0.8 ? "done" : progress >= 0.2 ? "running" : "pending", findings: 1 },
    { id: "perf", l: "Performance scan", st: progress >= 0.6 ? "done" : "pending", findings: 1 },
    { id: "doc", l: "Docs & runbook", st: progress >= 0.4 ? "done" : "pending", findings: 1 },
  ];
  return (
    <div className="page" data-screen-label="Assessment running">
      <div className="page-narrow" style={{maxWidth: 720}}>
        <div className="page-hd">
          <div>
            <h1>Running RTD · standard</h1>
            <div className="sub">VAC swarm is reading your repo and connectors. This stays on your machine.</div>
          </div>
        </div>

        <div className="card">
          <div style={{padding:18}}>
            <div className="score-meter" style={{height:8}}>
              <div className="fill" style={{width: `${Math.round(progress*100)}%`, background: "var(--accent)"}}></div>
            </div>
            <div className="row" style={{marginTop:8, fontSize:12.5}}>
              <span className="muted">{Math.round(progress*100)}% · ~{Math.max(0, Math.round((1-progress)*240))}s remaining</span>
              <div className="spacer"></div>
              <span className="muted">{families.filter(f => f.st === "done").length} / {families.length} families complete</span>
            </div>
          </div>
          <div className="divider-h"></div>
          {families.map(f => (
            <div key={f.id} className="approval-row" style={{borderBottom:"1px solid var(--line-soft)"}}>
              <div className="icon">
                {f.st === "done" && <Icon name="check" size={12} style={{color:"var(--ok)"}} />}
                {f.st === "running" && <span className="caret" style={{height:10, width:10, borderRadius:"50%", background:"var(--accent)"}}></span>}
                {f.st === "pending" && <Icon name="dot" size={10} style={{color:"var(--ink-5)"}} />}
              </div>
              <div>
                <div className="ttl" style={{fontSize:13}}>{f.l}</div>
                <div className="sub" style={{fontFamily:"var(--font-sans)"}}>
                  {f.st === "done" && `${f.findings} findings · finished`}
                  {f.st === "running" && "Reading evidence…"}
                  {f.st === "pending" && "Queued"}
                </div>
              </div>
              <div className="actions">
                <span className={`badge ${f.st === "done" ? "ok" : f.st === "running" ? "accent" : ""}`}>
                  {f.st}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="row" style={{justifyContent:"flex-end", marginTop:14, gap:8}}>
          <button className="btn ghost">Run in background</button>
          <button className="btn primary" onClick={onComplete}>Skip to report (demo)</button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ReadinessHub, AssessmentReport, RunAssessmentDrawer, AssessmentRunning });
