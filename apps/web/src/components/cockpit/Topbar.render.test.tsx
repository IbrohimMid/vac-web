// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { Topbar } from './Topbar';

describe('cockpit Topbar', () => {
  beforeEach(() => {
    useSession.getState().clear();
  });

  afterEach(() => {
    cleanup();
    useSession.getState().clear();
  });

  it('shows ACP auth metadata in the topbar', () => {
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
          id: 'openai-api-key',
          type: 'env_var',
          name: 'OpenAI API Key',
          vars: [{ name: 'OPENAI_API_KEY', label: 'API Key' }],
        },
      ],
    });

    render(<Topbar onCmdK={() => {}} onTweaks={() => {}} transport={null} />);

    expect(screen.getByText(/ACP auth:/i)).toBeInTheDocument();
    expect(screen.getByTitle('OpenAI API Key (env_var)')).toBeInTheDocument();
  });

  it('sends session.mode.set when the ACP model selector changes', async () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd', ok: true }));
    const transport: TransportHandle = {
      send,
      on: () => () => undefined,
      close: () => undefined,
    };

    useSession.setState({
      sessionId: 'sess_01',
      agentKind: 'acp',
      acpModel: {
        currentModelId: 'gemini-pro',
        models: [
          { id: 'gemini-pro', context_window: 1000000 },
          { id: 'gemini-flash', context_window: 500000 },
        ],
        modes: [
          { id: 'gemini-pro', context_window: 1000000 },
          { id: 'gemini-flash', context_window: 500000 },
        ],
        configOptions: null,
        contextUsed: 157000,
        contextLimit: 1000000,
      },
    });

    render(<Topbar onCmdK={() => {}} onTweaks={() => {}} transport={transport} />);

    fireEvent.change(screen.getByLabelText('ACP model'), { target: { value: 'gemini-flash' } });

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('sess_01', 'session.mode.set', { mode_id: 'gemini-flash' }),
    );
    await waitFor(() => expect(useSession.getState().acpModel.currentModelId).toBe('gemini-flash'));
    expect(screen.getByTestId('model-context-chip')).toHaveTextContent('ctx 157k/500k');
  });
});
