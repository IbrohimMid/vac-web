import { describe, expect, it } from 'vitest';

import {
	errorTaxonomyFor,
	isRetryable,
	requiresAudit,
	ERROR_TAXONOMY_CODES,
	ERROR_TAXONOMY_FALLBACK,
} from './errorTaxonomy';

describe('errorTaxonomyFor', () => {
	it('marks profile.denied as audited and non-retryable', () => {
		const e = errorTaxonomyFor('profile.denied');
		expect(e.severity).toBe('error');
		expect(e.retryable).toBe('no_retry');
		expect(e.auditRequired).toBe(true);
	});

	it('marks audit.write_failed as critical+idempotent retry', () => {
		const e = errorTaxonomyFor('audit.write_failed');
		expect(e.severity).toBe('critical');
		expect(e.retryable).toBe('idempotent_retry');
		expect(e.auditRequired).toBe(true);
	});

	it('falls back deterministically for unknown codes', () => {
		const e = errorTaxonomyFor('totally.made.up');
		expect(e.severity).toBe(ERROR_TAXONOMY_FALLBACK.severity);
		expect(e.retryable).toBe(ERROR_TAXONOMY_FALLBACK.retryable);
	});

	it('exports a non-empty CODES array', () => {
		expect(ERROR_TAXONOMY_CODES.length).toBeGreaterThan(5);
	});
});

describe('isRetryable / requiresAudit', () => {
	it('aligns with errorTaxonomyFor', () => {
		expect(isRetryable('profile.denied')).toBe(false);
		expect(isRetryable('audit.write_failed')).toBe(true);
		expect(requiresAudit('profile.denied')).toBe(true);
		expect(requiresAudit('feature.not_wired')).toBe(false);
	});
});
