// Wire transport events → approvals store.

import {
  useApprovals,
  type ApprovalOption,
  type ApprovalRequest,
  type ApprovalResolutionInput,
  type RiskLevel,
} from '../../stores/approvals';
import type { TransportHandle } from '../../transport';

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function asRisk(raw: unknown): RiskLevel {
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return 'medium';
}

function capitalize(raw: string): string {
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
}

function previewCommand(raw: string): string {
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}

function parseApprovalOptions(raw: unknown): ApprovalOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
    .map((opt) => {
      const optionId =
        asString(opt.optionId) ?? asString(opt.option_id) ?? asString(opt.id) ?? 'unknown';
      return {
        optionId,
        kind: asString(opt.kind) ?? 'unknown',
        name: asString(opt.name) ?? optionId,
      };
    });
}

function toolCallSummary(toolCall: Record<string, unknown>, fallback: string | null): string {
  const title = asString(toolCall.title);
  if (title) return title;
  const kind = asString(toolCall.kind);
  const rawInput = asRecord(toolCall.rawInput);
  const command = asString(rawInput.command);
  if (command) return previewCommand(command);
  const filePath = asString(rawInput.file_path) ?? asString(rawInput.path) ?? asString(rawInput.target_path);
  if (filePath) {
    if (kind === 'read') return `Read ${filePath}`;
    if (kind === 'edit') return `Edit ${filePath}`;
    return filePath;
  }
  const locationPath = Array.isArray(toolCall.locations)
    ? toolCall.locations
        .map((loc) => asRecord(loc))
        .map((loc) => asString(loc.path))
        .find((p): p is string => Boolean(p))
    : null;
  if (locationPath) return locationPath;
  return fallback ?? kind ?? 'approval request';
}

function toolCallLabel(toolCall: Record<string, unknown>, fallback: string | null): string {
  const title = asString(toolCall.title);
  if (title) return title;
  const kind = asString(toolCall.kind);
  return capitalize(fallback ?? kind ?? 'Approval');
}

function deriveRisk(toolCall: Record<string, unknown>, fallback: unknown): RiskLevel {
  const fallbackRisk = asRisk(fallback);
  if (fallbackRisk !== 'medium') return fallbackRisk;
  const kind = asString(toolCall.kind);
  if (kind === 'read') return 'low';
  if (kind === 'edit' || kind === 'execute') return 'high';
  return 'medium';
}

function deriveArgs(toolCall: Record<string, unknown>): Record<string, unknown> {
  const rawInput = asRecord(toolCall.rawInput);
  if (Object.keys(rawInput).length > 0) return rawInput;
  const fallback: Record<string, unknown> = {};
  for (const key of ['kind', 'title', 'locations', 'content']) {
    if (key in toolCall) fallback[key] = toolCall[key];
  }
  return fallback;
}

function normalizePending(
  evType: string,
  ev: { ts: string; payload: unknown },
): ApprovalRequest | null {
  const p = asRecord(ev.payload);
  const toolCall = asRecord(p.tool_call ?? p.toolCall);
  const approvalId =
    asString(p.approval_id) ??
    asString(p.approvalId) ??
    asString(toolCall.toolCallId) ??
    asString(p.tool_call_id) ??
    asString(p.toolCallId);
  const toolCallId = asString(toolCall.toolCallId) ?? approvalId;
  if (!approvalId || !toolCallId) return null;
  const options = parseApprovalOptions(p.options);
  const risk = deriveRisk(toolCall, p.risk);
  const summary = toolCallSummary(toolCall, asString(p.summary));
  const tool = toolCallLabel(toolCall, asString(p.tool));
  const createdAt = asString(p.created_at) ?? asString(p.createdAt) ?? ev.ts;
  const expiresInMs =
    typeof p.expires_in_ms === 'number'
      ? p.expires_in_ms
      : typeof p.expiresInMs === 'number'
        ? p.expiresInMs
        : null;
  return {
    approvalId,
    toolCallId,
    tool,
    risk,
    summary,
    args: deriveArgs(toolCall),
    createdAt,
    sourceEventType: evType,
    toolCall,
    state: 'pending',
    expiresInMs,
    options,
  };
}

function normalizeResolution(
  evType: string,
  ev: { ts: string; payload: unknown },
): ApprovalResolutionInput | null {
  const p = asRecord(ev.payload);
  const approvalId =
    asString(p.approval_id) ??
    asString(p.approvalId) ??
    asString(p.tool_call_id) ??
    asString(p.toolCallId);
  if (!approvalId) return null;
  const outcome = asString(p.outcome) ?? asString(p.decision) ?? 'unknown';
  const decision: ApprovalResolutionInput['decision'] =
    outcome === 'approved' ? 'approved' : outcome === 'rejected' ? 'rejected' : 'expired';
  const optionId = asString(p.option_id) ?? asString(p.optionId) ?? undefined;
  return {
    approvalId,
    decision,
    outcome,
    ...(optionId !== undefined && { optionId }),
    resolvedAt: ev.ts,
    sourceEventType: evType,
  };
}

export function registerApprovalHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('approval.pending', (ev) => {
      const approval = normalizePending('approval.pending', ev);
      if (!approval) return;
      useApprovals.getState().upsertPending(approval);
    }),
  );

  offs.push(
    transport.on('approval.resolved', (ev) => {
      const resolution = normalizeResolution('approval.resolved', ev);
      if (!resolution) return;
      useApprovals.getState().resolve(resolution);
    }),
  );

  offs.push(
    transport.on('approval.expired', (ev) => {
      const resolution = normalizeResolution('approval.expired', ev);
      if (!resolution) return;
      useApprovals.getState().resolve({
        ...resolution,
        decision: 'expired',
        outcome: resolution.outcome || 'expired',
      });
    }),
  );

  // Backward-compatible fallbacks for older surfaces/tests.
  offs.push(
    transport.on('tool_call.pending', (ev) => {
      const approval = normalizePending('tool_call.pending', ev);
      if (!approval) return;
      useApprovals.getState().upsertPending(approval);
    }),
  );

  offs.push(
    transport.on('tool_call.decided', (ev) => {
      const resolution = normalizeResolution('tool_call.decided', ev);
      if (!resolution) return;
      useApprovals.getState().resolve(resolution);
    }),
  );

  offs.push(
    transport.on('tool_call.expired', (ev) => {
      const resolution = normalizeResolution('tool_call.expired', ev);
      if (!resolution) return;
      useApprovals.getState().resolve({
        ...resolution,
        decision: 'expired',
        outcome: resolution.outcome || 'expired',
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
