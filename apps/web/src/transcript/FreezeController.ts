// Runs after transcript.completed; freezes oldest completed hot messages
// when hot window exceeds HOT_WINDOW_SIZE.
//
// Slice 50: the freeze decision is gated by the rendering pipeline
// catalog (`PIPELINE_MODES`). Today the cockpit always runs in `live`
// mode (mutable + cacheRenderedHtml), so the gate is a no-op. When
// replay/frozen modes are wired through the transcript store, this
// guard becomes the single source of truth for whether to render
// freeze HTML.

import { pipelineModeFor } from '../domain/capabilities/transcriptFreeze';
import { renderMarkdownAsync } from '../markdown/async';
import { HOT_WINDOW_SIZE, useTranscript } from '../stores/transcript';

let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    void evaluate();
  };
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(run, { timeout: 500 });
  } else {
    setTimeout(run, 100);
  }
}

async function evaluate() {
  const state = useTranscript.getState();
  // Slice 50: skip freezing when the active rendering pipeline mode
  // does not cache rendered HTML. The transcript store now carries
  // the live/replay/frozen mode (default `'live'`), and the catalog
  // is the source of truth for whether to cache.
  if (!pipelineModeFor(state.mode).cacheRenderedHtml) return;
  if (state.hotWindowIds.size <= HOT_WINDOW_SIZE) return;

  const completedInWindow: string[] = [];
  for (const id of state.order) {
    if (!state.hotWindowIds.has(id)) continue;
    const msg = state.messages.get(id);
    if (msg?.state === 'completed') {
      completedInWindow.push(id);
    }
  }

  // Freeze oldest completed until back under cap.
  const overflow = state.hotWindowIds.size - HOT_WINDOW_SIZE;
  const toFreeze = completedInWindow.slice(0, overflow);
  for (const id of toFreeze) {
    const msg = useTranscript.getState().messages.get(id);
    if (!msg || msg.isCold) continue;
    const html = await renderMarkdownAsync(id, msg.content);
    useTranscript.getState().freeze(id, html);
  }
}

export function onMessageCompleted(_id: string): void {
  schedule();
}
