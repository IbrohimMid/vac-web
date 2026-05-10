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

  it('renders a model selector from ACP config_options when no modes are advertised', async () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd', ok: true }));
    const transport: TransportHandle = {
      send,
      on: () => () => undefined,
      close: () => undefined,
    };

    useSession.setState({
      sessionId: 'sess_02',
      agentKind: 'acp',
      acpModel: {
        currentModelId: null,
        models: null,
        modes: null,
        configOptions: [
          {
            id: 'model',
            category: 'model',
            type: 'select',
            currentValue: 'gpt-5',
            options: [
              { value: 'gpt-5', name: 'GPT-5', context_window: 1000000 },
              { value: 'gpt-5-mini', name: 'GPT-5 Mini', context_window: 200000 },
            ],
          },
        ],
        contextUsed: 12000,
        contextLimit: 1000000,
      },
    });

    render(<Topbar onCmdK={() => {}} onTweaks={() => {}} transport={transport} />);

    const select = screen.getByLabelText('ACP model');
    expect(select).toBeEnabled();
    expect(select).toHaveValue('gpt-5');
    expect(screen.getByRole('option', { name: 'GPT-5 Mini' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'gpt-5-mini' } });

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('sess_02', 'session.config_option.set', {
        option_id: 'model',
        value: 'gpt-5-mini',
      }),
    );
    await waitFor(() => expect(useSession.getState().acpModel.currentModelId).toBe('gpt-5-mini'));
    expect(screen.getByTestId('model-context-chip')).toHaveTextContent('ctx 12k/200k');
  });
});
