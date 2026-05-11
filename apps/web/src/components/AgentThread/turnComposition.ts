import type { AgentPlan, AgentTextBlock, AgentToolCall, AgentTurn } from '../../stores/agentSession';
import { groupAgentTools, summarizeToolGroups, type AgentToolGroup } from './toolGrouping';

export type AgentTurnTraceEntryKind = 'thought' | 'assistant' | 'plan' | 'tool';

export interface AgentTurnTraceEntry {
  kind: AgentTurnTraceEntryKind;
  key: string;
  sortAt: string;
  label: string;
}

export interface AgentActivityCounts {
  created: number;
  edited: number;
  read: number;
  browsed: number;
  searched: number;
  ran: number;
  delegated: number;
}

export interface AgentContextStats {
  files: number;
  skills: number;
  other: number;
}

export interface AgentTurnComposition {
  reasoning: AgentTextBlock[];
  finalAnswers: AgentTextBlock[];
  topLevelTools: AgentToolCall[];
  childrenByParent: Map<string, AgentToolCall[]>;
  toolGroups: AgentToolGroup[];
  toolSummary: string;
  activityCounts: AgentActivityCounts;
  activitySummary: string;
  contextStats: AgentContextStats;
  subagentLabels: string[];
  rawTimeline: AgentTurnTraceEntry[];
}

function present<T>(value: T | null | undefined): value is T {
  return value != null;
}

function rawInputRecord(tool: AgentToolCall): Record<string, unknown> | null {
  return tool.rawInput && typeof tool.rawInput === 'object' && !Array.isArray(tool.rawInput)
    ? tool.rawInput as Record<string, unknown>
    : null;
}

function toolPath(tool: AgentToolCall): string | null {
  const firstLocation = tool.locations[0]?.path;
  if (firstLocation) return firstLocation;
  const raw = rawInputRecord(tool);
  const path = raw?.path ?? raw?.filePath ?? raw?.file_path ?? raw?.directory;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

function isCreateEdit(tool: AgentToolCall): boolean {
  const title = tool.title?.toLowerCase() ?? '';
  const raw = rawInputRecord(tool);
  return title.includes('create') || Boolean(raw?.mkdirp) || Boolean(raw?.create);
}

function buildActivityCounts(groups: AgentToolGroup[]): AgentActivityCounts {
  const counts: AgentActivityCounts = { created: 0, edited: 0, read: 0, browsed: 0, searched: 0, ran: 0, delegated: 0 };
  for (const group of groups) {
    if (group.id === 'search') counts.searched += group.count;
    if (group.id === 'read') counts.read += group.count;
    if (group.id === 'command') counts.ran += group.count;
    if (group.id === 'browser') counts.browsed += group.count;
    if (group.id === 'subagent') counts.delegated += group.count;
    if (group.id === 'edit') {
      counts.created += group.tools.filter(isCreateEdit).length;
      counts.edited += group.tools.filter((tool) => !isCreateEdit(tool)).length;
    }
  }
  return counts;
}

function summarizeActivity(counts: AgentActivityCounts): string {
  const parts = [
    ['Created', counts.created, 'files'],
    ['Edited', counts.edited, 'files'],
    ['Read', counts.read, 'files'],
    ['Browsed', counts.browsed, 'sources'],
    ['Searched', counts.searched, 'times'],
    ['Ran', counts.ran, 'commands'],
    ['Delegated', counts.delegated, 'sub-agents'],
  ] as const;
  const nonZero = parts.filter(([, count]) => count > 0);
  if (nonZero.length === 0) return 'No tool activity yet';
  return nonZero.map(([label, count, noun]) => `${label} ${count} ${noun}`).join(', ');
}

function buildContextStats(tools: AgentToolCall[]): AgentContextStats {
  const files = new Set<string>();
  let skills = 0;
  let other = 0;
  for (const tool of tools) {
    const path = toolPath(tool);
    if (path) files.add(path);
    const title = tool.title?.toLowerCase() ?? '';
    if (title.includes('skill')) skills += 1;
    if (!path && !title.includes('skill')) other += 1;
  }
  return { files: files.size, skills, other };
}

function subagentLabels(tools: AgentToolCall[]): string[] {
  const labels = new Set<string>();
  for (const tool of tools) {
    if (tool.subagentType) labels.add(tool.subagentType);
  }
  return [...labels];
}

export function composeAgentTurn(args: {
  turn: AgentTurn;
  assistants: Array<AgentTextBlock | null | undefined>;
  thoughts: Array<AgentTextBlock | null | undefined>;
  tools: Array<AgentToolCall | null | undefined>;
  plan: AgentPlan | null | undefined;
}): AgentTurnComposition {
  const reasoning = args.thoughts.filter(present);
  const finalAnswers = args.assistants.filter(present);
  const tools = args.tools.filter(present);

  const toolByCallId = new Map<string, AgentToolCall>();
  for (const tool of tools) toolByCallId.set(tool.toolCallId, tool);

  const childrenByParent = new Map<string, AgentToolCall[]>();
  for (const tool of tools) {
    if (!tool.parentToolCallId) continue;
    const children = childrenByParent.get(tool.parentToolCallId) ?? [];
    children.push(tool);
    childrenByParent.set(tool.parentToolCallId, children);
  }

  const topLevelTools = tools.filter((tool) => !tool.parentToolCallId || !toolByCallId.has(tool.parentToolCallId));
  const toolGroups = groupAgentTools(topLevelTools);
  const activityCounts = buildActivityCounts(toolGroups);

  const rawTimeline: AgentTurnTraceEntry[] = [
    ...reasoning.map((thought) => ({
      kind: 'thought' as const,
      key: `thought:${thought.id}`,
      sortAt: thought.createdAt,
      label: 'Reasoning',
    })),
    ...finalAnswers.map((assistant) => ({
      kind: 'assistant' as const,
      key: `assistant:${assistant.id}`,
      sortAt: assistant.createdAt,
      label: 'Assistant response',
    })),
    ...(args.plan ? [{
      kind: 'plan' as const,
      key: `plan:${args.plan.id}`,
      sortAt: args.plan.updatedAt,
      label: 'Plan',
    }] : []),
    ...topLevelTools.map((tool) => ({
      kind: 'tool' as const,
      key: `tool:${tool.id}`,
      sortAt: tool.createdAt ?? tool.updatedAt,
      label: tool.title ?? tool.kind,
    })),
  ].sort((a, b) => (a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : 0));

  return {
    reasoning,
    finalAnswers,
    topLevelTools,
    childrenByParent,
    toolGroups,
    toolSummary: summarizeToolGroups(toolGroups),
    activityCounts,
    activitySummary: summarizeActivity(activityCounts),
    contextStats: buildContextStats(tools),
    subagentLabels: subagentLabels(tools),
    rawTimeline,
  };
}
