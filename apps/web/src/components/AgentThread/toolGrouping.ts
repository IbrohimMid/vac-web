import type { AgentToolCall, AgentToolStatus } from '../../stores/agentSession';

export type AgentToolGroupId = 'subagent' | 'search' | 'read' | 'command' | 'edit' | 'browser' | 'other';

export interface AgentToolGroupDefinition {
  id: AgentToolGroupId;
  label: string;
  verb: string;
  emptyLabel: string;
}

export interface AgentToolGroup {
  id: AgentToolGroupId;
  label: string;
  verb: string;
  tools: AgentToolCall[];
  count: number;
  hasActive: boolean;
  hasFailed: boolean;
  hasApproval: boolean;
  defaultOpen: boolean;
}

const GROUPS: AgentToolGroupDefinition[] = [
  { id: 'subagent', label: 'Sub-agent', verb: 'Delegated', emptyLabel: 'No sub-agent activity' },
  { id: 'search', label: 'Search', verb: 'Searched', emptyLabel: 'No searches' },
  { id: 'read', label: 'Read', verb: 'Read', emptyLabel: 'No reads' },
  { id: 'command', label: 'Command', verb: 'Ran', emptyLabel: 'No commands' },
  { id: 'edit', label: 'Edit', verb: 'Edited', emptyLabel: 'No edits' },
  { id: 'browser', label: 'Browser/Web', verb: 'Fetched', emptyLabel: 'No web activity' },
  { id: 'other', label: 'Other', verb: 'Used', emptyLabel: 'No other tools' },
];

const SEARCH_TOOLS = new Set(['grep', 'glob', 'codesearch', 'search', 'find_path', 'find-path', 'findpath', 'lsp']);
const READ_TOOLS = new Set(['read', 'read_file', 'read-file', 'readfile', 'list_directory', 'list-directory', 'listdirectory', 'diagnostics']);
const COMMAND_TOOLS = new Set(['bash', 'shell', 'command', 'terminal', 'execute']);
const EDIT_TOOLS = new Set(['edit', 'write', 'apply_patch', 'apply-patch', 'save_file', 'save-file', 'create_directory', 'create-directory', 'delete_path', 'delete-path', 'move_path', 'move-path']);
const BROWSER_TOOLS = new Set(['webfetch', 'web_fetch', 'fetch', 'browser', 'search_web', 'search-web', 'web_search', 'web-search']);

function normalizeToolName(tool: AgentToolCall): string {
  const title = tool.title?.trim().toLowerCase();
  if (title) return title.replace(/\s+/g, '_');
  return tool.kind === 'execute' ? 'execute' : tool.kind;
}

function hasApprovalSignal(tool: AgentToolCall): boolean {
  const input = tool.rawInput;
  if (!input || typeof input !== 'object') return false;
  const record = input as Record<string, unknown>;
  return Boolean(
    record.requiresApproval
      ?? record.requires_approval
      ?? record.approvalRequired
      ?? record.approval_required,
  );
}

export function classifyAgentToolGroup(tool: AgentToolCall): AgentToolGroupId {
  if (tool.subagentType || tool.parentToolCallId) return 'subagent';

  const name = normalizeToolName(tool);
  if (SEARCH_TOOLS.has(name)) return 'search';
  if (READ_TOOLS.has(name)) return 'read';
  if (COMMAND_TOOLS.has(name)) return 'command';
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (BROWSER_TOOLS.has(name)) return 'browser';

  if (tool.kind === 'read') return 'read';
  if (tool.kind === 'edit') return 'edit';
  if (tool.kind === 'execute') return 'command';
  return 'other';
}

function isActiveStatus(status: AgentToolStatus): boolean {
  return status === 'pending' || status === 'in_progress';
}

export function groupAgentTools(tools: AgentToolCall[]): AgentToolGroup[] {
  const buckets = new Map<AgentToolGroupId, AgentToolCall[]>();
  for (const tool of tools) {
    const id = classifyAgentToolGroup(tool);
    const bucket = buckets.get(id) ?? [];
    bucket.push(tool);
    buckets.set(id, bucket);
  }

  return GROUPS.map((definition) => {
    const groupedTools = buckets.get(definition.id) ?? [];
    const hasActive = groupedTools.some((tool) => isActiveStatus(tool.status));
    const hasFailed = groupedTools.some((tool) => tool.status === 'failed');
    const hasApproval = groupedTools.some(hasApprovalSignal);
    return {
      ...definition,
      tools: groupedTools,
      count: groupedTools.length,
      hasActive,
      hasFailed,
      hasApproval,
      defaultOpen: hasActive || hasFailed || hasApproval,
    };
  }).filter((group) => group.count > 0);
}

export function summarizeToolGroups(groups: AgentToolGroup[]): string {
  if (groups.length === 0) return 'No tool activity';
  return groups.map((group) => `${group.verb} ${group.count}`).join(' · ');
}
