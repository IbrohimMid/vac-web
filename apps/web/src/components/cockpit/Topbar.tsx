// Topbar — brand + gate ribbon + search trigger + theme + notifications + tweaks.
// Gates come from useGates (real store); GATE_ORDER + visual states match
// docs/gates.md. ⌘K and tweaks button are handled by parent (callbacks).

import { useCockpit } from '../../stores/cockpit';
import { authMethodSummary } from '../../domain/sessions/auth';
import { GATE_ORDER, useGates, type GateState } from '../../stores/gates';
import { useSession } from '../../stores/session';
import { Avatar, Icon } from './primitives';

interface Props {
  onCmdK: () => void;
  onTweaks: () => void;
}

const STATE_TO_DOT: Record<GateState, 'ok' | 'warn' | 'crit' | 'idle'> = {
  pass: 'ok',
  open: 'warn',
  fail: 'crit',
};

export function Topbar({ onCmdK, onTweaks }: Props) {
  const theme = useCockpit((s) => s.theme);
  const setTheme = useCockpit((s) => s.setTheme);
  const project = useSession((s) => s.projectRoot ?? 'no project');
  const agentKind = useSession((s) => s.agentKind);
  const authMethods = useSession((s) => s.authMethods);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">V</div>
        <span className="brand-name">VAC</span>
        <span className="brand-sep">/</span>
        <span className="brand-project">{project}</span>
        {agentKind === 'acp' && (
          <span
            className="badge warn"
            style={{ padding: '1px 6px', fontSize: 10.5, marginLeft: 4 }}
            title={authMethods.map((m) => `${m.name} (${m.type})`).join(' · ') || 'ACP auth'}
          >
            ACP auth: {authMethodSummary(authMethods)}
          </span>
        )}
        <Icon
          name="chevron-d"
          size={13}
          style={{ color: 'var(--ink-4)', marginLeft: 2 }}
        />
      </div>
      <div className="topbar-divider"></div>
      <GateRibbon />
      <div className="topbar-spacer"></div>
      <button className="search-trigger" onClick={onCmdK} aria-label="Search">
        <Icon name="search" size={14} />
        <span>Search, run, navigate…</span>
        <span className="kbd">
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      <button
        className="icon-btn"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title="Toggle theme"
        aria-label="Toggle theme"
      >
        <Icon name={theme === 'dark' ? 'circle-half' : 'circle'} size={15} />
      </button>
      <button className="icon-btn" title="Notifications" aria-label="Notifications">
        <Icon name="bell" size={15} />
      </button>
      <button
        className="icon-btn"
        onClick={onTweaks}
        title="Tweaks"
        aria-label="Tweaks"
      >
        <Icon name="settings" size={15} />
      </button>
      <Avatar name="Asa" />
    </header>
  );
}

function GateRibbon() {
  const gates = useGates((s) => s.gates);
  const activeId = useCockpit((s) => s.activeGateId);
  const setActive = useCockpit((s) => s.setActiveGate);
  const ordered = GATE_ORDER.map((id) => gates.get(id)).filter(
    (g): g is NonNullable<ReturnType<typeof gates.get>> => g !== undefined,
  );
  if (ordered.length === 0) {
    // Empty-state pill so the topbar doesn't collapse — gates populate after
    // first assessment run.
    return (
      <div className="gate-ribbon" aria-label="Gate ribbon">
        <div className="gate-pill" style={{ opacity: 0.7 }}>
          <span className="dot idle"></span>
          <span>No gates yet</span>
        </div>
      </div>
    );
  }
  return (
    <div className="gate-ribbon" aria-label="Gate ribbon">
      {ordered.map((g) => (
        <div
          key={g.id}
          className={`gate-pill ${activeId === g.id ? 'active' : ''}`}
          onClick={() => setActive(activeId === g.id ? null : g.id)}
          title={g.summary}
          role="button"
          tabIndex={0}
          aria-pressed={activeId === g.id}
        >
          <span className={`dot ${STATE_TO_DOT[g.state]}`}></span>
          <span>{g.id}</span>
        </div>
      ))}
    </div>
  );
}
