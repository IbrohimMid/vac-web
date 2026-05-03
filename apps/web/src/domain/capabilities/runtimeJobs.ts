// Runtime job classification (slice 11).
//
// The cockpit's RuntimeTab shows two distinct kinds of jobs:
//   * observed_provider — a job started by the agent/provider that the
//                          bridge merely observes; not cancellable.
//   * bridge_owned     — a job the bridge itself spawned (shell, workflow
//                          step, etc.) and can cancel.
//
// Acceptance (slice 11):
//   * Cancel button only appears for cancellable jobs.
//   * Observed provider commands are labeled observed-only.
//   * Cancel result updates RuntimeTab without fake success.
//
// `classifyRuntimeJob()` is the single source of truth for that
// distinction. UI surfaces should call it and key affordances off the
// `cancellable` and `class` fields.

export type RuntimeJobClass = 'observed_provider' | 'bridge_owned' | 'unknown';

export interface RuntimeJobInput {
	readonly origin?: 'bridge' | 'provider' | 'agent' | string;
	readonly kind?: string;
	readonly cancellable?: boolean;
}

export interface RuntimeJobClassification {
	readonly class: RuntimeJobClass;
	readonly cancellable: boolean;
	readonly label: string;
	/** Hint shown next to the cancel control or its absence. */
	readonly cancelHint: string;
}

export function classifyRuntimeJob(job: RuntimeJobInput): RuntimeJobClassification {
	if (job.origin === 'bridge' || job.cancellable === true) {
		return {
			class: 'bridge_owned',
			cancellable: true,
			label: 'Bridge-owned job',
			cancelHint: 'Cancel ends this job and surfaces the result in the runtime log.',
		};
	}
	if (job.origin === 'provider' || job.origin === 'agent' || job.cancellable === false) {
		return {
			class: 'observed_provider',
			cancellable: false,
			label: 'Observed-only',
			cancelHint: 'The bridge does not own this job and cannot cancel it.',
		};
	}
	return {
		class: 'unknown',
		cancellable: false,
		label: 'Runtime job',
		cancelHint: 'Origin is unknown; cancel is disabled to avoid fake success.',
	};
}

export function isCancellableJob(job: RuntimeJobInput): boolean {
	return classifyRuntimeJob(job).cancellable;
}

export interface CancelResult {
	readonly code: 'ok' | 'runtime.job_not_cancellable' | 'runtime.job_not_found' | string;
	readonly message?: string;
}

export interface CancelResultCopy {
	readonly title: string;
	readonly detail: string;
	/** True iff the runtime tab should reflect a successful cancel. */
	readonly succeeded: boolean;
}

export function cancelResultCopyFor(result: CancelResult): CancelResultCopy {
	if (result.code === 'ok') {
		return {
			title: 'Job cancelled',
			detail: 'The bridge confirmed cancellation. Runtime log will record the result.',
			succeeded: true,
		};
	}
	if (result.code === 'runtime.job_not_cancellable') {
		return {
			title: 'Job is observed-only',
			detail: 'The bridge does not own this job and cannot cancel it.',
			succeeded: false,
		};
	}
	if (result.code === 'runtime.job_not_found') {
		return {
			title: 'Job not found',
			detail: 'The job has already terminated or was never registered.',
			succeeded: false,
		};
	}
	return {
		title: 'Cancel failed',
		detail: result.message ?? 'The bridge could not cancel this job.',
		succeeded: false,
	};
}
