import type { AgentPlan, AgentTextBlock, AgentToolCall, AgentTurn } from '../../stores/agentSession';
import { groupAgentTools, summarizeToolGroups, type AgentToolGroup } from './toolGrouping';

export type AgentTurnTraceEntryKind = 'thought' | 'assistant' | 'plan' | 'tool';

export interface AgentTurnTraceEntry {
  kind: AgentTurnTraceEntryKind;
  key: string;
  sortAt: string;
  label: string;
}

export interface AgentTurnComposition {
  reasoning: AgentTextBlock[];
  finalAnswers: AgentTextBlock[];
  topLevelTools: AgentToolCall[];
  childrenByParent: Map<string, AgentToolCall[]>;
  toolGroups: AgentToolGroup[];
  toolSummary: string;
  rawTimeline: AgentTurnTraceEntry[];
}

function present<T>(value: T | null | undefined): value is T {
  return value != null;
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
    rawTimeline,
  };
}
