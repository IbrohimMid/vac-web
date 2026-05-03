// Assessment-index lifecycle UX mapping (slice 04).
//
// The bridge surfaces assessment-index state through these event types:
//   * assessment.index.rebuild_started
//   * assessment.index.rebuild_progress
//   * assessment.index.rebuilt
//   * assessment.index.rebuild_failed
//   * assessment.index_status_failed
//   * assessment.index_rebuild_failed
//
// Acceptance (slice 04):
//   * User sees whether index is enabled, current, stale, rebuilding, or failed.
//   * Rebuild progress is visible.
//   * Failure reason distinguishes storage / schema / project-root /
//     persistence-disabled.
//
// `assessmentIndexCopyFor()` is the single source of truth for copy.
// `classifyIndexFailure()` discriminates the four failure reasons.

export type AssessmentIndexPhase =
	| 'enabled_current'
	| 'stale'
	| 'rebuilding'
	| 'rebuild_failed'
	| 'status_failed'
	| 'disabled';

export interface AssessmentIndexCopy {
	readonly phase: AssessmentIndexPhase;
	readonly title: string;
	readonly detail: string;
	readonly hint?: string | undefined;
	/** True while a rebuild is in progress. */
	readonly rebuilding: boolean;
	/** True when the cockpit must NOT clear existing findings. */
	readonly preserveFindings: boolean;
}

const FALLBACK: AssessmentIndexCopy = Object.freeze({
	phase: 'status_failed',
	title: 'Index status unknown',
	detail: 'The cockpit could not classify this assessment-index event.',
	rebuilding: false,
	preserveFindings: true,
});

const CODES: Record<string, AssessmentIndexCopy> = {
	'assessment.index.rebuild_started': {
		phase: 'rebuilding',
		title: 'Rebuilding assessment index…',
		detail: 'The bridge is rebuilding the on-disk assessment index. Existing findings remain visible.',
		rebuilding: true,
		preserveFindings: true,
	},
	'assessment.index.rebuild_progress': {
		phase: 'rebuilding',
		title: 'Rebuild in progress',
		detail: 'A subset of files has been re-indexed. Progress is reported incrementally.',
		rebuilding: true,
		preserveFindings: true,
	},
	'assessment.index.rebuilt': {
		phase: 'enabled_current',
		title: 'Assessment index ready',
		detail: 'The assessment index is up to date.',
		rebuilding: false,
		preserveFindings: true,
	},
	'assessment.index.rebuild_failed': {
		phase: 'rebuild_failed',
		title: 'Rebuild failed',
		detail: 'The assessment-index rebuild aborted. Existing findings are unchanged.',
		hint: 'Open the failure detail for the underlying reason (storage, schema, project-root, persistence).',
		rebuilding: false,
		preserveFindings: true,
	},
	'assessment.index_status_failed': {
		phase: 'status_failed',
		title: 'Index status unavailable',
		detail: 'The bridge could not return the current assessment-index status.',
		hint: 'Retry, or check that persistence is enabled in this profile.',
		rebuilding: false,
		preserveFindings: true,
	},
	'assessment.index_rebuild_failed': {
		phase: 'rebuild_failed',
		title: 'Rebuild request rejected',
		detail: 'The bridge rejected the rebuild request before it could start.',
		hint: 'Check the assessment-index manifest gate and persistence status.',
		rebuilding: false,
		preserveFindings: true,
	},
};

export function assessmentIndexCopyFor(eventType: string): AssessmentIndexCopy {
	return CODES[eventType] ?? FALLBACK;
}

export function isAssessmentIndexEvent(eventType: string): boolean {
	return typeof eventType === 'string' && eventType in CODES;
}

export type IndexFailureReason =
	| 'storage'
	| 'schema'
	| 'project_root'
	| 'persistence_disabled'
	| 'unknown';

export interface IndexFailureClassification {
	readonly reason: IndexFailureReason;
	readonly title: string;
	readonly detail: string;
	readonly hint: string;
}

const FAILURE_REASONS: Record<IndexFailureReason, IndexFailureClassification> = {
	storage: {
		reason: 'storage',
		title: 'Storage failure',
		detail: 'The on-disk index storage layer reported an I/O or corruption error.',
		hint: 'Check disk space and permissions, then retry.',
	},
	schema: {
		reason: 'schema',
		title: 'Schema mismatch',
		detail: 'The persisted index schema does not match the current bridge build.',
		hint: 'Trigger a full rebuild, or downgrade/upgrade the bridge to match.',
	},
	project_root: {
		reason: 'project_root',
		title: 'Project root unavailable',
		detail: 'The configured project root cannot be resolved from the active session.',
		hint: 'Open a session with a valid project root before rebuilding.',
	},
	persistence_disabled: {
		reason: 'persistence_disabled',
		title: 'Persistence disabled',
		detail: 'Assessment indexing requires session persistence, which is disabled in the active profile.',
		hint: 'Switch to a profile that enables persistence.',
	},
	unknown: {
		reason: 'unknown',
		title: 'Unknown failure',
		detail: 'The bridge returned a failure reason the cockpit does not classify.',
		hint: 'Open the audit log for raw error context.',
	},
};

/**
 * Classify a free-form failure-reason string from the bridge into one of
 * the four documented buckets.
 *
 * Slice 04 acceptance: "Failure reason distinguishes storage / schema /
 * project-root / persistence-disabled."
 */
export function classifyIndexFailure(reason: string | null | undefined): IndexFailureClassification {
	if (typeof reason !== 'string' || reason.length === 0) {
		return FAILURE_REASONS.unknown;
	}
	const lower = reason.toLowerCase();
	if (lower.includes('persistence') && lower.includes('disabl')) {
		return FAILURE_REASONS.persistence_disabled;
	}
	if (lower.includes('project') && lower.includes('root')) {
		return FAILURE_REASONS.project_root;
	}
	if (lower.includes('schema')) {
		return FAILURE_REASONS.schema;
	}
	if (
		lower.includes('storage') ||
		lower.includes('disk') ||
		lower.includes('io ') ||
		lower.includes('i/o') ||
		lower.includes('corrupt')
	) {
		return FAILURE_REASONS.storage;
	}
	return FAILURE_REASONS.unknown;
}

export const ASSESSMENT_INDEX_EVENTS: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as ASSESSMENT_INDEX_FALLBACK, FAILURE_REASONS as ASSESSMENT_INDEX_FAILURE_REASONS };
