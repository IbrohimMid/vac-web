import type { AvailableAgent } from '../../transport';

export function pickAssessmentAgentId(agents: AvailableAgent[]): string {
  const installedAcp = agents.find((agent) => agent.kind === 'acp' && agent.installed !== false);
  if (installedAcp) return installedAcp.id;

  const registryDefault = agents.find((agent) => agent.default);
  if (registryDefault) return registryDefault.id;

  return agents[0]?.id ?? '';
}

export function describeAssessmentAgent(agent: AvailableAgent): string {
  const parts = [agent.label, `kind: ${agent.kind}`];
  if (agent.default) parts.push('default');
  if (agent.installed === false) parts.push('not installed');
  return parts.join(' · ');
}
