import { describe, expect, it } from 'vitest';

import {
	assessmentIndexCopyFor,
	isAssessmentIndexEvent,
	classifyIndexFailure,
	ASSESSMENT_INDEX_EVENTS,
	ASSESSMENT_INDEX_FALLBACK,
} from './assessmentIndex';

describe('assessmentIndexCopyFor', () => {
	it('marks rebuild_started and rebuild_progress as rebuilding', () => {
		expect(assessmentIndexCopyFor('assessment.index.rebuild_started').rebuilding).toBe(true);
		expect(assessmentIndexCopyFor('assessment.index.rebuild_progress').rebuilding).toBe(true);
		expect(assessmentIndexCopyFor('assessment.index.rebuilt').rebuilding).toBe(false);
	});

	it('preserves findings on every event including failure', () => {
		for (const code of ASSESSMENT_INDEX_EVENTS) {
			expect(assessmentIndexCopyFor(code).preserveFindings).toBe(true);
		}
	});

	it('falls back deterministically for unknown event types', () => {
		expect(assessmentIndexCopyFor('assessment.unknown')).toEqual(ASSESSMENT_INDEX_FALLBACK);
		expect(isAssessmentIndexEvent('assessment.unknown')).toBe(false);
		expect(isAssessmentIndexEvent('assessment.index.rebuilt')).toBe(true);
	});

	it('every code returns non-empty title and detail', () => {
		for (const code of ASSESSMENT_INDEX_EVENTS) {
			const c = assessmentIndexCopyFor(code);
			expect(c.title.length).toBeGreaterThan(0);
			expect(c.detail.length).toBeGreaterThan(0);
		}
	});
});

describe('classifyIndexFailure', () => {
	it('distinguishes the four documented failure buckets', () => {
		expect(classifyIndexFailure('persistence is disabled in this profile').reason).toBe('persistence_disabled');
		expect(classifyIndexFailure('project root unavailable').reason).toBe('project_root');
		expect(classifyIndexFailure('schema version mismatch').reason).toBe('schema');
		expect(classifyIndexFailure('storage write failed').reason).toBe('storage');
		expect(classifyIndexFailure('disk full').reason).toBe('storage');
	});

	it('falls back to unknown when no rule matches', () => {
		expect(classifyIndexFailure('').reason).toBe('unknown');
		expect(classifyIndexFailure(null).reason).toBe('unknown');
		expect(classifyIndexFailure(undefined).reason).toBe('unknown');
		expect(classifyIndexFailure('something else entirely').reason).toBe('unknown');
	});
});
