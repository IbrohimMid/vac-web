import { useMemo, useState } from 'react';
import {
  agentDiffKey,
  agentTerminalKey,
  selectAgentTurns,
  useAgentSession,
  type AgentDebugMessage,
  type AgentDiff,
  type AgentPlanEntry,
  type AgentThreadItem,
  type AgentToolCall,
  type AgentToolStatus,
  type AgentTurn,
} from '../../stores/agentSession';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import '../../styles/transcript.css';

// X.5f.3 Patch B: shared shape for the optional plumbing the cockpit
// gives AgentThread (transport for message.cancel_stream / retry,
// onOpenTab to switch the workbench tab to Review / Runtime). Both
// are optional so the legacy render tests keep working without
// touching every fixture.
export interface AgentThreadActions {
  transport?: TransportHandle | null;
  onOpenTab?: ((tab: 'review' | 'runtime' | 'activity' | 'approvals' | 'agents' | 'plan' | 'workflow') => void) | null;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    // Clipboard can fail in test environments / sandboxed iframes;
    // swallow so the action button never throws into the UI.
  }
}

const TERMINAL_PREVIEW_LIMIT = 500;
const EMPTY_DEBUG_MESSAGES: AgentDebugMessage[] = [];
const EMPTY_DISCRIMINATORS: Record<string, number> = {};

type ProviderMeta = { label: string; shortLabel: string };

function providerMeta(provider: string | null | undefined): ProviderMeta {
  if (provider === 'gemini-acp') return { label: 'Gemini CLI ACP', shortLabel: 'Gemini' };
  if (provider === 'claude-acp') return { label: 'Claude Agent ACP', shortLabel: 'Claude' };
  if (provider === 'codex-acp') return { label: 'Codex CLI ACP', shortLabel: 'Codex' };
  if (provider === 'opencode') return { label: 'OpenCode ACP', shortLabel: 'OpenCode' };
  if (provider === 'github-copilot-acp') return { label: 'GitHub Copilot ACP', shortLabel: 'Copilot' };
  if (provider === 'kimi-cli-acp') return { label: 'Kimi CLI ACP', shortLabel: 'Kimi' };
  if (provider === 'qwen-code-acp') return { label: 'Qwen Code ACP', shortLabel: 'Qwen' };
  if (provider) return { label: provider, shortLabel: provider };
  return { label: 'ACP provider', shortLabel: 'Agent' };
}

function statusLabel(status: AgentToolStatus): string {
  if (status === 'in_progress') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function statusClass(status: AgentToolStatus): string {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'in_progress') return 'running';
  return 'pending';
}

function turnStatusClass(status: AgentTurn['status']): string {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'streaming' || status === 'working') return 'running';
  return 'pending';
}

function elapsedLabel(turn: AgentTurn): string | null {
  const end = turn.completedAt ?? (turn.status === 'working' || turn.status === 'streaming' ? new Date().toISOString() : null);
  if (!end) return null;
  const elapsedMs = Date.parse(end) - Date.parse(turn.startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `${seconds}s`;
}

function safeTerminalPreview(raw: string | null): { text: string | null; truncated: boolean; redacted: boolean } {
  if (!raw) return { text: null, truncated: false, redacted: false };
  let text = raw
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '<REDACTED-SECRET>')
    .replace(/(Authorization:\s*Bearer\s+)[^\s'"`]+/gi, '$1<REDACTED-SECRET>')
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|KEY)[A-Z0-9_]*=)[^\s]+/gi, '$1<REDACTED-SECRET>');
  const redacted = text.includes('<REDACTED-SECRET>');
  const truncated = text.length > TERMINAL_PREVIEW_LIMIT;
  if (truncated) text = `${text.slice(0, TERMINAL_PREVIEW_LIMIT)}…`;
  return { text, truncated, redacted };
}

function DiffPreview({ diff }: { diff: AgentDiff }) {
  const oldLine = diff.old_text?.split('\n').find((line) => line.length > 0) ?? '';
  const newLine = diff.new_text?.split('\n').find((line) => line.length > 0) ?? '';
  return (
    <div className="agent-diff-preview">
      <div className="agent-path">{diff.path}</div>
      {oldLine && <div className="agent-diff-line removed">- {oldLine}</div>}
      {newLine && <div className="agent-diff-line added">+ {newLine}</div>}
    </div>
  );
}

export function ThinkingBlock({ content, active = false }: { content: string; active?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <details className="agent-card thinking" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {active ? 'Thinking…' : `Thinking ${open ? 'expanded' : 'collapsed'}`}
      </summary>
      <div className="agent-card-body">{content}</div>
    </details>
  );
}

export function DiffCard({
  toolCallId,
  sessionId,
  onOpenTab,
}: {
  toolCallId: string;
  sessionId: string;
  onOpenTab?: AgentThreadActions['onOpenTab'];
}) {
  const diff = useAgentSession((s) => s.diffs.get(agentDiffKey(sessionId, toolCallId)));
  if (!diff || diff.diffs.length === 0) return null;
  const primaryPath = diff.diffs[0]?.path ?? null;
  return (
    <div className="agent-card nested" aria-label="Diff update">
      <div className="agent-card-title">Diff update</div>
      {diff.diffs.map((d) => <DiffPreview key={d.path} diff={d} />)}
      <div className="agent-card-actions" role="group" aria-label="Diff actions">
        <button
          type="button"
          className="agent-action"
          disabled={!onOpenTab}
          onClick={() => onOpenTab && onOpenTab('review')}
          title={onOpenTab ? 'Jump to the Review tab to inspect this changeset' : 'Unavailable: not mounted in workbench'}
        >
          Open Review
        </button>
        <button
          type="button"
          className="agent-action"
          disabled={!primaryPath}
          onClick={() => primaryPath && void copyToClipboard(primaryPath)}
          title={primaryPath ? `Copy path: ${primaryPath}` : 'Unavailable: no path on this diff'}
        >
          Copy path
        </button>
      </div>
    </div>
  );
}

export function TerminalCard({
  toolCallId,
  sessionId,
  onOpenTab,
}: {
  toolCallId: string;
  sessionId: string;
  onOpenTab?: AgentThreadActions['onOpenTab'];
}) {
  const terminal = useAgentSession((s) => s.terminals.get(agentTerminalKey(sessionId, toolCallId)));
  const preview = useMemo(() => safeTerminalPreview(terminal?.rawOutputRedacted ?? null), [terminal?.rawOutputRedacted]);
  if (!terminal || !preview.text) return null;
  const fullOutput = terminal.rawOutputRedacted ?? '';
  return (
    <div className="agent-card nested" aria-label="Terminal output">
      <div className="agent-card-title">Terminal output</div>
      <pre className="agent-terminal-output">{preview.text}</pre>
      <div className="agent-card-meta">
        {preview.redacted && <span>redacted</span>}
        {preview.truncated && <span>truncated</span>}
      </div>
      <div className="agent-card-actions" role="group" aria-label="Terminal actions">
        <button
          type="button"
          className="agent-action"
          disabled={!fullOutput}
          onClick={() => fullOutput && void copyToClipboard(fullOutput)}
          title={fullOutput ? 'Copy redacted terminal output to clipboard' : 'Unavailable: no terminal output'}
        >
          Copy output
        </button>
        <button
          type="button"
          className="agent-action"
          disabled={!onOpenTab}
          onClick={() => onOpenTab && onOpenTab('runtime')}
          title={onOpenTab ? 'Jump to the Runtime tab to inspect job logs' : 'Unavailable: not mounted in workbench'}
        >
          Open Runtime
        </button>
      </div>
    </div>
  );
}

/**
 * Derive a single-line input summary from a tool call's `rawInput`.
 *
 * The bridge forwards `raw_input_redacted` (a JSON object with secret-shaped
 * keys masked). Different providers/tools shape it differently:
 *  - Bash / shell: `{ command, description? }` → `$ <command>`
 *  - Read / file: `{ path | filePath | file_path }` → `path: <path>`
 *  - Grep / search: `{ pattern, path? }` → `grep: <pattern>` (+ path)
 *  - Glob: `{ pattern }` → `glob: <pattern>`
 *  - Edit / Write: `{ path, oldString?/newString? | content? }` → `edit: <path>`
 *  - OpenCode `task`: `{ description, subagent_type? }` → quoted description
 *  - Anything else: pretty-printed first ~200 chars of JSON.
 *
 * Returns `null` when there is no usable input shape.
 */
function summarizeToolInput(rawInput: unknown): string | null {
  if (rawInput == null) return null;
  if (typeof rawInput === 'string') return rawInput.length > 0 ? rawInput.slice(0, 240) : null;
  if (typeof rawInput !== 'object') return String(rawInput);
  const r = rawInput as Record<string, unknown>;
  const str = (k: string): string | null => (typeof r[k] === 'string' && (r[k] as string).length > 0 ? (r[k] as string) : null);
  const command = str('command') ?? str('cmd');
  if (command) return `$ ${command}`;
  const pattern = str('pattern') ?? str('query') ?? str('regex');
  const path = str('path') ?? str('filePath') ?? str('file_path') ?? str('absolute_path') ?? str('directory');
  if (pattern) return path ? `${pattern}  ·  ${path}` : pattern;
  if (path) return path;
  const description = str('description') ?? str('prompt') ?? str('text');
  if (description) {
    const subagent = str('subagent_type');
    return subagent ? `${subagent}: ${description}` : description;
  }
  const url = str('url');
  if (url) return url;
  try {
    const json = JSON.stringify(rawInput);
    return json.length > 240 ? `${json.slice(0, 240)}…` : json;
  } catch {
    return null;
  }
}

/**
 * Compact, redacted preview of a non-Execute tool's `rawOutput`. Execute
 * already renders via TerminalCard from the dedicated tool.terminal.updated
 * lane; this fallback handles Read/Edit/Other where the bridge attaches
 * the redacted output directly on the tool_call payload.
 */
function summarizeToolOutput(rawOutput: unknown): string | null {
  if (rawOutput == null) return null;
  if (typeof rawOutput === 'string') return rawOutput.length > 0 ? rawOutput.slice(0, 600) : null;
  try {
    const json = JSON.stringify(rawOutput);
    return json.length > 600 ? `${json.slice(0, 600)}…` : json;
  } catch {
    return null;
  }
}

// X.5h.3 — default-collapse threshold for the nested sub-agent tree.
// Top-level (depth 0) and direct children (depth 1) stay open by default
// so the most common shape (one sub-agent dispatch) is fully visible at
// a glance. Deeper nesting starts collapsed so a runaway 4-level tree
// (the bridge's hard cap, see MAX_SUBAGENT_DEPTH on the Rust side)
// doesn't push the rest of the timeline below the fold.
const SUBAGENT_DEFAULT_OPEN_DEPTH = 2;

export function ToolCallCard({
  tool,
  onOpenTab,
  childrenByParent,
  depth = 0,
}: {
  tool: AgentToolCall;
  onOpenTab?: AgentThreadActions['onOpenTab'];
  // X.5h.1 — parent→children map built once at the turn level so each
  // ToolCallCard can pluck its direct descendants without re-scanning the
  // entire tools store. When omitted (e.g. AgentThreadItemRow path), the
  // card renders as before with no nested children.
  childrenByParent?: Map<string, AgentToolCall[]> | undefined;
  // X.5h.3 — nesting depth for collapse heuristics + the per-node action
  // row's data attributes. Top-level cards pass 0 (or omit); each
  // recursive render passes depth + 1.
  depth?: number;
}) {
  const primaryPath = tool.locations[0]?.path ?? null;
  const children = childrenByParent?.get(tool.toolCallId) ?? [];
  const isSubagentTask = Boolean(tool.subagentType);
  const subagentLabel = tool.subagentType
    ? `Sub ${tool.subagentType.charAt(0).toUpperCase()}${tool.subagentType.slice(1)} Agent`
    : null;
  // X.5f.3 Patch A: when the bridge filled in a fallback DTO from
  // a non-canonical wire shape (e.g. Gemini snake_case), show a
  // small "normalized from <shape> shape" affordance so the user
  // understands why the title/kind look generic.
  const rawShape = tool.rawShape ?? null;
  const inputSummary = useMemo(() => summarizeToolInput(tool.rawInput), [tool.rawInput]);
  const outputSummary = useMemo(
    () => (tool.kind === 'execute' ? null : summarizeToolOutput(tool.rawOutput)),
    [tool.kind, tool.rawOutput],
  );
  const isCommand = inputSummary?.startsWith('$ ') ?? false;
  const displayTitle = tool.title ?? (tool.kind === 'execute' ? 'Run' : tool.kind === 'read' ? 'Read' : tool.kind === 'edit' ? 'Edit' : 'Tool');
  const summary = useMemo(() => {
    const title = tool.title ?? tool.kind;
    const path = primaryPath ? ` · ${primaryPath}` : '';
    const args = inputSummary ? ` · ${inputSummary}` : '';
    return `${title} (${tool.kind}, ${tool.status})${path}${args} [tool_call_id=${tool.toolCallId}]`;
  }, [tool.title, tool.kind, tool.status, tool.toolCallId, primaryPath, inputSummary]);
  // X.5h.3 — deep-nested cards start collapsed so a long sub-agent
  // chain doesn't dominate the timeline. The user can still expand
  // them manually; depth is also exposed via data-depth so styles
  // and tests can target it.
  const startsOpen =
    (tool.status === 'in_progress' || tool.status === 'completed')
    && depth < SUBAGENT_DEFAULT_OPEN_DEPTH;
  return (
    <details
      className="agent-card tool"
      aria-label={`Tool call ${tool.toolCallId}`}
      open={startsOpen}
      data-depth={depth}
      data-testid={depth > 0 ? `agent-tool-card-depth-${depth}` : undefined}
    >
      <summary className="agent-card-title">
        <span className="agent-tool-name"><strong>{displayTitle}</strong>{tool.title && tool.title !== displayTitle && <span className="agent-card-meta"> · {tool.kind}</span>}</span>
        {subagentLabel && (
          <span className="agent-subagent-badge" title={`Sub-agent type: ${tool.subagentType}`}>
            {subagentLabel}
          </span>
        )}
        {inputSummary && (
          <code className={`agent-tool-args ${isCommand ? 'is-command' : ''}`} title={inputSummary}>
            {inputSummary}
          </code>
        )}
        <span className="agent-tool-lifecycle">
          <span className={tool.status === 'pending' ? 'active' : ''}>queued</span>
          <span>→</span>
          <span className={tool.status === 'in_progress' ? 'active' : ''}>running</span>
          <span>→</span>
          <span className={tool.status === 'completed' ? 'active ok' : tool.status === 'failed' ? 'active error' : ''}>
            {tool.status === 'failed' ? 'failed' : 'succeeded'}
          </span>
        </span>
        <span className={`agent-status ${statusClass(tool.status)}`}>{statusLabel(tool.status)}</span>
      </summary>
      {rawShape && (
        <div className="agent-card-meta" data-testid="tool-raw-shape">
          {rawShape === 'opencode_serve'
            ? 'via opencode sub-agent tap'
            : `normalized from ${rawShape} shape`}
        </div>
      )}
      {tool.locations.length > 0 && (
        <div className="agent-tool-locations" aria-label="Tool call locations">
          {tool.locations.map((loc, i) => (
            <span className="agent-path" key={`${loc.path}:${loc.line ?? ''}:${i}`}>
              {loc.path}{loc.line != null ? `:${loc.line}` : ''}
            </span>
          ))}
        </div>
      )}
      {outputSummary && (
        <div className="agent-tool-output" aria-label="Tool call output preview">
          <div className="agent-card-meta">Output</div>
          <pre className="agent-terminal-output">{outputSummary}</pre>
        </div>
      )}
      <div className="agent-card-actions" role="group" aria-label="Tool call actions">
        <button
          type="button"
          className="agent-action"
          onClick={() => {
            void navigator.clipboard?.writeText(summary);
          }}
          title="Copy tool call summary to clipboard"
        >
          Copy tool summary
        </button>
        <button
          type="button"
          className="agent-action"
          onClick={() => {
            const panel = document.querySelector<HTMLDetailsElement>('details.agent-card.debug');
            if (panel) {
              panel.open = true;
              panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
          title={`Open ACP Debug panel filtered to ${tool.toolCallId}`}
        >
          Open ACP Debug
        </button>
      </div>
      {/* X.5h.3 — per-node sub-agent actions. Surface Cancel / Retry as
          first-class buttons on each task tool card so the user has a
          place to act on a specific sub-agent rather than only at the
          turn level. The actual cancel/retry wiring lives on the bridge
          side (per-task abort against the OpenCode HTTP API + retry
          via re-dispatch); the buttons stay disabled with explicit
          tooltips until that surface lands so the affordance is
          honest about what is and isn't currently available. The
          "Copy task description" affordance always works since the
          description is in `inputSummary`. */}
      {isSubagentTask && (
        <div
          className="agent-card-actions agent-subagent-actions"
          role="group"
          aria-label="Sub-agent task actions"
          data-testid="agent-subagent-actions"
          data-subagent-type={tool.subagentType ?? ''}
          data-tool-call-id={tool.toolCallId}
        >
          <button
            type="button"
            className="agent-action"
            disabled
            data-testid="agent-subagent-cancel"
            title="Per-task cancel is not yet wired through the bridge. Use the turn-level Cancel above to abort the whole turn."
          >
            Cancel sub-task
          </button>
          <button
            type="button"
            className="agent-action"
            disabled
            data-testid="agent-subagent-retry"
            title="Per-task retry is not yet wired through the bridge. Use the turn-level Retry above to resubmit the original prompt."
          >
            Retry sub-task
          </button>
          <button
            type="button"
            className="agent-action"
            data-testid="agent-subagent-copy-description"
            disabled={!inputSummary}
            onClick={() => {
              if (inputSummary) void navigator.clipboard?.writeText(inputSummary);
            }}
            title={
              inputSummary
                ? 'Copy the sub-agent task description to the clipboard'
                : 'No task description was extracted from the tool call input'
            }
          >
            Copy task description
          </button>
        </div>
      )}
      <DiffCard sessionId={tool.sessionId} toolCallId={tool.toolCallId} onOpenTab={onOpenTab} />
      <TerminalCard sessionId={tool.sessionId} toolCallId={tool.toolCallId} onOpenTab={onOpenTab} />
      {children.length > 0 && (
        <div
          className="agent-tool-children"
          role="group"
          aria-label={`Sub-agent activity for ${displayTitle}`}
          data-testid="agent-tool-children"
          data-parent-depth={depth}
        >
          {children.map((child) => (
            <ToolCallCard
              key={child.id}
              tool={child}
              onOpenTab={onOpenTab}
              childrenByParent={childrenByParent}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </details>
  );
}

export function PlanCard({ entries }: { entries: AgentPlanEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="agent-card plan" aria-label="Agent plan">
      <div className="agent-card-title">Plan</div>
      <ul className="agent-plan-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className={`agent-plan-dot ${entry.status}`} aria-hidden="true" />
            <span>{entry.title}</span>
            <span className="agent-card-meta">{entry.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

// X.5f.3 Patch C: render a provider-aware header line + a compact
// counts summary in place of the generic "Rich agent session" string
// and the verbose "Rich events: ..." badge. The intent is to make
// it obvious which provider is on the wire and what kinds of rich
// events have actually been observed for this session.
function AgentTelemetryBadge({ sessionId, provider }: { sessionId: string; provider: string | null }) {
  const telemetry = useAgentSession((s) => s.telemetry.get(sessionId));
  const meta = providerMeta(telemetry?.providerId ?? provider);
  const counts = telemetry?.eventCounts;
  const status = telemetry?.promptStatus ?? 'idle';
  const statusLabelText =
    status === 'streaming' || status === 'working' ? 'Streaming'
    : status === 'completed' ? 'Completed'
    : status === 'failed' ? 'Failed'
    : 'Idle';
  const messageCount = counts?.message ?? 0;
  const toolCount = counts?.tool ?? 0;
  const thoughtCount = counts?.thought ?? 0;
  const planCount = counts?.plan ?? 0;
  const summaryParts = [
    pluralize(messageCount, 'message', 'messages'),
    pluralize(toolCount, 'tool', 'tools'),
    thoughtCount === 0 ? 'no thoughts emitted' : pluralize(thoughtCount, 'thought', 'thoughts'),
    planCount === 0 ? 'no plan emitted' : pluralize(planCount, 'plan', 'plans'),
  ];
  return (
    <div className="agent-telemetry" aria-label="Provider rich event telemetry">
      <span className={`agent-status ${turnStatusClass(status)}`}>
        {meta.label} · {statusLabelText}
      </span>
      <span className="agent-card-meta">{summaryParts.join(' · ')}</span>
    </div>
  );
}

function AcpDebugPanel({ sessionId }: { sessionId: string }) {
  const debugMessages = useAgentSession((s) => s.telemetry.get(sessionId)?.debugMessages ?? EMPTY_DEBUG_MESSAGES);
  const discriminators = useAgentSession((s) => s.telemetry.get(sessionId)?.discriminators ?? EMPTY_DISCRIMINATORS);
  if (debugMessages.length === 0 && Object.keys(discriminators).length === 0) return null;
  // X.5f.3 Patch C: collapse the debug panel summary into one
  // compact line so it does not visually compete with the agent
  // turn cards. Diagnostics stays one click away via the disclosure.
  const frameCount = debugMessages.length;
  const bucketCount = Object.keys(discriminators).length;
  const summaryText =
    `Diagnostics · ${pluralize(frameCount, 'ACP frame', 'ACP frames')} · `
    + `${pluralize(bucketCount, 'discriminator bucket', 'discriminator buckets')}`;
  return (
    <details className="agent-card debug" aria-label="ACP Debug">
      <summary className="agent-card-title">
        <span>{summaryText}</span>
        <span className="agent-card-meta">[Open]</span>
      </summary>
      <div className="agent-debug-grid">
        <div>
          <strong>session/update discriminators</strong>
          {Object.keys(discriminators).length === 0 ? (
            <div className="agent-card-meta">none seen</div>
          ) : (
            <ul>
              {Object.entries(discriminators).map(([disc, count]) => (
                <li key={disc}>{disc}: {count}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <strong>wire messages</strong>
          <ul>
            {debugMessages.slice(-12).map((msg) => <AcpDebugRow key={msg.id} message={msg} />)}
          </ul>
        </div>
      </div>
    </details>
  );
}

function AcpDebugRow({ message }: { message: AgentDebugMessage }) {
  return (
    <li className="agent-debug-row">
      <span>{message.direction ?? 'unknown'}</span>
      <span>{message.method ?? message.messageType ?? 'message'}</span>
      {message.discriminator && <span>{message.discriminator}</span>}
      {message.paramsPreview && <span className="agent-debug-preview">{message.paramsPreview}</span>}
      {message.paramsHash && <span className="agent-card-meta">{message.paramsHash.slice(0, 10)}</span>}
    </li>
  );
}

function AgentTurnCard({
  turn,
  sessionId,
  transport,
  onOpenTab,
}: {
  turn: AgentTurn;
  sessionId: string;
  transport?: TransportHandle | null;
  onOpenTab?: AgentThreadActions['onOpenTab'];
}) {
  const assistantsById = useAgentSession((s) => s.assistants);
  const thoughtsById = useAgentSession((s) => s.thoughts);
  const toolsById = useAgentSession((s) => s.tools);
  const plan = useAgentSession((s) => (turn.planId ? s.plans.get(turn.planId) : null));
  const assistants = useMemo(
    () => turn.assistantBlockIds.map((id) => assistantsById.get(id)).filter(Boolean),
    [assistantsById, turn.assistantBlockIds],
  );
  const thoughts = useMemo(
    () => turn.thinkingBlockIds.map((id) => thoughtsById.get(id)).filter(Boolean),
    [thoughtsById, turn.thinkingBlockIds],
  );
  const tools = useMemo(
    () => turn.toolCallIds.map((id) => toolsById.get(id)).filter(Boolean),
    [toolsById, turn.toolCallIds],
  );
  // X.5h.1 — Trae-style nested sub-agent tree.
  // Top-level tools are those whose parent is unknown to this turn (either
  // missing or pointing at a tool we don't have in scope). Children are
  // rendered nested inside their parent task card and skipped at the top
  // level so the timeline stays a clean sub-agent→child tree instead of a
  // flat list with duplicates.
  const toolByCallId = useMemo(() => {
    const m = new Map<string, AgentToolCall>();
    for (const t of tools) if (t) m.set(t.toolCallId, t);
    return m;
  }, [tools]);
  const topLevelTools = useMemo(
    () =>
      tools.filter((t) => {
        if (!t) return false;
        const parent = t.parentToolCallId;
        return !parent || !toolByCallId.has(parent);
      }),
    [tools, toolByCallId],
  );
  const childrenByParent = useMemo(() => {
    const m = new Map<string, AgentToolCall[]>();
    for (const t of tools) {
      if (!t || !t.parentToolCallId) continue;
      const arr = m.get(t.parentToolCallId) ?? [];
      arr.push(t);
      m.set(t.parentToolCallId, arr);
    }
    return m;
  }, [tools]);
  const meta = providerMeta(turn.provider);
  const isActive = turn.status === 'working' || turn.status === 'streaming';
  const emptyResponse = assistants.length === 0 && thoughts.length === 0 && tools.length === 0 && !plan;
  const elapsed = elapsedLabel(turn);

  return (
    <article className={`agent-turn ${isActive ? 'active' : ''}`} aria-label="Agent turn">
      <div className="agent-turn-rail" aria-hidden="true" />
      <div className="agent-turn-body">
        <div className="agent-turn-header">
          <span>{meta.label}</span>
          <span className={`agent-status ${turnStatusClass(turn.status)}`}>{turn.status}</span>
          {elapsed && <span className="agent-card-meta">{elapsed}</span>}
          <div className="agent-card-actions" role="group" aria-label="Turn actions">
            <button
              type="button"
              className="agent-action"
              disabled={!isActive || !transport}
              onClick={() => {
                if (transport) void transport.send(sessionId, 'message.cancel_stream', {});
              }}
              title={
                !isActive
                  ? 'Unavailable: turn is not streaming'
                  : !transport
                    ? 'Unavailable: not mounted in workbench'
                    : 'Cancel the in-flight agent turn'
              }
            >
              Cancel
            </button>
            <button
              type="button"
              className="agent-action"
              disabled={isActive || !transport || !turn.userText}
              onClick={() => {
                if (transport && turn.userText)
                  void transport.send(sessionId, 'message.submit', {
                    text: turn.userText,
                    attachments: [],
                    mentions: [],
                  });
              }}
              title={
                isActive
                  ? 'Unavailable: turn still streaming'
                  : !transport
                    ? 'Unavailable: not mounted in workbench'
                    : !turn.userText
                      ? 'Unavailable: no user prompt to retry'
                      : 'Resubmit the original prompt for this turn'
              }
            >
              Retry
            </button>
          </div>
        </div>
        {turn.userText && <div className="agent-user-prompt">{turn.userText}</div>}
        {emptyResponse && isActive && (
          // X.5f.3 Patch F: while the turn is active and the provider has
          // not emitted any rich event yet, surface a louder placeholder
          // so dogfooders don't think the UI is dead. Includes an
          // animated spinner glyph and the elapsed time pulled from the
          // header so the wait state is unambiguous at a glance.
          <div
            className="agent-message pending agent-working"
            role="status"
            aria-live="polite"
            data-testid="agent-working-placeholder"
          >
            <span className="agent-working-spinner" aria-hidden="true" />
            <span>
              {meta.shortLabel} is working
              {elapsed ? ` · ${elapsed} elapsed` : '…'}
            </span>
          </div>
        )}
        {thoughts.map((thought) => (
          <ThinkingBlock key={thought!.id} content={thought!.content} active={isActive} />
        ))}
        {assistants.map((assistant) => (
          <div key={assistant!.id} className={`agent-message ${isActive ? 'streaming' : ''}`}>
            {assistant!.content}
            {isActive && <span className="streaming-cursor">▍</span>}
            {!isActive && assistant!.content && (
              <div className="agent-card-actions" role="group" aria-label="Assistant actions">
                <button
                  type="button"
                  className="agent-action"
                  onClick={() => void copyToClipboard(assistant!.content)}
                  title="Copy assistant response to clipboard"
                >
                  Copy response
                </button>
              </div>
            )}
          </div>
        ))}
        {plan && <PlanCard entries={plan.entries} />}
        {topLevelTools.map((tool) => (
          <ToolCallCard
            key={tool!.id}
            tool={tool!}
            onOpenTab={onOpenTab}
            childrenByParent={childrenByParent}
          />
        ))}
        {/* X.5f.3 Patch D: when the provider streamed assistant text but
            emitted no rich (thinking/tool/diff/terminal/plan) events for
            this completed turn, surface a one-line explainer so the user
            understands why the timeline only shows a message. */}
        {!isActive
          && assistants.length > 0
          && thoughts.length === 0
          && tools.length === 0
          && !plan
          && (
            <div className="agent-card-meta" data-testid="agent-text-only-fallback">
              {meta.label} streamed a text-only response. No thinking, tool, diff, terminal, or plan events were emitted for this turn.
            </div>
          )}
        {/* X.5f.3 Patch F: when the provider's turn completed (or failed)
            without emitting ANY content at all (no assistant text, thought,
            tool, diff, terminal, or plan), the card would otherwise render
            only a header — looking dead in the timeline. Surface an explicit
            "completed empty" notice and a Retry hint so dogfooders can tell
            the difference between "still working" and "finished with nothing". */}
        {!isActive && emptyResponse && (
          <div
            className="agent-card-meta agent-empty-turn"
            data-testid="agent-empty-turn-fallback"
          >
            {meta.label} {turn.status === 'failed' ? 'failed' : 'finished'} without emitting any
            content for this turn. No assistant text, thinking, tool, diff, terminal, or plan
            events were observed. Use Retry above to resend the prompt, or open ACP Debug below
            to inspect the raw frames.
          </div>
        )}
      </div>
    </article>
  );
}

function AgentThreadItemRow({ item, onOpenTab }: { item: AgentThreadItem; onOpenTab?: AgentThreadActions['onOpenTab'] }) {
  const assistant = useAgentSession((s) => s.assistants.get(item.refId));
  const thought = useAgentSession((s) => s.thoughts.get(item.refId));
  const tool = useAgentSession((s) => s.tools.get(item.refId));
  const plan = useAgentSession((s) => s.plans.get(item.refId));

  if (item.kind === 'assistant' && assistant?.content) {
    return <div className="agent-message">{assistant.content}</div>;
  }
  if (item.kind === 'thought' && thought?.content) {
    return <ThinkingBlock content={thought.content} />;
  }
  if (item.kind === 'tool' && tool) {
    return <ToolCallCard tool={tool} onOpenTab={onOpenTab} />;
  }
  if (item.kind === 'plan' && plan) {
    return <PlanCard entries={plan.entries} />;
  }
  return null;
}

export function AgentThread({
  sessionId,
  transport,
  onOpenTab,
}: {
  sessionId?: string | null;
  transport?: TransportHandle | null;
  onOpenTab?: AgentThreadActions['onOpenTab'];
}) {
  const currentSession = useSession((s) => s.sessionId);
  const provider = useSession((s) => s.agentId);
  const sid = sessionId ?? currentSession;
  const order = useAgentSession((s) => s.order);
  const itemsById = useAgentSession((s) => s.items);
  const turnsState = useAgentSession((s) => s.turns);
  const turnOrder = useAgentSession((s) => s.turnOrder);
  const telemetry = useAgentSession((s) => (sid ? s.telemetry.get(sid) : undefined));
  const turns = useMemo(() => selectAgentTurns(sid), [sid, turnsState, turnOrder]);
  // X.5f.3 Patch D: dev-only sanity warning. If the raw debug stream
  // shows tool_call discriminators but the normalized tool count is
  // still zero, the bridge silently dropped the wire shape and we
  // want devs to notice immediately during dogfood.
  const devWarning = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (!telemetry) return null;
    const discriminators = telemetry.discriminators ?? {};
    const toolCallSeen = (discriminators['tool_call'] ?? 0)
      + (discriminators['tool_call_update'] ?? 0);
    const normalizedTools = telemetry.eventCounts?.tool ?? 0;
    if (toolCallSeen > 0 && normalizedTools === 0) {
      return 'ACP tool_call was seen in debug but no normalized tool card was created.';
    }
    return null;
  }, [telemetry]);
  const items = useMemo(() => {
    if (!sid) return [];
    const prefix = `${sid}\x00`;
    return order
      .filter((id) => id.startsWith(prefix))
      .map((id) => itemsById.get(id))
      .filter((item): item is AgentThreadItem => item != null);
  }, [itemsById, order, sid]);

  if (!sid || (turns.length === 0 && items.length === 0 && !telemetry)) return null;

  return (
    <section className="agent-thread" aria-label="Rich agent thread">
      <div className="agent-thread-header">
        <AgentTelemetryBadge sessionId={sid} provider={provider} />
      </div>
      {devWarning && (
        <div
          className="agent-card-meta agent-dev-warning"
          role="alert"
          data-testid="agent-dev-warning"
        >
          ⚠️ {devWarning}
        </div>
      )}
      {turns.length > 0
        ? turns.map((turn) => (
            <AgentTurnCard
              key={turn.id}
              turn={turn}
              sessionId={sid}
              transport={transport ?? null}
              onOpenTab={onOpenTab ?? null}
            />
          ))
        : items.map((item) => <AgentThreadItemRow key={item.id} item={item} onOpenTab={onOpenTab ?? null} />)}
      <AcpDebugPanel sessionId={sid} />
    </section>
  );
}
