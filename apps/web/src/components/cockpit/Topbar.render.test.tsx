// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useSession } from '../../stores/session';
import { Topbar } from './Topbar';

describe('cockpit Topbar auth badge', () => {
  beforeEach(() => {
    useSession.setState({
      sessionId: 'sess_01',
      profileId: 'executor.code@1.0.0',
      projectRoot: '/repo',
      workflowId: null,
      workflowName: null,
      agentId: 'claude-agent-acp',
      agentKind: 'acp',
      authMethods: [
        {
          id: 'openai',
          name: 'OpenAI API Key',
          type: 'env_var',
          vars: [{ name: 'OPENAI_API_KEY', label: 'API Key' }],
        },
      ],
    });
  });

  afterEach(cleanup);

  it('shows ACP auth metadata in the topbar', () => {
    render(<Topbar onCmdK={() => {}} onTweaks={() => {}} />);

    expect(screen.getByText(/ACP auth:/i)).toBeInTheDocument();
    expect(screen.getByTitle('OpenAI API Key (env_var)')).toBeInTheDocument();
  });
});
