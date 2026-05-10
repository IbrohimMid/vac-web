// gate_detail overlay — Stage H restyle.
// Cockpit card chrome + cockpit tokens. Logic + signoff/override flow
// unchanged from Phase 6: ReadyToDeploy still requires two signers; bridge
// commands `gate.signoff` / `gate.override` still dispatched on submit.

import { useState } from 'react';
import { useGates, type GateId } from '../../stores/gates';
import { useSession } from '../../stores/session';
import type { OverlayRenderProps } from '../../overlays/registry';
import type { TransportHandle } from '../../transport';
import {
  affordanceFor,
  toAffordanceStatus,
} from '../../domain/capabilities/affordanceCatalog';

export function GateDetail({ params, dismiss }: OverlayRenderProps) {
  const gateId = typeof params.gateId === 'string' ? (params.gateId as GateId) : null;
  const transport = (params.transport as TransportHandle | undefined) ?? null;
  const sessionId = useSession((s) => s.sessionId);
  const gate = useGates((s) => (gateId ? s.gates.get(gateId) : undefined));
  const [overrideReason, setOverrideReason] = useState('');
  const [signerName, setSignerName] = useState('');

  if (!gate || !gateId) {
    return (
      <div role="dialog" aria-modal="true" className="card" style={cardSize}>
        <header className="card-hd">
          <div className="card-title">Gate not found</div>
          <div className="spacer"></div>
          <button className="btn ghost" onClick={dismiss}>
            Close
          </button>
        </header>
      </div>
    );
  }

  const canSignOff = gate.signers.length < gate.required_signers && gate.state !== 'fail';
  const stateBadge =
    gate.state === 'pass' ? 'ok' : gate.state === 'fail' ? 'crit' : 'warn';

  const signoffDecision = affordanceFor('gate.signoff.button', {
    commandStatus: toAffordanceStatus('gate.signoff'),
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
  });
  const overrideDecision = affordanceFor('gate.override.button', {
    commandStatus: toAffordanceStatus('gate.override'),
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
  });

  const signoff = async () => {
    if (!signoffDecision.enabled) return;
    if (!signerName.trim()) return;
    if (!transport || !sessionId) return;
    useGates.getState().addSigner(gateId, signerName.trim());
    setSignerName('');
    try {
      await transport.send(sessionId, 'gate.signoff', { id: gateId, signer: signerName.trim() });
    } catch {
      /* ignore */
    }
  };

  const override = async () => {
    if (!overrideDecision.enabled) return;
    if (!overrideReason.trim()) return;
    if (!transport || !sessionId) return;
    useGates.getState().override(gateId, overrideReason.trim());
    try {
      await transport.send(sessionId, 'gate.override', {
        id: gateId,
        reason: overrideReason.trim(),
      });
    } catch {
      /* ignore */
    }
    dismiss();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${gateId} detail`}
      className="card"
      style={cardSize}
    >
      <header className="card-hd">
        <div className="card-title">{gateId}</div>
        <span className={`badge ${stateBadge}`}>
          <span className="dot" style={{ background: 'currentColor' }}></span>
          {gate.state}
          {gate.overridden && ' · override'}
        </span>
        <div className="spacer"></div>
        <button className="btn ghost" onClick={dismiss}>
          Close
        </button>
      </header>
      <div className="card-body" style={{ padding: 16 }}>
        {gate.summary && (
          <p
            className="muted"
            style={{ margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.5 }}
          >
            {gate.summary}
          </p>
        )}

        {gate.criteria.length > 0 && (
          <section style={{ marginBottom: 14 }}>
            <strong style={sectionTitle}>Criteria</strong>
            <ul style={listStyle}>
              {gate.criteria.map((c) => (
                <li
                  key={c.id}
                  style={{
                    fontSize: 12.5,
                    color: c.satisfied ? 'var(--ok)' : 'var(--warn)',
                    padding: '2px 0',
                  }}
                >
                  {c.satisfied ? '✓' : '●'} {c.label}
                </li>
              ))}
            </ul>
          </section>
        )}

        {gate.blockers.length > 0 && (
          <section style={{ marginBottom: 14 }}>
            <strong style={sectionTitle}>Blockers</strong>
            <ul style={listStyle}>
              {gate.blockers.map((b, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 12.5,
                    color: 'var(--crit)',
                    padding: '2px 0',
                  }}
                >
                  ✗ {b}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section style={{ marginBottom: 14 }}>
          <strong style={sectionTitle}>
            Signers ({gate.signers.length}/{gate.required_signers})
          </strong>
          <ul style={listStyle}>
            {gate.signers.length === 0 && (
              <li className="muted" style={{ fontSize: 12.5 }}>
                None yet.
              </li>
            )}
            {gate.signers.map((s) => (
              <li key={s.name} style={{ fontSize: 12.5, padding: '2px 0' }}>
                <span className="mono">{s.name}</span>{' '}
                <span className="muted">· {s.signed_at}</span>
              </li>
            ))}
          </ul>
          {canSignOff && (
            <>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  className="twk-field"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && signoffDecision.enabled && signerName.trim()) {
                      e.preventDefault();
                      void signoff();
                    }
                  }}
                  placeholder="your name"
                  aria-label="Signer name"
                  style={inputStyle}
                />
                <button
                  className="btn primary"
                  onClick={signoff}
                  disabled={!signoffDecision.enabled || !signerName.trim()}
                  data-affordance-id={signoffDecision.affordanceId}
                  title={signoffDecision.disabledReason ?? ''}
                >
                  Sign off
                </button>
              </div>
              {!signoffDecision.enabled && signoffDecision.disabledReason && (
                <p
                  role="note"
                  tabIndex={0}
                  style={{
                    margin: '6px 0 0',
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    color: 'var(--ink-3)',
                  }}
                >
                  {signoffDecision.disabledReason}
                </p>
              )}
            </>
          )}
        </section>

        {gate.state !== 'pass' && !gate.overridden && (
          <section
            style={{
              marginTop: 8,
              padding: 12,
              border: '1px dashed var(--warn)',
              borderRadius: 'var(--r-md)',
              background: 'var(--warn-soft)',
            }}
          >
            <strong style={sectionTitle}>Override</strong>
            <div
              style={{ fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 8px' }}
            >
              Overrides are audit-logged. Use only with authority.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                onKeyDown={(e) => {
                  // Override is risky: require Cmd/Ctrl+Enter to submit, never bare Enter.
                  if (
                    e.key === 'Enter' &&
                    (e.metaKey || e.ctrlKey) &&
                    overrideDecision.enabled &&
                    overrideReason.trim()
                  ) {
                    e.preventDefault();
                    void override();
                  }
                }}
                placeholder="reason (Cmd/Ctrl+Enter to submit)"
                aria-label="Override reason"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                className="btn"
                onClick={override}
                disabled={!overrideDecision.enabled || !overrideReason.trim()}
                data-affordance-id={overrideDecision.affordanceId}
                title={overrideDecision.disabledReason ?? ''}
              >
                Override
              </button>
            </div>
            {!overrideDecision.enabled && overrideDecision.disabledReason && (
              <p
                role="note"
                tabIndex={0}
                style={{
                  margin: '6px 0 0',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: 'var(--ink-3)',
                }}
              >
                {overrideDecision.disabledReason}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

const cardSize: React.CSSProperties = {
  width: 'min(520px, 90vw)',
  maxHeight: '85vh',
  overflow: 'auto',
};

const sectionTitle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--ink-3)',
  marginBottom: 6,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const inputStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--panel-2)',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
