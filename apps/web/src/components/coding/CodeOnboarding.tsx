import type { TransportHandle } from '../../transport';

interface Props {
  sessionId: string | null;
  transport: TransportHandle | null;
  onOpenBuild(): void;
  onOpenRuntime(): void;
  onSelectTab(tab: 'code' | 'diff' | 'preview' | 'validation'): void;
}

const STARTER_ACTIONS = [
  { id: 'fix-bug', label: 'Fix bug', detail: 'Open Code and ask the agent with file context.', tab: 'code' as const },
  { id: 'implement-feature', label: 'Implement feature', detail: 'Start with the task plan and changed-file loop.', tab: 'code' as const },
  { id: 'review-changes', label: 'Review changes', detail: 'Jump to file/hunk review before shipping.', tab: 'diff' as const },
  { id: 'run-validation', label: 'Run validation', detail: 'Open checks, reruns, and failure context.', tab: 'validation' as const },
  { id: 'preview-ui', label: 'Preview UI', detail: 'Open the browser preview panel for local app state.', tab: 'preview' as const },
];

export function CodeOnboarding({ sessionId, transport, onOpenBuild, onOpenRuntime, onSelectTab }: Props) {
  const paired = !!transport;
  const hasSession = !!sessionId;
  const ready = paired && hasSession;

  return (
    <section className="codeworkspace-onboarding" data-testid="code-onboarding" aria-label="Code workspace onboarding">
      <div className="codeworkspace-onboarding-copy">
        <span className="codeworkspace-onboarding-kicker">First-run coding flow</span>
        <strong>{ready ? 'Ready to code in this session' : 'Start coding in three safe steps'}</strong>
        <p>
          {ready
            ? 'Use the starters below to choose the next browser coding loop. Existing Build, Review, Runtime, and Validation surfaces remain the source of truth.'
            : 'Pair the bridge, create or resume a session, then choose a starter action. Unsupported file, preview, and validation controls stay truthful until the bridge confirms support.'}
        </p>
      </div>
      <ol className="codeworkspace-onboarding-steps" aria-label="Setup checklist">
        <li data-state={paired ? 'done' : 'todo'}>
          <span>{paired ? '✓' : '1'}</span>
          <div><strong>Connect bridge</strong><small>{paired ? 'Transport available' : 'Pair local bridge or relay first'}</small></div>
        </li>
        <li data-state={hasSession ? 'done' : 'todo'}>
          <span>{hasSession ? '✓' : '2'}</span>
          <div><strong>Select session</strong><small>{hasSession ? sessionId : 'Create or resume a project session'}</small></div>
        </li>
        <li data-state={ready ? 'done' : 'todo'}>
          <span>{ready ? '✓' : '3'}</span>
          <div><strong>Pick starter</strong><small>Fix bug, implement feature, review, validate, or preview</small></div>
        </li>
      </ol>
      <div className="codeworkspace-onboarding-actions" aria-label="Starter actions">
        {STARTER_ACTIONS.map((action) => (
          <button key={action.id} type="button" onClick={() => onSelectTab(action.tab)} disabled={!ready && action.id !== 'review-changes'}>
            <strong>{action.label}</strong>
            <span>{action.detail}</span>
          </button>
        ))}
      </div>
      <div className="codeworkspace-onboarding-footer">
        <button type="button" className="codeworkspace-link-btn" onClick={onOpenBuild}>Open Build surface</button>
        <button type="button" className="codeworkspace-link-btn" onClick={onOpenRuntime}>Open runtime drawer</button>
      </div>
    </section>
  );
}
