// Topbar — brand + gate ribbon + search trigger + theme + notifications + tweaks.
// Gates come from useGates (real store); GATE_ORDER + visual states match
// docs/gates.md. ⌘K and tweaks button are handled by parent (callbacks).

import { useCockpit } from '../../stores/cockpit';
import { authMethodSummary } from '../../domain/sessions/auth';
import { GATE_ORDER, useGates, type GateState } from '../../stores/gates';
import { useSession } from '../../stores/session';
import { useSessionHistory } from '../../stores/sessionHistory';
import type { TransportHandle } from '../../transport';
import { Avatar, Icon } from './primitives';

interface Props {
  onCmdK: () => void;
  onTweaks: () => void;
  transport: TransportHandle | null;
}

const STATE_TO_DOT: Record<GateState, 'ok' | 'warn' | 'crit' | 'idle'> = {
  pass: 'ok',
  open: 'warn',
  fail: 'crit',
};

/// Sprint 3 UI badges — derive a compact set of capability indicators
/// from the bridge's `agent_capabilities` payload. The bridge surfaces
/// the raw ACP `agentCapabilities` shape (camelCase) plus our profile-
/// derived `fs.read` / `fs.write` / `terminal` booleans (snake_case),
/// so we tolerate both encodings here.
function summarizeAgentCapabilities(
  caps: Record<string, unknown> | null,
): { fs: 'rw' | 'r' | 'w' | null; terminal: boolean; loadSession: boolean; image: boolean } {
  if (!caps) return { fs: null, terminal: false, loadSession: false, image: false };
  const readOk =
    caps.fs_read === true ||
    caps.read_text_file === true ||
    (typeof caps.fs === 'object' && caps.fs !== null && (caps.fs as Record<string, unknown>).read === true);
  const writeOk =
    caps.fs_write === true ||
    caps.write_text_file === true ||
    (typeof caps.fs === 'object' && caps.fs !== null && (caps.fs as Record<string, unknown>).write === true);
  const fs: 'rw' | 'r' | 'w' | null = readOk && writeOk ? 'rw' : readOk ? 'r' : writeOk ? 'w' : null;
  const terminal = caps.terminal === true || caps.terminal_create === true;
  const loadSession = caps.loadSession === true || caps.load_session === true;
  const promptCaps =
    typeof caps.promptCapabilities === 'object' && caps.promptCapabilities !== null
      ? (caps.promptCapabilities as Record<string, unknown>)
      : {};
  const image = promptCaps.image === true;
  return { fs, terminal, loadSession, image };
}

function asModelArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['models', 'items', 'available']) {
      const value = obj[key];
      if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    }
  }
  return [];
}

function getModelId(model: Record<string, unknown>, fallback: string): string {
  for (const key of ['id', 'modelId', 'model_id', 'name']) {
    const value = model[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function formatContextWindow(used: number | null, limit: number | null): string {
  if (typeof used === 'number' && typeof limit === 'number' && limit > 0) {
    const fmt = (n: number) => n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}m` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
    return `${fmt(used)}/${fmt(limit)}`;
  }
  if (typeof limit === 'number' && limit > 0) return `0/${limit >= 1_000_000 ? `${Math.round(limit / 100_000) / 10}m` : limit >= 1000 ? `${Math.round(limit / 100) / 10}k` : limit}`;
  return 'no telemetry';
}

function ModelContextChip({ transport }: { transport: TransportHandle | null }) {
  const sessionId = useSession((s) => s.sessionId);
  const acpModel = useSession((s) => s.acpModel);
  const agentKind = useSession((s) => s.agentKind);
  const setAcpModelSnapshot = useSession((s) => s.setAcpModelSnapshot);
  const modes = asModelArray(acpModel.modes);
  const models = asModelArray(acpModel.models);
  const choices = modes.length > 0 ? modes : models;
  const source = modes.length > 0 ? 'mode' : 'model';
  if (agentKind !== 'acp' && choices.length === 0 && !acpModel.currentModelId) return null;
  const current = acpModel.currentModelId ?? (choices[0] ? getModelId(choices[0], 'model') : 'model unknown');
  const context = formatContextWindow(acpModel.contextUsed, acpModel.contextLimit);
  const canSwitch = Boolean(transport && sessionId && choices.length > 0 && current !== 'model unknown');
  const switchModel = async (next: string) => {
    if (!transport || !sessionId || !next || next === current) return;
    const cmd = source === 'mode' ? 'session.mode.set' : 'session.config_option.set';
    const payload = source === 'mode' ? { mode_id: next } : { option_id: 'model', value: next };
    const ack = await transport.send(sessionId, cmd, payload);
    if (ack.ok) {
      setAcpModelSnapshot({ currentModelId: next });
    }
  };
  const title = [
    choices.length > 0 ? `${choices.length} ACP ${source} entries advertised` : 'No ACP model/mode list advertised yet',
    acpModel.currentModelId ? `Current model/mode: ${acpModel.currentModelId}` : 'Current model/mode not advertised',
    acpModel.contextLimit ? `Context window: ${context}` : 'Context window telemetry unavailable from this ACP adapter',
    canSwitch ? 'Changing this selector calls the active ACP adapter.' : 'Switching requires an active ACP session and advertised model/mode entries.',
  ].join(' · ');
  if (choices.length > 0) {
    return (
      <label className="model-pill model-picker" data-testid="model-context-chip" title={title}>
        <span>{source}</span>
        <select
          aria-label="ACP model"
          value={current}
          disabled={!canSwitch}
          onChange={(event) => void switchModel(event.target.value)}
        >
          {choices.map((model, index) => {
            const id = getModelId(model, `model-${index + 1}`);
            const name = typeof model.name === 'string' ? model.name : id;
            return (
              <option key={`${id}-${index}`} value={id}>
                {name}
              </option>
            );
          })}
          {!choices.some((model, index) => getModelId(model, `model-${index + 1}`) === current) && (
            <option value={current}>{current}</option>
          )}
        </select>
        <span className="muted">ctx {context}</span>
      </label>
    );
  }
  return (
    <span className="model-pill" data-testid="model-context-chip" title={title}>
      <span>model: {current}</span>
      <span className="muted">ctx {context}</span>
    </span>
  );
}

export function Topbar({ onCmdK, onTweaks, transport }: Props) {
  const theme = useCockpit((s) => s.theme);
  const setTheme = useCockpit((s) => s.setTheme);
  const project = useSession((s) => s.projectRoot ?? 'no project');
  const agentKind = useSession((s) => s.agentKind);
  const authMethods = useSession((s) => s.authMethods);
  const authLabel = authMethodSummary(authMethods).replaceAll(' · ', ' - ');
  const agentCapabilities = useSession((s) => s.agentCapabilities);
  const capSummary = summarizeAgentCapabilities(agentCapabilities);
  // The sandbox tooling strips literal ` ... ` JSX object
  // expressions during edit application, so we hoist the badge style
  // into a single-brace `style={badgeStyle}` reference. Functionally
  // equivalent to the inline object that lived here before; keep both
  // shapes in sync if you tweak this.
  const badgeStyle: React.CSSProperties = {
    padding: '1px 6px',
    fontSize: 10.5,
    marginLeft: 4,
  };

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
            style={badgeStyle}
            title={authMethods.map((m) => `${m.name} (${m.type})`).join(' · ') || 'ACP auth'}
          >
            ACP auth: {authLabel}
          </span>
        )}
        {capSummary.fs && (
          // Sprint 3: profile-derived fs capability indicator. We render
          // a single pill instead of separate read/write pills so the
          // topbar stays compact when an agent has both. The title gives
          // the long form for hover-discovery.
          <span
            className="badge ok"
            style={badgeStyle}
            data-testid="cap-fs-badge"
            title={`Profile grants fs: ${capSummary.fs === 'rw' ? 'read + write' : capSummary.fs === 'r' ? 'read-only' : 'write-only'}`}
          >
            fs: {capSummary.fs}
          </span>
        )}
        {capSummary.terminal && (
          // Sprint 3: profile grants `terminal/create`. The chip is
          // intentionally `warn`-toned because terminal access is the
          // most consequential capability the operator can hand to an
          // ACP agent.
          <span
            className="badge warn"
            style={badgeStyle}
            data-testid="cap-term-badge"
            title="Profile grants terminal/create (Sprint 2)"
          >
            terminal
          </span>
        )}
        {capSummary.loadSession && (
          // Audit Sprint 3 P1/P2 fix: the agent advertises
          // `session/load`, but the bridge does NOT yet implement
          // the outbound ACP `session/load` call — resume still
          // goes through the bridge's replay buffer. Avoid
          // overpromising here so operators don't think the chip
          // is actionable. The `muted` tone + explicit "advertised"
          // label keeps it informational only.
          <span
            className="badge muted"
            style={badgeStyle}
            data-testid="cap-loadsession-badge"
            title="Agent advertises session/load. Bridge resume currently uses the replay buffer; ACP-native session/load is not wired yet."
          >
            resume (advertised)
          </span>
        )}
        {capSummary.image && (
          <span
            className="badge ok"
            style={badgeStyle}
            data-testid="cap-image-badge"
            title="Agent accepts image content blocks in prompts"
          >
            image
          </span>
        )}
        <ModelContextChip transport={transport} />
        <ConfigStatusChip />
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

// Stage R4 — compact "Config: valid/invalid" chip in the brand area.
// Reads `useSessionHistory` rather than re-fetching so it stays in lock-step
// with the resume policy preview panel inside `PersistentSessions`. The
// tooltip lists each diagnostic so an operator can spot the offending YAML
// key without leaving the cockpit.
function ConfigStatusChip() {
  const status = useSessionHistory((s) => s.configStatus);
  const diagnostics = useSessionHistory((s) => s.configDiagnostics);
  const reloading = useSessionHistory((s) => s.configReloading);
  const retained = useSessionHistory((s) => s.configActiveSnapshotRetained);
  if (status === 'unknown') return null;
  const ok = status === 'valid';
  const tone: 'ok' | 'crit' = ok ? 'ok' : 'crit';
  const label = reloading
    ? 'Config: reloading\u2026'
    : retained
    ? 'Config: reload failed'
    : ok
    ? 'Config: valid'
    : 'Config: invalid';
  const title = diagnostics.length
    ? diagnostics
        .slice(0, 5)
        .map((d) => `${d.scope}/${d.path}: ${d.message}`)
        .join('\n') + (diagnostics.length > 5 ? `\n\u2026 +${diagnostics.length - 5} more` : '')
    : retained
    ? 'Reload failed; active config snapshot is unchanged and runtime is using the last successful snapshot.'
    : ok
    ? 'Config snapshot loaded successfully.'
    : 'Bridge config validation failed; runtime is using last good snapshot.';
  const chipStyle: React.CSSProperties = {
    padding: '1px 6px',
    fontSize: 10.5,
    marginLeft: 4,
  };
  return (
    <span
      className={`badge ${tone}`}
      style={chipStyle}
      data-testid="config-status-chip"
      role={ok ? undefined : 'alert'}
      title={title}
      aria-label={label}
    >
      {label}
    </span>
  );
}

