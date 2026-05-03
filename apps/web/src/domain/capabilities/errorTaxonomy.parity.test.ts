// Parity test (slice 40 step_03).
//
// Asserts the hand-authored capability classifier in errorTaxonomy.ts
// matches the generated catalog in apps/web/src/generated/errorTaxonomyCatalog.ts
// (generated from schema/error-taxonomy.yaml).
//
// Either side may be the easier place to add an entry; this test fails
// loudly when they drift apart.

import { describe, expect, it } from 'vitest';

import {
	ERROR_TAXONOMY_CATALOG,
	ERROR_TAXONOMY_CATALOG_BY_CODE,
} from '../../generated/errorTaxonomyCatalog';
import { errorTaxonomyFor, ERROR_TAXONOMY_CODES } from './errorTaxonomy';

describe('error taxonomy parity (capability vs generated catalog)', () => {
	it('every code in the capability module exists in the generated catalog', () => {
		for (const code of ERROR_TAXONOMY_CODES) {
			expect(
				ERROR_TAXONOMY_CATALOG_BY_CODE.has(code),
				`code ${code} missing from generated catalog`,
			).toBe(true);
		}
	});

	it('every code in the generated catalog exists in the capability module', () => {
		const capabilityCodes = new Set(ERROR_TAXONOMY_CODES);
		for (const e of ERROR_TAXONOMY_CATALOG) {
			expect(
				capabilityCodes.has(e.code),
				`generated code ${e.code} missing from capability module`,
			).toBe(true);
		}
	});

	it('every shared code agrees on severity / retryable / recovery / audit / message', () => {
		for (const e of ERROR_TAXONOMY_CATALOG) {
			const capability = errorTaxonomyFor(e.code);
			expect(capability.severity, `severity for ${e.code}`).toBe(e.severity);
			expect(capability.retryable, `retryable for ${e.code}`).toBe(e.retryable);
			expect(capability.recovery, `recovery for ${e.code}`).toBe(e.recovery);
			expect(capability.auditRequired, `auditRequired for ${e.code}`).toBe(e.auditRequired);
			expect(capability.userMessage, `userMessage for ${e.code}`).toBe(e.userMessage);
		}
	});
});
