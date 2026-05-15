import { useWorkspace } from '../../stores/workspace';
import type { TransportHandle } from '../../transport';

interface BranchUpdatedPayload {
  branch?: string;
}

export function registerWorkspaceHandlers(transport: TransportHandle): () => void {
  return transport.on('workspace.branch.updated', (ev) => {
    const p = (ev.payload ?? {}) as BranchUpdatedPayload;
    if (typeof p.branch === 'string' && p.branch.length > 0) {
      useWorkspace.getState().setBranchName(p.branch);
    }
  });
}
