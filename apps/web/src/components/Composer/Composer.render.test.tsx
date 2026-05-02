// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import { useSession } from '../../stores/session';
import { useComposer } from '../../stores/composer';
import { useAttachments } from '../../stores/attachments';
import { useActions } from '../../actions/registry';
import type { TransportHandle } from '../../transport';

afterEach(() => cleanup());

function resetStores() {
  useSession.getState().clear();
  useComposer.getState().reset();
  useAttachments.getState().clear();
  useActions.getState().clear();
  window.localStorage.removeItem('vac.composer.experimental');
}

function mockTransport(): TransportHandle {
  return {
    send: vi.fn(async () => ({ ackOf: 'cmd', ok: true })),
    on: () => () => undefined,
    close: () => undefined,
  };
}

describe('Composer slash commands', () => {
  beforeEach(() => {
    resetStores();
    useSession.setState({
      sessionId: 'sess_01',
      profileId: 'executor.code@1.0.0',
      projectRoot: '/repo',
      agentId: 'gemini-acp',
      agentKind: 'acp',
      acpCommands: [
        {
          id: 'acp-command:compact:0',
          name: 'compact',
          title: 'Compact context',
          description: 'Summarize old context',
          slash: '/compact',
          raw: { name: 'compact' },
        },
      ],
    });
  });

  it('shows ACP commands in slash palette and inserts the slash text without invoking VAC actions', () => {
    const transport = mockTransport();
    render(<Composer transport={transport} />);

    const textbox = screen.getByRole('textbox', { name: /composer/i });
    fireEvent.change(textbox, { target: { value: '/co', selectionStart: 3 } });

    expect(screen.getByRole('listbox', { name: /slash commands/i })).toBeTruthy();
    expect(screen.getByText('Compact context')).toBeTruthy();
    expect(screen.getByText('ACP')).toBeTruthy();

    fireEvent.click(screen.getByText('Compact context'));

    expect((textbox as HTMLTextAreaElement).value).toBe('/compact ');
    expect(transport.send).not.toHaveBeenCalled();
  });
});
