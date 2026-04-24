// `@`-trigger fuzzy picker over project files (+ connector items later).
//
// Debounced query → `context.mention_search` command; bridge responds via
// `context.mention_results` event; picker shows top results. Enter selects;
// Esc closes. Parent (Composer) owns open/close state.

import { useEffect, useRef, useState } from 'react';
import { useAttachments } from '../../stores/attachments';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

interface Result {
  id: string;
  kind: 'file' | 'url' | 'page';
  label: string;
  score: number;
  payload: string;
}

interface Props {
  transport: TransportHandle | null;
  query: string;
  onClose: () => void;
}

export function MentionPicker({ transport, query, onClose }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const [results, setResults] = useState<Result[]>([]);
  const [cursor, setCursor] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!transport || !sessionId || !query) {
      setResults([]);
      return;
    }
    const off = transport.on('context.mention_results', (ev) => {
      const p = ev.payload as { query?: string; results?: Result[] } | null;
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
        useAttachments.getState().add({
          id: r.id,
          kind: r.kind === 'file' ? 'file' : 'url',
          label: r.label,
          payload: r.payload,
        });
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
        background: 'var(--bg-1, #1a1a1a)',
        border: '1px solid var(--border-1, #333)',
        borderRadius: 6,
        maxHeight: 240,
        overflow: 'auto',
        zIndex: 40,
      }}
    >
      {results.map((r, i) => (
        <li
          key={r.id}
          role="option"
          aria-selected={i === cursor}
          style={{
            padding: '4px 8px',
            background: i === cursor ? 'var(--bg-2, #222)' : 'transparent',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
          onMouseEnter={() => setCursor(i)}
        >
          {r.label}
        </li>
      ))}
    </ul>
  );
}
