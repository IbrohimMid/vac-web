// Settings overlay content. Backdrop + role="dialog" come from OverlayHost,
// so this component renders the inner surface only.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { OverlayRenderProps } from '../../overlays/registry';
import type { TransportHandle } from '../../transport';
import { ExtensionsList } from './Extensions/ExtensionsList';

type SettingsTab = 'extensions';

const SURFACE_STYLE: CSSProperties = {
  background: 'var(--surface, #111)',
  border: '1px solid var(--border, #333)',
  borderRadius: 8,
  padding: 16,
  width: 'min(960px, 80vw)',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  overflow: 'hidden',
};
const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
const TITLE_STYLE: CSSProperties = { margin: 0 };
const NAV_STYLE: CSSProperties = { display: 'flex', gap: 8 };
const SECTION_STYLE: CSSProperties = { flex: 1, overflow: 'auto' };

export function SettingsPage({ params, dismiss }: OverlayRenderProps) {
  const transport =
    (params.transport as TransportHandle | null | undefined) ?? null;
  const [tab, setTab] = useState<SettingsTab>('extensions');
  return (
    <div
      data-testid="settings-overlay"
      className="settings-overlay"
      onClick={(e) => e.stopPropagation()}
      style={SURFACE_STYLE}
    >
      <header style={HEADER_STYLE}>
        <h2 style={TITLE_STYLE}>Settings</h2>
        <button
          onClick={dismiss}
          aria-label="Close settings"
          className="icon-btn"
          data-testid="settings-close"
        >
          ✕
        </button>
      </header>
      <nav style={NAV_STYLE} aria-label="Settings tabs">
        <button
          className={tab === 'extensions' ? 'tab active' : 'tab'}
          onClick={() => setTab('extensions')}
          aria-pressed={tab === 'extensions'}
        >
          Extensions
        </button>
      </nav>
      <section style={SECTION_STYLE}>
        {tab === 'extensions' && <ExtensionsList transport={transport} />}
      </section>
    </div>
  );
}
