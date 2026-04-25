import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/cockpit.css';
import { BridgeStatus } from './app/BridgeStatus';
import { PairingPrompt } from './app/PairingPrompt';
import { BuildSurface } from './components/cockpit/BuildSurface';
import { Rail } from './components/cockpit/Rail';
import { Sidebar } from './components/cockpit/Sidebar';
import { Topbar as CockpitTopbar } from './components/cockpit/Topbar';
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
import { registerTranscriptHandlers } from './domain/transcript/handlers';
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
        } else {
          const wsUrl =
            (location.protocol === 'https:' ? 'wss:' : 'ws:') +
            '//' +
            location.host +
            '/api/sessions/stream';
          t = await createTransport(wsUrl);
        }
        offs.push(registerTranscriptHandlers(t));
        offs.push(registerCapabilitiesHandlers(t));
        offs.push(registerNotifyHandlers(t));
        offs.push(registerApprovalHandlers(t));
        offs.push(registerReviewHandlers(t));
        offs.push(registerSessionHandlers(t));
        offs.push(registerRuntimeHandlers(t));
        offs.push(registerConnectorHandlers(t));
        offs.push(registerAssessmentHandlers(t));
        offs.push(registerGateHandlers(t));
        offs.push(registerHandoffHandlers(t));
        offs.push(registerReleaseHandlers(t));
        offs.push(registerRegressionHandlers(t));
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

  const openTweaks = () => {
    // Tweaks panel lands in Stage E; for now just open the command palette
    // so ⌘K + tweaks button share an entry point.
    useOverlays.getState().open('command_palette', { transport });
  };

  return (
    <div
      className="app"
      data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      data-rail={railCollapsed ? 'collapsed' : 'expanded'}
    >
      <CockpitTopbar
        onCmdK={() => useOverlays.getState().open('command_palette', { transport })}
        onTweaks={openTweaks}
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
              <SurfaceWrap title="Assess">
                <ReadinessHub transport={transport} />
              </SurfaceWrap>
            )}
            {route === 'handoff' && (
              <SurfaceWrap title="Handoff">
                <HandoffTab transport={transport} />
              </SurfaceWrap>
            )}
            {route === 'release' && (
              <SurfaceWrap title="Release">
                <ReleaseTab transport={transport} />
              </SurfaceWrap>
            )}
            {route === 'knowledge' && (
              <SurfaceWrap title="Knowledge">
                <ArchiveTab />
              </SurfaceWrap>
            )}
            {route === 'sessions' && (
              <SurfaceWrap title="Sessions">
                <SessionPicker transport={transport} />
                <SessionsTab transport={transport} />
              </SurfaceWrap>
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
    </div>
  );
}

function SurfaceWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 'var(--pad)', minWidth: 0, overflow: 'auto' }}>
      <h2 style={{ margin: '0 0 var(--gap) 0', fontSize: 18 }}>{title}</h2>
      <div
        style={{
          background: 'var(--panel)',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--line)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
