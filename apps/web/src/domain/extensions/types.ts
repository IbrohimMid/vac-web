// Types mirror the bridge's extensions.list_response / extensions.updated
// payloads. See apps/local-bridge/src/extensions/handlers.rs for the producer.

export type ExtensionTier =
  | 'allowed_bundled'
  | 'allowed_signed'
  | 'quarantined'
  | 'revoked';

export type ExtensionSource = 'bundled' | 'signed';

export type TrustDecision =
  | 'allowed_bundled'
  | 'allowed_signed'
  | 'quarantined'
  | 'revoked';

export interface ExtensionEntry {
  id: string;
  tier: ExtensionTier;
  source: ExtensionSource;
  publisher: string | null;
  decision: TrustDecision;
}

export interface ExtensionsListPayload {
  version: number;
  allow_unsigned: boolean;
  publishers: string[];
  entries: ExtensionEntry[];
}

export interface ExtensionsUpdatedPayload {
  entry: ExtensionEntry;
}

export const EXTENSION_TIERS: ExtensionTier[] = [
  'allowed_bundled',
  'allowed_signed',
  'quarantined',
  'revoked',
];

export function tierLabel(t: ExtensionTier): string {
  switch (t) {
    case 'allowed_bundled':
      return 'Allowed (bundled)';
    case 'allowed_signed':
      return 'Allowed (signed)';
    case 'quarantined':
      return 'Quarantined';
    case 'revoked':
      return 'Revoked';
  }
}

export function isExtensionTier(v: unknown): v is ExtensionTier {
  return (
    v === 'allowed_bundled' ||
    v === 'allowed_signed' ||
    v === 'quarantined' ||
    v === 'revoked'
  );
}

export function isExtensionSource(v: unknown): v is ExtensionSource {
  return v === 'bundled' || v === 'signed';
}

export function isTrustDecision(v: unknown): v is TrustDecision {
  return isExtensionTier(v);
}
