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
    bottom: 8,
    right: 8,
    fontSize: 12,
    padding: '4px 8px',
    borderRadius: 4,
    fontFamily: 'monospace',
  };
  if (s === 'loading')
    return <div style={{ ...style, background: '#eee' }}>connecting…</div>;
  if (s === 'error') return <div style={{ ...style, background: '#fdd', color: 'crimson' }}>offline</div>;
  return (
    <div style={{ ...style, background: '#dfd', color: 'darkgreen' }}>
      bridge v{s.version} · up {s.uptime_s}s · {s.sessions ?? 0} sessions
    </div>
  );
}
