import { beforeEach, describe, expect, it } from 'vitest';
import { activateSessionFromReady } from './activation';
import { useActivity } from '../../stores/activity';
import { useApprovals, type ApprovalRequest } from '../../stores/approvals';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import { useShell } from '../../stores/shell';
import { useTranscript } from '../../stores/transcript';

describe('session activation helper', () => {
  beforeEach(() => {
    useActivity.setState({ entries: [{ id: 'act_old', ts: 't', subsystem: 'session', severity: 'info', summary: 'old' }] });
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
    expect(useTranscript.getState().order).toHaveLength(0);
    expect(useShell.getState().open).toBe(false);
    expect(useShell.getState().shellId).toBeNull();
    expect(useSession.getState().authStatus).toBe('idle');
    expect(useSession.getState().authError).toBeNull();
  });
});
