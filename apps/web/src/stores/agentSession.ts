import { create } from 'zustand';

export type AgentToolKind = 'read' | 'edit' | 'execute' | 'other';
export type AgentToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export type AgentThreadItemKind = 'assistant' | 'thought' | 'tool' | 'plan';

export interface AgentLocation {
  path: string;
  line?: number | null;
}

export interface AgentDiff {
  path: string;
  old_text?: string | null;
  new_text?: string | null;
}

export interface AgentTextBlock {
  id: string;
  sessionId: string;
  kind: 'assistant' | 'thought';
  content: string;
  createdAt: string;
}

export interface AgentToolCall {
  id: string;
  sessionId: string;
  toolCallId: string;
  kind: AgentToolKind;
  title: string | null;
  status: AgentToolStatus;
  locations: AgentLocation[];
  agentId: string | null;
  agentKind: string | null;
  approvedByApprovalId: string | null;
  updatedAt: string;
}

export interface AgentDiffUpdate {
  id: string;
  sessionId: string;
  toolCallId: string;
  status: AgentToolStatus;
  locations: AgentLocation[];
  diffs: AgentDiff[];
  approvedByApprovalId: string | null;
  updatedAt: string;
}

export interface AgentTerminalUpdate {
  id: string;
  sessionId: string;
  toolCallId: string;
  status: AgentToolStatus;
  rawInputRedacted: unknown;
  rawOutputRedacted: string | null;
  approvedByApprovalId: string | null;
  agentId: string | null;
  agentKind: string | null;
  updatedAt: string;
}

export interface AgentPlanEntry {
  id: string;
  title: string;
  status: PlanStatus;
}

export interface AgentPlan {
  id: string;
  sessionId: string;
  entries: AgentPlanEntry[];
  updatedAt: string;
}

export interface AgentThreadItem {
  id: string;
  sessionId: string;
  kind: AgentThreadItemKind;
  refId: string;
  createdAt: string;
}

interface AgentSessionSlice {
  assistants: Map<string, AgentTextBlock>;
  thoughts: Map<string, AgentTextBlock>;
  activeTextIds: Map<string, string>;
  textCounters: Map<string, number>;
  tools: Map<string, AgentToolCall>;
  diffs: Map<string, AgentDiffUpdate>;
  terminals: Map<string, AgentTerminalUpdate>;
  plans: Map<string, AgentPlan>;
  items: Map<string, AgentThreadItem>;
  order: string[];

  appendAssistantDelta(sessionId: string, delta: string, at?: string): void;
  appendThoughtDelta(sessionId: string, delta: string, at?: string): void;
  completeTextBlocks(sessionId: string): void;
  upsertToolCall(tool: Omit<AgentToolCall, 'id'>): void;
  upsertDiff(diff: Omit<AgentDiffUpdate, 'id'>): void;
  upsertTerminal(terminal: Omit<AgentTerminalUpdate, 'id'>): void;
  updatePlan(plan: Omit<AgentPlan, 'id'>): void;
  clearSession(sessionId: string): void;
  clear(): void;
}

const CAP = 500;

export function agentTextKey(sessionId: string, kind: 'assistant' | 'thought', index = 1): string {
  return `${sessionId}\x00${kind}\x00${index}`;
}

function agentTextBaseKey(sessionId: string, kind: 'assistant' | 'thought'): string {
  return `${sessionId}\x00${kind}`;
}

function nextTextId(
  sessionId: string,
  kind: 'assistant' | 'thought',
  activeTextIds: Map<string, string>,
  textCounters: Map<string, number>,
): { id: string; activeTextIds: Map<string, string>; textCounters: Map<string, number> } {
  const base = agentTextBaseKey(sessionId, kind);
  const active = activeTextIds.get(base);
  if (active) return { id: active, activeTextIds, textCounters };

  const nextCounters = new Map(textCounters);
  const index = (nextCounters.get(base) ?? 0) + 1;
  nextCounters.set(base, index);

  const id = agentTextKey(sessionId, kind, index);
  const nextActive = new Map(activeTextIds);
  nextActive.set(base, id);
  return { id, activeTextIds: nextActive, textCounters: nextCounters };
}

export function agentToolKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\x00tool\x00${toolCallId}`;
}

export function agentDiffKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\x00diff\x00${toolCallId}`;
}

export function agentTerminalKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\x00terminal\x00${toolCallId}`;
}

export function agentPlanKey(sessionId: string): string {
  return `${sessionId}\x00plan`;
}

function appendOrder(
  items: Map<string, AgentThreadItem>,
  order: string[],
  item: AgentThreadItem,
): { items: Map<string, AgentThreadItem>; order: string[] } {
  const nextItems = new Map(items);
  const nextOrder = nextItems.has(item.id) ? order : [...order, item.id];
  nextItems.set(item.id, item);
  if (nextOrder.length <= CAP) return { items: nextItems, order: nextOrder };

  const cappedOrder = nextOrder.slice(nextOrder.length - CAP);
  const cappedItems = new Map<string, AgentThreadItem>();
  for (const id of cappedOrder) {
    const existing = nextItems.get(id);
    if (existing) cappedItems.set(id, existing);
  }
  return { items: cappedItems, order: cappedOrder };
}

export const useAgentSession = create<AgentSessionSlice>((set) => ({
  assistants: new Map(),
  thoughts: new Map(),
  activeTextIds: new Map(),
  textCounters: new Map(),
  tools: new Map(),
  diffs: new Map(),
  terminals: new Map(),
  plans: new Map(),
  items: new Map(),
  order: [],

  appendAssistantDelta(sessionId, delta, at = new Date().toISOString()) {
    if (!delta) return;
    set((s) => {
      const text = nextTextId(sessionId, 'assistant', s.activeTextIds, s.textCounters);
      const id = text.id;
      const prev = s.assistants.get(id);
      const block: AgentTextBlock = {
        id,
        sessionId,
        kind: 'assistant',
        content: (prev?.content ?? '') + delta,
        createdAt: prev?.createdAt ?? at,
      };
      const assistants = new Map(s.assistants);
      assistants.set(id, block);
      const itemResult = appendOrder(s.items, s.order, {
        id,
        sessionId,
        kind: 'assistant',
        refId: id,
        createdAt: block.createdAt,
      });
      return {
        assistants,
        activeTextIds: text.activeTextIds,
        textCounters: text.textCounters,
        items: itemResult.items,
        order: itemResult.order,
      };
    });
  },

  appendThoughtDelta(sessionId, delta, at = new Date().toISOString()) {
    if (!delta) return;
    set((s) => {
      const text = nextTextId(sessionId, 'thought', s.activeTextIds, s.textCounters);
      const id = text.id;
      const prev = s.thoughts.get(id);
      const block: AgentTextBlock = {
        id,
        sessionId,
        kind: 'thought',
        content: (prev?.content ?? '') + delta,
        createdAt: prev?.createdAt ?? at,
      };
      const thoughts = new Map(s.thoughts);
      thoughts.set(id, block);
      const itemResult = appendOrder(s.items, s.order, {
        id,
        sessionId,
        kind: 'thought',
        refId: id,
        createdAt: block.createdAt,
      });
      return {
        thoughts,
        activeTextIds: text.activeTextIds,
        textCounters: text.textCounters,
        items: itemResult.items,
        order: itemResult.order,
      };
    });
  },

  completeTextBlocks(sessionId) {
    set((s) => {
      const activeTextIds = new Map(s.activeTextIds);
      activeTextIds.delete(agentTextBaseKey(sessionId, 'assistant'));
      activeTextIds.delete(agentTextBaseKey(sessionId, 'thought'));
      return { activeTextIds };
    });
  },

  upsertToolCall(tool) {
    set((s) => {
      const id = agentToolKey(tool.sessionId, tool.toolCallId);
      const tools = new Map(s.tools);
      const existing = tools.get(id);
      tools.set(id, { ...existing, ...tool, id });
      const itemResult = appendOrder(s.items, s.order, {
        id,
        sessionId: tool.sessionId,
        kind: 'tool',
        refId: id,
        createdAt: existing?.updatedAt ?? tool.updatedAt,
      });
      return { tools, items: itemResult.items, order: itemResult.order };
    });
  },

  upsertDiff(diff) {
    set((s) => {
      const id = agentDiffKey(diff.sessionId, diff.toolCallId);
      const diffs = new Map(s.diffs);
      diffs.set(id, { ...diff, id });
      return { diffs };
    });
  },

  upsertTerminal(terminal) {
    set((s) => {
      const id = agentTerminalKey(terminal.sessionId, terminal.toolCallId);
      const terminals = new Map(s.terminals);
      terminals.set(id, { ...terminal, id });
      return { terminals };
    });
  },

  updatePlan(plan) {
    set((s) => {
      const id = agentPlanKey(plan.sessionId);
      const plans = new Map(s.plans);
      plans.set(id, { ...plan, id });
      const itemResult = appendOrder(s.items, s.order, {
        id,
        sessionId: plan.sessionId,
        kind: 'plan',
        refId: id,
        createdAt: plan.updatedAt,
      });
      return { plans, items: itemResult.items, order: itemResult.order };
    });
  },

  clearSession(sessionId) {
    set((s) => {
      const prefix = `${sessionId}\x00`;
      const assistants = new Map(s.assistants);
      const thoughts = new Map(s.thoughts);
      const activeTextIds = new Map(s.activeTextIds);
      const textCounters = new Map(s.textCounters);
      const tools = new Map(s.tools);
      const diffs = new Map(s.diffs);
      const terminals = new Map(s.terminals);
      const plans = new Map(s.plans);
      const items = new Map(s.items);
      for (const map of [assistants, thoughts, tools, diffs, terminals, plans, items]) {
        for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
      }
      for (const key of activeTextIds.keys()) if (key.startsWith(prefix)) activeTextIds.delete(key);
      for (const key of textCounters.keys()) if (key.startsWith(prefix)) textCounters.delete(key);
      return {
        assistants,
        thoughts,
        activeTextIds,
        textCounters,
        tools,
        diffs,
        terminals,
        plans,
        items,
        order: s.order.filter((id) => !id.startsWith(prefix)),
      };
    });
  },

  clear() {
    set({
      assistants: new Map(),
      thoughts: new Map(),
      activeTextIds: new Map(),
      textCounters: new Map(),
      tools: new Map(),
      diffs: new Map(),
      terminals: new Map(),
      plans: new Map(),
      items: new Map(),
      order: [],
    });
  },
}));

export function selectAgentThreadItems(sessionId: string | null | undefined): AgentThreadItem[] {
  if (!sessionId) return [];
  const s = useAgentSession.getState();
  const prefix = `${sessionId}\x00`;
  return s.order
    .filter((id) => id.startsWith(prefix))
    .map((id) => s.items.get(id))
    .filter((item): item is AgentThreadItem => item != null);
}
