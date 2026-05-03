// Gate / signoff / override UX (slice 12).
//
// The cockpit GateRibbon must:
//   * Render gate state from authoritative bridge events.
//   * Disable signoff/override controls until persistence + audit exist.
//   * Require reason and expiry for overrides.
//   * Expire overrides automatically.
//
// `gateAffordanceFor()` is the single source of truth that combines a
// gate state, persistence/audit availability, and time, into a UX
// decision (controls enabled/disabled, override active/expired).

export type GateOutcome = 'pass' | 'fail' | 'pending' | 'unknown';

export interface GateState {
	readonly id: string;
	readonly outcome: GateOutcome;
	readonly signoffPersisted?: boolean;
	readonly override?: {
		readonly reason: string;
		readonly expiresAt: string; // ISO-8601
	} | null;
}

export interface GateBackendCapabilities {
	readonly persistenceWired: boolean;
	readonly auditWired: boolean;
}

export interface GateAffordance {
	readonly canSignoff: boolean;
	readonly canOverride: boolean;
	readonly overrideActive: boolean;
	readonly overrideExpired: boolean;
	readonly disabledReason?: string | undefined;
}

export interface OverrideRequest {
	readonly reason?: string;
	readonly expiresAt?: string;
}

export function validateOverrideRequest(req: OverrideRequest): { ok: true } | { ok: false; code: 'gate.reason_required' | 'gate.expiry_required' | 'gate.expiry_in_past'; detail: string } {
	if (!req.reason || req.reason.trim().length === 0) {
		return { ok: false, code: 'gate.reason_required', detail: 'Override requires a reason.' };
	}
	if (!req.expiresAt) {
		return { ok: false, code: 'gate.expiry_required', detail: 'Override requires an explicit expiry.' };
	}
	const t = Date.parse(req.expiresAt);
	if (Number.isNaN(t)) {
		return { ok: false, code: 'gate.expiry_required', detail: 'Override expiry could not be parsed.' };
	}
	if (t <= Date.now()) {
		return { ok: false, code: 'gate.expiry_in_past', detail: 'Override expiry must be in the future.' };
	}
	return { ok: true };
}

export function gateAffordanceFor(
	gate: GateState,
	caps: GateBackendCapabilities,
	now: Date = new Date(),
): GateAffordance {
	if (!caps.persistenceWired || !caps.auditWired) {
		return {
			canSignoff: false,
			canOverride: false,
			overrideActive: false,
			overrideExpired: false,
			disabledReason: !caps.persistenceWired
				? 'Signoff requires persistence; this profile has it disabled.'
				: 'Override requires audit logging; this profile has it disabled.',
		};
	}
	if (!gate.override) {
		return {
			canSignoff: gate.outcome !== 'pass',
			canOverride: gate.outcome === 'fail',
			overrideActive: false,
			overrideExpired: false,
		};
	}
	const expiresAt = Date.parse(gate.override.expiresAt);
	const expired = !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
	return {
		canSignoff: gate.outcome !== 'pass',
		canOverride: gate.outcome === 'fail' && expired,
		overrideActive: !expired,
		overrideExpired: expired,
	};
}
