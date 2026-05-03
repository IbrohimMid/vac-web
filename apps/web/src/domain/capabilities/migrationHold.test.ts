import { describe, expect, it } from 'vitest';

import { migrationHoldFor } from './migrationHold';

describe('migrationHoldFor', () => {
	it('holds every action when any capability is missing', () => {
		const d = migrationHoldFor({ persistenceWired: false, rollbackWired: true, schemaValidationWired: true, executorWired: true });
		expect(d.held).toBe(true);
		expect(d.canCreateDraft).toBe(false);
		expect(d.canDryRun).toBe(false);
		expect(d.canVerifyReversibility).toBe(false);
		expect(d.canDispatch).toBe(false);
		expect(d.canWriteContinuousConfig).toBe(false);
	});

	it('refuses partial enablement (acceptance #1)', () => {
		const combos = [
			{ persistenceWired: true, rollbackWired: false, schemaValidationWired: true, executorWired: true },
			{ persistenceWired: true, rollbackWired: true, schemaValidationWired: false, executorWired: true },
			{ persistenceWired: true, rollbackWired: true, schemaValidationWired: true, executorWired: false },
		];
		for (const c of combos) {
			const d = migrationHoldFor(c);
			expect(d.held).toBe(true);
			expect(d.canCreateDraft).toBe(false);
		}
	});

	it('explains why migration is held (acceptance #2)', () => {
		expect(migrationHoldFor({ persistenceWired: false, rollbackWired: true, schemaValidationWired: true, executorWired: true }).reason).toMatch(/persistence/i);
		expect(migrationHoldFor({ persistenceWired: true, rollbackWired: false, schemaValidationWired: true, executorWired: true }).reason).toMatch(/rollback/i);
		expect(migrationHoldFor({ persistenceWired: true, rollbackWired: true, schemaValidationWired: false, executorWired: true }).reason).toMatch(/schema/i);
		expect(migrationHoldFor({ persistenceWired: true, rollbackWired: true, schemaValidationWired: true, executorWired: false }).reason).toMatch(/executor/i);
	});

	it('enables every action together when all capabilities are ready', () => {
		const d = migrationHoldFor({ persistenceWired: true, rollbackWired: true, schemaValidationWired: true, executorWired: true });
		expect(d.held).toBe(false);
		expect(d.canCreateDraft).toBe(true);
		expect(d.canDryRun).toBe(true);
		expect(d.canVerifyReversibility).toBe(true);
		expect(d.canDispatch).toBe(true);
		expect(d.canWriteContinuousConfig).toBe(true);
	});
});
