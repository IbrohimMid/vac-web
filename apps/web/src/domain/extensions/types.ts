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

// --- Two-party promotion approvals (Slice #6 / ADR-0004) -----------------
//
// Bridge contract:
//   request_promotion  payload { extension_id, target_tier in {allowed_bundled, allowed_signed} }
//   approve_promotion  payload { request_id } (approver session must differ from requester)
//   list_approvals     payload {} -> emits extensions.approvals_list_response
//
// Producer: apps/local-bridge/src/extensions/{approvals.rs, handlers.rs}.
// A promotion is only valid for entries currently at tier=revoked.

export type PromotionTier = 'allowed_bundled' | 'allowed_signed';

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface PromotionApprovalRequest {
  request_id: string;
  extension_id: string;
  requested_tier: PromotionTier;
  requested_by_session_id: string;
  requested_by_profile_id: string;
  created_at: string;
  status: ApprovalStatus;
  decided_at: string | null;
  decided_by_session_id: string | null;
  decided_by_profile_id: string | null;
}

export interface ApprovalsListPayload {
  requests: PromotionApprovalRequest[];
}

export interface PromotionRequestedPayload {
  request: PromotionApprovalRequest;
}

export interface PromotionDecidedPayload {
  request: PromotionApprovalRequest;
}

export function isPromotionTier(v: unknown): v is PromotionTier {
  return v === 'allowed_bundled' || v === 'allowed_signed';
}

export function isApprovalStatus(v: unknown): v is ApprovalStatus {
  return v === 'pending' || v === 'approved' || v === 'denied';
}

export function isPromotionApprovalRequest(
  v: unknown,
): v is PromotionApprovalRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.request_id === 'string' &&
    typeof r.extension_id === 'string' &&
    isPromotionTier(r.requested_tier) &&
    typeof r.requested_by_session_id === 'string' &&
    typeof r.requested_by_profile_id === 'string' &&
    typeof r.created_at === 'string' &&
    isApprovalStatus(r.status)
  );
}

// True iff a tier transition requires the request/approve flow.
// Mirrors apply_promotion_with_approval gate in handlers.rs: only entries
// currently at `revoked` may be promoted to an `allowed_*` tier; any other
// transition flows through the direct `extensions.update_trust` handler.
export function isPromotionTransition(
  current: ExtensionTier,
  next: ExtensionTier,
): next is PromotionTier {
  return current === 'revoked' && isPromotionTier(next);
}
