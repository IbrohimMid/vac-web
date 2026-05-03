import { describe, expect, it } from 'vitest';

import {
	EVENT_CATALOG,
	EVENT_BY_ID,
	eventStatus,
	isKnownEvent,
	isLegacyMockOnly,
	replacementFor,
} from './eventCatalog';

describe('eventCatalog (generated)', () => {
	it('contains the canonical session lifecycle events', () => {
		for (const id of [
			'session.started',
			'session.closed',
			'session.context.updated',
			'session.renamed',
		]) {
			expect(isKnownEvent(id)).toBe(true);
			expect(eventStatus(id)).toBe('implemented');
		}
	});

	it('contains the canonical review taxonomy events', () => {
		expect(isKnownEvent('review.changeset_updated')).toBe(true);
		expect(isKnownEvent('review.file_diff_chunk')).toBe(true);
	});

	it('marks shell.started/output as not_wired', () => {
		expect(eventStatus('shell.started')).toBe('not_wired');
		expect(eventStatus('shell.output')).toBe('not_wired');
	});

	it('marks legacy mock events with a replacement', () => {
		expect(isLegacyMockOnly('changeset.updated')).toBe(true);
		expect(replacementFor('changeset.updated')).toBe('review.changeset_updated');
	});

	it('every legacy event declares a replacement that exists in the catalog', () => {
		for (const e of EVENT_CATALOG) {
			if (e.status === 'legacy_mock_only') {
				expect(e.replacement).toBeDefined();
				expect(EVENT_BY_ID.has(e.replacement!)).toBe(true);
			}
		}
	});

	it('rejects unknown ids', () => {
		expect(isKnownEvent('totally.fake.event')).toBe(false);
		expect(eventStatus('totally.fake.event')).toBeUndefined();
	});

	it('catalog has at least 20 entries', () => {
		expect(EVENT_CATALOG.length).toBeGreaterThanOrEqual(20);
	});
});
