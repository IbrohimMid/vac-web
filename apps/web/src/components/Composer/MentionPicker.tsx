// `@`-trigger fuzzy picker over project files (+ connector items later).
//
// Debounced query → `context.mention_search` command; bridge responds via
// `context.mention_results` event; picker shows top results. Enter or click
// invokes `onSelect(result)` — caller decides what happens (attachment tray
// for textarea mode, inline DOM chip for contentEditable mode). The picker
// itself never mutates global state.

import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

export interface MentionResult {
  id: string;
  kind: 'file' | 'url' | 'page';
  label: string;
  score: number;
  payload: string;
}

interface Props {
  transport: TransportHandle | null;
  query: string;
  onSelect(result: MentionResult): void;
  onClose: () => void;
}

export function MentionPicker({ transport, query, onSelect, onClose }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const [results, setResults] = useState<MentionResult[]>([]);
  const [cursor, setCursor] = useState(0);
  // Refs so the keydown listener doesn't need to re-register on every prop
  // identity change; callbacks may be inline arrow functions from the parent.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!transport || !sessionId || !query) {
      setResults([]);
      return;
    }
    const off = transport.on('context.mention_results', (ev) => {
      const p = ev.payload as { query?: string; results?: MentionResult[] } | null;
      if (!p || p.query !== query) return;
      setResults(p.results ?? []);
      setCursor(0);
    });
    const timer = setTimeout(() => {
      transport.send(sessionId, 'context.mention_search', { query, limit: 12 }).catch(() => {});
    }, 80);
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [query, transport, sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter' && results[cursor]) {
        e.preventDefault();
        const r = results[cursor]!;
        onSelectRef.current(r);
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, cursor]);

  if (results.length === 0) return null;
  return (
    <ul
      role="listbox"
      aria-label="Mention picker"
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
        maxHeight: 240,
        overflow: 'auto',
        zIndex: 40,
        boxShadow: 'var(--shadow-md)',
      }}
    >
      {results.map((r, i) => (
        <li
          key={r.id}
          role="option"
          aria-selected={i === cursor}
          style={{
            padding: '4px 8px',
            background: i === cursor ? 'var(--bg-hover)' : 'transparent',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
          }}
          onMouseEnter={() => setCursor(i)}
          onClick={() => {
            onSelect(r);
            onClose();
          }}
        >
          {r.label}
        </li>
      ))}
    </ul>
  );
}
