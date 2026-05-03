import { describe, expect, it } from 'vitest';

import {
	registryEventCopyFor,
	isRegistryEvent,
	isRegistryBlocking,
	REGISTRY_EVENT_CODES,
	REGISTRY_EVENT_FALLBACK,
} from './registryEvents';

describe('registryEventCopyFor', () => {
	it('marks trust violations and MCP drift as blocking', () => {
		expect(isRegistryBlocking('registry.trust_violation')).toBe(true);
		expect(isRegistryBlocking('session.mcp_server_drift')).toBe(true);
		expect(isRegistryBlocking('registry.synced')).toBe(false);
		expect(isRegistryBlocking('registry.reloaded')).toBe(false);
	});

	it('marks success events as triggering registry cache refresh', () => {
		expect(registryEventCopyFor('registry.synced').refreshRegistry).toBe(true);
		expect(registryEventCopyFor('registry.reloaded').refreshRegistry).toBe(true);
		expect(registryEventCopyFor('registry.trust_violation').refreshRegistry).toBe(false);
	});

	it('isRegistryEvent recognises the known codes only', () => {
		for (const code of REGISTRY_EVENT_CODES) {
			expect(isRegistryEvent(code)).toBe(true);
		}
		expect(isRegistryEvent('registry.unknown')).toBe(false);
		expect(isRegistryEvent('profile.tool_denied')).toBe(false);
	});

	it('blocking events carry an operator hint', () => {
		expect(registryEventCopyFor('registry.trust_violation').hint).toBeTruthy();
		expect(registryEventCopyFor('session.mcp_server_drift').hint).toBeTruthy();
	});

	it('falls back deterministically for unknown event types', () => {
		expect(registryEventCopyFor('registry.totally.unknown')).toEqual(REGISTRY_EVENT_FALLBACK);
	});
});
