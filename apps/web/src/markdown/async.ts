// Main-thread dispatcher: below threshold → sync, above → worker.

import { renderMarkdown } from './full';
import { get as cacheGet, put as cachePut } from './cache';

const THRESHOLD = 20_000;

let worker: Worker | null = null;
const pending = new Map<string, (html: string) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<{ id: string; html: string }>) => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data.html);
      }
    };
  }
  return worker;
}

export async function renderMarkdownAsync(id: string, src: string): Promise<string> {
  const cached = cacheGet(id, src);
  if (cached !== null) return cached;
  if (src.length < THRESHOLD) {
    const html = renderMarkdown(src);
    cachePut(id, src, html);
    return html;
  }
  return new Promise<string>((resolve) => {
    pending.set(id, (html) => {
      cachePut(id, src, html);
      resolve(html);
    });
    getWorker().postMessage({ id, src });
  });
}
