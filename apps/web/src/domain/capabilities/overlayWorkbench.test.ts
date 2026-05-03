import { describe, expect, it } from 'vitest';

import { classifyCommandOwnership, planAffordanceFor } from './overlayWorkbench';

describe('classifyCommandOwnership', () => {
	it('keeps overlay.* and workbench.select_tab frontend-only', () => {
		for (const cmd of ['overlay.open', 'overlay.dismiss', 'overlay.dismiss_all', 'workbench.select_tab']) {
			const d = classifyCommandOwnership(cmd);
			expect(d.ownership).toBe('frontend_only');
			expect(d.localOnly).toBe(true);
			expect(d.disabled).toBe(false);
		}
	});

	it('disables workbench.invoke (acceptance #3)', () => {
		const d = classifyCommandOwnership('workbench.invoke');
		expect(d.ownership).toBe('unmapped');
		expect(d.disabled).toBe(true);
	});

	it('disables unknown commands by default', () => {
		const d = classifyCommandOwnership('totally.unknown');
		expect(d.disabled).toBe(true);
	});

	it('routes plan.open to bridge', () => {
		const d = classifyCommandOwnership('plan.open');
		expect(d.ownership).toBe('bridge_owned');
		expect(d.localOnly).toBe(false);
	});
});

describe('planAffordanceFor', () => {
	it('hides plan mutation when bridge does not own plan state (acceptance #2)', () => {
		const a = planAffordanceFor({ bridgeOwnsPlanState: false });
		expect(a.canEdit).toBe(false);
		expect(a.canApprove).toBe(false);
		expect(a.canReject).toBe(false);
		expect(a.readOnlyReason).toMatch(/read-only/i);
	});

	it('enables plan mutation when bridge owns plan state', () => {
		const a = planAffordanceFor({ bridgeOwnsPlanState: true });
		expect(a.canEdit).toBe(true);
		expect(a.canApprove).toBe(true);
		expect(a.canReject).toBe(true);
	});
});
