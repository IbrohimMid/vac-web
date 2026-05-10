// Confirm-before-request dialog for promoting a `revoked` extension to an
// `allowed_*` tier (Slice #6 / ADR-0004). Surfaces the operator-visible
// consequences before the request lands on the bridge approval queue, where
// it will then need a second operator to approve via
// extensions.approve_promotion before any trust delta is persisted.

import type { CSSProperties } from 'react';
import { useRef } from 'react';
import {
  tierLabel,
  type ExtensionEntry,
  type PromotionTier,
} from '../../../domain/extensions/types';
import { useFocusTrap } from '../../../hooks/useFocusTrap';

interface Props {
  entry: ExtensionEntry;
  targetTier: PromotionTier;
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

export function PromotionRequestModal({
  entry,
  targetTier,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, { onEscape: onCancel });

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="promotion-request-title"
      data-testid="promotion-request-modal"
      style={BACKDROP_STYLE}
      onClick={onCancel}
    >
      <div onClick={(e) => e.stopPropagation()} style={PANEL_STYLE}>
        <h3 id="promotion-request-title" style={NO_MARGIN}>
          Request promotion: {tierLabel(targetTier)}
        </h3>
        <p style={NO_MARGIN}>
          You are about to request a promotion for{' '}
          <strong>{entry.id}</strong> from{' '}
          <strong>{tierLabel(entry.tier)}</strong> to{' '}
          <strong>{tierLabel(targetTier)}</strong>.
        </p>
        <p className="muted" style={NO_MARGIN}>
          A second operator must approve this request from a different
          session before the trust tier changes. The pending request will
          appear in the approvals queue below until then.
        </p>
        <div style={FOOTER_STYLE}>
          <button
            className="btn"
            onClick={onCancel}
            data-testid="promotion-request-cancel"
          >
            Cancel
          </button>
          <button
            className="btn"
            onClick={onConfirm}
            data-testid="promotion-request-confirm"
            autoFocus
            data-autofocus="true"
          >
            Request {tierLabel(targetTier)}
          </button>
        </div>
      </div>
    </div>
  );
}
