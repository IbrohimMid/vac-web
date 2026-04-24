// Shiki syntax highlight worker. Single-entry: receive `{id, code, lang, theme}`,
// reply `{id, html}`. Highlighter cached; LRU of (lang+theme+hash) results.

/// <reference lib="webworker" />
import { createHighlighter, type Highlighter } from 'shiki';

interface Req {
  id: string;
  code: string;
  lang: string;
  theme: string;
}
interface Resp {
  id: string;
  html: string;
}

const INITIAL_LANGS = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'rust',
  'python',
  'bash',
  'json',
  'yaml',
  'go',
  'sql',
  'html',
  'css',
  'markdown',
];
const INITIAL_THEMES = ['github-light', 'github-dark'];

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: INITIAL_THEMES,
      langs: INITIAL_LANGS,
    });
  }
  return highlighterPromise;
}

const cache = new Map<string, string>();
const CACHE_CAP = 500;

function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, code, lang, theme } = e.data;
  const key = `${lang}|${theme}|${hashStr(code)}`;
  let html = cache.get(key);
  if (!html) {
    try {
      const highlighter = await getHighlighter();
      // Lazy-load language if not already loaded.
      const loaded = highlighter.getLoadedLanguages();
      const langToUse = loaded.includes(lang as never) ? lang : 'plaintext';
      html = highlighter.codeToHtml(code, { lang: langToUse, theme });
      if (cache.size >= CACHE_CAP) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, html);
    } catch {
      // Fallback: escape + wrap in pre.
      html = `<pre class="shiki-fallback"><code>${escape(code)}</code></pre>`;
    }
  }
  (self as unknown as Worker).postMessage({ id, html } satisfies Resp);
};

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
