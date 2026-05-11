export interface AgentPrMetadata {
  branch: string | null;
  pullRequestUrl: string | null;
}

function readString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function gitMetadataFromAgentInfo(agentInfo: Record<string, unknown> | null): AgentPrMetadata {
  const git = agentInfo?.git && typeof agentInfo.git === 'object' && !Array.isArray(agentInfo.git)
    ? agentInfo.git as Record<string, unknown>
    : null;
  return {
    branch: readString(git, ['branch', 'currentBranch', 'current_branch'])
      ?? readString(agentInfo, ['branch', 'currentBranch', 'current_branch']),
    pullRequestUrl: readString(git, ['pullRequestUrl', 'pull_request_url', 'prUrl', 'pr_url'])
      ?? readString(agentInfo, ['pullRequestUrl', 'pull_request_url', 'prUrl', 'pr_url']),
  };
}

export function AgentPrSurface({ metadata }: { metadata: AgentPrMetadata }) {
  const canOpenPr = Boolean(metadata.pullRequestUrl);
  return (
    <div className="agent-pr-surface" data-testid="agent-pr-surface" aria-label="Branch and PR actions">
      <span className="agent-branch-pill" data-testid="agent-branch-pill">
        ⎇ {metadata.branch ?? 'branch unavailable'}
      </span>
      <button
        type="button"
        className="agent-action agent-pr-button"
        disabled={!canOpenPr}
        onClick={() => {
          if (metadata.pullRequestUrl) window.open(metadata.pullRequestUrl, '_blank', 'noopener,noreferrer');
        }}
        title={
          canOpenPr
            ? 'Open the pull request for this agent run'
            : 'PR metadata is not available from the bridge yet; no fake PR is generated.'
        }
      >
        AI Create PR
      </button>
    </div>
  );
}
