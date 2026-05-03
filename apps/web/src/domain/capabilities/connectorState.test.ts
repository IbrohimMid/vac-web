import { describe, expect, it } from 'vitest';

import { connectorRowStateFor } from './connectorState';

describe('connectorRowStateFor', () => {
	it('marks unwired connectors as not_wired with no actions', () => {
		const r = connectorRowStateFor({ id: 'slack', featureWired: false });
		expect(r.state).toBe('not_wired');
		expect(r.canConnect).toBe(false);
		expect(r.canDisconnect).toBe(false);
		expect(r.canWrite).toBe(false);
	});

	it('distinguishes available / configured / connected / rate_limited / disconnected', () => {
		expect(connectorRowStateFor({ id: 'slack', featureWired: true }).state).toBe('available');
		expect(connectorRowStateFor({ id: 'slack', featureWired: true, hasCredentials: true }).state).toBe('configured');
		expect(connectorRowStateFor({ id: 'slack', featureWired: true, health: 'ok' }).state).toBe('connected');
		expect(connectorRowStateFor({ id: 'slack', featureWired: true, health: 'rate_limited' }).state).toBe('rate_limited');
		expect(connectorRowStateFor({ id: 'slack', featureWired: true, health: 'disconnected' }).state).toBe('disconnected');
	});

	it('blocks write unless connected, write-capable, AND profile grants write', () => {
		const r1 = connectorRowStateFor({ id: 'slack', featureWired: true, health: 'ok', writeCapable: false, profileGrantsWrite: true });
		expect(r1.canWrite).toBe(false);
		expect(r1.writeBlockedReason).toMatch(/write capability/i);

		const r2 = connectorRowStateFor({ id: 'slack', featureWired: true, health: 'ok', writeCapable: true, profileGrantsWrite: false });
		expect(r2.canWrite).toBe(false);
		expect(r2.writeBlockedReason).toMatch(/profile/i);

		const r3 = connectorRowStateFor({ id: 'slack', featureWired: true, health: 'ok', writeCapable: true, profileGrantsWrite: true });
		expect(r3.canWrite).toBe(true);
	});

	it('does not claim connection before credentials exist', () => {
		const r = connectorRowStateFor({ id: 'slack', featureWired: true });
		expect(r.state).toBe('available');
		expect(r.label).toMatch(/available/i);
	});
});
