// GateRibbon: two gate pills in the Topbar. Click opens gate_detail overlay.

import { useEffect, useRef, useState } from 'react';
import { useOverlays } from '../../stores/overlays';
import { GATE_ORDER, useGates, type Gate, type GateState } from '../../stores/gates';
import type { TransportHandle } from '../../transport';

const VISIBLE_PILLS = 2;

const STATE_COLOR: Record<GateState, string> = {
  open: 'var(--sev-warn)',
  pass: 'var(--sev-ok)',
  fail: 'var(--sev-error)',
};

const STATE_GLYPH: Record<GateState, string> = {
  open: '●',
  pass: '✓',
  fail: '✗',
};

export function GateRibbon({ transport }: { transport?: TransportHandle | null | undefined }) {
  const gates = useGates((s) => s.gates);
  const [foldOpen, setFoldOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the overflow dropdown on outside-click or Escape, matching overlay
  // stack precedence for dismiss.
  useEffect(() => {
    if (!foldOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setFoldOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFoldOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [foldOpen]);

  const ordered = GATE_ORDER.map((id) => gates.get(id)).filter(
    (g): g is Gate => g !== undefined,
  );
  if (ordered.length === 0) return null;
  const visible = ordered.slice(0, VISIBLE_PILLS);
  const folded = ordered.slice(VISIBLE_PILLS);
  const foldedFail = folded.some((g) => g.state === 'fail');
  return (
    <div
      ref={containerRef}
      role="status"
      aria-label="Release gates"
      style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}
    >
      {visible.map((g) => (
        <GatePill key={g.id} gate={g} transport={transport} />
      ))}
      {folded.length > 0 && (
        <>
          <button
            onClick={() => setFoldOpen((v) => !v)}
            aria-expanded={foldOpen}
            aria-label={`${folded.length} more gates`}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 12,
              background: 'transparent',
              border: `1px solid ${foldedFail ? 'var(--sev-error)' : 'var(--text-2)'}`,
              color: foldedFail ? 'var(--sev-error)' : 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            +{folded.length}
          </button>
          {foldOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'var(--bg-1, #1a1a1a)',
                border: '1px solid var(--border-1, #333)',
                borderRadius: 6,
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                zIndex: 50,
              }}
            >
              {folded.map((g) => (
                <GatePill key={g.id} gate={g} transport={transport} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GatePill({ gate, transport }: { gate: Gate; transport?: TransportHandle | null | undefined }) {
  const open = () =>
    useOverlays.getState().open('gate_detail', { gateId: gate.id, transport });
  return (
    <button
      onClick={open}
      aria-label={`${gate.id} gate: ${gate.state}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 12,
        background: 'transparent',
        border: `1px solid ${STATE_COLOR[gate.state]}`,
        color: STATE_COLOR[gate.state],
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
        {STATE_GLYPH[gate.state]}
      </span>
      <span>{gate.id}</span>
      {gate.overridden && <span style={{ fontSize: 10 }}>·ovr</span>}
    </button>
  );
}
