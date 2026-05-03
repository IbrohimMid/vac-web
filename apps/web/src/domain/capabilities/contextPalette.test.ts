import { describe, expect, it } from 'vitest';

import {
	filterRealMentionResults,
	validateAttachment,
	resolvePaletteAction,
} from './contextPalette';

describe('filterRealMentionResults', () => {
	it('drops unknown-kind and remote-only entries (acceptance #1)', () => {
		const out = filterRealMentionResults([
			{ id: 'a', kind: 'page', title: 'Local Page', localPath: 'docs/a.md' },
			{ id: 'b', kind: 'unknown', title: 'Mystery', localPath: 'somewhere' },
			{ id: 'c', kind: 'session', title: 'Remote Session' }, // no localPath
		]);
		expect(out.map((r) => r.id)).toEqual(['a']);
	});
});

describe('validateAttachment', () => {
	it('rejects paths outside the project root (acceptance #2)', () => {
		const d = validateAttachment(
			{ path: '/home/other/x.txt' },
			{ projectRoot: '/home/me/proj', profileGrantsAttachments: true },
		);
		expect(d.ok).toBe(false);
		if (!d.ok) expect(d.code).toBe('attach.outside_project_root');
	});

	it('rejects when profile denies attachments', () => {
		const d = validateAttachment(
			{ path: '/home/me/proj/x.txt' },
			{ projectRoot: '/home/me/proj', profileGrantsAttachments: false },
		);
		expect(d.ok).toBe(false);
		if (!d.ok) expect(d.code).toBe('attach.profile_denied');
	});

	it('rejects ../ traversal that escapes the root', () => {
		const d = validateAttachment(
			{ path: '/home/me/proj/../other/x.txt' },
			{ projectRoot: '/home/me/proj', profileGrantsAttachments: true },
		);
		expect(d.ok).toBe(false);
	});

	it('accepts a clean path inside the root', () => {
		const d = validateAttachment(
			{ path: '/home/me/proj/docs/x.md' },
			{ projectRoot: '/home/me/proj', profileGrantsAttachments: true },
		);
		expect(d.ok).toBe(true);
	});
});

describe('resolvePaletteAction', () => {
	it('refuses to invoke actions without a concrete command (acceptance #3)', () => {
		const r = resolvePaletteAction({ id: 'open-magic', commandId: null });
		expect(r.invokable).toBe(false);
		expect(r.reason).toMatch(/concrete command/i);
	});

	it('invokes actions that map to a real command', () => {
		const r = resolvePaletteAction({ id: 'open-page', commandId: 'page.open' });
		expect(r.invokable).toBe(true);
		expect(r.commandId).toBe('page.open');
	});
});
