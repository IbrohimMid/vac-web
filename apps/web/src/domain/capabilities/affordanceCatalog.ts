// Frontend declarative affordance catalog (slice 33).
//
// Maps UI controls to:
//   * the command they invoke (or null for frontend-only controls);
//   * a capability gate (capability module reference);
//   * disabled-copy fallback;
//   * required session/runtime conditions.
//
// Acceptance:
//   * A visible enabled control always maps to an implemented backend command
//     or a frontend_owned action.
//   * Disabled controls show consistent operator-facing reason copy.
//   * New command buttons require a catalog entry.
//
// This module deliberately stays small — it is the schema and a typed lookup.
// Surface code (Topbar / ReleaseTab / etc.) imports `affordanceFor()` and
// receives a deterministic decision instead of repeating capability checks.

import { commandStatus } from '../../generated/commandCatalog';

export type AffordanceCommandStatus =
	| 'implemented'
	| 'frontend_owned'
	| 'not_wired'
	| 'unknown';

export interface AffordanceContext {
	readonly commandStatus: AffordanceCommandStatus;
	readonly hasTransport: boolean;
	readonly hasSessionId: boolean;
	readonly sessionKind?: 'acp' | 'codex' | 'unknown' | undefined;
	readonly metadataKeys?: ReadonlyArray<string> | undefined;
	readonly gateReady?: boolean | undefined;
}

export interface AffordanceDecision {
	readonly affordanceId: string;
	readonly command: string | null;
	readonly visible: boolean;
	readonly enabled: boolean;
	readonly disabledReason?: string | undefined;
}

export interface AffordanceSpec {
	readonly id: string;
	readonly component: string;
	readonly command: string | null;
	readonly when?:
		| {
				sessionKind?: AffordanceContext['sessionKind'];
				hasTransport?: boolean;
				hasSessionId?: boolean;
				metadataAny?: ReadonlyArray<string>;
		  }
		| undefined;
	readonly enabledIf?:
		| {
				commandStatus?: AffordanceCommandStatus;
				gateReady?: boolean;
		  }
		| undefined;
	readonly disabledCopy: string;
}

const SPECS: ReadonlyArray<AffordanceSpec> = Object.freeze([
	{
		id: 'topbar.model.select',
		component: 'Topbar.ModelContextChip',
		command: 'session.mode.set',
		when: { sessionKind: 'acp', hasTransport: true, hasSessionId: true, metadataAny: ['modes', 'models'] },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Model switching is unavailable for this runtime.',
	},
	{
		id: 'release.deploy.button',
		component: 'ReleaseTab.DeployButton',
		command: 'release.deploy',
		enabledIf: { commandStatus: 'implemented', gateReady: true },
		disabledCopy: 'Release gates are not ready.',
	},
	{
		id: 'shell.start',
		component: 'ShellDrawer.StartButton',
		command: 'shell.start',
		when: { hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Shell backend is not wired yet.',
	},
	{
		id: 'review.revert_file',
		component: 'ReviewTab.RevertFileButton',
		command: 'review.revert_file',
		when: { hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Revert requires bridge fs executor + audit; not wired.',
	},
	{
		// Slice 33 follow-up: catalog entry kept in place even though there is
		// no dedicated UI button today. dismissAll() is invoked via Cmd+K
		// (main.tsx) and the session activation handler. When a future surface
		// adds a visible button (target component name `Overlay.DismissAllButton`)
		// it can adopt this affordance unchanged.
		id: 'overlay.dismiss_all',
		component: 'Overlay.DismissAllButton',
		command: null,
		enabledIf: { commandStatus: 'frontend_owned' },
		disabledCopy: 'Overlay control is unavailable.',
	},
	{
		id: 'session.create',
		component: 'SessionPicker.CreateButton',
		command: 'session.create',
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Session create backend is not wired yet.',
	},
	{
		id: 'notify.dismiss',
		component: 'NotifyLane.DismissButton',
		command: null,
		enabledIf: { commandStatus: 'frontend_owned' },
		disabledCopy: 'Notification dismiss is unavailable.',
	},
	{
		id: 'transcript.tool.toggle',
		component: 'Transcript.ToolCallBlock',
		command: null,
		enabledIf: { commandStatus: 'frontend_owned' },
		disabledCopy: 'Tool call expand/collapse is unavailable.',
	},
	{
		id: 'topbar.search.trigger',
		component: 'Topbar.SearchTrigger',
		command: null,
		enabledIf: { commandStatus: 'frontend_owned' },
		disabledCopy: 'Command palette is unavailable.',
	},
	{
		id: 'composer.message.submit',
		component: 'Composer.SendButton',
		command: 'message.submit',
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Open or create a session before sending a message.',
	},
	{
		id: 'approvals.approve_all',
		component: 'Approvals.ApproveAllButton',
		command: null,
		when: { hasTransport: true },
		enabledIf: { commandStatus: 'frontend_owned' },
		disabledCopy: 'Connect to the bridge to approve pending tool calls.',
	},
	{
		id: 'approvals.decide',
		component: 'Approvals.DecideButton',
		command: 'approval.respond',
		when: { hasTransport: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Connect to the bridge to record an approval decision.',
	},
	{
		id: 'review.revert_all',
		component: 'ReviewTab.RevertAllButton',
		command: null,
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'frontend_owned' },
		disabledCopy: 'Connect to the bridge before reverting the changeset.',
	},
	{
		id: 'release.publish.button',
		component: 'ReleaseTab.PublishButton',
		command: 'release.publish',
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'implemented', gateReady: true },
		disabledCopy: 'Release publish gate is not ready.',
	},
	{
		id: 'release.generate_notes.button',
		component: 'ReleaseTab.GenerateNotesButton',
		command: 'release.generate_notes',
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Release notes generator is not wired yet.',
	},
	{
		id: 'gate.signoff.button',
		component: 'GateDetail.SignOffButton',
		command: 'gate.signoff',
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Gate signoff requires persistence + audit; not wired.',
	},
	{
		id: 'gate.override.button',
		component: 'GateDetail.OverrideButton',
		command: 'gate.override',
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Gate override requires reason+expiry+audit; not wired.',
	},
	{
		id: 'runtime.cancel_job.button',
		component: 'RuntimeTab.CancelButton',
		command: 'runtime.cancel_job',
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Job cancellation backend is not wired yet.',
	},
	{
		id: 'migration.create_draft.button',
		component: 'MigrationTab.NewDraftButton',
		command: 'migration.create_draft',
		when: { hasTransport: true, hasSessionId: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Migration packets require executor.migration profile; not wired (Phase 7).',
	},
	{
		id: 'connector.connect.button',
		component: 'ConnectorsTab.ConnectButton',
		command: 'connector.connect',
		when: { hasTransport: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Connector connect flow is not wired yet.',
	},
	{
		id: 'connector.disconnect.button',
		component: 'ConnectorsTab.DisconnectButton',
		command: 'connector.disconnect',
		when: { hasTransport: true },
		enabledIf: { commandStatus: 'implemented' },
		disabledCopy: 'Connector disconnect flow is not wired yet.',
	},
]);

const SPEC_BY_ID = new Map<string, AffordanceSpec>(SPECS.map((s) => [s.id, s]));

export function listAffordances(): ReadonlyArray<AffordanceSpec> {
	return SPECS;
}

export function toAffordanceStatus(commandId: string): AffordanceCommandStatus {
	const s = commandStatus(commandId);
	if (s === 'implemented' || s === 'frontend_owned' || s === 'not_wired') return s;
	return 'unknown';
}

export function affordanceFor(
	affordanceId: string,
	ctx: AffordanceContext,
): AffordanceDecision {
	const spec = SPEC_BY_ID.get(affordanceId);
	if (!spec) {
		return { affordanceId, command: null, visible: false, enabled: false, disabledReason: 'Unknown affordance.' };
	}
	const visible = matchVisibility(spec, ctx);
	if (!visible) {
		return { affordanceId, command: spec.command, visible: false, enabled: false };
	}
	const enabled = matchEnabled(spec, ctx);
	return {
		affordanceId,
		command: spec.command,
		visible: true,
		enabled,
		...(enabled ? {} : { disabledReason: spec.disabledCopy }),
	};
}

function matchVisibility(spec: AffordanceSpec, ctx: AffordanceContext): boolean {
	const w = spec.when;
	if (!w) return true;
	if (w.sessionKind && ctx.sessionKind !== w.sessionKind) return false;
	if (w.hasTransport === true && !ctx.hasTransport) return false;
	if (w.hasSessionId === true && !ctx.hasSessionId) return false;
	if (w.metadataAny && w.metadataAny.length > 0) {
		const keys = ctx.metadataKeys ?? [];
		if (!w.metadataAny.some((k) => keys.includes(k))) return false;
	}
	return true;
}

function matchEnabled(spec: AffordanceSpec, ctx: AffordanceContext): boolean {
	const e = spec.enabledIf;
	if (!e) return true;
	if (e.commandStatus && ctx.commandStatus !== e.commandStatus) return false;
	if (e.gateReady === true && ctx.gateReady !== true) return false;
	return true;
}
