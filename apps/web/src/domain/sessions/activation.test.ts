import { beforeEach, describe, expect, it } from 'vitest';
import { activateSessionFromReady } from './activation';
import { useActivity } from '../../stores/activity';
import { useApprovals, type ApprovalRequest } from '../../stores/approvals';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import { useShell } from '../../stores/shell';
import { agentTextKey, useAgentSession } from '../../stores/agentSession';
import { useTranscript } from '../../stores/transcript';
import { usePreview } from '../../stores/preview';
import { useProject } from '../../stores/project';
import { useTasks } from '../../stores/tasks';
import { useValidation } from '../../stores/validation';
import { useWorkflow } from '../../stores/workflow';

describe('session activation helper', () => {
  beforeEach(() => {
    useActivity.setState({
      entries: [{ id: 'act_old', ts: 't', subsystem: 'session', severity: 'info', summary: 'old' }],
    });
    useApprovals.setState({
      pending: new Map([
        [
          'appr_old',
          {
            approvalId: 'appr_old',
            toolCallId: 'tool_old',
            tool: 'edit',
            risk: 'high',
            summary: 'old approval',
            args: {},
            createdAt: 't',
            sourceEventType: 'session.resume',
            toolCall: {},
            state: 'pending',
            expiresInMs: 1000,
            options: [],
          } as ApprovalRequest,
        ],
      ]),
      pendingOrder: ['appr_old'],
      resolved: new Map(),
      resolvedOrder: [],
    });
    useCockpit.setState({ route: 'sessions' });
    useSession.setState({
      sessionId: 'sess_old',
      profileId: 'old.profile',
      projectRoot: '/old',
      workflowId: 'wf_old',
      workflowName: 'Old workflow',
      agentId: 'agent_old',
      agentKind: 'acp',
      authMethods: [],
      authStatus: 'failed',
      authError: { code: 'auth.old', message: 'old' },
      lastAuthMethodId: 'old-method',
    });
    useShell.setState({ open: true, shellId: 'shell_old' });
    useAgentSession.getState().clear();
    useProject.setState({
      treeStatus: 'loaded',
      entries: [{ path: 'old.ts', type: 'file', size: 12 }],
      files: {
        'old.ts': { path: 'old.ts', status: 'loaded', content: 'old file' },
      },
      selectedFilePath: 'old.ts',
      selectedLines: { start: 1, end: 2 },
      expanded: { src: true },
      filter: 'old',
      treeOptions: { includeHidden: true },
      truncated: true,
      entryCount: 1,
      capReason: 'old cap',
    });
    usePreview.setState({
      status: 'failed',
      url: 'http://localhost:5174',
      errorMessage: 'old preview error',
      unsupportedReason: 'old unsupported',
      lastUpdatedAt: 1,
      consoleErrors: [{ message: 'old console', receivedAt: 1 }],
      networkFailures: [{ url: 'http://localhost:5174/api', receivedAt: 1 }],
    });
    useTasks.setState({
      tasks: new Map([
        [
          'task_old',
          {
            taskId: 'task_old',
            sessionId: 'sess_old',
            title: 'Old task',
            status: 'executing',
            plan: [],
            activeStepId: null,
            changedFiles: ['old.ts'],
            commands: ['pnpm test'],
            approvalsNeeded: [],
            validation: null,
            blocker: null,
            errorMessage: null,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      ]),
      order: ['task_old'],
      activeTaskId: 'task_old',
    });
    useValidation.setState({
      runs: new Map([
        [
          'val_old',
          {
            id: 'val_old',
            sessionId: 'sess_old',
            command: 'pnpm test',
            label: 'Old validation',
            status: 'running',
            startedAt: 't',
            relatedFiles: ['old.ts'],
          },
        ],
      ]),
      order: ['val_old'],
      selectedRunId: 'val_old',
    });
    useWorkflow.setState({
      runs: new Map([
        [
          'sess_old',
          {
            run_id: 'run_old',
            session_id: 'sess_old',
            spec_id: 'wf_old',
            spec_name: 'Old workflow',
            steps: [
              { step_id: 'step_old', activity_kind: 'shell', label: 'Old step', status: 'started' },
            ],
            artifacts: [],
            status: 'running',
          },
        ],
      ]),
    });
    useAgentSession.getState().appendAssistantDelta('sess_old', 'old rich text');
    useTranscript.setState({
      messages: new Map([
        [
          'msg_old',
          {
            id: 'msg_old',
            role: 'assistant',
            content: 'old transcript',
            state: 'completed',
            createdAt: 't',
            isCold: false,
          },
        ],
      ]),
      order: ['msg_old'],
      hotWindowIds: new Set(['msg_old']),
    });
  });

  it('clears stale session state and activates the new session', () => {
    const sessionId = activateSessionFromReady({
      session_id: 'sess_new',
      profile_id: 'executor.code@1.0.0',
      project_root: '/repo',
      agent_id: 'agent_new',
      agent_kind: 'acp',
      workflow_id: 'build.observe-tools',
      workflow_name: 'Tool Observation',
      auth_methods: [
        {
          id: 'claude-login',
          name: 'Log in with Claude Code',
          description: 'Run `claude /login` in the terminal',
        },
      ],
    });

    expect(sessionId).toBe('sess_new');
    expect(useSession.getState().sessionId).toBe('sess_new');
    expect(useSession.getState().profileId).toBe('executor.code@1.0.0');
    expect(useSession.getState().projectRoot).toBe('/repo');
    expect(useSession.getState().agentId).toBe('agent_new');
    expect(useSession.getState().agentKind).toBe('acp');
    expect(useSession.getState().workflowId).toBe('build.observe-tools');
    expect(useSession.getState().workflowName).toBe('Tool Observation');
    expect(useSession.getState().authMethods).toHaveLength(1);
    expect(useCockpit.getState().route).toBe('build');
    expect(useActivity.getState().entries).toHaveLength(0);
    expect(useApprovals.getState().pendingOrder).toHaveLength(0);
    expect(
      useAgentSession.getState().assistants.get(agentTextKey('sess_old', 'assistant')),
    ).toBeUndefined();
    expect(useTranscript.getState().order).toHaveLength(0);
    expect(useProject.getState().entries).toHaveLength(0);
    expect(useProject.getState().files).toEqual({});
    expect(useProject.getState().selectedFilePath).toBeNull();
    expect(usePreview.getState().status).toBe('idle');
    expect(usePreview.getState().consoleErrors).toHaveLength(0);
    expect(usePreview.getState().networkFailures).toHaveLength(0);
    expect(useTasks.getState().order).toHaveLength(0);
    expect(useValidation.getState().order).toHaveLength(0);
    expect(useWorkflow.getState().runs.size).toBe(0);
    expect(useShell.getState().open).toBe(false);
    expect(useShell.getState().shellId).toBeNull();
    expect(useSession.getState().authStatus).toBe('idle');
    expect(useSession.getState().authError).toBeNull();
  });
});
