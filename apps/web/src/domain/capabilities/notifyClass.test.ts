import { describe, expect, it } from 'vitest';

import {
	classifyNotifyError,
	isFeatureStub,
	isWireError,
	NOTIFY_ERROR_FALLBACK,
} from './notifyClass';

describe('classifyNotifyError', () => {
	it('classifies feature.not_wired as a stub', () => {
		const c = classifyNotifyError('feature.not_wired');
		expect(c.kind).toBe('feature_not_wired');
		expect(c.isStub).toBe(true);
		expect(c.sticky).toBe(false);
		expect(isFeatureStub('feature.not_wired')).toBe(true);
	});

	it('classifies profile.* codes as profile denials with sticky banner', () => {
		const c = classifyNotifyError('profile.tool_denied');
		expect(c.kind).toBe('profile_denial');
		expect(c.sticky).toBe(true);
		expect(c.isStub).toBe(false);
	});

	it('classifies audit.write_failed as a sticky audit failure', () => {
		const c = classifyNotifyError('audit.write_failed');
		expect(c.kind).toBe('audit_write_failed');
		expect(c.sticky).toBe(true);
	});

	it('classifies approval and handoff codes into their own buckets', () => {
		expect(classifyNotifyError('approval.expired').kind).toBe('approval_error');
		expect(classifyNotifyError('handoff.created').kind).toBe('handoff_event');
	});

	it('classifies session lifecycle event types', () => {
		expect(classifyNotifyError('session.resumed').kind).toBe('session_lifecycle');
		expect(classifyNotifyError('session.renamed').kind).toBe('session_lifecycle');
	});

	it('classifies auth.* and protocol.* as transport-class errors', () => {
		const auth = classifyNotifyError('auth.required');
		expect(auth.kind).toBe('auth_error');
		expect(auth.isTransport).toBe(true);
		expect(auth.sticky).toBe(true);

		const proto = classifyNotifyError('protocol.bad_envelope');
		expect(proto.isTransport).toBe(true);
		expect(isWireError('rpc.unknown_method')).toBe(true);
	});

	it('falls back to unknown for empty or unrecognized codes', () => {
		expect(classifyNotifyError('').kind).toBe('unknown');
		const other = classifyNotifyError('completely.unknown');
		expect(other.kind).toBe('unknown');
		expect(other.isStub).toBe(false);
		expect(other.isTransport).toBe(false);
		expect(NOTIFY_ERROR_FALLBACK.kind).toBe('unknown');
	});

	it('does not confuse feature.not_wired with profile codes', () => {
		expect(isFeatureStub('profile.tool_denied')).toBe(false);
		expect(classifyNotifyError('profile.tool_denied').isStub).toBe(false);
	});
});
