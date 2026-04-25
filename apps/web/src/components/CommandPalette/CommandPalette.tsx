import { useEffect, useMemo, useRef, useState } from 'react';
import { filterActions } from '../../actions/filterActions';
import { type Context } from '../../actions/predicate';
import { markUsed } from '../../actions/recency';
import { useActions, type ActionSpec } from '../../actions/registry';
import type { OverlayRenderProps } from '../../overlays/registry';
import { useComposer } from '../../stores/composer';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

/**
 * Command palette content — rendered inside OverlayHost which provides
 * backdrop, stacking, Esc handling, and focus restore.
 *
 * Params: `{ transport }`. Transport is optional; if absent, palette invokes
 * only dismiss (useful for standalone demos).
 */
export function CommandPalette({ dismiss, params }: OverlayRenderProps) {
  const transport = (params.transport as TransportHandle | null | undefined) ?? null;
  const actions = useActions((s) => s.actions);
  const sessionId = useSession((s) => s.sessionId);
  const streaming = useComposer((s) => s.submitting);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setQuery('');
    setFocused(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const ctx: Context = useMemo(
    () => ({
      session: { open: !!sessionId, streaming },
      workbench: { tab: 'transcript' },
      approvals: { pendingCount: 0 },
      gates: {},
    }),
    [sessionId, streaming],
  );

  // Single source of truth shared with SlashPalette — both modes funnel
  // through `filterActions` to prevent command-discovery drift.
  const filtered = useMemo(
    () => filterActions({ actions, query, mode: 'palette', ctx }),
    [actions, query, ctx],
  );

  useEffect(() => {
    setFocused(0);
  }, [query]);

  const invoke = async (a: ActionSpec) => {
    markUsed(a.id);
    if (transport && sessionId) {
      await transport.send(sessionId, 'palette.invoke_action', {
        actionId: a.id,
        args: {},
      });
    }
    dismiss();
  };

  const onKey = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocused((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocused((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const f = filtered[focused];
      if (f && !f.disabledReason) await invoke(f.action);
    }
    // Esc handled globally by overlays/esc.ts.
  };

  // Group filtered rows by `action.group` so the cockpit `.palette-section`
  // header can render once per group. Preserves score order within group.
  const grouped = useMemo(() => {
    const out: Array<[string, typeof filtered]> = [];
    for (const row of filtered) {
      const g = row.action.group ?? 'Actions';
      const existing = out.find(([k]) => k === g);
      if (existing) existing[1].push(row);
      else out.push([g, [row]]);
    }
    return out;
  }, [filtered]);

  // Flatten back to a list with section markers so keyboard navigation still
  // counts items linearly.
  let runningIndex = 0;

  return (
    <div
      className="palette"
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
      onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="palette-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a command, page, or assessment…"
      />
      <div className="palette-list" role="listbox">
        {filtered.length === 0 && (
          <div className="empty">
            <div className="icon-wrap">⌕</div>
            No matches
          </div>
        )}
        {grouped.map(([section, rows]) => (
          <div key={section}>
            <div className="palette-section">{section}</div>
            {rows.map((row) => {
              const i = runningIndex++;
              const isActive = i === focused;
              return (
                <div
                  key={row.action.id}
                  className={`palette-item ${isActive ? 'active' : ''}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={!!row.disabledReason}
                  onMouseEnter={() => setFocused(i)}
                  onClick={() => row.disabledReason || invoke(row.action)}
                  style={{
                    cursor: row.disabledReason ? 'not-allowed' : 'pointer',
                    opacity: row.disabledReason ? 0.45 : 1,
                  }}
                >
                  <span className="icon">⌘</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{row.action.label}</div>
                    {row.action.description && (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                        {row.action.description}
                      </div>
                    )}
                    {row.disabledReason && (
                      <div style={{ fontSize: 11, color: 'var(--crit)' }}>
                        {row.disabledReason}
                      </div>
                    )}
                  </span>
                  <span className="kbd" style={{ marginLeft: 'auto', fontSize: 11 }}>
                    {row.action.keybinding ?? row.action.slash_alias ?? ''}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
