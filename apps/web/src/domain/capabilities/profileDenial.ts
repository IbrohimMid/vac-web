// Profile-core denial UX mapping.
//
// Slice 20 (wiring.profile_policy): every profile-core denial code emitted
// from `packages/profile-core/src/enforce.rs` must render as precise,
// operator-facing UI copy. This module is the single source of truth for
// that mapping. UI surfaces (Topbar, MessageRow approval banner, Composer
// upload guard, Shell pane, Connectors tab) should call `denialCopyFor()`
// rather than spelling the codes inline.
//
// Codes are intentionally enumerated by hand (not generated): the bridge
// runtime is the authority for which codes exist, but the UI authors copy
// per surface. Keep this list in lockstep with `enforce.rs`. The unit test
// `profileDenial.test.ts` enforces that every code returns non-empty copy
// and that unknown codes degrade to a stable fallback.

export interface DenialCopy {
	readonly title: string;
	readonly detail: string;
	/** Optional operator hint about how to fix the denial (profile edit, etc.). */
	readonly hint?: string;
}

const FALLBACK: DenialCopy = {
	title: 'Action blocked by profile',
	detail: 'The active capability profile does not allow this action.',
	hint: 'Switch to a profile that grants this capability, or escalate via gate override.',
};

const CODES: Record<string, DenialCopy> = {
	'profile.tool_denied': {
		title: 'Tool not allowed',
		detail: 'The active profile denies this tool.',
		hint: 'Add the tool to the profile or switch profiles.',
	},
	'profile.tool_not_allowed': {
		title: 'Tool not allowed',
		detail: 'The active profile does not include this tool in its allowlist.',
		hint: 'Update the profile allowlist to include this tool.',
	},
	'profile.shell_bin_not_allowed': {
		title: 'Shell binary not allowed',
		detail: 'The active profile blocks running this shell binary.',
		hint: 'Add the binary to the profile shell allowlist.',
	},
	'profile.shell_too_many_args': {
		title: 'Shell args limit exceeded',
		detail: 'The shell command exceeds the profile arg-count limit.',
		hint: 'Reduce the number of arguments or relax the profile limit.',
	},
	'profile.shell_args_pattern_mismatch': {
		title: 'Shell args pattern blocked',
		detail: 'The shell argument pattern is not permitted by the profile.',
		hint: 'Adjust the args to match an allowed pattern.',
	},
	'profile.shell_pattern_invalid': {
		title: 'Profile shell pattern invalid',
		detail: 'The profile defines a shell pattern that could not be compiled.',
		hint: 'Fix the regex/glob pattern in the profile and reload.',
	},
	'profile.shell_meta_chars': {
		title: 'Shell meta characters blocked',
		detail: 'The shell command contains meta characters disallowed by the profile.',
		hint: 'Quote or remove shell meta characters, or grant unsafe-shell to the profile.',
	},
	'profile.fs_read_disabled': {
		title: 'Filesystem read disabled',
		detail: 'The active profile has fs.read set to none.',
		hint: 'Enable fs.read in the profile to read files.',
	},
	'profile.fs_write_disabled': {
		title: 'Filesystem write disabled',
		detail: 'The active profile has fs.write set to none.',
		hint: 'Enable fs.write in the profile to modify files.',
	},
	'profile.fs_out_of_scope': {
		title: 'Path is out of scope',
		detail: 'The path is outside the profile-allowed filesystem scope.',
		hint: 'Move the file inside an allowed scope or extend scope_paths.',
	},
	'profile.fs_deny_glob': {
		title: 'Path blocked by profile',
		detail: 'A profile deny pattern matches this path.',
		hint: 'Adjust the deny_globs in the profile if the block is unintended.',
	},
	'profile.fs_scoped_paths_mismatch': {
		title: 'Path not in scope_paths',
		detail: 'fs.write is set to scoped, but the path does not match scope_paths.',
		hint: 'Add the path prefix to scope_paths or relocate the write.',
	},
	'profile.fs_write_unknown': {
		title: 'Unknown fs.write mode',
		detail: 'The profile fs.write value is not recognized.',
		hint: 'Set fs.write to one of: none, scoped, all.',
	},
	'profile.egress_disabled': {
		title: 'Network egress disabled',
		detail: 'The active profile has network_egress set to off.',
		hint: 'Enable network egress in the profile to make outbound requests.',
	},
	'profile.egress_host': {
		title: 'Host blocked by profile',
		detail: 'The destination host is not in the profile network allowlist.',
		hint: 'Add the host to allow_hosts or adjust egress mode.',
	},
	'profile.egress_method': {
		title: 'HTTP method blocked',
		detail: 'The HTTP method is not permitted by the profile network policy.',
		hint: 'Add the method to allow_methods for this profile.',
	},
	'profile.egress_mode_unknown': {
		title: 'Unknown egress mode',
		detail: 'The profile network_egress mode is not recognized.',
		hint: 'Set network_egress.mode to one of: off, allowlist, all.',
	},
	'profile.load_failed': {
		title: 'Profile failed to load',
		detail: 'The capability profile could not be loaded for this session.',
		hint: 'Check the profile YAML for syntax errors and reload.',
	},
};

/** Returns the curated copy for a profile-core denial code. */
export function denialCopyFor(code: string): DenialCopy {
	return CODES[code] ?? FALLBACK;
}

/** Returns true when the code is a recognized profile-core denial. */
export function isProfileDenial(code: string): boolean {
	return typeof code === 'string' && code.startsWith('profile.');
}

/** Snapshot of every code with curated copy (for tests + introspection). */
export const PROFILE_DENIAL_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as PROFILE_DENIAL_FALLBACK };
