// Composer @-mention, attachment, and palette gating (slice 16).
//
// Acceptance:
//   * @ mention returns real local entities.
//   * Attachments respect project-root/profile policy.
//   * Palette never invokes unclassified generic actions.
//
// This module exposes pure validators that the Composer/MentionPicker/
// CommandPalette use to decide whether an entry is invokable.

export type MentionEntityKind = 'page' | 'session' | 'assessment' | 'handoff' | 'unknown';

export interface MentionResult {
	readonly id: string;
	readonly kind: MentionEntityKind;
	readonly title: string;
	/** Local source path where the entity was found (relative to project root). */
	readonly localPath?: string | undefined;
}

/**
 * Filter raw mention candidates down to entities that are real and local
 * (acceptance #1). Anything without a known kind or local source is
 * dropped to avoid surfacing mock-only or remote-only entries.
 */
export function filterRealMentionResults(
	candidates: ReadonlyArray<MentionResult>,
): ReadonlyArray<MentionResult> {
	return candidates.filter((c) => c.kind !== 'unknown' && typeof c.localPath === 'string' && c.localPath.length > 0);
}

export interface AttachmentRequest {
	readonly path: string;
}

export interface AttachmentPolicy {
	readonly projectRoot: string;
	readonly profileGrantsAttachments: boolean;
}

export type AttachmentDecision =
	| { ok: true; resolved: string }
	| { ok: false; code: 'attach.outside_project_root' | 'attach.profile_denied' | 'attach.invalid_path'; detail: string };

export function validateAttachment(
	req: AttachmentRequest,
	policy: AttachmentPolicy,
): AttachmentDecision {
	if (!req.path || typeof req.path !== 'string') {
		return { ok: false, code: 'attach.invalid_path', detail: 'Attachment path is empty.' };
	}
	if (!policy.profileGrantsAttachments) {
		return { ok: false, code: 'attach.profile_denied', detail: 'Active profile does not grant file attachments.' };
	}
	const root = normalize(policy.projectRoot);
	const target = normalize(req.path);
	if (!target.startsWith(root + '/') && target !== root) {
		return { ok: false, code: 'attach.outside_project_root', detail: 'Attachment path is outside the project root.' };
	}
	return { ok: true, resolved: target };
}

function normalize(p: string): string {
	const stripped = p.replace(/\/+$/u, '');
	const parts: string[] = [];
	for (const seg of stripped.split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') {
			parts.pop();
			continue;
		}
		parts.push(seg);
	}
	return (stripped.startsWith('/') ? '/' : '') + parts.join('/');
}

export interface PaletteAction {
	readonly id: string;
	/** Concrete command this palette action invokes; `null` means UI-only. */
	readonly commandId: string | null;
}

/**
 * Palette acceptance #3: never invoke unclassified generic actions.
 * Returns the command ID if the action maps to a concrete command, or
 * `null` if the action is a UI-only / unmapped entry that should not
 * cross to the bridge.
 */
export function resolvePaletteAction(action: PaletteAction): { invokable: boolean; commandId: string | null; reason?: string | undefined } {
	if (typeof action.commandId !== 'string' || action.commandId.length === 0) {
		return { invokable: false, commandId: null, reason: 'Palette action has no concrete command mapping.' };
	}
	return { invokable: true, commandId: action.commandId };
}
