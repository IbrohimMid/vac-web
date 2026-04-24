// Full markdown rendering path — used on transcript.completed and for
// ColdMessage serialization. Emits `<pre data-lang="...">` blocks for Phase 2.2
// syntax-highlight hook.

import MarkdownIt from 'markdown-it';
import { sanitize } from './sanitize';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

// Wrap fenced code blocks with data-lang for Shiki integration.
const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
  const token = tokens[idx];
  if (!token) return defaultFence ? defaultFence(tokens, idx, options, env, slf) : '';
  const info = token.info.trim();
  const lang = info ? info.split(/\s+/)[0] : '';
  const content = token.content;
  const escaped = md.utils.escapeHtml(content);
  const langAttr = lang ? ` data-lang="${md.utils.escapeHtml(lang)}"` : '';
  return `<pre${langAttr}><code>${escaped}</code></pre>\n`;
};

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const rendered = md.render(src);
  return sanitize(rendered);
}
