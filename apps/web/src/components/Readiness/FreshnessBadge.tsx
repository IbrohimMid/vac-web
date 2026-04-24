import { freshnessTier, type EvidenceRef, type FreshnessTier } from '../../stores/assessment';

const LABEL: Record<FreshnessTier, string> = {
  fresh: '✓',
  aging: '~',
  stale: '⟳',
  hard_expire: '✗',
};

const COLOR: Record<FreshnessTier, string> = {
  fresh: 'var(--sev-ok)',
  aging: 'var(--sev-info)',
  stale: 'var(--sev-warn)',
  hard_expire: 'var(--sev-error)',
};

export function FreshnessBadge({ evidence, now }: { evidence: EvidenceRef; now?: number }) {
  const tier = freshnessTier(evidence, now);
  return (
    <span
      title={`freshness: ${tier}`}
      aria-label={`freshness ${tier}`}
      style={{
        color: COLOR[tier],
        fontWeight: 700,
        fontFamily: 'monospace',
        fontSize: 11,
        marginRight: 4,
      }}
    >
      {LABEL[tier]}
    </span>
  );
}
