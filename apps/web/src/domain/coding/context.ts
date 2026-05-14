// Build outbound coding-context payloads + send helpers.
//
// Phase 3 frontend adds file-level agent actions to the Code Workspace.
// These hand the agent thread structured context about the current file,
// selection, or intent (edit / tests). The bridge backend is NOT yet
// required to handle these events -- until it does, transport.send is
// fire-and-forget at the WS level and the user can navigate to the
// Build surface to continue driving the agent manually.
//
// Outbound events (frontend -> bridge):
//   coding.context.ask_about_file
//     { session_id, path, excerpt?, lines? }
//   coding.context.ask_about_selection
//     { session_id, path, start_line, end_line, selected_text }
//   coding.context.request_edit
//     { session_id, path, hint? }
//   coding.context.request_tests
//     { session_id, path }

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
}

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

// Generic constraint keeps call sites in CodePanel.tsx free of casts (the
// concrete FileContextPayload / SelectionContextPayload / FileIntentPayload
// types all satisfy { session_id?: string }), and TypeScript infers the
// concrete payload type at each call site so excess-property check on
// object literals at the test sites does not fire.
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
