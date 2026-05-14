// CodePanel - Phase 3.
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
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
  buildFileContextPayload,
  buildFileIntentPayload,
  buildSelectionContextPayload,
  sendCodingContext,
} from '../../domain/coding/context';

interface Props {
  sessionId: string | null;
  transport: TransportHandle | null;
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
  return (
    <div className="codepanel" data-testid="code-panel">
      <CodeToolbar path={path} sessionId={sessionId} transport={transport} selection={selection} hasPendingDiff={hasPendingDiff} content={content} />
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
}

function CodeToolbar({ path, sessionId, transport, selection, hasPendingDiff, content }: ToolbarProps) {
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

  const requestEdit = useCallback(async () => {
    if (!ready || !sessionId || !transport) return;
    const payload = buildFileIntentPayload(sessionId, path);
    await sendCodingContext(transport, 'coding.context.request_edit', payload);
    setRoute('build');
  }, [ready, sessionId, transport, path, setRoute]);

  const requestTests = useCallback(async () => {
    if (!ready || !sessionId || !transport) return;
    const payload = buildFileIntentPayload(sessionId, path);
    await sendCodingContext(transport, 'coding.context.request_tests', payload);
    setRoute('build');
  }, [ready, sessionId, transport, path, setRoute]);

  return (
    <header className="codepanel-toolbar" role="toolbar" aria-label="File actions">
      <span className="codepanel-path" title={path}>{path}</span>
      {hasPendingDiff ? (
        <span className="codepanel-badge codepanel-badge-diff" data-testid="code-panel-diff-badge" title="This file has pending changes">pending diff</span>
      ) : null}
      <span className="cw-spacer" />
      <button type="button" className="codeworkspace-link-btn" onClick={copyPath} data-testid="code-panel-copy-path">Copy path</button>
      <button type="button" className="codeworkspace-link-btn" onClick={openDiff} disabled={!hasPendingDiff} data-testid="code-panel-open-diff" title={hasPendingDiff ? 'Open diff overlay for this file' : 'No pending changes for this file'}>Open related diff</button>
      <button type="button" className="codeworkspace-link-btn" onClick={askAboutFile} disabled={!ready} data-testid="code-panel-ask-file" title={disabledReason ?? 'Ask agent about this file'}>Ask agent about file</button>
      <button type="button" className="codeworkspace-link-btn" onClick={askAboutSelection} disabled={!ready || !selection || content == null} data-testid="code-panel-ask-selection" title={!ready ? (disabledReason ?? 'Unavailable') : !selection ? 'Select one or more lines first' : 'Ask agent about the selected lines'}>Ask about selection</button>
      <button type="button" className="codeworkspace-link-btn" onClick={requestEdit} disabled={!ready} data-testid="code-panel-request-edit" title={disabledReason ?? 'Hand this file to the agent for editing'}>Edit with agent</button>
      <button type="button" className="codeworkspace-link-btn" onClick={requestTests} disabled={!ready} data-testid="code-panel-request-tests" title={disabledReason ?? 'Ask the agent to generate tests for this file'}>Generate tests</button>
    </header>
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
