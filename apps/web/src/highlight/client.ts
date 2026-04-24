// Main-thread highlight client: dispatches to worker + caches promises.

let worker: Worker | null = null;
const pending = new Map<string, (html: string) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/shiki.worker.ts', import.meta.url), {
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

function newId(): string {
  return Math.random().toString(36).slice(2);
}

export function highlight(code: string, lang: string, theme = 'github-light'): Promise<string> {
  return new Promise<string>((resolve) => {
    const id = newId();
    pending.set(id, resolve);
    getWorker().postMessage({ id, code, lang, theme });
    // Timeout fallback — 2s.
    setTimeout(() => {
      if (pending.delete(id)) {
        resolve(`<pre><code>${escape(code)}</code></pre>`);
      }
    }, 2000);
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
