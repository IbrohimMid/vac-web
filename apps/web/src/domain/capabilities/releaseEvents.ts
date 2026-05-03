// Release surface event classifier (slice 14).
//
// Acceptance:
//   * Release tab never implies production confidence from mock data.
//   * Deploy/publish disabled until gate readiness and backend executor
//     exist.
//   * Draft notes are labeled drafts.
//
// `releaseEventCopyFor()` and `releaseAffordanceFor()` are the single
// sources of truth for the ReleaseTab.

export type ReleaseEventStatus =
	| 'implemented'
	| 'draft_only'
	| 'mock_only'
	| 'future'
	| 'unknown';

export interface ReleaseEventCopy {
	readonly eventType: string;
	readonly status: ReleaseEventStatus;
	readonly title: string;
	readonly detail: string;
	/** True iff the cockpit may show this as production-grade. */
	readonly production: boolean;
}

const FALLBACK: ReleaseEventCopy = Object.freeze({
	eventType: '',
	status: 'unknown',
	title: 'Release event',
	detail: 'The cockpit does not classify this release event.',
	production: false,
});

const CODES: Record<string, Omit<ReleaseEventCopy, 'eventType'>> = {
	'release.targets': {
		status: 'implemented',
		title: 'Release targets loaded',
		detail: 'Read-only target list from local config.',
		production: false,
	},
	'release.notes_draft': {
		status: 'draft_only',
		title: 'Draft release notes',
		detail: 'These notes have not been persisted; treat them as a draft.',
		production: false,
	},
	'release.deploy_progress': {
		status: 'mock_only',
		title: 'Deploy progress (mock)',
		detail: 'Deploy progress events come from the mock engine; no production deploy is in progress.',
		production: false,
	},
	'release.post_deploy_observation': {
		status: 'mock_only',
		title: 'Post-deploy observation (mock)',
		detail: 'Observed only in mock scenarios; not yet wired to real telemetry.',
		production: false,
	},
};

export function releaseEventCopyFor(eventType: string): ReleaseEventCopy {
	if (typeof eventType !== 'string' || eventType.length === 0) {
		return FALLBACK;
	}
	const hit = CODES[eventType];
	return hit ? { eventType, ...hit } : { ...FALLBACK, eventType };
}

export interface ReleaseBackendCapabilities {
	readonly gatesReady: boolean;
	readonly persistenceWired: boolean;
	readonly deployExecutorWired: boolean;
	readonly publishExecutorWired: boolean;
}

export interface ReleaseAffordance {
	readonly canDeploy: boolean;
	readonly canPublish: boolean;
	readonly canPersistNotes: boolean;
	readonly disabledReason?: string | undefined;
}

export function releaseAffordanceFor(caps: ReleaseBackendCapabilities): ReleaseAffordance {
	const canDeploy = caps.gatesReady && caps.deployExecutorWired;
	const canPublish = caps.gatesReady && caps.publishExecutorWired;
	const canPersistNotes = caps.persistenceWired;
	let disabledReason: string | undefined;
	if (!canDeploy && !canPublish) {
		if (!caps.gatesReady) disabledReason = 'Release gates are not ready.';
		else if (!caps.deployExecutorWired) disabledReason = 'Deploy executor is not wired.';
		else if (!caps.publishExecutorWired) disabledReason = 'Publish executor is not wired.';
	}
	return { canDeploy, canPublish, canPersistNotes, disabledReason };
}

export const RELEASE_EVENTS: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as RELEASE_EVENT_FALLBACK };
