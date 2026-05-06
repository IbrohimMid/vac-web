// Confirm-before-demote dialog. Surfaces the operator-visible consequences
// before quarantine/revoke land on the persisted trust config.

import type { CSSProperties } from 'react';
import {
  tierLabel,
  type ExtensionEntry,
  type ExtensionTier,
} from '../../../domain/extensions/types';

interface Props {
  entry: ExtensionEntry;
  targetTier: ExtensionTier;
  onConfirm: () => void;
  onCancel: () => void;
}

const BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const PANEL_STYLE: CSSProperties = {
  background: 'var(--surface, #111)',
  border: '1px solid var(--border, #333)',
  borderRadius: 8,
  padding: 20,
  minWidth: 360,
  maxWidth: 480,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const NO_MARGIN: CSSProperties = { margin: 0 };
const FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
};

const CONSEQUENCE: Record<ExtensionTier, string> = {
  allowed_bundled: 'Extension will be trusted as bundled.',
  allowed_signed:
    'Extension will be trusted with publisher signature checks.',
  quarantined:
    'Extension will continue to load but lose privileged capabilities.',
  revoked: 'Extension will be refused on next load.',
};

export function QuarantineConfirmModal({
  entry,
  targetTier,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="quarantine-title"
      data-testid="quarantine-modal"
      style={BACKDROP_STYLE}
      onClick={onCancel}
    >
      <div onClick={(e) => e.stopPropagation()} style={PANEL_STYLE}>
        <h3 id="quarantine-title" style={NO_MARGIN}>
          Confirm: {tierLabel(targetTier)}
        </h3>
        <p style={NO_MARGIN}>
          You are about to set the trust tier of{' '}
          <strong>{entry.id}</strong> to{' '}
          <strong>{tierLabel(targetTier)}</strong>.
        </p>
        <p className="muted" style={NO_MARGIN}>
          {CONSEQUENCE[targetTier]}
        </p>
        <div style={FOOTER_STYLE}>
          <button
            className="btn"
            onClick={onCancel}
            data-testid="quarantine-cancel"
          >
            Cancel
          </button>
          <button
            className={targetTier === 'revoked' ? 'btn crit' : 'btn warn'}
            onClick={onConfirm}
            data-testid="quarantine-confirm"
            autoFocus
          >
            {tierLabel(targetTier)}
          </button>
        </div>
      </div>
    </div>
  );
}
