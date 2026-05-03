import { describe, expect, it } from 'vitest';
import {
	WS_AUTH_ERROR_CODES,
	WS_AUTH_ERROR_FALLBACK,
	classifyWsAuthError,
	isConnectionLevelAuthError,
	isSessionLevelAuthError,
} from './wsAuthError';

describe('WS auth error classification (slice 21)', () => {
	it('classifies WS-level auth codes as connection-scoped', () => {
		expect(classifyWsAuthError('auth.required').scope).toBe('connection');
		expect(classifyWsAuthError('auth.invalid_token').scope).toBe('connection');
		expect(isConnectionLevelAuthError('auth.required')).toBe(true);
		expect(isConnectionLevelAuthError('auth.invalid_token')).toBe(true);
	});

	it('classifies ACP-provider auth codes as session-scoped', () => {
		expect(classifyWsAuthError('auth.not_supported').scope).toBe('session');
		expect(classifyWsAuthError('auth.env_var_recreate_required').scope).toBe('session');
		expect(isSessionLevelAuthError('auth.env_var_recreate_required')).toBe(true);
		expect(isConnectionLevelAuthError('auth.env_var_recreate_required')).toBe(false);
	});

	it('flags env-var recreate as requiresProcessRestart', () => {
		const envVar = classifyWsAuthError('auth.env_var_recreate_required');
		expect(envVar.requiresProcessRestart).toBe(true);
		expect(envVar.offersReauth).toBe(false);
	});

	it('classifies envelope errors as envelope-scoped (developer-visible)', () => {
		const envelope = classifyWsAuthError('protocol.bad_envelope');
		expect(envelope.scope).toBe('envelope');
		expect(envelope.offersReauth).toBe(false);
	});

	it('falls back gracefully for unknown codes', () => {
		const unknown = classifyWsAuthError('auth.something_brand_new');
		expect(unknown.scope).toBe('unknown');
		expect(unknown.code).toBe('auth.something_brand_new');
		expect(unknown.title).toBe(WS_AUTH_ERROR_FALLBACK.title);
	});

	it('catalog mirrors the canonical bridge codes', () => {
		// These four come from apps/local-bridge/src/ws/handler.rs and
		// apps/local-bridge/src/session/handle.rs. Keep both sides in sync.
		for (const code of [
			'auth.required',
			'auth.invalid_token',
			'protocol.bad_envelope',
			'auth.not_supported',
			'auth.env_var_recreate_required',
		]) {
			expect(WS_AUTH_ERROR_CODES).toContain(code);
		}
	});

	it('every catalogued entry has non-empty title and detail', () => {
		for (const code of WS_AUTH_ERROR_CODES) {
			const entry = classifyWsAuthError(code);
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.detail.length).toBeGreaterThan(0);
		}
	});
});
