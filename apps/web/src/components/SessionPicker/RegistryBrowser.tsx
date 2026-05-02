// Sprint 5 — Registry browser modal.
//
// Lets the operator pull the bridge's configured remote agent catalog
// (`registry.sync`) and append individual entries to the local
// `agents.toml` (`registry.add`). The bridge is the source of truth
// about whether a `[registry]` table is configured — we surface its
// error codes verbatim instead of duplicating policy on the frontend.
//
// Once an entry is added, we tell the operator the new agent will be
// picked up the next time the bridge restarts. (Hot-reload of
// `agents.toml` is not implemented; doing so would change the in-memory
// `AgentRuntimeRegistry` which has implications for live ACP sessions
// and is intentionally out of Sprint 5 scope.)

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TransportHandle } from '../../transport';

const REGISTRY_PLACEHOLDER_SESSION = 'sess_pending_registry';

/// Wire-shape entry returned by `registry.sync`. Mirrors
/// `RegistryEntry` in `apps/local-bridge/src/agent_runtime/registry_sync.rs`.
/// Optional fields are skipped from the wire when empty/None on the
/// bridge side, so we treat them as forward-compatible (older bridges
/// that pre-date Sprint 5 will never emit this event at all, so we
/// don't need a legacy fallback).
export interface RegistryAgentEntry {
  id: string;
  label: string;
  kind: string;
  command: string;
  args?: string[];
  install_hint?: string;
  source: 'local' | 'remote';
  installed: boolean;
}

interface RegistrySyncedPayload {
  source: string;
  sourceKind: 'url' | 'path';
  fromCache: boolean;
  agents: RegistryAgentEntry[];
}

interface RegistryAddedPayload {
  id: string;
  added: boolean;
  path: string;
}

const MODAL_BACKDROP_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: 90,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const MODAL_STYLE: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #ccc',
  borderRadius: 6,
  padding: 16,
  width: 'min(720px, 90vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
};

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
};

const LIST_STYLE: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const ROW_STYLE: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 4,
  padding: '8px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const ROW_BODY_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const HINT_STYLE: React.CSSProperties = {
  color: '#555',
  fontSize: 12,
};

const ERROR_STYLE: React.CSSProperties = {
  color: '#a00',
  fontSize: 13,
  marginTop: 8,
};

const INFO_STYLE: React.CSSProperties = {
  color: '#444',
  fontSize: 12,
  marginTop: 8,
};

// Inline JSX object expressions get stripped by the sandbox edit tool,
// so every style we'd otherwise write as `style= ... ` lives here
// as a named const and the JSX uses single-brace `style={NAME}`.
const H3_STYLE: React.CSSProperties = { margin: 0, flex: 1 };
const H4_STYLE: React.CSSProperties = { marginTop: 16, marginBottom: 6 };
const DETAILS_STYLE: React.CSSProperties = { marginTop: 16 };

export function RegistryBrowser({
  transport,
  onClose,
}: {
  transport: TransportHandle;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<RegistryAgentEntry[]>([]);
  const [meta, setMeta] = useState<{ source: string; fromCache: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Track ids that were successfully added in this session so we can
  // mark them with an "Added — restart bridge" badge instead of letting
  // the user re-click. The bridge's idempotency means double-add is
  // safe but visually confusing.
  const [added, setAdded] = useState<Set<string>>(() => new Set());

  const remoteEntries = useMemo(
    () => entries.filter((e) => e.source === 'remote'),
    [entries],
  );
  const localEntries = useMemo(
    () => entries.filter((e) => e.source === 'local'),
    [entries],
  );

  // Audit fix: wrap `sync` in `useCallback` so we can list it as a
  // dependency of the auto-sync `useEffect` without re-syncing every
  // render. Stable across renders because `transport` is the only
  // captured value and parents pass a stable handle.
  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setInfo(null);
    // Listener registered before send so we don't miss a fast event.
    const off = transport.on('registry.synced', (ev) => {
      const p = ev.payload as RegistrySyncedPayload;
      setEntries(p.agents ?? []);
      setMeta({ source: p.source, fromCache: !!p.fromCache });
      off();
    });
    try {
      const ack = await transport.send(
        REGISTRY_PLACEHOLDER_SESSION,
        'registry.sync',
        {},
      );
      if (!ack.ok) {
        off();
        // Surface bridge error code verbatim — the operator needs
        // to know whether this is `registry.not_configured` (config
        // edit needed) vs `registry.fetch_failed` (transient).
        setError(`${ack.error?.code ?? 'error'}: ${ack.error?.message ?? 'sync failed'}`);
      }
    } catch (e) {
      off();
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }, [transport]);

  // Auto-sync on first open so the operator doesn't have to click
  // twice. `sync` is stable via useCallback so this still fires once
  // per mount in practice.
  useEffect(() => {
    void sync();
  }, [sync]);

  const addEntry = async (entry: RegistryAgentEntry) => {
    setAddingId(entry.id);
    setError(null);
    setInfo(null);
    const off = transport.on('registry.added', (ev) => {
      const p = ev.payload as RegistryAddedPayload;
      if (p.id !== entry.id) return;
      if (p.added) {
        setInfo(
          `Added '${p.id}' to ${p.path}. Restart the bridge to load the new agent.`,
        );
      } else {
        setInfo(`'${p.id}' was already present in ${p.path}.`);
      }
      setAdded((prev) => {
        const next = new Set(prev);
        next.add(p.id);
        return next;
      });
      off();
    });
    try {
      const ack = await transport.send(REGISTRY_PLACEHOLDER_SESSION, 'registry.add', {
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        command: entry.command,
        args: entry.args ?? [],
        install_hint: entry.install_hint,
      });
      if (!ack.ok) {
        off();
        setError(`${ack.error?.code ?? 'error'}: ${ack.error?.message ?? 'add failed'}`);
      }
    } catch (e) {
      off();
      setError(String(e));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Browse remote agent registry"
      style={MODAL_BACKDROP_STYLE}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={MODAL_STYLE}>
        <div style={HEADER_STYLE}>
          <h3 style={H3_STYLE}>Browse agent registry</h3>
          <button onClick={() => void sync()} disabled={syncing}>
            {syncing ? 'syncing…' : 'Refresh'}
          </button>
          <button onClick={onClose}>Close</button>
        </div>

        {meta && (
          <p style={HINT_STYLE} data-testid="registry-source">
            Source: <code>{meta.source}</code>
            {meta.fromCache ? ' (cached)' : ''}
          </p>
        )}

        {error && (
          <p role="alert" style={ERROR_STYLE} data-testid="registry-error">
            {error}
          </p>
        )}
        {info && (
          <p role="status" style={INFO_STYLE} data-testid="registry-info">
            {info}
          </p>
        )}

        <h4 style={H4_STYLE}>
          Remote agents ({remoteEntries.length})
        </h4>
        {remoteEntries.length === 0 && !syncing && !error ? (
          <p style={HINT_STYLE} data-testid="registry-empty">
            No remote-only agents — the registry source has no entries
            beyond what's already in your local <code>agents.toml</code>.
          </p>
        ) : (
          <ul style={LIST_STYLE} aria-label="Remote agents">
            {remoteEntries.map((entry) => {
              const isAdded = added.has(entry.id);
              const isBusy = addingId === entry.id;
              return (
                <li key={entry.id} style={ROW_STYLE} data-testid={`registry-row-${entry.id}`}>
                  <div style={ROW_BODY_STYLE}>
                    <strong>
                      {entry.label}{' '}
                      <span style={HINT_STYLE}>
                        · {entry.id} · {entry.kind}
                      </span>
                    </strong>
                    <span style={HINT_STYLE}>
                      <code>{entry.command}</code>
                      {entry.args?.length ? ` ${entry.args.join(' ')}` : ''}
                      {entry.installed === false ? ' • not installed' : ''}
                    </span>
                    {entry.install_hint && (
                      <span style={HINT_STYLE}>{entry.install_hint}</span>
                    )}
                  </div>
                  {isAdded ? (
                    <span
                      className="badge ok"
                      data-testid={`registry-added-${entry.id}`}
                      title="Restart the bridge to use this agent"
                    >
                      Added
                    </span>
                  ) : (
                    <button
                      onClick={() => void addEntry(entry)}
                      disabled={isBusy}
                      data-testid={`registry-add-${entry.id}`}
                    >
                      {isBusy ? 'adding…' : 'Add to local'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {localEntries.length > 0 && (
          <details style={DETAILS_STYLE}>
            <summary>Local agents ({localEntries.length})</summary>
            <ul style={LIST_STYLE} aria-label="Local agents">
              {localEntries.map((entry) => (
                <li key={entry.id} style={ROW_STYLE}>
                  <div style={ROW_BODY_STYLE}>
                    <strong>
                      {entry.label}{' '}
                      <span style={HINT_STYLE}>
                        · {entry.id} · {entry.kind}
                      </span>
                    </strong>
                    <span style={HINT_STYLE}>
                      <code>{entry.command}</code>
                      {entry.args?.length ? ` ${entry.args.join(' ')}` : ''}
                    </span>
                  </div>
                  <span className="badge muted">already local</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
