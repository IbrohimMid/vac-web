// Wire transport events → approvals store.

import { useApprovals, type RiskLevel } from '../../stores/approvals';
import type { TransportHandle } from '../../transport';

interface PendingPayload {
  tool_call_id: string;
  tool: string;
  risk?: string;
  summary?: string;
  args?: Record<string, unknown>;
  created_at: string;
}

interface DecidedPayload {
  tool_call_id: string;
  decision: string;
}

function asRisk(raw: string | undefined): RiskLevel {
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return 'medium';
}

export function registerApprovalHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('tool_call.pending', (ev) => {
      const p = ev.payload as PendingPayload | null;
      if (!p?.tool_call_id || !p.tool) return;
      useApprovals.getState().upsertPending({
        id: p.tool_call_id,
        tool: p.tool,
        risk: asRisk(p.risk),
        summary: p.summary ?? '',
        args: p.args ?? {},
        createdAt: p.created_at,
        state: 'pending',
      });
    }),
  );

  offs.push(
    transport.on('tool_call.decided', (ev) => {
      const p = ev.payload as DecidedPayload | null;
      if (!p?.tool_call_id) return;
      const d = p.decision === 'approved' ? 'approved' : 'rejected';
      useApprovals.getState().resolve(p.tool_call_id, d);
    }),
  );

  offs.push(
    transport.on('tool_call.expired', (ev) => {
      const p = ev.payload as { tool_call_id?: string } | null;
      if (!p?.tool_call_id) return;
      useApprovals.getState().resolve(p.tool_call_id, 'rejected');
    }),
  );

  return () => offs.forEach((off) => off());
}
