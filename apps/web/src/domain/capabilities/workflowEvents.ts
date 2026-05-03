// Workflow engine event classifier (slice 18).
//
// The bridge emits these workflow event_types:
//   * workflow.started
//   * workflow.step.started
//   * workflow.step.updated
//   * workflow.step.completed
//   * workflow.step.failed
//   * workflow.completed
//   * workflow.failed
//   * workflow.artifact.created
//   * workflow.input.message_submit   (internal-only — not a UI surface)
//
// Acceptance (slice 18):
//   * Every workflow event has UI destination or internal classification.
//   * YAML controls orchestration metadata only.
//   * Rust executor remains source of truth for side effects.
//
// `classifyWorkflowEvent()` is the single source of truth for that
// routing. The cockpit calls it once per inbound event and uses the
// returned `destination` to decide where to render (or to drop).

export type WorkflowDestination =
	| 'workflow_rail' // top-level rail/timeline
	| 'step_detail' // per-step detail panel
	| 'artifact_panel' // artifact viewer
	| 'internal' // not user-visible; consumed by the workflow store
	| 'unknown';

export type WorkflowPhase = 'running' | 'success' | 'failure' | 'artifact' | 'internal' | 'unknown';

export interface WorkflowEventClassification {
	readonly eventType: string;
	readonly destination: WorkflowDestination;
	readonly phase: WorkflowPhase;
	/** True if this event terminates the workflow (success or failure). */
	readonly terminal: boolean;
}

const FALLBACK: WorkflowEventClassification = Object.freeze({
	eventType: '',
	destination: 'unknown',
	phase: 'unknown',
	terminal: false,
});

const CODES: Record<string, Omit<WorkflowEventClassification, 'eventType'>> = {
	'workflow.started': { destination: 'workflow_rail', phase: 'running', terminal: false },
	'workflow.step.started': { destination: 'step_detail', phase: 'running', terminal: false },
	'workflow.step.updated': { destination: 'step_detail', phase: 'running', terminal: false },
	'workflow.step.completed': { destination: 'step_detail', phase: 'success', terminal: false },
	'workflow.step.failed': { destination: 'step_detail', phase: 'failure', terminal: false },
	'workflow.completed': { destination: 'workflow_rail', phase: 'success', terminal: true },
	'workflow.failed': { destination: 'workflow_rail', phase: 'failure', terminal: true },
	'workflow.artifact.created': { destination: 'artifact_panel', phase: 'artifact', terminal: false },
	'workflow.input.message_submit': { destination: 'internal', phase: 'internal', terminal: false },
};

export function classifyWorkflowEvent(eventType: string): WorkflowEventClassification {
	if (typeof eventType !== 'string' || eventType.length === 0) {
		return FALLBACK;
	}
	const hit = CODES[eventType];
	if (!hit) {
		return { ...FALLBACK, eventType };
	}
	return { eventType, ...hit };
}

export function isWorkflowEvent(eventType: string): boolean {
	return typeof eventType === 'string' && eventType in CODES;
}

export function isInternalWorkflowEvent(eventType: string): boolean {
	return classifyWorkflowEvent(eventType).destination === 'internal';
}

export const WORKFLOW_EVENTS: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as WORKFLOW_EVENT_FALLBACK };
