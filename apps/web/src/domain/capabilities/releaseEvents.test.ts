import { describe, expect, it } from 'vitest';

import {
	releaseEventCopyFor,
	releaseAffordanceFor,
	RELEASE_EVENTS,
} from './releaseEvents';

describe('releaseEventCopyFor', () => {
	it('marks every release event as non-production by default', () => {
		for (const code of RELEASE_EVENTS) {
			expect(releaseEventCopyFor(code).production).toBe(false);
		}
	});

	it('labels draft notes explicitly as draft_only', () => {
		expect(releaseEventCopyFor('release.notes_draft').status).toBe('draft_only');
	});

	it('labels deploy_progress and post_deploy as mock_only', () => {
		expect(releaseEventCopyFor('release.deploy_progress').status).toBe('mock_only');
		expect(releaseEventCopyFor('release.post_deploy_observation').status).toBe('mock_only');
	});

	it('falls back deterministically for unknown event types', () => {
		expect(releaseEventCopyFor('release.unknown').status).toBe('unknown');
	});
});

describe('releaseAffordanceFor', () => {
	it('disables deploy until gates and executor are ready', () => {
		const a = releaseAffordanceFor({ gatesReady: false, persistenceWired: true, deployExecutorWired: true, publishExecutorWired: true });
		expect(a.canDeploy).toBe(false);
		expect(a.canPublish).toBe(false);
	});

	it('enables deploy/publish when gates and executors are ready', () => {
		const a = releaseAffordanceFor({ gatesReady: true, persistenceWired: true, deployExecutorWired: true, publishExecutorWired: true });
		expect(a.canDeploy).toBe(true);
		expect(a.canPublish).toBe(true);
	});

	it('persistNotes follows persistence flag', () => {
		expect(
			releaseAffordanceFor({ gatesReady: false, persistenceWired: false, deployExecutorWired: false, publishExecutorWired: false }).canPersistNotes,
		).toBe(false);
		expect(
			releaseAffordanceFor({ gatesReady: false, persistenceWired: true, deployExecutorWired: false, publishExecutorWired: false }).canPersistNotes,
		).toBe(true);
	});
});
