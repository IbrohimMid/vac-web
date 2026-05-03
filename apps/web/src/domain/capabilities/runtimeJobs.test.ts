import { describe, expect, it } from 'vitest';

import {
	classifyRuntimeJob,
	isCancellableJob,
	cancelResultCopyFor,
} from './runtimeJobs';

describe('classifyRuntimeJob', () => {
	it('marks bridge-owned jobs as cancellable', () => {
		const c = classifyRuntimeJob({ origin: 'bridge' });
		expect(c.class).toBe('bridge_owned');
		expect(c.cancellable).toBe(true);
		expect(isCancellableJob({ origin: 'bridge' })).toBe(true);
	});

	it('marks observed provider jobs as not cancellable', () => {
		const c = classifyRuntimeJob({ origin: 'provider' });
		expect(c.class).toBe('observed_provider');
		expect(c.cancellable).toBe(false);
		expect(c.label).toMatch(/observed/i);
	});

	it('treats explicit cancellable flag as authoritative', () => {
		expect(classifyRuntimeJob({ cancellable: true }).cancellable).toBe(true);
		expect(classifyRuntimeJob({ cancellable: false }).cancellable).toBe(false);
	});

	it('falls back to unknown with cancel disabled to avoid fake success', () => {
		const c = classifyRuntimeJob({});
		expect(c.class).toBe('unknown');
		expect(c.cancellable).toBe(false);
		expect(c.cancelHint).toMatch(/fake success|disabled/i);
	});
});

describe('cancelResultCopyFor', () => {
	it('reports success only on ok', () => {
		expect(cancelResultCopyFor({ code: 'ok' }).succeeded).toBe(true);
		expect(cancelResultCopyFor({ code: 'runtime.job_not_cancellable' }).succeeded).toBe(false);
		expect(cancelResultCopyFor({ code: 'runtime.job_not_found' }).succeeded).toBe(false);
		expect(cancelResultCopyFor({ code: 'transport.timeout' }).succeeded).toBe(false);
	});

	it('uses bridge message on unknown error code', () => {
		expect(cancelResultCopyFor({ code: 'transport.timeout', message: 'WS dropped' }).detail).toMatch(/WS dropped/);
	});
});
