import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyScore } from '../../actions/fuzzy';
import { evaluate, type Context } from '../../actions/predicate';
import { markUsed, recencyBonus } from '../../actions/recency';
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

  const filtered = useMemo(() => {
    const scored: Array<{ action: ActionSpec; score: number; disabledReason?: string }> = [];
    for (const a of actions) {
      if (!a.palette_visible) continue;
      const baseScore = query ? fuzzyScore(query, a.label) ?? fuzzyScore(query, a.id) : 1;
      if (baseScore === null) continue;
      const score = baseScore + recencyBonus(a.id);
      const availableOk = evaluate(a.available_when ?? null, ctx);
      const entry: { action: ActionSpec; score: number; disabledReason?: string } = {
        action: a,
        score,
      };
      if (!availableOk) entry.disabledReason = `unavailable: ${a.available_when}`;
      scored.push(entry);
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 30);
  }, [actions, query, ctx]);

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

  return (
    <div
      aria-label="Command palette"
      onKeyDown={onKey}
      style={{
        background: 'var(--surface-1, white)',
        width: 560,
        maxWidth: '90vw',
        borderRadius: 8,
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a command…"
        style={{
          width: '100%',
          border: 'none',
          outline: 'none',
          padding: '16px',
          fontSize: 16,
          borderBottom: '1px solid var(--border, #eee)',
          background: 'transparent',
          color: 'var(--text-1)',
        }}
      />
      <ul role="listbox" style={{ margin: 0, padding: 0, maxHeight: 400, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <li style={{ padding: 16, color: 'var(--text-2)' }}>No commands</li>
        )}
        {filtered.map((row, i) => (
          <li
            key={row.action.id}
            role="option"
            aria-selected={i === focused}
            aria-disabled={!!row.disabledReason}
            onClick={() => row.disabledReason || invoke(row.action)}
            style={{
              padding: '10px 16px',
              listStyle: 'none',
              background: i === focused ? 'var(--surface-2, #f0f4ff)' : undefined,
              cursor: row.disabledReason ? 'not-allowed' : 'pointer',
              opacity: row.disabledReason ? 0.4 : 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{row.action.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{row.action.description}</div>
              {row.disabledReason && (
                <div style={{ fontSize: 11, color: 'var(--sev-error)' }}>
                  {row.disabledReason}
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
              {row.action.keybinding ?? row.action.slash_alias ?? row.action.group}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
