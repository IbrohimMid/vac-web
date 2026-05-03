import { describe, expect, it } from 'vitest';

import {
	classifyTerminalEvent,
	isReadOnlyTerminalSurface,
	TERMINAL_EVENT_FALLBACK,
} from './shellTerminal';

describe('classifyTerminalEvent', () => {
	it('routes shell.* to the cockpit shell surface', () => {
		const c = classifyTerminalEvent('shell.started', { shellWired: true });
		expect(c.surface).toBe('cockpit_shell');
		expect(c.drivesShellDrawer).toBe(true);
		expect(c.drivesActivityLog).toBe(false);
		expect(c.typeable).toBe(true);
	});

	it('keeps cockpit shell read-only when shell.* commands are not wired', () => {
		const c = classifyTerminalEvent('shell.started', { shellWired: false });
		expect(c.surface).toBe('cockpit_shell');
		expect(c.typeable).toBe(false);
		expect(c.label).toMatch(/not wired/i);
	});

	it('routes terminal.* to runtime activity, never typeable', () => {
		for (const ev of ['terminal.create', 'terminal.kill', 'terminal.release', 'terminal.lifecycle']) {
			const c = classifyTerminalEvent(ev, { shellWired: true });
			expect(c.surface).toBe('runtime_activity');
			expect(c.drivesShellDrawer).toBe(false);
			expect(c.drivesActivityLog).toBe(true);
			expect(c.typeable).toBe(false);
		}
	});

	it('user cannot type into a provider terminal observation — acceptance', () => {
		expect(isReadOnlyTerminalSurface('terminal.create')).toBe(true);
		expect(isReadOnlyTerminalSurface('terminal.lifecycle')).toBe(true);
		expect(isReadOnlyTerminalSurface('shell.started')).toBe(false);
	});

	it('falls back to unknown surface for unrecognized event types', () => {
		expect(classifyTerminalEvent('').surface).toBe('unknown');
		expect(classifyTerminalEvent('foo.bar').surface).toBe('unknown');
		expect(TERMINAL_EVENT_FALLBACK.surface).toBe('unknown');
	});
});
