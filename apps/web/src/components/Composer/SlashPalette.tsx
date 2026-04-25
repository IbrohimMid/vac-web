// `/`-trigger slash palette. Anchors above the composer when the user types
// `/` at the start of a line. Consumes `filterActions(mode='slash')` so the
// candidate set + scoring stays identical to the ⌘K palette.

import { useEffect, useMemo, useRef, useState } from 'react';
import { filterActions } from '../../actions/filterActions';
import { type Context } from '../../actions/predicate';
import { useActions, type ActionSpec } from '../../actions/registry';
import { useComposer } from '../../stores/composer';
import { useSession } from '../../stores/session';

interface Props {
  query: string; // text after `/` (without the slash itself)
  onInvoke(action: ActionSpec): void;
  onClose: () => void;
}

export function SlashPalette({ query, onInvoke, onClose }: Props) {
  const actions = useActions((s) => s.actions);
  const sessionId = useSession((s) => s.sessionId);
  const streaming = useComposer((s) => s.submitting);
  const [cursor, setCursor] = useState(0);
  const onInvokeRef = useRef(onInvoke);
  onInvokeRef.current = onInvoke;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const ctx: Context = useMemo(
    () => ({
      session: { open: !!sessionId, streaming },
      workbench: { tab: 'transcript' },
      approvals: { pendingCount: 0 },
      gates: {},
    }),
    [sessionId, streaming],
  );

  const rows = useMemo(
    () => filterActions({ actions, query, mode: 'slash', ctx, limit: 8 }),
    [actions, query, ctx],
  );

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter' && rows[cursor] && !rows[cursor]?.disabledReason) {
        e.preventDefault();
        const r = rows[cursor]!;
        // Recency tracking is the parent's responsibility (it also dispatches
        // the action), so we only forward the invoke here.
        onInvokeRef.current(r.action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor]);

  if (rows.length === 0) return null;

  return (
    <ul
      role="listbox"
      aria-label="Slash commands"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        listStyle: 'none',
        margin: 0,
        padding: 4,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        maxHeight: 280,
        overflow: 'auto',
        zIndex: 40,
        boxShadow: 'var(--shadow-md)',
      }}
    >
      {rows.map((row, i) => (
        <li
          key={row.action.id}
          role="option"
          aria-selected={i === cursor}
          aria-disabled={!!row.disabledReason}
          style={{
            padding: '6px 10px',
            background: i === cursor ? 'var(--bg-hover)' : 'transparent',
            cursor: row.disabledReason ? 'not-allowed' : 'pointer',
            opacity: row.disabledReason ? 0.45 : 1,
            display: 'flex',
            gap: 8,
            alignItems: 'baseline',
          }}
          onMouseEnter={() => setCursor(i)}
          onClick={() => {
            if (row.disabledReason) return;
            onInvoke(row.action);
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-2)' }}>
            {row.action.slash_alias}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{row.action.label}</div>
            {row.action.description && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                {row.action.description}
              </div>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
