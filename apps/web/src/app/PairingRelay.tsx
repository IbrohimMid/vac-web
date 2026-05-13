// Copy-only pairing surface. The bridge/CLI owns QR generation when it is
// available; this browser surface mints or consumes a relay pairing URL and
// shows a masked, copyable value so token-bearing URLs are not exposed as a
// fake scannable QR.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

interface Props {
  relayUrl: string;
  deviceId: string;
  sessionId: string;
}

const sectionStyle: CSSProperties = { border: '1px solid #334155', padding: 12, borderRadius: 10 };
const headingStyle: CSSProperties = { marginTop: 0 };
const errorStyle: CSSProperties = { color: '#fca5a5' };
const helpStyle: CSSProperties = { color: '#94a3b8', marginBottom: 8 };
const urlBoxStyle: CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#0f172a', padding: 8, borderRadius: 8 };
const codeStyle: CSSProperties = { fontSize: 18 };
const rowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const noteStyle: CSSProperties = { color: '#94a3b8', fontSize: 12 };

export function maskPairingUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const token = url.searchParams.get('token');
    if (token) {
      const suffix = token.slice(-4);
      url.searchParams.set('token', `••••${suffix}`);
    }
    return url.toString();
  } catch {
    return raw.replace(/([?&]token=)[^&\s]+/i, '$1••••');
  }
}

async function copyPairingUrl(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function PairingRelay({ relayUrl, deviceId, sessionId }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>('');

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
  const maskedAttachUrl = attachUrl ? maskPairingUrl(attachUrl) : null;

  return (
    <section aria-label="Pair remote device" style={sectionStyle}>
      <h3 style={headingStyle}>Pair a remote device</h3>
      {error && <p style={errorStyle}>{error}</p>}
      {!attachUrl || !maskedAttachUrl ? (
        <p>Requesting token…</p>
      ) : (
        <>
          <p style={helpStyle}>
            Copy this pairing URL into the remote device. QR rendering is not available in this web surface.
          </p>
          <pre style={urlBoxStyle} aria-label="Masked pairing URL">
            {maskedAttachUrl}
          </pre>
          <div style={rowStyle}>
            <button
              type="button"
              onClick={() => {
                void copyPairingUrl(attachUrl).then((ok) => setCopyStatus(ok ? 'Pairing URL copied.' : 'Copy unavailable; use the CLI token source.'));
              }}
            >
              Copy full pairing URL
            </button>
            {shortCode && (
              <span>
                Short code: <code style={codeStyle}>{shortCode}</code>
              </span>
            )}
          </div>
          <p style={noteStyle}>
            The visible URL masks its token. Copy uses the full token-bearing URL for this one-time pairing flow.
          </p>
          {copyStatus && <p role="status">{copyStatus}</p>}
        </>
      )}
    </section>
  );
}
