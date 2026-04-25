// app.jsx — main App, navigation, tweaks, palette wiring

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "#0fb6a8",
  "density": "regular",
  "sidebarCollapsed": false,
  "railCollapsed": false,
  "splitFr": 1.2,
  "vilIntensity": "moderate",
  "assessDepth": "standard"
}/*EDITMODE-END*/;

const ACCENTS = [
  { name: "Mint",   v: "#0fb6a8", v2: "#0a9b8e", soft: "#d6f4f0", soft2: "#ebf9f6" },
  { name: "Sky",    v: "#3aa5e0", v2: "#2a8bc6", soft: "#dfeefb", soft2: "#eef6fc" },
  { name: "Sage",   v: "#5fa371", v2: "#488a59", soft: "#dfeede", soft2: "#eef6ee" },
  { name: "Lilac",  v: "#9377d8", v2: "#7a5fc4", soft: "#e8e0f7", soft2: "#f1ecfa" },
  { name: "Coral",  v: "#e08465", v2: "#c66a4d", soft: "#fadfd2", soft2: "#fbeee6" },
];

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply theme + accent + density to root
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.setAttribute("data-density", t.density);
    document.documentElement.setAttribute("data-vil", t.vilIntensity);
    const a = ACCENTS.find(x => x.v === t.accent) || ACCENTS[0];
    const r = document.documentElement.style;
    r.setProperty("--accent", a.v);
    r.setProperty("--accent-2", a.v2);
    r.setProperty("--accent-soft", t.theme === "dark" ? "#10302c" : a.soft);
    r.setProperty("--accent-soft-2", t.theme === "dark" ? "#0a1c1a" : a.soft2);
  }, [t.theme, t.accent, t.density, t.vilIntensity]);

  const [route, setRoute] = React.useState("build");
  const [reportKind, setReportKind] = React.useState(null);   // null | "report"
  const [activeGate, setActiveGate] = React.useState("deploy");
  const [wbTab, setWbTab] = React.useState("approvals");
  const [shellOpen, setShellOpen] = React.useState(false);
  const [railTab, setRailTab] = React.useState("Activity");

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [runDrawerOpen, setRunDrawerOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runProgress, setRunProgress] = React.useState(0);

  const [selectedFindings, setSelectedFindings] = React.useState(new Set(["f1", "f2", "f3"]));
  const toggleFinding = (id) => setSelectedFindings(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const [toasts, setToasts] = React.useState([]);
  const pushToast = (text, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, { id, text, ...opts }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3200);
  };

  const [streaming, setStreaming] = React.useState(true);
  React.useEffect(() => {
    if (!streaming) return;
    const t = setTimeout(() => setStreaming(false), 8000);
    return () => clearTimeout(t);
  }, [streaming]);

  // Cmd+K
  React.useEffect(() => {
    const fn = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPaletteOpen(o => !o);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // Run progress simulation
  React.useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = (Date.now() - start) / 4000;
      if (elapsed >= 1) {
        setRunProgress(1);
        clearInterval(tick);
        setTimeout(() => {
          setRunning(false);
          setRunProgress(0);
          setRoute("assess");
          setReportKind("report");
          pushToast("Assessment complete · 8 findings", { tone: "ok", icon: "check" });
        }, 600);
      } else {
        setRunProgress(elapsed);
      }
    }, 100);
    return () => clearInterval(tick);
  }, [running]);

  const onNav = (id) => { setRoute(id); setReportKind(null); };
  const onPaletteAction = (item) => {
    setPaletteOpen(false);
    if (item.route) { onNav(item.route); return; }
    if (item.action === "run-rtd" || item.action === "run-sec") { setRunDrawerOpen(true); return; }
    if (item.action === "new-handoff") { setRoute("handoff"); return; }
    if (item.action === "reassess") { pushToast("Reassessing… (queued)", { icon: "refresh", tone: "info" }); return; }
    if (item.action === "new-session") { pushToast("New session created", { tone: "ok" }); return; }
    if (item.action?.startsWith("wb-")) { setRoute("build"); setWbTab(item.action.slice(3)); return; }
  };

  return (
    <div className="app"
         data-sidebar={t.sidebarCollapsed ? "collapsed" : "expanded"}
         data-rail={t.railCollapsed ? "collapsed" : "expanded"}>
      <Topbar project="payments-svc"
              onCmdK={() => setPaletteOpen(true)}
              theme={t.theme}
              setTheme={(th) => setTweak("theme", th)}
              onTweaks={() => window.dispatchEvent(new CustomEvent("__open_tweaks"))}
              activeGate={activeGate} setActiveGate={(g) => { setActiveGate(g); pushToast(`Gate: ${GATES.find(x=>x.id===g).label}`, { icon: "shield" }); }} />
      <Sidebar active={route} onNav={onNav} sidebarCollapsed={t.sidebarCollapsed} />

      {/* Main routes */}
      {route === "build" && (
        <Build wbTab={wbTab} setWbTab={setWbTab}
               shellOpen={shellOpen} setShellOpen={setShellOpen}
               splitFr={t.splitFr}
               transcriptStreaming={streaming} />
      )}
      {route === "assess" && !reportKind && !running && (
        <main className="main">
          <ReadinessHub
            onOpen={(r, sub) => { setRoute(r); if (sub) setReportKind(sub); }}
            onRunAssessment={() => setRunDrawerOpen(true)} />
        </main>
      )}
      {route === "assess" && running && (
        <main className="main"><AssessmentRunning progress={runProgress} onComplete={() => { setRunning(false); setRoute("assess"); setReportKind("report"); pushToast("Assessment complete · 8 findings", { tone: "ok" }); }} /></main>
      )}
      {route === "assess" && reportKind === "report" && !running && (
        <main className="main">
          <AssessmentReport
            selectedFindings={selectedFindings}
            toggleFinding={toggleFinding}
            onCreateHandoff={() => setRoute("handoff")} />
        </main>
      )}
      {route === "handoff" && (
        <main className="main">
          <HandoffBuilder
            selectedFindings={selectedFindings}
            onApprove={() => { pushToast("Handoff dispatched to local executor", { tone: "ok", icon: "check" }); setRoute("build"); }}
            onBack={() => { setRoute("assess"); setReportKind("report"); }} />
        </main>
      )}
      {route === "release" && <main className="main"><ReleasePage /></main>}
      {route === "knowledge" && <main className="main"><KnowledgePage /></main>}
      {route === "sessions" && <main className="main"><SessionsPage onOpen={onNav} /></main>}

      <Rail tab={railTab} setTab={setRailTab} />

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} onAction={onPaletteAction} />}
      {runDrawerOpen && (
        <RunAssessmentDrawer
          depth={t.assessDepth}
          setDepth={(d) => setTweak("assessDepth", d)}
          onClose={() => setRunDrawerOpen(false)}
          onRun={() => { setRunDrawerOpen(false); setRoute("assess"); setReportKind(null); setRunning(true); setRunProgress(0); }} />
      )}
      <Toast items={toasts} />

      {/* Tweaks panel */}
      <TweaksPanelHost t={t} setTweak={setTweak} />
    </div>
  );
};

const TweaksPanelHost = ({ t, setTweak }) => {
  return (
    <TweaksPanel title="Tweaks · VAC Web">
      <TweakSection label="Appearance" />
      <TweakRadio label="Theme" value={t.theme}
                  options={["light", "dark"]}
                  onChange={(v) => setTweak("theme", v)} />
      <TweakRadio label="Density" value={t.density}
                  options={["compact", "regular", "comfy"]}
                  onChange={(v) => setTweak("density", v)} />

      <TweakSection label="Accent color" />
      <div style={{display:"flex", gap:6, padding:"4px 0"}}>
        {ACCENTS.map(a => (
          <button key={a.name}
                  onClick={() => setTweak("accent", a.v)}
                  title={a.name}
                  style={{
                    width: 26, height: 26, borderRadius: 7,
                    background: a.v,
                    border: t.accent === a.v ? "2px solid #29261b" : "2px solid transparent",
                    cursor: "default",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                  }} />
        ))}
      </div>

      <TweakSection label="Layout" />
      <TweakToggle label="Collapse sidebar" value={t.sidebarCollapsed}
                   onChange={(v) => setTweak("sidebarCollapsed", v)} />
      <TweakToggle label="Collapse right rail" value={t.railCollapsed}
                   onChange={(v) => setTweak("railCollapsed", v)} />
      <TweakSlider label="Transcript / workbench split"
                   value={t.splitFr} min={0.6} max={1.8} step={0.1}
                   onChange={(v) => setTweak("splitFr", v)} />

      <TweakSection label="VIL & Assessment" />
      <TweakRadio label="VIL cue intensity" value={t.vilIntensity}
                  options={["subtle", "moderate", "prominent"]}
                  onChange={(v) => setTweak("vilIntensity", v)} />
      <TweakRadio label="Default assessment depth" value={t.assessDepth}
                  options={["quick", "standard", "full"]}
                  onChange={(v) => setTweak("assessDepth", v)} />
    </TweaksPanel>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
