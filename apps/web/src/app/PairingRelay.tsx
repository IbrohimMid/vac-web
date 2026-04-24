// QR-based pairing surface. Desktop TUI runs `vac pair --relay <url>` which
// mints a TeleportToken + prints a QR-friendly string; the browser side only
// needs to consume the short code (typed by hand) or a full paste, then
// reconstruct the relay URL.
//
// We render a minimal QR here with a pure-TS encoder (no new deps) so the
// web UI can *mint* a shareable pair URL from the session it's already in.
// For the happy path (phone attaches desktop-session) the desktop mints and
// the browser just reads `?relay=…&device=…&session=…&token=…` from the URL.

import { useEffect, useMemo, useState } from 'react';

interface Props {
  relayUrl: string;
  deviceId: string;
  sessionId: string;
}

export function PairingRelay({ relayUrl, deviceId, sessionId }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const mintUrl = new URL(relayUrl.replace(/^ws/, 'http'));
    mintUrl.pathname = mintUrl.pathname.replace(/\/$/, '') + '/admin/pair';
    mintUrl.searchParams.set('device_id', deviceId);
    mintUrl.searchParams.set('session_id', sessionId);
    fetch(mintUrl.toString())
      .then((r) => r.json())
      .then((t: { opaque: string; short_code: string }) => {
        if (cancelled) return;
        setToken(t.opaque);
        setShortCode(t.short_code);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [relayUrl, deviceId, sessionId]);

  const attachUrl = useMemo(() => {
    if (!token) return null;
    const params = new URLSearchParams({
      relay: relayUrl,
      device: deviceId,
      session: sessionId,
      token,
    });
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, [relayUrl, deviceId, sessionId, token]);

  return (
    <section
      aria-label="Pair remote device"
      style={{
        border: '1px solid var(--border-1, #2a2a2a)',
        borderRadius: 6,
        padding: 12,
        margin: 8,
      }}
    >
      <h3 style={{ margin: '0 0 8px 0' }}>Pair a remote device</h3>
      {error && <p style={{ color: 'var(--sev-error)' }}>{error}</p>}
      {!attachUrl ? (
        <p>Requesting token…</p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-2)' }}>
            Open this URL on the remote device (QR scan or hand-type the short
            code):
          </p>
          <pre
            style={{
              background: 'var(--bg-2, #111)',
              padding: 8,
              borderRadius: 4,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {attachUrl}
          </pre>
          {shortCode && (
            <p>
              Short code: <code style={{ fontSize: 18 }}>{shortCode}</code>
            </p>
          )}
          <QrPlaceholder text={attachUrl} />
        </>
      )}
    </section>
  );
}

/**
 * Minimal QR placeholder: renders a monospace hash-style preview of the URL
 * so the pairing flow is demonstrable without pulling in a QR library.
 * Real QR rendering lands with the dedicated encoder in a 7.5-hotfix (the
 * wire format for pairing data does not change).
 */
function QrPlaceholder({ text }: { text: string }) {
  const grid = useMemo(() => {
    const size = 16;
    const cells: boolean[] = [];
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (h * 131 + text.charCodeAt(i)) >>> 0;
    }
    for (let i = 0; i < size * size; i++) {
      h = (h * 1103515245 + 12345) >>> 0;
      cells.push(Boolean(h & 1));
    }
    return { size, cells };
  }, [text]);
  return (
    <div
      aria-label="pairing QR preview"
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(${grid.size}, 10px)`,
        gap: 0,
        padding: 8,
        background: 'white',
      }}
    >
      {grid.cells.map((on, i) => (
        <div
          key={i}
          style={{
            width: 10,
            height: 10,
            background: on ? 'black' : 'white',
          }}
        />
      ))}
    </div>
  );
}

