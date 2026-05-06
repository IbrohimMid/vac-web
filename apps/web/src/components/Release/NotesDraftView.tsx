// Release notes drafts panel. Reads useRelease.notes; renders markdown bodies
// inside collapsible <details> blocks. Markdown is rendered as preformatted text
// for now (matches legacy ReleaseTab); a richer markdown render can plug in later
// without changing the store contract.

import type { CSSProperties } from 'react';
import { useRelease } from '../../stores/release';

const sectionStyle: CSSProperties = { marginTop: 12 };
const detailsStyle: CSSProperties = { marginBottom: 8 };
const preStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontFamily: 'inherit',
  margin: 0,
  padding: 8,
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 4,
  fontSize: 12,
};

export function NotesDraftView() {
  const notes = useRelease((s) => s.notes);
  if (notes.size === 0) return null;

  return (
    <section className="panel-card panel-card-pad" style={sectionStyle}>
      <h4 className="panel-title">Release notes drafts</h4>
      {Array.from(notes.values()).map((d) => (
        <details key={d.id} style={detailsStyle} data-testid={`release-notes-${d.id}`}>
          <summary>
            {d.target_id} · {d.commit_range}
          </summary>
          <pre style={preStyle}>{d.markdown}</pre>
        </details>
      ))}
    </section>
  );
}
