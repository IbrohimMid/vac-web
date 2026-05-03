import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/cockpit.css';
import { BridgeStatus } from './app/BridgeStatus';
import { PairingPrompt } from './app/PairingPrompt';
import { BuildSurface } from './components/cockpit/BuildSurface';
import { Rail } from './components/cockpit/Rail';
import { Sidebar } from './components/cockpit/Sidebar';
import { SurfacePage } from './components/cockpit/SurfacePage';
import { Topbar as CockpitTopbar } from './components/cockpit/Topbar';
import { TweaksPanel } from './components/cockpit/TweaksPanel';
import { RunAssessmentDrawer } from './components/cockpit/RunAssessmentDrawer';
import { Icon as CockpitIcon } from './components/cockpit/primitives';
import {
  PersistentRail,
  StickyBanners,
  TransientToasts,
} from './components/NotifyLane';
import { OverlayHost } from './components/OverlayHost/OverlayHost';
import { SessionPicker } from './components/SessionPicker/SessionPicker';
import { ShellDrawer } from './components/Shell/ShellDrawer';

// Phase-3..8 surfaces — each route lazy-loads its primary panel so the
// initial chunk stays under the bundle budget. (Approvals + Review live
// inside BuildSurface so their lazy splits are co-located there.)
const ReadinessHub = lazy(() =>
  import('./components/Readiness/ReadinessHub').then((m) => ({ default: m.ReadinessHub })),
);
const HandoffTab = lazy(() =>
  import('./components/Handoff/HandoffTab').then((m) => ({ default: m.HandoffTab })),
);
const SessionsTab = lazy(() =>
  import('./components/Sessions/SessionsTab').then((m) => ({ default: m.SessionsTab })),
);
const ReleaseTab = lazy(() =>
  import('./components/Release/ReleaseTab').then((m) => ({ default: m.ReleaseTab })),
);
const ArchiveTab = lazy(() =>
  import('./components/Archive/ArchiveTab').then((m) => ({ default: m.ArchiveTab })),
);

import { registerApprovalHandlers } from './domain/approvals/handlers';
import { registerAgentSessionHandlers } from './domain/agentSession/handlers';
import { registerToolActivityHandlers } from './domain/toolActivity/handlers';
import { registerWorkflowHandlers } from './domain/workflow/handlers';
import { registerAssessmentHandlers } from './domain/assessment/handlers';
import { registerCapabilitiesHandlers } from './domain/capabilities/handlers';
import { registerConnectorHandlers } from './domain/connectors/handlers';
import { registerGateHandlers } from './domain/gates/handlers';
import { registerHandoffHandlers } from './domain/handoff/handlers';
import { registerReleaseHandlers } from './domain/release/handlers';
import { registerRegressionHandlers } from './domain/regression/handlers';
import { registerNotifyHandlers } from './domain/notify/handlers';
import { registerReviewHandlers } from './domain/review/handlers';
import { registerRuntimeHandlers } from './domain/runtime/handlers';
import { registerSessionHandlers } from './domain/sessions/handlers';
import { registerSessionHistoryHandlers } from './domain/sessions/history';
import { registerTranscriptHandlers } from './domain/transcript/handlers';
import { attachTranscriptModeBridge } from './transcript/sessionModeBridge';
import { overlayRegistry } from './overlays/overlay-registry';
import { useCockpit } from './stores/cockpit';
import { useOverlays } from './stores/overlays';
import { useShell } from './stores/shell';
import { createTransport, type TransportHandle } from './transport';
import { createRelayTransport, parseRelayParamsFromLocation } from './transport/relay';

function App() {
  const [paired, setPaired] = useState(false);
  const [transport, setTransport] = useState<TransportHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);

  // Apply theme + density + accent to <html data-*> + CSS vars.
  const theme = useCockpit((s) => s.theme);
  const density = useCockpit((s) => s.density);
  const accent = useCockpit((s) => s.accent);
  const sidebarCollapsed = useCockpit((s) => s.sidebarCollapsed);
  const railCollapsed = useCockpit((s) => s.railCollapsed);
  const route = useCockpit((s) => s.route);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    html.setAttribute('data-density', density);
    html.style.setProperty('--accent', accent);
  }, [theme, density, accent]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const overlays = useOverlays.getState();
        if (overlays.isOpen('command_palette')) {
          overlays.dismissAll();
        } else {
          overlays.open('command_palette', { transport });
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        useShell.getState().setOpen(!useShell.getState().open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [transport]);

  useEffect(() => {
    if (!paired) return;
    let t: TransportHandle | null = null;
    const offs: Array<() => void> = [];
    (async () => {
      try {
        const relay = parseRelayParamsFromLocation();
        if (relay) {
          t = await createRelayTransport(relay);
          // Strip relay/token query params from the visible URL so the
          // attach token doesn't leak via history, screenshots, referrer
          // headers, telemetry, or copy-pasted bookmarks. See audit pass-2
          // P2 "Token handling threat model".
          try {
            const cleaned = new URL(window.location.href);
            for (const k of ['relay', 'device', 'session', 'token', 'last_event_id']) {
              cleaned.searchParams.delete(k);
            }
            const next =
              cleaned.pathname +
              (cleaned.searchParams.toString() ? `?${cleaned.searchParams.toString()}` : '') +
              cleaned.hash;
            window.history.replaceState({}, document.title, next);
          } catch {
            /* non-fatal: pairing succeeded, only the URL hygiene step failed */
          }
        } else {
          const wsUrl =
            (location.protocol === 'https:' ? 'wss:' : 'ws:') +
            '//' +
            location.host +
            '/api/sessions/stream';
          t = await createTransport(wsUrl);
        }
        offs.push(registerTranscriptHandlers(t));
        offs.push(registerAgentSessionHandlers(t));
        // Slice 50: forward session-lifecycle frames into the transcript
        // store's pipeline-mode field. Decoupled from sessions/handlers.ts
        // (which owns the session list / activation) so the bridge can
        // evolve without touching that surface. The bridge is structural
        // over `TransportHandle.on`, so no transport-layer dep leaks.
        offs.push(attachTranscriptModeBridge(t));
        offs.push(registerCapabilitiesHandlers(t));
        offs.push(registerNotifyHandlers(t));
        offs.push(registerApprovalHandlers(t));
        offs.push(registerReviewHandlers(t));
        offs.push(registerSessionHandlers(t));
        offs.push(registerSessionHistoryHandlers(t));
        offs.push(registerRuntimeHandlers(t));
        offs.push(registerConnectorHandlers(t));
        offs.push(registerAssessmentHandlers(t));
        offs.push(registerGateHandlers(t));
        offs.push(registerHandoffHandlers(t));
        offs.push(registerReleaseHandlers(t));
        offs.push(registerRegressionHandlers(t));
        offs.push(registerToolActivityHandlers(t));
        offs.push(registerWorkflowHandlers(t));
        setTransport(t);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      offs.forEach((off) => off());
      t?.close();
    };
  }, [paired]);

  const registry = useMemo(() => overlayRegistry, []);

  if (!paired) {
    return (
      <main className="paired-empty">
        <h1>vac-web</h1>
        <PairingPrompt onPaired={() => setPaired(true)} />
        <BridgeStatus />
      </main>
    );
  }

  const openTweaks = () => setTweaksOpen(true);

  return (
    <div
      className="app"
      data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      data-rail={railCollapsed ? 'collapsed' : 'expanded'}
    >
      <CockpitTopbar
        onCmdK={() => useOverlays.getState().open('command_palette', { transport })}
        onTweaks={openTweaks}
        transport={transport}
      />
      <Sidebar />
      <main className="main">
        <StickyBanners />
        {error && (
          <div style={{ color: 'var(--crit)', padding: 'var(--pad)' }}>
            transport error: {error}
          </div>
        )}
        {transport ? (
          <Suspense
            fallback={
              <div style={{ padding: 16, color: 'var(--ink-3)' }}>Loading surface…</div>
            }
          >
            {route === 'build' && <BuildSurface transport={transport} />}
            {route === 'assess' && (
              <SurfacePage
                title="Readiness"
                subtitle="Assessor families, scorecards, and the next thing to do"
                icon="assess"
                actions={
                  <button
                    className="btn primary"
                    data-testid="run-assessment-sweep-button"
                    onClick={() => setRunDrawerOpen(true)}
                    disabled={!transport}
                  >
                    <CockpitIcon name="play" size={11} />
                    Run sweep
                  </button>
                }
              >
                <ReadinessHub transport={transport} />
              </SurfacePage>
            )}
            {route === 'handoff' && (
              <SurfacePage
                title="Handoff"
                subtitle="Build packets from selected findings; two-party signoff before dispatch"
                icon="handoff"
              >
                <HandoffTab transport={transport} />
              </SurfacePage>
            )}
            {route === 'release' && (
              <SurfacePage
                title="Release"
                subtitle="Deploy / publish targets with gate guards + release notes"
                icon="release"
              >
                <ReleaseTab transport={transport} />
              </SurfacePage>
            )}
            {route === 'knowledge' && (
              <SurfacePage
                title="Knowledge"
                subtitle="Plan / VIL / Signal / Memory lenses on session state"
                icon="knowledge"
              >
                <ArchiveTab />
              </SurfacePage>
            )}
            {route === 'sessions' && (
              <SurfacePage
                title="Sessions"
                subtitle="Active and recent sessions; resume or close"
                icon="sessions"
                fullBleed
              >
                <div style={{ padding: 'var(--pad)' }}>
                  <SessionPicker transport={transport} />
                </div>
                <SessionsTab transport={transport} />
              </SurfacePage>
            )}
          </Suspense>
        ) : (
          <p style={{ padding: 'var(--pad)' }}>connecting…</p>
        )}
        <PersistentRail />
      </main>
      <Rail />
      <OverlayHost registry={registry} />
      <ShellDrawer transport={transport} />
      <TransientToasts />
      <BridgeStatus />
      {tweaksOpen && <TweaksPanel onClose={() => setTweaksOpen(false)} />}
      {runDrawerOpen && (
        <RunAssessmentDrawer
          transport={transport}
          onClose={() => setRunDrawerOpen(false)}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
