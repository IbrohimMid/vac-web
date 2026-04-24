// Overlay renderer registry. Each overlay kind maps to a React component
// that receives `{ id, params, dismiss }`. Phase 2.5 ships `command_palette`;
// Phase 3+ add approval_inspector, diff_viewer, shell_drawer, etc.

import type { ComponentType } from 'react';
import type { OverlayKind } from '../stores/overlays';

export interface OverlayRenderProps {
  id: string;
  params: Record<string, unknown>;
  dismiss: () => void;
}

/**
 * Registered overlay components keyed by kind. Host reads from here to render.
 * `undefined` entries are intentional: kinds without a renderer yet are still
 * openable in store (useful for tests) but render as empty.
 */
export type OverlayRegistry = Partial<
  Record<OverlayKind, ComponentType<OverlayRenderProps>>
>;
