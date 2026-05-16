// Build outbound coding-context payloads + send helpers.
//
// Phase 3 frontend adds file-level agent actions to the Code Workspace.
// Phase 2 (Sprint A, F5 maturity plan) extends `request_edit` / `request_tests`
// with the Edit Intent Panel payload — chips (multi-select preset hints),
// free-form instruction, and an optional `selected_range` carrying the
// `selected_text` slice. The bridge backend treats these as agent-mediated:
// no direct browser write happens; the agent picks up the request and
// proposes changes through the review pipeline.
//
// Outbound events (frontend -> bridge):
//   coding.context.ask_about_file
//     { session_id, path, excerpt?, lines? }
//   coding.context.ask_about_selection
//     { session_id, path, start_line, end_line, selected_text }
//   coding.context.request_edit
//     { session_id, path, hint?, chips?, selected_range?, selected_text? }
//   coding.context.request_tests
//     { session_id, path, hint?, chips? }

import type { TransportHandle } from '../../transport';

export interface SelectionRange {
  start: number;
  end: number;
}

export interface FileContextInput {
  path: string;
  content?: string | undefined;
  selection?: SelectionRange | null | undefined;
}

const EXCERPT_HEAD_LINES = 60;
const EXCERPT_TAIL_LINES = 20;
const EXCERPT_MAX_CHARS = 4000;
const HINT_MAX_CHARS = 2000;

export interface FileContextPayload {
  session_id: string;
  path: string;
  excerpt?: string;
  lines?: SelectionRange;
}

export interface SelectionContextPayload {
  session_id: string;
  path: string;
  start_line: number;
  end_line: number;
  selected_text: string;
}

export interface FileIntentPayload {
  session_id: string;
  path: string;
  hint?: string;
  chips?: string[];
  selected_range?: { start_line: number; end_line: number };
  selected_text?: string;
}

export interface EditIntentInput {
  hint?: string | null | undefined;
  chips?: ReadonlyArray<string> | null | undefined;
  selection?: SelectionRange | null | undefined;
  content?: string | null | undefined;
}

export const EDIT_INTENT_CHIPS = [
  'refactor',
  'add types',
  'fix bug',
  'extract function',
  'add docstring',
  'simplify',
] as const;

export const TEST_INTENT_CHIPS = [
  'unit',
  'integration',
  'edge cases',
  'error paths',
  'snapshot',
] as const;

export type EditIntentChip = (typeof EDIT_INTENT_CHIPS)[number];
export type TestIntentChip = (typeof TEST_INTENT_CHIPS)[number];

export function buildFileContextPayload(
  sessionId: string,
  input: FileContextInput,
): FileContextPayload {
  const payload: FileContextPayload = {
    session_id: sessionId,
    path: input.path,
  };
  if (input.selection) {
    payload.lines = { start: input.selection.start, end: input.selection.end };
  }
  if (typeof input.content === 'string') {
    payload.excerpt = buildExcerpt(input.content);
  }
  return payload;
}

export function buildSelectionContextPayload(
  sessionId: string,
  path: string,
  content: string,
  selection: SelectionRange,
): SelectionContextPayload {
  const lines = content.split('\n');
  const start = Math.max(1, Math.min(selection.start, lines.length));
  const end = Math.max(start, Math.min(selection.end, lines.length));
  const selected = lines.slice(start - 1, end).join('\n');
  return {
    session_id: sessionId,
    path,
    start_line: start,
    end_line: end,
    selected_text: selected.slice(0, EXCERPT_MAX_CHARS),
  };
}

export function buildFileIntentPayload(
  sessionId: string,
  path: string,
  hint?: string,
): FileIntentPayload {
  const payload: FileIntentPayload = { session_id: sessionId, path };
  if (typeof hint === 'string' && hint.length > 0) {
    payload.hint = hint;
  }
  return payload;
}

// Phase 2 (Edit Intent Panel): build a structured request_edit / request_tests
// payload from chip selections, free-form hint, optional scope selection,
// and the in-memory file content. The bridge sees a single agent-mediated
// request — nothing is written from the browser.
export function buildEditIntentPayload(
  sessionId: string,
  path: string,
  input: EditIntentInput = {},
): FileIntentPayload {
  const payload: FileIntentPayload = { session_id: sessionId, path };
  if (typeof input.hint === 'string') {
    const trimmed = input.hint.trim();
    if (trimmed.length > 0) {
      payload.hint = trimmed.slice(0, HINT_MAX_CHARS);
    }
  }
  if (input.chips && input.chips.length > 0) {
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const raw of input.chips) {
      if (typeof raw !== 'string') continue;
      const c = raw.trim();
      if (c.length === 0 || seen.has(c)) continue;
      seen.add(c);
      dedup.push(c);
    }
    if (dedup.length > 0) payload.chips = dedup;
  }
  if (input.selection) {
    const start = Math.max(1, input.selection.start);
    const end = Math.max(start, input.selection.end);
    payload.selected_range = { start_line: start, end_line: end };
    if (typeof input.content === 'string') {
      const lines = input.content.split('\n');
      const clampedStart = Math.min(start, Math.max(lines.length, 1));
      const clampedEnd = Math.min(end, lines.length);
      const sliced = lines.slice(clampedStart - 1, clampedEnd).join('\n');
      payload.selected_text = sliced.slice(0, EXCERPT_MAX_CHARS);
    }
  }
  return payload;
}

function buildExcerpt(content: string): string {
  const lines = content.split('\n');
  if (lines.length <= EXCERPT_HEAD_LINES + EXCERPT_TAIL_LINES) {
    return content.slice(0, EXCERPT_MAX_CHARS);
  }
  const head = lines.slice(0, EXCERPT_HEAD_LINES).join('\n');
  const tail = lines.slice(-EXCERPT_TAIL_LINES).join('\n');
  const elided = lines.length - EXCERPT_HEAD_LINES - EXCERPT_TAIL_LINES;
  const truncated = head + '\n... (' + elided + ' lines elided) ...\n' + tail;
  return truncated.slice(0, EXCERPT_MAX_CHARS);
}

export type CodingContextEvent =
  | 'coding.context.ask_about_file'
  | 'coding.context.ask_about_selection'
  | 'coding.context.request_edit'
  | 'coding.context.request_tests';

export interface SendCodingContextResult {
  ok: boolean;
  error?: string;
}

export async function sendCodingContext<P extends { session_id?: string }>(
  transport: TransportHandle,
  type: CodingContextEvent,
  payload: P,
): Promise<SendCodingContextResult> {
  if (typeof payload.session_id !== 'string' || payload.session_id.length === 0) {
    return { ok: false, error: 'missing session_id' };
  }
  try {
    await transport.send(
      payload.session_id,
      type,
      payload as unknown as Record<string, unknown>,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
