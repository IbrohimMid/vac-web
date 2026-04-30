import { GateRibbon } from '../Gates/GateRibbon';
import { ResumeStatus } from './ResumeStatus';
import { SeverityIcon } from '../SeverityIcon';
import { useSession } from '../../stores/session';
import { useSystemPulse } from '../../stores/systemPulse';
import type { TransportHandle } from '../../transport';

export function Topbar({ transport }: { transport?: TransportHandle | null | undefined } = {}) {
  const sessionId = useSession((s) => s.sessionId);
  const facets = useSystemPulse((s) => s.facets);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: 'var(--surface-2, #f6f7f9)',
        borderBottom: '1px solid var(--border, #e0e3e8)',
        fontSize: 13,
      }}
    >
      <strong style={{ color: 'var(--text-1)' }}>vac-web</strong>
      {sessionId && (
        <span style={{ color: 'var(--text-2, #666)', fontFamily: 'monospace' }}>
          {sessionId.slice(0, 16)}…
        </span>
      )}
      <GateRibbon transport={transport} />
      <ResumeStatus />
      <div style={{ flex: 1 }} />
      <nav style={{ display: 'flex', gap: 8 }}>
        {facets.map((f) => (
          <button
            key={f.kind + ':' + f.label}
            title={`${f.kind}: ${f.label}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border, #e0e3e8)',
              background: 'var(--surface-1, #fff)',
              fontSize: 12,
              cursor: 'default',
            }}
          >
            <SeverityIcon severity={f.severity} />
            <span>{f.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
