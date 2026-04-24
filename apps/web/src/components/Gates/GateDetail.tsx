// gate_detail overlay. Shows criteria, blockers, signoff list, override dialog.
// ReadyToDeploy requires two signers; buttons disabled until threshold met.

import { useState } from 'react';
import { useGates, type GateId } from '../../stores/gates';
import { useSession } from '../../stores/session';
import type { OverlayRenderProps } from '../../overlays/registry';
import type { TransportHandle } from '../../transport';

export function GateDetail({ params, dismiss }: OverlayRenderProps) {
  const gateId = typeof params.gateId === 'string' ? (params.gateId as GateId) : null;
  const transport = (params.transport as TransportHandle | undefined) ?? null;
  const sessionId = useSession((s) => s.sessionId);
  const gate = useGates((s) => (gateId ? s.gates.get(gateId) : undefined));
  const [overrideReason, setOverrideReason] = useState('');
  const [signerName, setSignerName] = useState('');

  if (!gate || !gateId) {
    return (
      <div role="dialog" aria-modal="true" style={dialogStyle}>
        <header style={headerStyle}>
          <strong>Gate not found</strong>
          <button onClick={dismiss}>Close</button>
        </header>
      </div>
    );
  }

  const canSignOff = gate.signers.length < gate.required_signers && gate.state !== 'fail';

  const signoff = async () => {
    if (!signerName.trim()) return;
    useGates.getState().addSigner(gateId, signerName.trim());
    if (transport && sessionId) {
      try {
        await transport.send(sessionId, 'gate.signoff', { id: gateId, signer: signerName.trim() });
      } catch {
        /* ignore */
      }
    }
    setSignerName('');
  };

  const override = async () => {
    if (!overrideReason.trim()) return;
    useGates.getState().override(gateId, overrideReason.trim());
    if (transport && sessionId) {
      try {
        await transport.send(sessionId, 'gate.override', {
          id: gateId,
          reason: overrideReason.trim(),
        });
      } catch {
        /* ignore */
      }
    }
    dismiss();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${gateId} detail`} style={dialogStyle}>
      <header style={headerStyle}>
        <strong>{gateId}</strong>
        <button onClick={dismiss}>Close</button>
      </header>
      <div style={{ padding: 16 }}>
        <p style={{ margin: 0 }}>
          <strong>State:</strong> {gate.state}
          {gate.overridden && ' (overridden)'}
        </p>
        {gate.summary && (
          <p style={{ margin: '4px 0', color: 'var(--text-2)' }}>{gate.summary}</p>
        )}
        {gate.criteria.length > 0 && (
          <section style={{ marginTop: 12 }}>
            <strong>Criteria</strong>
            <ul style={{ paddingLeft: 16 }}>
              {gate.criteria.map((c) => (
                <li
                  key={c.id}
                  style={{
                    color: c.satisfied ? 'var(--sev-ok)' : 'var(--sev-warn)',
                  }}
                >
                  {c.satisfied ? '✓' : '●'} {c.label}
                </li>
              ))}
            </ul>
          </section>
        )}
        {gate.blockers.length > 0 && (
          <section style={{ marginTop: 12 }}>
            <strong>Blockers</strong>
            <ul style={{ paddingLeft: 16, color: 'var(--sev-error)' }}>
              {gate.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </section>
        )}
        <section style={{ marginTop: 12 }}>
          <strong>
            Signers ({gate.signers.length}/{gate.required_signers})
          </strong>
          <ul style={{ paddingLeft: 16 }}>
            {gate.signers.map((s) => (
              <li key={s.name}>
                {s.name} · {s.signed_at}
              </li>
            ))}
          </ul>
          {canSignOff && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="your name"
                aria-label="Signer name"
              />
              <button onClick={signoff} disabled={!signerName.trim()}>
                Sign off
              </button>
            </div>
          )}
        </section>
        {gate.state !== 'pass' && !gate.overridden && (
          <section
            style={{
              marginTop: 16,
              padding: 8,
              border: '1px dashed var(--sev-warn)',
              borderRadius: 4,
            }}
          >
            <strong>Override</strong>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
              Overrides are audit-logged. Use only with authority.
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="reason"
                aria-label="Override reason"
                style={{ flex: 1 }}
              />
              <button onClick={override} disabled={!overrideReason.trim()}>
                Override
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const dialogStyle: React.CSSProperties = {
  background: 'var(--bg-1, #1a1a1a)',
  color: 'var(--text-1)',
  border: '1px solid var(--border-1, #333)',
  borderRadius: 8,
  width: 'min(520px, 90vw)',
  maxHeight: '85vh',
  overflow: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 16px',
  borderBottom: '1px solid var(--border-1, #333)',
};
