// CodePanel — Phase 3 (file browsing) + Phase 2 (Edit Intent Panel).
//
// Phase 2 (Sprint A maturity plan): toolbar buttons "Ask local AI to edit"
// and "Ask local AI for tests" open an inline Edit Intent Panel where the
// user can multi-select preset chips, type a free-form instruction, and
// review the scope (whole file vs selected line range). On submit, the
// panel dispatches a structured `coding.context.request_edit` /
// `request_tests` payload carrying `chips`, `hint`, `selected_range`, and
// `selected_text`, then closes and routes to Build. Per VAC-WEB copy
// rules: no surface here writes files directly in the browser; every
// request is agent-mediated and audited at the bridge.
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { TransportHandle } from '../../transport';
import {
  useProject,
  type ProjectSelection,
} from '../../stores/project';
import { useReview } from '../../stores/review';
import { useOverlays } from '../../stores/overlays';
import { useCockpit } from '../../stores/cockpit';
import { requestProjectFile } from '../../domain/project/handlers';
import {
  buildEditIntentPayload,
  buildFileContextPayload,
  buildSelectionContextPayload,
  sendCodingContext,
  EDIT_INTENT_CHIPS,
  TEST_INTENT_CHIPS,
} from '../../domain/coding/context';

interface Props {
  sessionId: string | null;
  transport: TransportHandle | null;
}

type IntentKind = 'edit' | 'tests';
interface IntentPanelState {
  kind: IntentKind;
  chips: string[];
  hint: string;
}

export function CodePanel({ sessionId, transport }: Props) {
  const selectedFilePath = useProject((s) => s.selectedFilePath);
  const selectedLines = useProject((s) => s.selectedLines);
  const file = useProject((s) =>
    selectedFilePath ? s.files[selectedFilePath] : undefined,
  );
  const reviewFiles = useReview((s) => s.files);
  const hasPendingDiff =
    selectedFilePath != null &&
    reviewFiles.some((f) => f.path === selectedFilePath);

  if (!selectedFilePath) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-panel-empty">
        <span className="cw-empty-title">No file selected</span>
        <span className="cw-empty-hint">
          {sessionId
            ? 'Pick a file from the explorer to view its contents.'
            : 'Connect a session to browse project files.'}
        </span>
        <span className="codeworkspace-unsupported">
          Unavailable: direct browser editing is not wired yet.
        </span>
      </div>
    );
  }

  if (!file || file.status === 'idle' || file.status === 'requesting') {
    return (
      <CodePanelShell path={selectedFilePath} sessionId={sessionId} transport={transport} selection={null} hasPendingDiff={hasPendingDiff} content={null}>
        <div className="codeworkspace-empty" role="status" data-testid="code-panel-loading">
          <span className="cw-empty-title">Requesting file...</span>
          <span className="cw-empty-hint">Waiting for the bridge to respond.</span>
        </div>
      </CodePanelShell>
    );
  }

  if (file.status === 'unsupported') {
    return (
      <CodePanelShell path={selectedFilePath} sessionId={sessionId} transport={transport} selection={null} hasPendingDiff={hasPendingDiff} content={null}>
        <div className="codeworkspace-empty" role="status" data-testid="code-panel-unsupported">
          <span className="cw-empty-title">File preview</span>
          <span className="codeworkspace-unsupported">
            Unavailable: bridge does not support project file browsing yet.
          </span>
          {file.errorMessage ? (
            <span className="cw-empty-hint cw-empty-detail">{file.errorMessage}</span>
          ) : null}
        </div>
      </CodePanelShell>
    );
  }

  if (file.status === 'error') {
    return (
      <CodePanelShell path={selectedFilePath} sessionId={sessionId} transport={transport} selection={null} hasPendingDiff={hasPendingDiff} content={null}>
        <div className="codeworkspace-empty" role="status" data-testid="code-panel-error">
          <span className="cw-empty-title">File error</span>
          <span className="cw-empty-hint">{file.errorMessage ?? 'Unknown error from the bridge.'}</span>
          <button type="button" className="codeworkspace-link-btn" onClick={() => { if (transport && sessionId && selectedFilePath) { void requestProjectFile(transport, sessionId, selectedFilePath); } }}>Retry</button>
        </div>
      </CodePanelShell>
    );
  }

  return (
    <CodePanelShell path={selectedFilePath} sessionId={sessionId} transport={transport} selection={selectedLines} hasPendingDiff={hasPendingDiff} content={file.content ?? ''}>
      <CodeBody content={file.content ?? ''} truncated={file.truncated === true} selection={selectedLines} />
    </CodePanelShell>
  );
}

interface ShellProps {
  path: string;
  sessionId: string | null;
  transport: TransportHandle | null;
  selection: ProjectSelection | null;
  hasPendingDiff: boolean;
  content: string | null;
  children: ReactNode;
}

function CodePanelShell({ path, sessionId, transport, selection, hasPendingDiff, content, children }: ShellProps) {
  const [intent, setIntent] = useState<IntentPanelState | null>(null);
  const openIntent = useCallback((kind: IntentKind) => {
    setIntent({ kind, chips: [], hint: '' });
  }, []);
  const closeIntent = useCallback(() => setIntent(null), []);
  return (
    <div className="codepanel" data-testid="code-panel">
      <CodeToolbar
        path={path}
        sessionId={sessionId}
        transport={transport}
        selection={selection}
        hasPendingDiff={hasPendingDiff}
        content={content}
        intent={intent}
        onOpenIntent={openIntent}
        onCloseIntent={closeIntent}
      />
      {intent ? (
        <IntentPanel
          state={intent}
          path={path}
          sessionId={sessionId}
          transport={transport}
          selection={selection}
          content={content}
          onChange={(next) => setIntent({ ...intent, ...next })}
          onClose={closeIntent}
        />
      ) : null}
      <div className="codepanel-body">{children}</div>
    </div>
  );
}

interface ToolbarProps {
  path: string;
  sessionId: string | null;
  transport: TransportHandle | null;
  selection: ProjectSelection | null;
  hasPendingDiff: boolean;
  content: string | null;
  intent: IntentPanelState | null;
  onOpenIntent: (kind: IntentKind) => void;
  onCloseIntent: () => void;
}

function CodeToolbar({ path, sessionId, transport, selection, hasPendingDiff, content, intent, onOpenIntent, onCloseIntent }: ToolbarProps) {
  const setRoute = useCockpit((s) => s.setRoute);
  const ready = !!sessionId && !!transport;
  const disabledReason = !sessionId ? 'Connect a session first.' : !transport ? 'Bridge transport is offline.' : null;

  const copyPath = useCallback(() => {
    void navigator.clipboard.writeText(path).catch(() => {});
  }, [path]);

  const openDiff = useCallback(() => {
    useOverlays.getState().open('diff_viewer', { path, transport });
  }, [path, transport]);

  const askAboutFile = useCallback(async () => {
    if (!ready || !sessionId || !transport) return;
    const payload = buildFileContextPayload(sessionId, { path, content: content ?? undefined });
    await sendCodingContext(transport, 'coding.context.ask_about_file', payload);
    setRoute('build');
  }, [ready, sessionId, transport, path, content, setRoute]);

  const askAboutSelection = useCallback(async () => {
    if (!ready || !sessionId || !transport || !selection || content == null) return;
    const payload = buildSelectionContextPayload(sessionId, path, content, selection);
    await sendCodingContext(transport, 'coding.context.ask_about_selection', payload);
    setRoute('build');
  }, [ready, sessionId, transport, path, content, selection, setRoute]);

  const toggleEdit = useCallback(() => {
    if (intent?.kind === 'edit') onCloseIntent();
    else onOpenIntent('edit');
  }, [intent, onOpenIntent, onCloseIntent]);

  const toggleTests = useCallback(() => {
    if (intent?.kind === 'tests') onCloseIntent();
    else onOpenIntent('tests');
  }, [intent, onOpenIntent, onCloseIntent]);

  return (
    <header className="codepanel-toolbar" role="toolbar" aria-label="File actions">
      <span className="codepanel-path" title={path}>{path}</span>
      {hasPendingDiff ? (
        <span className="codepanel-badge codepanel-badge-diff" data-testid="code-panel-diff-badge" title="This file has pending changes">pending diff</span>
      ) : null}
      <span className="cw-spacer" />
      <button type="button" className="codeworkspace-link-btn" onClick={copyPath} data-testid="code-panel-copy-path">Copy path</button>
      <button type="button" className="codeworkspace-link-btn" onClick={openDiff} disabled={!hasPendingDiff} data-testid="code-panel-open-diff" title={hasPendingDiff ? 'Open diff overlay for this file' : 'No pending changes for this file'}>Open related diff</button>
      <button type="button" className="codeworkspace-link-btn" onClick={askAboutFile} disabled={!ready} data-testid="code-panel-ask-file" title={disabledReason ?? 'Ask local AI about this file'}>Ask local AI about file</button>
      <button type="button" className="codeworkspace-link-btn" onClick={askAboutSelection} disabled={!ready || !selection || content == null} data-testid="code-panel-ask-selection" title={!ready ? (disabledReason ?? 'Unavailable') : !selection ? 'Select one or more lines first' : 'Ask local AI about the selected lines'}>Ask about selection</button>
      <button
        type="button"
        className={'codeworkspace-link-btn' + (intent?.kind === 'edit' ? ' codeworkspace-link-btn-active' : '')}
        onClick={toggleEdit}
        disabled={!ready}
        data-testid="code-panel-request-edit"
        aria-pressed={intent?.kind === 'edit'}
        title={disabledReason ?? 'Ask local AI to edit this file'}
      >
        Ask local AI to edit
      </button>
      <button
        type="button"
        className={'codeworkspace-link-btn' + (intent?.kind === 'tests' ? ' codeworkspace-link-btn-active' : '')}
        onClick={toggleTests}
        disabled={!ready}
        data-testid="code-panel-request-tests"
        aria-pressed={intent?.kind === 'tests'}
        title={disabledReason ?? 'Ask local AI to draft tests for this file'}
      >
        Ask local AI for tests
      </button>
    </header>
  );
}

interface IntentPanelProps {
  state: IntentPanelState;
  path: string;
  sessionId: string | null;
  transport: TransportHandle | null;
  selection: ProjectSelection | null;
  content: string | null;
  onChange: (next: Partial<Pick<IntentPanelState, 'chips' | 'hint'>>) => void;
  onClose: () => void;
}

function IntentPanel({ state, path, sessionId, transport, selection, content, onChange, onClose }: IntentPanelProps) {
  const setRoute = useCockpit((s) => s.setRoute);
  const ready = !!sessionId && !!transport;
  const presetChips = state.kind === 'edit' ? EDIT_INTENT_CHIPS : TEST_INTENT_CHIPS;
  const eventType = state.kind === 'edit' ? ('coding.context.request_edit' as const) : ('coding.context.request_tests' as const);
  const hintTrimmed = state.hint.trim();
  const canSend = ready && (state.chips.length > 0 || hintTrimmed.length > 0);
  const title = state.kind === 'edit' ? 'Ask local AI to edit' : 'Ask local AI for tests';
  const placeholder = state.kind === 'edit'
    ? 'Describe what you want changed (optional)'
    : 'Describe the tests you want (optional)';
  const scopeLabel = state.kind === 'edit'
    ? (selection ? `lines ${selection.start}\u2013${selection.end}` : 'whole file')
    : 'whole file';

  const toggleChip = (chip: string) => {
    if (state.chips.includes(chip)) {
      onChange({ chips: state.chips.filter((c) => c !== chip) });
    } else {
      onChange({ chips: [...state.chips, chip] });
    }
  };

  const submit = useCallback(async () => {
    if (!ready || !sessionId || !transport || !canSend) return;
    const payload = buildEditIntentPayload(sessionId, path, {
      chips: state.chips,
      hint: state.hint,
      selection: state.kind === 'edit' ? selection ?? undefined : undefined,
      content: state.kind === 'edit' && content != null ? content : undefined,
    });
    onClose();
    await sendCodingContext(transport, eventType, payload);
    setRoute('build');
  }, [ready, sessionId, transport, canSend, path, state, selection, content, eventType, setRoute, onClose]);

  return (
    <section
      className="codepanel-intent"
      role="region"
      aria-label={title}
      data-testid={`code-panel-intent-${state.kind}`}
    >
      <header className="codepanel-intent-header">
        <span className="cw-empty-title">{title}</span>
        <span className="cw-empty-hint">Scope: {scopeLabel}. Local AI receives an audited request; nothing is written from the browser.</span>
      </header>
      <div className="codepanel-intent-chips" role="group" aria-label="Preset intents">
        {presetChips.map((chip) => {
          const pressed = state.chips.includes(chip);
          const chipTestId = `code-panel-intent-chip-${chip.replace(/\s+/g, '-')}`;
          return (
            <button
              key={chip}
              type="button"
              className={'codepanel-intent-chip' + (pressed ? ' codepanel-intent-chip-active' : '')}
              aria-pressed={pressed}
              onClick={() => toggleChip(chip)}
              data-testid={chipTestId}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <textarea
        className="codepanel-intent-hint"
        placeholder={placeholder}
        value={state.hint}
        onChange={(e) => onChange({ hint: e.target.value })}
        rows={3}
        data-testid={`code-panel-intent-hint-${state.kind}`}
      />
      <footer className="codepanel-intent-actions">
        <button
          type="button"
          className="codeworkspace-link-btn"
          onClick={onClose}
          data-testid={`code-panel-intent-cancel-${state.kind}`}
        >
          Cancel
        </button>
        <button
          type="button"
          className="codeworkspace-link-btn"
          onClick={() => { void submit(); }}
          disabled={!canSend}
          data-testid={`code-panel-intent-send-${state.kind}`}
          title={canSend ? 'Send to local AI' : 'Pick a chip or type instructions first'}
        >
          Send to local AI
        </button>
      </footer>
    </section>
  );
}

interface BodyProps {
  content: string;
  truncated: boolean;
  selection: ProjectSelection | null;
}

function CodeBody({ content, truncated, selection }: BodyProps) {
  const lines = useMemo(() => content.split('\n'), [content]);
  const selectLines = useProject((s) => s.selectLines);

  const handleLineClick = (lineNumber: number, shiftKey: boolean) => {
    if (shiftKey && selection) {
      const start = Math.min(selection.start, lineNumber);
      const end = Math.max(selection.end, lineNumber);
      selectLines({ start, end });
      return;
    }
    selectLines({ start: lineNumber, end: lineNumber });
  };

  if (content.length === 0) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-panel-empty-body">
        <span className="cw-empty-title">Empty file</span>
        <span className="cw-empty-hint">This file is zero bytes.</span>
      </div>
    );
  }

  return (
    <div className="codepanel-source" data-testid="code-panel-source">
      <pre className="codepanel-pre">
        {lines.map((text, idx) => {
          const lineNumber = idx + 1;
          const selected = selection != null && lineNumber >= selection.start && lineNumber <= selection.end;
          return (
            <div key={lineNumber} className={'codepanel-line' + (selected ? ' codepanel-line-selected' : '')} data-line={lineNumber} onClick={(e) => handleLineClick(lineNumber, e.shiftKey)}>
              <span className="codepanel-lineno" aria-hidden="true">{lineNumber}</span>
              <span className="codepanel-linetext">{text || ' '}</span>
            </div>
          );
        })}
      </pre>
      {truncated ? (
        <p className="codepanel-truncated" data-testid="code-panel-truncated" role="note">File truncated by bridge -- showing first chunk only.</p>
      ) : null}
    </div>
  );
}
