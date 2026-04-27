import { useEffect, useState } from 'react';

type Status = { ok: boolean; version: string; uptime_s: number; sessions?: number } | 'error' | 'loading';

export function BridgeStatus() {
  const [s, setS] = useState<Status>('loading');
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch('/api/health');
        if (!r.ok) throw new Error();
        setS(await r.json());
      } catch {
        setS('error');
      }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => clearInterval(iv);
  }, []);

  const style: React.CSSProperties = {
    position: 'fixed',
    bottom: 10,
    right: 10,
    zIndex: 200,
    fontSize: 11.5,
    padding: '4px 8px',
    borderRadius: 6,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '-0.01em',
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 0 rgba(255, 255, 255, 0.72) inset',
    pointerEvents: 'none',
  };
  if (s === 'loading') {
    return (
      <div style={{ ...style, background: '#f1f1eb', color: '#6d6a5f', border: '1px solid #dfddd2' }}>
        connecting…
      </div>
    );
  }
  if (s === 'error') {
    return (
      <div style={{ ...style, background: '#fff0ee', color: '#a43b2a', border: '1px solid #efc7bf' }}>
        offline
      </div>
    );
  }
  return (
    <div style={{ ...style, background: '#e6f8de', color: '#1f6c36', border: '1px solid #c6e7bb' }}>
      bridge v{s.version} · up {s.uptime_s}s · {s.sessions ?? 0} sessions
    </div>
  );
}
