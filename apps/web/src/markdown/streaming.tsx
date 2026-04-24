// Lightweight streaming renderer — plain text with fence detection.
// Called per-render during state=streaming; must be cheap.
// No markdown-it; no DOMPurify; we escape as React does naturally.

import { Fragment, type ReactNode } from 'react';

interface Segment {
  kind: 'text' | 'code';
  lang?: string;
  text: string;
}

const FENCE_RE = /^```([^\n]*)\n([\s\S]*?)(?:\n```|$)/m;

function splitSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let remainder = text;
  while (remainder.length > 0) {
    const idx = remainder.indexOf('```');
    if (idx < 0) {
      out.push({ kind: 'text', text: remainder });
      break;
    }
    if (idx > 0) {
      out.push({ kind: 'text', text: remainder.slice(0, idx) });
      remainder = remainder.slice(idx);
    }
    const match = FENCE_RE.exec(remainder);
    if (!match) {
      // Unclosed fence — show everything remaining as code.
      const rest = remainder.replace(/^```([^\n]*)\n?/, '');
      out.push({ kind: 'code', text: rest });
      break;
    }
    const [full, lang, body] = match;
    const langTrim = lang?.trim();
    const seg: Segment = langTrim
      ? { kind: 'code', lang: langTrim, text: body ?? '' }
      : { kind: 'code', text: body ?? '' };
    out.push(seg);
    remainder = remainder.slice(full?.length ?? 0);
  }
  return out;
}

export function renderStreaming(text: string): ReactNode {
  if (!text) return null;
  const segments = splitSegments(text);
  return segments.map((seg, i) => {
    if (seg.kind === 'code') {
      return (
        <pre
          key={i}
          data-lang={seg.lang}
          data-streaming="true"
          style={{
            background: '#f5f5f5',
            padding: 8,
            overflowX: 'auto',
            borderRadius: 4,
          }}
        >
          <code>{seg.text}</code>
        </pre>
      );
    }
    // Preserve newlines as <br> in streaming text.
    const lines = seg.text.split('\n');
    return (
      <Fragment key={i}>
        {lines.map((line, j) => (
          <Fragment key={j}>
            {line}
            {j < lines.length - 1 && <br />}
          </Fragment>
        ))}
      </Fragment>
    );
  });
}
