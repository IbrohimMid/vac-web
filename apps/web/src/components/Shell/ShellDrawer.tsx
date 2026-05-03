// Shell drawer. xterm.js is lazy-loaded on first open so it never hits the
// initial bundle. When closed, the terminal instance is disposed.
//
// PTY traffic: `shell.output` events carry text chunks; input goes out via
// `shell.input`. Binary framing is a bridge-side optimization (Phase 3+).

import { useEffect, useRef, useState } from 'react';
import { useShell } from '../../stores/shell';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import {
  affordanceFor,
  type AffordanceCommandStatus,
} from '../../domain/capabilities/affordanceCatalog';
import { commandStatus } from '../../generated/commandCatalog';

function toAffordanceStatus(id: string): AffordanceCommandStatus {
  const s = commandStatus(id);
  if (s === 'implemented' || s === 'frontend_owned' || s === 'not_wired') return s;
  return 'unknown';
}

interface Props {
  transport: TransportHandle | null;
}

export function ShellDrawer({ transport }: Props) {
  const open = useShell((s) => s.open);
  const sessionId = useSession((s) => s.sessionId);
  const setOpen = useShell((s) => s.setOpen);
  const setShellId = useShell((s) => s.setShellId);
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const termRef = useRef<{ dispose: () => void; write: (s: string) => void } | null>(null);
  const offRef = useRef<(() => void) | null>(null);

  // Slice 33 follow-up: gate the auto-start path through the declarative
  // affordance catalog so the drawer doesn't try to spawn a shell when
  // the backend command is re-tagged as `not_wired`. Today `shell.start`
  // is implemented end-to-end so this is a no-op guard, but it keeps the
  // disabled-copy story consistent with other surfaces.
  const shellStartStatus = toAffordanceStatus('shell.start');
  const startDecision = affordanceFor('shell.start', {
    commandStatus: shellStartStatus,
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
  });

  useEffect(() => {
    if (!open || !hostRef.current || !transport || !sessionId) return;
    if (!startDecision.enabled) return;
    let disposed = false;
    let localShellId: string | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ]);
      // CSS loaded via a standard <link> the first time — avoids ?inline query typing.
      if (!document.getElementById('xterm-css')) {
        const link = document.createElement('link');
        link.id = 'xterm-css';
        link.rel = 'stylesheet';
        link.href = new URL('xterm/css/xterm.css', import.meta.url).href;
        document.head.appendChild(link);
      }
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        fontFamily: 'monospace',
        fontSize: 13,
        cursorBlink: true,
        convertEol: true,
        scrollback: 10_000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();

      termRef.current = { dispose: () => term.dispose(), write: (s) => term.write(s) };

      const offStarted = transport.on('shell.started', (ev) => {
        const p = ev.payload as { shell_id?: string } | null;
        if (!p?.shell_id || localShellId) return;
        localShellId = p.shell_id;
        setShellId(p.shell_id);
      });

      const offOutput = transport.on('shell.output', (ev) => {
        const p = ev.payload as { shell_id?: string; data?: string } | null;
        if (!p || p.shell_id !== localShellId || typeof p.data !== 'string') return;
        term.write(p.data);
      });

      offRef.current = () => {
        offStarted();
        offOutput();
      };

      await transport.send(sessionId, 'shell.start', {
        cols: term.cols,
        rows: term.rows,
      });

      term.onData((data) => {
        if (!localShellId) return;
        void transport.send(sessionId, 'shell.input', { shell_id: localShellId, data });
      });

      term.onResize(({ cols, rows }) => {
        if (!localShellId) return;
        void transport.send(sessionId, 'shell.resize', { shell_id: localShellId, cols, rows });
      });

      setReady(true);
    })().catch(() => setReady(false));

    return () => {
      disposed = true;
      offRef.current?.();
      offRef.current = null;
      if (localShellId && transport && sessionId) {
        void transport.send(sessionId, 'shell.kill', { shell_id: localShellId }).catch(() => {});
      }
      termRef.current?.dispose();
      termRef.current = null;
      setShellId(null);
      setReady(false);
    };
  }, [open, transport, sessionId, setShellId, startDecision.enabled]);

  if (!open) return null;
  return (
    <aside
      role="region"
      aria-label="Shell"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '40vh',
        background: 'var(--bg-1, #1a1a1a)',
        borderTop: '1px solid var(--border-1, #333)',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-1, #333)',
        }}
      >
        <strong>Shell{ready ? '' : ' (loading…)'}</strong>
        <button onClick={() => setOpen(false)} aria-label="Close shell">
          Close
        </button>
      </header>
      <div ref={hostRef} style={{ flex: 1 }} />
    </aside>
  );
}
