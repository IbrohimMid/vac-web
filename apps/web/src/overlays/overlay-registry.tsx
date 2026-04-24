// Default registry wiring Phase 2 overlays into OverlayHost.
// Each entry maps an OverlayKind to its content component.
// Phase 3+ will extend this with diff_viewer, approval_inspector, etc.

import { ApprovalInspector } from '../components/Approvals/ApprovalInspector';
import { CommandPalette } from '../components/CommandPalette/CommandPalette';
import { GateDetail } from '../components/Gates/GateDetail';
import { GuidedMode } from '../components/GuidedMode/GuidedMode';
import { DiffViewer } from '../components/Review/DiffViewer';
import type { OverlayRegistry } from './registry';

export const overlayRegistry: OverlayRegistry = {
  command_palette: CommandPalette,
  approval_inspector: ApprovalInspector,
  diff_viewer: DiffViewer,
  gate_detail: GateDetail,
  guided_mode: GuidedMode,
};
