import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { TransportHandle } from '../../transport';
import { isAllowedPreviewUrl, usePreview } from '../../stores/preview';
import {
  requestPreviewOpen,
  requestPreviewRefresh,
  requestPreviewRunE2e,
  requestPreviewSendContext,
  requestPreviewStop,
} from '../../domain/preview/handlers';

interface Props {
  sessionId: string | null;
  transport: TransportHandle | null;
}

export function PreviewPanel({ sessionId, transport }: Props) {
  const status = usePreview((s) => s.status);
  const url = usePreview((s) => s.url);
  const errorMessage = usePreview((s) => s.errorMessage);
  const unsupportedReason = usePreview((s) => s.unsupportedReason);
  const consoleErrors = usePreview((s) => s.consoleErrors);
  const networkFailures = usePreview((s) => s.networkFailures);
  const clearConsole = usePreview((s) => s.clearConsole);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = !!sessionId && !!transport;
  const canUseUrl = !!url && isAllowedPreviewUrl(url);

  const copyUrl = useCallback(() => {
    if (!url) return;
    void navigator.clipboard.writeText(url).then(
      () => setNotice('Preview URL copied.'),
      () => setNotice('Copy failed.'),
    );
  }, [url]);

  const refresh = useCallback(() => {
    if (!ready || !sessionId || !transport) return;
    void requestPreviewRefresh(transport, sessionId);
  }, [ready, sessionId, transport]);

  const stop = useCallback(() => {
    if (!ready || !sessionId || !transport) return;
    void requestPreviewStop(transport, sessionId);
  }, [ready, sessionId, transport]);

  const sendContext = useCallback(() => {
    if (!ready || !sessionId || !transport || !url) return;
    void requestPreviewSendContext(transport, sessionId, {
      url,
      console_errors: consoleErrors,
      network_failures: networkFailures,
      viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio },
    }).then(
      () => setNotice('Preview context sent to agent.'),
      (err) => setNotice(err instanceof Error ? err.message : String(err)),
    );
  }, [ready, sessionId, transport, url, consoleErrors, networkFailures]);

  const runE2e = useCallback(() => {
    if (!ready || !sessionId || !transport) return;
    void requestPreviewRunE2e(transport, sessionId, url).then(
      () => setNotice('E2E request sent.'),
      (err) => setNotice(err instanceof Error ? err.message : String(err)),
    );
  }, [ready, sessionId, transport, url]);

  const openPreview = useCallback((nextUrl: string) => {
    if (!ready || !sessionId || !transport) return;
    void requestPreviewOpen(transport, sessionId, nextUrl);
  }, [ready, sessionId, transport]);

  return (
    <section className="codeworkspace-preview" data-testid="preview-panel" aria-label="App preview">
      <header className="codeworkspace-preview-toolbar" role="toolbar" aria-label="Preview actions">
        <span className="codeworkspace-preview-title">App preview</span>
        <span className="codeworkspace-preview-status" data-status={status}>{status}</span>
        {url ? <span className="codeworkspace-preview-url" title={url}>{url}</span> : null}
        <span className="cw-spacer" />
        <button type="button" className="codeworkspace-link-btn" onClick={refresh} disabled={!ready || !url}>Refresh</button>
        <button type="button" className="codeworkspace-link-btn" onClick={copyUrl} disabled={!url}>Copy URL</button>
        <button type="button" className="codeworkspace-link-btn" onClick={sendContext} disabled={!ready || !url}>Send context</button>
        <button type="button" className="codeworkspace-link-btn" onClick={runE2e} disabled={!ready}>Run e2e</button>
        <button type="button" className="codeworkspace-link-btn" onClick={stop} disabled={!ready || status === 'stopped'}>Stop</button>
        <button type="button" className="codeworkspace-link-btn" onClick={clearConsole} disabled={consoleErrors.length + networkFailures.length === 0}>Clear console</button>
      </header>

      {notice ? <p className="codeworkspace-preview-notice" role="status">{notice}</p> : null}

      <div className="codeworkspace-preview-body">
        <PreviewBody
          ready={ready}
          status={status}
          url={url}
          canUseUrl={canUseUrl}
          errorMessage={errorMessage}
          unsupportedReason={unsupportedReason}
          onOpen={openPreview}
        />
      </div>
      <ConsoleSummary consoleCount={consoleErrors.length} networkCount={networkFailures.length} />
    </section>
  );
}

interface BodyProps {
  ready: boolean;
  status: ReturnType<typeof usePreview.getState>['status'];
  url: string | null;
  canUseUrl: boolean;
  errorMessage: string | null;
  unsupportedReason: string | null;
  onOpen(url: string): void;
}

function PreviewBody({ ready, status, url, canUseUrl, errorMessage, unsupportedReason, onOpen }: BodyProps) {
  if (!ready) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="preview-empty">
        <span className="cw-empty-title">No active preview session</span>
        <span className="cw-empty-hint">Connect a session before opening a browser preview.</span>
      </div>
    );
  }

  if (status === 'idle') {
    return (
      <div className="codeworkspace-preview-setup" data-testid="preview-idle">
        <PreviewOpenForm initialUrl={url ?? 'http://localhost:4181'} onOpen={onOpen} />
        <span className="codeworkspace-unsupported">Unavailable: preview bridge support is not confirmed until workspace.preview.* responds.</span>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="preview-starting">
        <span className="cw-empty-title">Opening preview...</span>
        <span className="cw-empty-hint">Waiting for the bridge to acknowledge workspace.preview.open or refresh.</span>
      </div>
    );
  }

  if (status === 'running' && url && canUseUrl) {
    return (
      <iframe
        title="VAC app preview"
        className="codeworkspace-preview-frame"
        data-testid="preview-frame"
        src={url}
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
      />
    );
  }

  if (status === 'running' && url && !canUseUrl) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="preview-url-blocked">
        <span className="cw-empty-title">Preview URL blocked</span>
        <span className="codeworkspace-unsupported">Only loopback preview URLs are allowed: localhost, 127.0.0.1, or [::1].</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="preview-failed">
        <span className="cw-empty-title">Preview failed</span>
        <span className="cw-empty-hint">{errorMessage ?? 'Unknown preview error.'}</span>
        <PreviewOpenForm initialUrl={url ?? 'http://localhost:4181'} onOpen={onOpen} />
      </div>
    );
  }

  if (status === 'stopped') {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="preview-stopped">
        <span className="cw-empty-title">Preview stopped</span>
        <span className="cw-empty-hint">Restart the loopback preview when the app server is ready.</span>
        <PreviewOpenForm initialUrl={url ?? 'http://localhost:4181'} onOpen={onOpen} />
      </div>
    );
  }

  return (
    <div className="codeworkspace-empty" role="status" data-testid="preview-unsupported">
      <span className="cw-empty-title">Preview unsupported</span>
      <span className="codeworkspace-unsupported">Unavailable: bridge does not support browser preview yet.</span>
      {unsupportedReason ? <span className="cw-empty-hint cw-empty-detail">{unsupportedReason}</span> : null}
      <PreviewOpenForm initialUrl={url ?? 'http://localhost:4181'} onOpen={onOpen} />
    </div>
  );
}

interface PreviewOpenFormProps {
  initialUrl: string;
  onOpen(url: string): void;
}

function PreviewOpenForm({ initialUrl, onOpen }: PreviewOpenFormProps) {
  const [rawUrl, setRawUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const allowed = useMemo(() => isAllowedPreviewUrl(rawUrl), [rawUrl]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!allowed) {
      setError('Only loopback URLs are allowed: localhost, 127.0.0.1, or [::1].');
      return;
    }
    setError(null);
    onOpen(rawUrl);
  };

  return (
    <form className="codeworkspace-preview-form" onSubmit={submit} data-testid="preview-open-form">
      <label>
        Preview URL
        <input value={rawUrl} onChange={(e) => setRawUrl(e.target.value)} placeholder="http://localhost:4181" aria-invalid={!allowed} />
      </label>
      <button type="submit" className="codeworkspace-link-btn">Open preview</button>
      {error ? <span className="codeworkspace-preview-error" role="alert">{error}</span> : null}
    </form>
  );
}

function ConsoleSummary({ consoleCount, networkCount }: { consoleCount: number; networkCount: number }) {
  return (
    <footer className="codeworkspace-preview-console" data-testid="preview-console-summary">
      <span>Console errors: {consoleCount}</span>
      <span>Network failures: {networkCount}</span>
      <span className="cw-empty-detail">Context is sent only when you click Send context.</span>
    </footer>
  );
}
