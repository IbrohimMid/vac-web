// TweaksPanel — Stage E.
// Fixed right-side drawer that toggles theme/density/accent + layout
// collapses. All knobs persist via useCockpit's localStorage layer; close
// the panel with the X button or by clicking the backdrop. Simpler than the
// prototype's full editmode protocol — we just need the user-facing knobs.

import { useRef } from 'react';
import { ACCENT_PRESETS, useCockpit, type Density, type Theme } from '../../stores/cockpit';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  onClose: () => void;
}

export function TweaksPanel({ onClose }: Props) {
  const theme = useCockpit((s) => s.theme);
  const density = useCockpit((s) => s.density);
  const accent = useCockpit((s) => s.accent);
  const sidebarCollapsed = useCockpit((s) => s.sidebarCollapsed);
  const railCollapsed = useCockpit((s) => s.railCollapsed);
  const setTheme = useCockpit((s) => s.setTheme);
  const setDensity = useCockpit((s) => s.setDensity);
  const setAccent = useCockpit((s) => s.setAccent);
  const setSidebarCollapsed = useCockpit((s) => s.setSidebarCollapsed);
  const setRailCollapsed = useCockpit((s) => s.setRailCollapsed);
  const panelRef = useRef<HTMLElement | null>(null);
  useFocusTrap(true, panelRef, { onEscape: onClose });

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          zIndex: 99,
        }}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tweaks"
        style={{
          position: 'fixed',
          right: 16,
          top: 60,
          width: 300,
          maxHeight: 'calc(100vh - 80px)',
          background: 'var(--panel)',
          color: 'var(--ink)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--pad)',
          zIndex: 100,
          overflowY: 'auto',
          fontSize: 'var(--fs-body)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--gap)',
          }}
        >
          <strong>Tweaks</strong>
          <button
            onClick={onClose}
            aria-label="Close tweaks"
            style={{
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--ink-3)',
              width: 24,
              height: 24,
            }}
          >
            ×
          </button>
        </header>

        <Section label="Appearance" />
        <Radio
          label="Theme"
          value={theme}
          options={['light', 'dark']}
          onChange={(v) => setTheme(v as Theme)}
        />
        <Radio
          label="Density"
          value={density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setDensity(v as Density)}
        />

        <Section label="Accent" />
        <div style={{ display: 'flex', gap: 6, padding: '4px 0' }}>
          {ACCENT_PRESETS.map((a) => (
            <button
              key={a.name}
              onClick={() => setAccent(a.v)}
              title={a.name}
              aria-label={`Accent ${a.name}`}
              aria-pressed={accent === a.v}
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: a.v,
                border:
                  accent === a.v
                    ? '2px solid var(--ink)'
                    : '2px solid transparent',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)',
              }}
            />
          ))}
        </div>

        <Section label="Layout" />
        <Toggle
          label="Collapse sidebar"
          value={sidebarCollapsed}
          onChange={setSidebarCollapsed}
        />
        <Toggle
          label="Collapse right rail"
          value={railCollapsed}
          onChange={setRailCollapsed}
        />
      </aside>
    </>
  );
}

function Section({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        margin: '12px 0 6px',
      }}
    >
      {label}
    </div>
  );
}

interface RadioProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}

function Radio({ label, value, options, onChange }: RadioProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        style={{
          display: 'flex',
          padding: 2,
          borderRadius: 8,
          background: 'var(--bg-sunken)',
          gap: 2,
        }}
      >
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <button
              key={opt}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt)}
              style={{
                flex: 1,
                border: 0,
                background: selected ? 'var(--panel)' : 'transparent',
                color: selected ? 'var(--ink)' : 'var(--ink-3)',
                fontWeight: selected ? 600 : 500,
                height: 26,
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: selected ? 'var(--shadow-sm)' : 'none',
                fontSize: 12,
                textTransform: 'capitalize',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, value, onChange }: ToggleProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--ink-2)' }}>{label}</span>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          position: 'relative',
          width: 32,
          height: 18,
          border: 0,
          borderRadius: 999,
          background: value ? 'var(--accent)' : 'var(--line-strong)',
          padding: 0,
          cursor: 'pointer',
          transition: 'background 120ms ease-out',
        }}
      >
        <i
          style={{
            position: 'absolute',
            top: 2,
            left: 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            transform: value ? 'translateX(14px)' : 'translateX(0)',
            transition: 'transform 120ms ease-out',
          }}
        />
      </button>
    </div>
  );
}
