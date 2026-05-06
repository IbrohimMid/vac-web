// Quick-action menu — promote/demote shortcuts. The list is intentionally
// minimal; the full tier selector lives in the row's <select>.

import type { CSSProperties } from 'react';
import {
  tierLabel,
  type ExtensionEntry,
  type ExtensionTier,
} from '../../../domain/extensions/types';

interface Props {
  entry: ExtensionEntry;
  onSelect: (tier: ExtensionTier) => void;
}

const MENU_STYLE: CSSProperties = { display: 'flex', gap: 4 };

const SHORTCUTS: ExtensionTier[] = [
  'allowed_bundled',
  'quarantined',
  'revoked',
];

export function TrustActionMenu({ entry, onSelect }: Props) {
  return (
    <div
      role="group"
      aria-label={`Trust actions for ${entry.id}`}
      style={MENU_STYLE}
    >
      {SHORTCUTS.filter((t) => t !== entry.tier).map((t) => (
        <button
          key={t}
          className="btn small"
          data-testid={`trust-action-${entry.id}-${t}`}
          onClick={() => onSelect(t)}
        >
          {tierLabel(t)}
        </button>
      ))}
    </div>
  );
}
