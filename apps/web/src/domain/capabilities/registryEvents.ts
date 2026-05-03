// Registry / MCP-drift / trust-violation UX mapping (slice 26).
//
// The bridge emits these event_type values on the notify lane:
//   * registry.synced            (apps/local-bridge/src/translator/mod.rs:3367)
//   * registry.reloaded          (apps/local-bridge/src/translator/mod.rs:3531)
//   * registry.trust_violation   (translator/mod.rs:3331)            — error code
//   * session.mcp_server_drift   (translator/mod.rs:947)              — error code
//
// The cockpit must:
//   * Surface trust violations as visible errors (acceptance #1).
//   * Show MCP server drift on session create/resume (acceptance #2).
//   * Refresh registry caches on registry.reloaded (acceptance #3 of slice 10).
//
// `registryEventCopyFor()` is the single source of truth for that copy.

export type RegistryEventKind =
	| 'sync_success'
	| 'reload_success'
	| 'trust_violation'
	| 'mcp_drift';

export interface RegistryEventCopy {
	readonly kind: RegistryEventKind;
	readonly title: string;
	readonly detail: string;
	readonly hint?: string;
	/** True when the operator must take action before continuing. */
	readonly blocking: boolean;
	/** True when the cockpit should refresh registry/agent caches. */
	readonly refreshRegistry: boolean;
}

const FALLBACK: RegistryEventCopy = Object.freeze({
	kind: 'sync_success',
	title: 'Registry event',
	detail: 'A registry lifecycle event arrived.',
	blocking: false,
	refreshRegistry: false,
});

const CODES: Record<string, RegistryEventCopy> = {
	'registry.synced': {
		kind: 'sync_success',
		title: 'Registry synced',
		detail: 'The agent registry was refreshed against the configured remote source.',
		refreshRegistry: true,
		blocking: false,
	},
	'registry.reloaded': {
		kind: 'reload_success',
		title: 'Registry reloaded',
		detail: 'The agent registry was rebuilt from the latest config snapshot.',
		refreshRegistry: true,
		blocking: false,
	},
	'registry.trust_violation': {
		kind: 'trust_violation',
		title: 'Registry trust violation',
		detail: 'A registry source URL is outside the configured trust prefixes and was rejected.',
		hint: 'Add the source URL prefix to registry trust roots, or remove the source.',
		blocking: true,
		refreshRegistry: false,
	},
	'session.mcp_server_drift': {
		kind: 'mcp_drift',
		title: 'MCP server drift',
		detail: 'This session’s recorded MCP servers no longer match the active registry definition.',
		hint: 'Resume into a fresh session, or accept drift if your policy allows it.',
		blocking: true,
		refreshRegistry: false,
	},
};

export function registryEventCopyFor(eventType: string): RegistryEventCopy {
	return CODES[eventType] ?? FALLBACK;
}

export function isRegistryEvent(eventType: string): boolean {
	return typeof eventType === 'string' && eventType in CODES;
}

export function isRegistryBlocking(eventType: string): boolean {
	return registryEventCopyFor(eventType).blocking;
}

export const REGISTRY_EVENT_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as REGISTRY_EVENT_FALLBACK };
