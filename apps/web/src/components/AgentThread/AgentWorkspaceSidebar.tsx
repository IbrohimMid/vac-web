import type { AgentTurn } from '../../stores/agentSession';
import type { AcpModelSummary } from '../../stores/session';
import type { AgentTurnComposition } from './turnComposition';

type SidebarTurn = {
  turn: AgentTurn;
  composition: AgentTurnComposition;
};

function truncate(text: string | null, max = 54): string {
  if (!text) return 'Agent turn';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function percent(used: number | null, limit: number | null): number | null {
  if (used == null || limit == null || limit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

function compactNumber(value: number | null): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

export function AgentWorkspaceSidebar({
  turns,
  acpModel,
}: {
  turns: SidebarTurn[];
  acpModel: AcpModelSummary;
}) {
  if (turns.length === 0 && !acpModel.contextUsed && !acpModel.contextLimit) return null;
  const contextPercent = percent(acpModel.contextUsed, acpModel.contextLimit);
  const totals = turns.reduce(
    (acc, item) => {
      acc.files += item.composition.contextStats.files;
      acc.skills += item.composition.contextStats.skills;
      acc.other += item.composition.contextStats.other;
      return acc;
    },
    { files: 0, skills: 0, other: 0 },
  );
  return (
    <aside className="agent-workspace-sidebar" data-testid="agent-workspace-sidebar" aria-label="Agent workspace sidebar">
      <section className="agent-sidebar-section" aria-label="Todo">
        <div className="agent-sidebar-title">Todo</div>
        <ol className="agent-sidebar-todos">
          {turns.map((item, index) => (
            <li key={item.turn.id} className={`agent-sidebar-todo ${item.turn.status}`}>
              <span className="agent-sidebar-check" aria-hidden="true">✓</span>
              <span>{`Task ${index + 1}: ${truncate(item.turn.userText)}`}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="agent-sidebar-section" aria-label="Context">
        <div className="agent-sidebar-title">
          <span>Context</span>
          <span className="agent-sidebar-pill">compact</span>
        </div>
        <div className="agent-context-meter" data-testid="agent-context-meter">
          <div className="agent-context-track" aria-hidden="true">
            <div className="agent-context-fill" style={{ width: `${contextPercent ?? 0}%` }} />
          </div>
          <span>{contextPercent == null ? 'unavailable' : `${contextPercent}%`}</span>
        </div>
        <div className="agent-context-detail">
          ctx {compactNumber(acpModel.contextUsed)}/{compactNumber(acpModel.contextLimit)}
        </div>
        <div className="agent-context-chips" aria-label="Context sources">
          <span><strong>{totals.skills}</strong> Skills</span>
          <span><strong>{totals.files}</strong> Files</span>
          <span><strong>{totals.other}</strong> Other</span>
        </div>
      </section>
    </aside>
  );
}
