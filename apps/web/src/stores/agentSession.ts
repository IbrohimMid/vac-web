import { create } from 'zustand';

export type AgentToolKind = 'read' | 'edit' | 'execute' | 'other';
export type AgentToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export type AgentThreadItemKind = 'assistant' | 'thought' | 'tool' | 'plan';
export type AgentTurnStatus = 'idle' | 'queued' | 'working' | 'streaming' | 'waiting_permission' | 'completed' | 'failed';
export type RichEventKind = 'message' | 'thought' | 'tool' | 'diff' | 'terminal' | 'plan' | 'debug';

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
  /**
   * X.5f.3 Patch A: bridge-supplied hint for the raw ACP wire shape
   * the bridge had to normalize. "gemini" indicates a snake_case
   * Gemini CLI ACP frame that the bridge filled in with fallback
   * defaults (kind=other, title="Gemini tool call"). The FE shows
   * a small "normalized from <shape> shape" affordance so the user
   * can tell why the tool card is minimal.
   *
   * Optional so legacy / canonical tool_call payloads (and existing
   * test fixtures that don't care about the wire shape) stay valid
   * without touching every call site.
   */
  rawShape?: string | null;
  /**
   * Redacted input arguments for the tool call (e.g. `{ command, description }`
   * for Bash, `{ path }` for Read, `{ pattern, path }` for Grep, `{ description,
   * subagent_type }` for OpenCode `task`). Forwarded by the bridge through
   * `tool.call.created` / `tool.call.updated` as `raw_input_redacted`. Used by
   * `ToolCallCard` to render a one-line argument summary instead of leaving the
   * card body empty during a streaming tool run.
   */
  rawInput?: unknown;
  /**
   * Redacted, byte-capped output for the tool call (terminal stdout, file read
   * preview, etc.). Forwarded by the bridge as `raw_output_redacted`. Used by
   * `ToolCallCard` to render a compact output preview for non-Execute kinds
   * (Execute already renders via `TerminalCard`).
   */
  rawOutput?: unknown;
  /**
   * X.5h.1 — Trae-style nested sub-agent rendering.
   *
   * `parentToolCallId` is the bridge-snapshotted parent task tool_call_id when
   * this tool was dispatched inside an OpenCode-style sub-agent `task`. The
   * `ToolCallCard` uses it to build a parent→children map and render child
   * tool calls indented under the task card.
   */
  parentToolCallId?: string | null;
  /**
   * X.5h.1 — Sub-agent kind for the OpenCode `task` tool shape
   * (`{ description, subagent_type, prompt }`). Mirrors `raw_input.subagent_type`.
   * Used to render the per-task badge (e.g. "Sub Explore Agent",
   * "Sub Code Agent", "Sub Search Agent").
   */
  subagentType?: string | null;
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

export interface AgentTurn {
  id: string;
  sessionId: string;
  userText: string | null;
  provider: string | null;
  status: AgentTurnStatus;
  assistantBlockIds: string[];
  thinkingBlockIds: string[];
  toolCallIds: string[];
  planId: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDebugMessage {
  id: string;
  sessionId: string;
  direction: string | null;
  messageType: string | null;
  method: string | null;
  discriminator: string | null;
  paramsPreview: string | null;
  paramsHash: string | null;
  ts: string;
}

export interface AgentTelemetry {
  sessionId: string;
  providerId: string | null;
  eventCounts: Record<RichEventKind, number>;
  discriminators: Record<string, number>;
  lastUpdateAt: string | null;
  promptStatus: AgentTurnStatus;
  debugMessages: AgentDebugMessage[];
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
  turns: Map<string, AgentTurn>;
  turnOrder: string[];
  activeTurnIds: Map<string, string>;
  turnCounters: Map<string, number>;
  telemetry: Map<string, AgentTelemetry>;

  beginTurn(args: { sessionId: string; userText: string; provider?: string | null; at?: string }): void;
  failActiveTurn(sessionId: string, at?: string): void;
  appendAssistantDelta(sessionId: string, delta: string, at?: string): void;
  appendThoughtDelta(sessionId: string, delta: string, at?: string): void;
  completeTextBlocks(sessionId: string, at?: string): void;
  upsertToolCall(tool: Omit<AgentToolCall, 'id'>): void;
  upsertDiff(diff: Omit<AgentDiffUpdate, 'id'>): void;
  upsertTerminal(terminal: Omit<AgentTerminalUpdate, 'id'>): void;
  updatePlan(plan: Omit<AgentPlan, 'id'>): void;
  recordDebugMessage(message: Omit<AgentDebugMessage, 'id'>): void;
  setProvider(sessionId: string, providerId: string | null): void;
  clearSession(sessionId: string): void;
  clear(): void;
}

const CAP = 500;
const DEBUG_CAP = 80;

const emptyCounts = (): Record<RichEventKind, number> => ({
  message: 0,
  thought: 0,
  tool: 0,
  diff: 0,
  terminal: 0,
  plan: 0,
  debug: 0,
});

export function agentTextKey(sessionId: string, kind: 'assistant' | 'thought', index = 1): string {
  return `${sessionId}\x00${kind}\x00${index}`;
}

function agentTextBaseKey(sessionId: string, kind: 'assistant' | 'thought'): string {
  return `${sessionId}\x00${kind}`;
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

export function agentTurnKey(sessionId: string, index = 1): string {
  return `${sessionId}\x00turn\x00${index}`;
}

function appendUnique<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items : [...items, item];
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

function telemetryWith(
  telemetry: Map<string, AgentTelemetry>,
  sessionId: string,
  at: string,
  update: {
    providerId?: string | null;
    event?: RichEventKind;
    status?: AgentTurnStatus;
    discriminator?: string | null;
    debugMessage?: AgentDebugMessage;
  },
): Map<string, AgentTelemetry> {
  const next = new Map(telemetry);
  const prev = next.get(sessionId) ?? {
    sessionId,
    providerId: null,
    eventCounts: emptyCounts(),
    discriminators: {},
    lastUpdateAt: null,
    promptStatus: 'idle' as AgentTurnStatus,
    debugMessages: [],
  };
  const counts = { ...prev.eventCounts };
  if (update.event) counts[update.event] += 1;
  const discriminators = { ...prev.discriminators };
  if (update.discriminator) discriminators[update.discriminator] = (discriminators[update.discriminator] ?? 0) + 1;
  const debugMessages = update.debugMessage
    ? [...prev.debugMessages, update.debugMessage].slice(-DEBUG_CAP)
    : prev.debugMessages;
  next.set(sessionId, {
    ...prev,
    providerId: update.providerId !== undefined ? update.providerId : prev.providerId,
    eventCounts: counts,
    discriminators,
    promptStatus: update.status ?? prev.promptStatus,
    lastUpdateAt: at,
    debugMessages,
  });
  return next;
}

function ensureActiveTurn(
  s: AgentSessionSlice,
  sessionId: string,
  at: string,
  provider: string | null = null,
  status: AgentTurnStatus = 'streaming',
): {
  turn: AgentTurn;
  turns: Map<string, AgentTurn>;
  turnOrder: string[];
  activeTurnIds: Map<string, string>;
  turnCounters: Map<string, number>;
} {
  const activeId = s.activeTurnIds.get(sessionId);
  const active = activeId ? s.turns.get(activeId) : undefined;
  if (active && active.status !== 'completed' && active.status !== 'failed') {
    const turns = new Map(s.turns);
    const turn = {
      ...active,
      provider: active.provider ?? provider,
      status: active.status === 'working' && status === 'streaming' ? 'streaming' : active.status,
      updatedAt: at,
    };
    turns.set(turn.id, turn);
    return { turn, turns, turnOrder: s.turnOrder, activeTurnIds: s.activeTurnIds, turnCounters: s.turnCounters };
  }

  const turnCounters = new Map(s.turnCounters);
  const index = (turnCounters.get(sessionId) ?? 0) + 1;
  turnCounters.set(sessionId, index);
  const id = agentTurnKey(sessionId, index);
  const turn: AgentTurn = {
    id,
    sessionId,
    userText: null,
    provider,
    status,
    assistantBlockIds: [],
    thinkingBlockIds: [],
    toolCallIds: [],
    planId: null,
    startedAt: at,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  const turns = new Map(s.turns);
  turns.set(id, turn);
  const activeTurnIds = new Map(s.activeTurnIds);
  activeTurnIds.set(sessionId, id);
  const turnOrder = [...s.turnOrder, id].slice(-CAP);
  return { turn, turns, turnOrder, activeTurnIds, turnCounters };
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
  turns: new Map(),
  turnOrder: [],
  activeTurnIds: new Map(),
  turnCounters: new Map(),
  telemetry: new Map(),

  beginTurn({ sessionId, userText, provider = null, at = new Date().toISOString() }) {
    set((s) => {
      const existingId = s.activeTurnIds.get(sessionId);
      const existing = existingId ? s.turns.get(existingId) : undefined;
      let turnResult = ensureActiveTurn(s, sessionId, at, provider, 'working');
      let turn = turnResult.turn;
      const turns = new Map(turnResult.turns);
      if (existing && !existing.userText && existing.status !== 'completed' && existing.status !== 'failed') {
        turn = { ...existing, userText, provider: existing.provider ?? provider, status: 'working', updatedAt: at };
      } else if (!existing || existing.status === 'completed' || existing.status === 'failed') {
        turn = { ...turn, userText, provider, status: 'working', updatedAt: at };
      } else {
        const turnCounters = new Map(s.turnCounters);
        const index = (turnCounters.get(sessionId) ?? 0) + 1;
        turnCounters.set(sessionId, index);
        const id = agentTurnKey(sessionId, index);
        turn = {
          id,
          sessionId,
          userText,
          provider,
          status: 'working',
          assistantBlockIds: [],
          thinkingBlockIds: [],
          toolCallIds: [],
          planId: null,
          startedAt: at,
          completedAt: null,
          createdAt: at,
          updatedAt: at,
        };
        turnResult = {
          turn,
          turns,
          turnOrder: [...s.turnOrder, id].slice(-CAP),
          activeTurnIds: new Map(s.activeTurnIds),
          turnCounters,
        };
        turnResult.activeTurnIds.set(sessionId, id);
      }
      turns.set(turn.id, turn);
      const activeTextIds = new Map(s.activeTextIds);
      activeTextIds.delete(agentTextBaseKey(sessionId, 'assistant'));
      activeTextIds.delete(agentTextBaseKey(sessionId, 'thought'));
      return {
        turns,
        turnOrder: turnResult.turnOrder,
        activeTurnIds: turnResult.activeTurnIds,
        turnCounters: turnResult.turnCounters,
        activeTextIds,
        telemetry: telemetryWith(s.telemetry, sessionId, at, { providerId: provider, status: 'working' }),
      };
    });
  },

  failActiveTurn(sessionId, at = new Date().toISOString()) {
    set((s) => {
      const activeId = s.activeTurnIds.get(sessionId);
      if (!activeId) return { telemetry: telemetryWith(s.telemetry, sessionId, at, { status: 'failed' }) };
      const turn = s.turns.get(activeId);
      if (!turn) return { telemetry: telemetryWith(s.telemetry, sessionId, at, { status: 'failed' }) };
      const turns = new Map(s.turns);
      turns.set(activeId, { ...turn, status: 'failed', completedAt: at, updatedAt: at });
      const activeTurnIds = new Map(s.activeTurnIds);
      activeTurnIds.delete(sessionId);
      return { turns, activeTurnIds, telemetry: telemetryWith(s.telemetry, sessionId, at, { status: 'failed' }) };
    });
  },

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
      const turnResult = ensureActiveTurn(s, sessionId, at, null, 'streaming');
      const turns = new Map(turnResult.turns);
      turns.set(turnResult.turn.id, {
        ...turnResult.turn,
        status: 'streaming',
        assistantBlockIds: appendUnique(turnResult.turn.assistantBlockIds, id),
        updatedAt: at,
      });
      return {
        assistants,
        activeTextIds: text.activeTextIds,
        textCounters: text.textCounters,
        items: itemResult.items,
        order: itemResult.order,
        turns,
        turnOrder: turnResult.turnOrder,
        activeTurnIds: turnResult.activeTurnIds,
        turnCounters: turnResult.turnCounters,
        telemetry: telemetryWith(s.telemetry, sessionId, at, { event: 'message', status: 'streaming' }),
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
      const turnResult = ensureActiveTurn(s, sessionId, at, null, 'streaming');
      const turns = new Map(turnResult.turns);
      turns.set(turnResult.turn.id, {
        ...turnResult.turn,
        status: 'streaming',
        thinkingBlockIds: appendUnique(turnResult.turn.thinkingBlockIds, id),
        updatedAt: at,
      });
      return {
        thoughts,
        activeTextIds: text.activeTextIds,
        textCounters: text.textCounters,
        items: itemResult.items,
        order: itemResult.order,
        turns,
        turnOrder: turnResult.turnOrder,
        activeTurnIds: turnResult.activeTurnIds,
        turnCounters: turnResult.turnCounters,
        telemetry: telemetryWith(s.telemetry, sessionId, at, { event: 'thought', status: 'streaming' }),
      };
    });
  },

  completeTextBlocks(sessionId, at = new Date().toISOString()) {
    set((s) => {
      const activeTextIds = new Map(s.activeTextIds);
      activeTextIds.delete(agentTextBaseKey(sessionId, 'assistant'));
      activeTextIds.delete(agentTextBaseKey(sessionId, 'thought'));
      const activeTurnIds = new Map(s.activeTurnIds);
      const activeId = activeTurnIds.get(sessionId);
      const turns = new Map(s.turns);
      if (activeId) {
        const turn = turns.get(activeId);
        if (turn) turns.set(activeId, { ...turn, status: 'completed', completedAt: at, updatedAt: at });
        activeTurnIds.delete(sessionId);
      }
      return {
        activeTextIds,
        turns,
        activeTurnIds,
        telemetry: telemetryWith(s.telemetry, sessionId, at, { status: 'completed' }),
      };
    });
  },

  upsertToolCall(tool) {
    set((s) => {
      const id = agentToolKey(tool.sessionId, tool.toolCallId);
      const tools = new Map(s.tools);
      const existing = tools.get(id);
      // X.5f.3 Patch A defensive: sticky-preserve rawShape across
      // subsequent tool.call.updated frames that don't repeat the hint.
      tools.set(id, {
        ...existing,
        ...tool,
        rawShape: tool.rawShape ?? existing?.rawShape ?? null,
        // Sticky-preserve rawInput/rawOutput across update frames that don't
        // repeat them (OpenCode emits the inputs on the initial tool_call and
        // only sends `status: completed` + content[] on the follow-up).
        rawInput: tool.rawInput ?? existing?.rawInput,
        rawOutput: tool.rawOutput ?? existing?.rawOutput,
        // X.5h.1 sticky-preserve: parent linkage and subagent kind only arrive
        // on the initial tool_call frame (or the first update that carries
        // raw_input). Keep them across subsequent status-only updates so the
        // tree doesn't collapse mid-run.
        parentToolCallId: tool.parentToolCallId ?? existing?.parentToolCallId ?? null,
        subagentType: tool.subagentType ?? existing?.subagentType ?? null,
        id,
      });
      const itemResult = appendOrder(s.items, s.order, {
        id,
        sessionId: tool.sessionId,
        kind: 'tool',
        refId: id,
        createdAt: existing?.updatedAt ?? tool.updatedAt,
      });
      const turnResult = ensureActiveTurn(s, tool.sessionId, tool.updatedAt, tool.agentId, 'streaming');
      const turns = new Map(turnResult.turns);
      turns.set(turnResult.turn.id, {
        ...turnResult.turn,
        status: tool.status === 'failed' ? 'failed' : 'streaming',
        provider: turnResult.turn.provider ?? tool.agentId,
        toolCallIds: appendUnique(turnResult.turn.toolCallIds, id),
        updatedAt: tool.updatedAt,
      });
      return {
        tools,
        items: itemResult.items,
        order: itemResult.order,
        turns,
        turnOrder: turnResult.turnOrder,
        activeTurnIds: turnResult.activeTurnIds,
        turnCounters: turnResult.turnCounters,
        telemetry: telemetryWith(s.telemetry, tool.sessionId, tool.updatedAt, {
          event: 'tool',
          providerId: tool.agentId,
          status: tool.status === 'failed' ? 'failed' : 'streaming',
        }),
      };
    });
  },

  upsertDiff(diff) {
    set((s) => {
      const id = agentDiffKey(diff.sessionId, diff.toolCallId);
      const diffs = new Map(s.diffs);
      diffs.set(id, { ...diff, id });
      const turnResult = ensureActiveTurn(s, diff.sessionId, diff.updatedAt, null, 'streaming');
      const toolId = agentToolKey(diff.sessionId, diff.toolCallId);
      const turns = new Map(turnResult.turns);
      turns.set(turnResult.turn.id, {
        ...turnResult.turn,
        toolCallIds: appendUnique(turnResult.turn.toolCallIds, toolId),
        updatedAt: diff.updatedAt,
      });
      return {
        diffs,
        turns,
        turnOrder: turnResult.turnOrder,
        activeTurnIds: turnResult.activeTurnIds,
        turnCounters: turnResult.turnCounters,
        telemetry: telemetryWith(s.telemetry, diff.sessionId, diff.updatedAt, { event: 'diff', status: 'streaming' }),
      };
    });
  },

  upsertTerminal(terminal) {
    set((s) => {
      const id = agentTerminalKey(terminal.sessionId, terminal.toolCallId);
      const terminals = new Map(s.terminals);
      terminals.set(id, { ...terminal, id });
      const turnResult = ensureActiveTurn(s, terminal.sessionId, terminal.updatedAt, terminal.agentId, 'streaming');
      const toolId = agentToolKey(terminal.sessionId, terminal.toolCallId);
      const turns = new Map(turnResult.turns);
      turns.set(turnResult.turn.id, {
        ...turnResult.turn,
        provider: turnResult.turn.provider ?? terminal.agentId,
        toolCallIds: appendUnique(turnResult.turn.toolCallIds, toolId),
        updatedAt: terminal.updatedAt,
      });
      return {
        terminals,
        turns,
        turnOrder: turnResult.turnOrder,
        activeTurnIds: turnResult.activeTurnIds,
        turnCounters: turnResult.turnCounters,
        telemetry: telemetryWith(s.telemetry, terminal.sessionId, terminal.updatedAt, {
          event: 'terminal',
          providerId: terminal.agentId,
          status: 'streaming',
        }),
      };
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
      const turnResult = ensureActiveTurn(s, plan.sessionId, plan.updatedAt, null, 'streaming');
      const turns = new Map(turnResult.turns);
      turns.set(turnResult.turn.id, {
        ...turnResult.turn,
        planId: id,
        updatedAt: plan.updatedAt,
      });
      return {
        plans,
        items: itemResult.items,
        order: itemResult.order,
        turns,
        turnOrder: turnResult.turnOrder,
        activeTurnIds: turnResult.activeTurnIds,
        turnCounters: turnResult.turnCounters,
        telemetry: telemetryWith(s.telemetry, plan.sessionId, plan.updatedAt, { event: 'plan', status: 'streaming' }),
      };
    });
  },

  recordDebugMessage(message) {
    set((s) => {
      const id = `${message.sessionId}\x00debug\x00${message.ts}\x00${s.telemetry.get(message.sessionId)?.debugMessages.length ?? 0}`;
      const debugMessage = { ...message, id };
      return {
        telemetry: telemetryWith(s.telemetry, message.sessionId, message.ts, {
          event: 'debug',
          discriminator: message.discriminator,
          debugMessage,
        }),
      };
    });
  },

  setProvider(sessionId, providerId) {
    const at = new Date().toISOString();
    set((s) => ({ telemetry: telemetryWith(s.telemetry, sessionId, at, { providerId }) }));
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
      const turns = new Map(s.turns);
      const activeTurnIds = new Map(s.activeTurnIds);
      const turnCounters = new Map(s.turnCounters);
      const telemetry = new Map(s.telemetry);
      for (const map of [assistants, thoughts, tools, diffs, terminals, plans, items, turns]) {
        for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
      }
      for (const key of activeTextIds.keys()) if (key.startsWith(prefix)) activeTextIds.delete(key);
      for (const key of textCounters.keys()) if (key.startsWith(prefix)) textCounters.delete(key);
      activeTurnIds.delete(sessionId);
      turnCounters.delete(sessionId);
      telemetry.delete(sessionId);
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
        turns,
        activeTurnIds,
        turnCounters,
        telemetry,
        order: s.order.filter((id) => !id.startsWith(prefix)),
        turnOrder: s.turnOrder.filter((id) => !id.startsWith(prefix)),
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
      turns: new Map(),
      turnOrder: [],
      activeTurnIds: new Map(),
      turnCounters: new Map(),
      telemetry: new Map(),
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

export function selectAgentTurns(sessionId: string | null | undefined): AgentTurn[] {
  if (!sessionId) return [];
  const s = useAgentSession.getState();
  const prefix = `${sessionId}\x00turn\x00`;
  return s.turnOrder
    .filter((id) => id.startsWith(prefix))
    .map((id) => s.turns.get(id))
    .filter((turn): turn is AgentTurn => turn != null);
}
