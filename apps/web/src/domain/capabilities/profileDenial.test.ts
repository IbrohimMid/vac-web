import { describe, expect, it } from 'vitest';
import {
	PROFILE_DENIAL_CODES,
	PROFILE_DENIAL_FALLBACK,
	denialCopyFor,
	isProfileDenial,
} from './profileDenial';

describe('profile denial UX mapping (slice 20)', () => {
	it('returns non-empty curated copy for every catalogued code', () => {
		expect(PROFILE_DENIAL_CODES.length).toBeGreaterThan(0);
		for (const code of PROFILE_DENIAL_CODES) {
			const copy = denialCopyFor(code);
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.detail.length).toBeGreaterThan(0);
		}
	});

	it('falls back to a stable copy for unknown codes', () => {
		const copy = denialCopyFor('profile.something_brand_new');
		expect(copy).toEqual(PROFILE_DENIAL_FALLBACK);
	});

	it('isProfileDenial only matches profile.* codes', () => {
		expect(isProfileDenial('profile.tool_denied')).toBe(true);
		expect(isProfileDenial('profile.fs_out_of_scope')).toBe(true);
		expect(isProfileDenial('feature.not_wired')).toBe(false);
		expect(isProfileDenial('auth.required')).toBe(false);
		expect(isProfileDenial('')).toBe(false);
	});

	it('covers the canonical profile-core denial codes', () => {
		// Mirrors `packages/profile-core/src/enforce.rs`. Update both files
		// when the bridge adds or renames a denial code.
		const expected = [
			'profile.tool_denied',
			'profile.tool_not_allowed',
			'profile.shell_bin_not_allowed',
			'profile.shell_too_many_args',
			'profile.shell_args_pattern_mismatch',
			'profile.shell_pattern_invalid',
			'profile.shell_meta_chars',
			'profile.fs_read_disabled',
			'profile.fs_write_disabled',
			'profile.fs_out_of_scope',
			'profile.fs_deny_glob',
			'profile.fs_scoped_paths_mismatch',
			'profile.fs_write_unknown',
			'profile.egress_disabled',
			'profile.egress_host',
			'profile.egress_method',
			'profile.egress_mode_unknown',
			'profile.load_failed',
		];
		for (const code of expected) {
			expect(PROFILE_DENIAL_CODES).toContain(code);
		}
	});
});
