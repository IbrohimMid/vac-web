import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/cockpit.css';
import { BridgeStatus } from './app/BridgeStatus';
import { PairingPrompt } from './app/PairingPrompt';
import { ActivityRail } from './components/ActivityRail/ActivityRail';
import { Composer } from './components/Composer/Composer';
import {
  PersistentRail,
  StickyBanners,
  TransientToasts,
} from './components/NotifyLane';
import { OverlayHost } from './components/OverlayHost/OverlayHost';
import { SessionPicker } from './components/SessionPicker/SessionPicker';
import { ShellDrawer } from './components/Shell/ShellDrawer';
import { Topbar } from './components/Topbar/Topbar';
import { Transcript } from './components/Transcript/Transcript';
import { Workbench } from './components/Workbench/Workbench';

// Non-default workbench panes lazy-load to keep the initial bundle focused on
// the Transcript + composer surface. Each pane chunks independently; Vite
// generates one JS file per pane and the browser fetches on first tab click.
const ApprovalsTab = lazy(() =>
  import('./components/Approvals/ApprovalsTab').then((m) => ({ default: m.ApprovalsTab })),
);
const ReviewTab = lazy(() =>
  import('./components/Review/ReviewTab').then((m) => ({ default: m.ReviewTab })),
);
const ReadinessHub = lazy(() =>
  import('./components/Readiness/ReadinessHub').then((m) => ({ default: m.ReadinessHub })),
);
const HandoffTab = lazy(() =>
  import('./components/Handoff/HandoffTab').then((m) => ({ default: m.HandoffTab })),
);
const SessionsTab = lazy(() =>
  import('./components/Sessions/SessionsTab').then((m) => ({ default: m.SessionsTab })),
);
const RuntimeTab = lazy(() =>
  import('./components/Runtime/RuntimeTab').then((m) => ({ default: m.RuntimeTab })),
);
const ConnectorsTab = lazy(() =>
  import('./components/Connectors/ConnectorsTab').then((m) => ({ default: m.ConnectorsTab })),
);
const ReleaseTab = lazy(() =>
  import('./components/Release/ReleaseTab').then((m) => ({ default: m.ReleaseTab })),
);
const MigrationTab = lazy(() =>
  import('./components/Migration/MigrationTab').then((m) => ({ default: m.MigrationTab })),
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
import { useOverlays } from './stores/overlays';
import { useShell } from './stores/shell';
import { createTransport, type TransportHandle } from './transport';
import { createRelayTransport, parseRelayParamsFromLocation } from './transport/relay';

function App() {
  const [paired, setPaired] = useState(false);
  const [transport, setTransport] = useState<TransportHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        // Relay mode: if the URL carries `?relay=…&device=…&session=…&token=…`,
        // dial the relay instead of the direct local bridge WS. All downstream
        // handlers work identically because the wire envelope is unchanged.
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
      <main style={{ fontFamily: 'system-ui', maxWidth: 900, margin: '0 auto' }}>
        <h1>vac-web</h1>
        <PairingPrompt onPaired={() => setPaired(true)} />
        <BridgeStatus />
      </main>
    );
  }

  return (
    <main
      style={{
        fontFamily: 'system-ui',
        maxWidth: 1100,
        margin: '0 auto',
        color: 'var(--text-1)',
      }}
    >
      <Topbar transport={transport} />
      <StickyBanners />
      {error && <div style={{ color: 'crimson', padding: 8 }}>transport error: {error}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-2)', padding: 8, display: 'flex', gap: 12 }}>
        <span>
          <kbd>Ctrl/⌘ + K</kbd> palette · <kbd>Ctrl/⌘ + `</kbd> shell
        </span>
        <button
          onClick={() => useOverlays.getState().open('guided_mode', { transport })}
          style={{ fontSize: 12 }}
        >
          Guided setup
        </button>
      </div>
      {transport ? (
        <div style={{ padding: 8 }}>
          <SessionPicker transport={transport} />
          <Suspense
            fallback={<div style={{ padding: 16, color: 'var(--text-2)' }}>Loading…</div>}
          >
            <Workbench
              panes={{
                transcript: <Transcript />,
                approvals: <ApprovalsTab transport={transport} />,
                review: <ReviewTab transport={transport} />,
                sessions: <SessionsTab transport={transport} />,
                readiness: <ReadinessHub transport={transport} />,
                handoff: <HandoffTab transport={transport} />,
                release: <ReleaseTab transport={transport} />,
                migration: <MigrationTab transport={transport} />,
                archive: <ArchiveTab />,
                runtime: <RuntimeTab transport={transport} />,
                connectors: <ConnectorsTab transport={transport} />,
              }}
            />
          </Suspense>
          <Composer transport={transport} />
          <PersistentRail />
          <ActivityRail />
        </div>
      ) : (
        <p>connecting…</p>
      )}
      <OverlayHost registry={registry} />
      <ShellDrawer transport={transport} />
      <TransientToasts />
      <BridgeStatus />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
