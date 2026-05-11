import type { ReactNode } from 'react';
import type { AgentToolCall } from '../../stores/agentSession';
import type { AgentToolGroup } from './toolGrouping';

export function ToolActivitySection({
  groups,
  summary,
  activitySummary,
  subagentLabels,
  renderTool,
}: {
  groups: AgentToolGroup[];
  summary: string;
  activitySummary: string;
  subagentLabels: string[];
  renderTool: (tool: AgentToolCall) => ReactNode;
}) {
  if (groups.length === 0) return null;
  const hasOpenSignal = groups.some((group) => group.defaultOpen);
  return (
    <details className="agent-card tool-activity" data-testid="agent-tool-activity-section" open={hasOpenSignal || undefined}>
      <summary className="agent-card-title">
        <span>Tool activity</span>
        <span className="agent-card-meta">{summary}</span>
      </summary>
      <div className="agent-activity-sentence" data-testid="agent-activity-summary">{activitySummary}</div>
      {subagentLabels.length > 0 && (
        <div className="agent-subagent-headline" data-testid="agent-subagent-headline">
          <span className="agent-subagent-icon" aria-hidden="true">✦</span>
          <span>Sub Coding Agent</span>
          <span className="agent-card-meta">{subagentLabels.join(', ')}</span>
        </div>
      )}
      <div className="agent-tool-groups">
        {groups.map((group) => (
          <details
            key={group.id}
            className={`agent-tool-group ${group.hasFailed ? 'failed' : group.hasActive ? 'active' : ''}`}
            data-testid={`agent-tool-group-${group.id}`}
            open={group.defaultOpen || undefined}
          >
            <summary>
              <span>{group.label}</span>
              <span className="agent-card-meta">
                {group.count} {group.count === 1 ? 'tool' : 'tools'}
                {group.hasFailed ? ' · needs attention' : group.hasActive ? ' · running' : ' · collapsed'}
              </span>
            </summary>
            <div className="agent-tool-group-body">
              {group.tools.map((tool) => renderTool(tool))}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
