// Renders the trust catalog as a table with per-row trust dropdowns.
// Quarantine + revoke pass through QuarantineConfirmModal so the
// operator confirms each demotion explicitly.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  EXTENSION_TIERS,
  tierLabel,
  type ExtensionEntry,
  type ExtensionTier,
} from '../../../domain/extensions/types';
import { useExtensions } from '../../../stores/extensions';
import type { TransportHandle } from '../../../transport';
import { QuarantineConfirmModal } from './QuarantineConfirmModal';
import { TrustActionMenu } from './TrustActionMenu';

interface Props {
  transport: TransportHandle | null;
}

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  marginBottom: 8,
};
const TABLE_STYLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};
const TH_STYLE: CSSProperties = { textAlign: 'left' };

function decisionTone(d: ExtensionEntry['decision']): string {
  switch (d) {
    case 'allowed_bundled':
    case 'allowed_signed':
      return 'badge ok';
    case 'quarantined':
      return 'badge warn';
    case 'revoked':
      return 'badge crit';
  }
}

export function ExtensionsList({ transport }: Props) {
  const status = useExtensions((s) => s.status);
  const error = useExtensions((s) => s.error);
  const order = useExtensions((s) => s.order);
  const entries = useExtensions((s) => s.entries);
  const allowUnsigned = useExtensions((s) => s.allowUnsigned);
  const publishers = useExtensions((s) => s.publishers);
  const requestList = useExtensions((s) => s.requestList);
  const updateTrust = useExtensions((s) => s.updateTrust);

  const [pending, setPending] = useState<
    { entry: ExtensionEntry; tier: ExtensionTier } | null
  >(null);

  useEffect(() => {
    if (transport && status === 'idle') {
      void requestList(transport);
    }
  }, [transport, status, requestList]);

  const handleTierChange = async (
    entry: ExtensionEntry,
    nextTier: ExtensionTier,
  ) => {
    if (nextTier === entry.tier) return;
    if (nextTier === 'quarantined' || nextTier === 'revoked') {
      setPending({ entry, tier: nextTier });
      return;
    }
    await updateTrust(transport, entry.id, nextTier);
  };

  const confirmDemotion = async () => {
    if (!pending) return;
    await updateTrust(transport, pending.entry.id, pending.tier);
    setPending(null);
  };

  const cancelDemotion = () => setPending(null);

  const visible = order
    .map((id) => entries.get(id))
    .filter((e): e is ExtensionEntry => !!e);

  return (
    <div data-testid="extensions-list">
      <div style={HEADER_ROW_STYLE}>
        <span className="muted">{order.length} extensions</span>
        <span className={`badge ${allowUnsigned ? 'warn' : 'ok'}`}>
          allow_unsigned: {allowUnsigned ? 'true' : 'false'}
        </span>
        <span className="muted">{publishers.length} publishers</span>
        <button
          className="btn"
          onClick={() => void requestList(transport)}
          disabled={!transport || status === 'loading'}
        >
          Refresh
        </button>
      </div>
      {status === 'error' && error && (
        <div role="alert" className="badge crit" data-testid="extensions-error">
          {error}
        </div>
      )}
      {status === 'loading' && order.length === 0 && (
        <div className="muted" data-testid="extensions-loading">
          Loading extensions…
        </div>
      )}
      {visible.length === 0 && status !== 'loading' ? (
        <div className="muted" data-testid="extensions-empty">
          No extensions declared.
        </div>
      ) : (
        <table className="data-table" style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={TH_STYLE}>Extension</th>
              <th style={TH_STYLE}>Source</th>
              <th style={TH_STYLE}>Publisher</th>
              <th style={TH_STYLE}>Decision</th>
              <th style={TH_STYLE}>Tier</th>
              <th style={TH_STYLE}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.id} data-testid={`extension-row-${entry.id}`}>
                <td>{entry.id}</td>
                <td>{entry.source}</td>
                <td className="muted">{entry.publisher ?? '—'}</td>
                <td>
                  <span className={decisionTone(entry.decision)}>
                    {tierLabel(entry.decision)}
                  </span>
                </td>
                <td>
                  <select
                    aria-label={`Trust tier for ${entry.id}`}
                    value={entry.tier}
                    disabled={!transport}
                    onChange={(e) =>
                      void handleTierChange(
                        entry,
                        e.target.value as ExtensionTier,
                      )
                    }
                  >
                    {EXTENSION_TIERS.map((t) => (
                      <option key={t} value={t}>
                        {tierLabel(t)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <TrustActionMenu
                    entry={entry}
                    onSelect={(tier) => void handleTierChange(entry, tier)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pending && (
        <QuarantineConfirmModal
          entry={pending.entry}
          targetTier={pending.tier}
          onConfirm={() => void confirmDemotion()}
          onCancel={cancelDemotion}
        />
      )}
    </div>
  );
}
