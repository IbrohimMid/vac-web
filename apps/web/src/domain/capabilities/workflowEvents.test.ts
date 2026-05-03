import { describe, expect, it } from 'vitest';

import {
	classifyWorkflowEvent,
	isWorkflowEvent,
	isInternalWorkflowEvent,
	WORKFLOW_EVENTS,
	WORKFLOW_EVENT_FALLBACK,
} from './workflowEvents';

describe('classifyWorkflowEvent', () => {
	it('routes every documented event somewhere — acceptance #1', () => {
		for (const code of WORKFLOW_EVENTS) {
			const c = classifyWorkflowEvent(code);
			expect(c.destination).not.toBe('unknown');
			expect(c.phase).not.toBe('unknown');
		}
	});

	it('classifies workflow.input.message_submit as internal-only', () => {
		expect(isInternalWorkflowEvent('workflow.input.message_submit')).toBe(true);
		expect(classifyWorkflowEvent('workflow.input.message_submit').destination).toBe('internal');
	});

	it('marks workflow.completed and workflow.failed as terminal', () => {
		expect(classifyWorkflowEvent('workflow.completed').terminal).toBe(true);
		expect(classifyWorkflowEvent('workflow.failed').terminal).toBe(true);
		expect(classifyWorkflowEvent('workflow.step.completed').terminal).toBe(false);
		expect(classifyWorkflowEvent('workflow.started').terminal).toBe(false);
	});

	it('routes step.* events to the step detail panel', () => {
		for (const code of ['workflow.step.started', 'workflow.step.updated', 'workflow.step.completed', 'workflow.step.failed']) {
			expect(classifyWorkflowEvent(code).destination).toBe('step_detail');
		}
	});

	it('routes workflow.artifact.created to the artifact panel', () => {
		const c = classifyWorkflowEvent('workflow.artifact.created');
		expect(c.destination).toBe('artifact_panel');
		expect(c.phase).toBe('artifact');
	});

	it('falls back deterministically for unknown event types', () => {
		expect(classifyWorkflowEvent('workflow.unknown')).toEqual({ ...WORKFLOW_EVENT_FALLBACK, eventType: 'workflow.unknown' });
		expect(isWorkflowEvent('workflow.unknown')).toBe(false);
		expect(isWorkflowEvent('workflow.completed')).toBe(true);
	});
});
