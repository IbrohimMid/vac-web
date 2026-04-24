// IntersectionObserver controller: finds `<pre data-lang>` blocks not yet
// highlighted, highlights them when they scroll into view.
//
// Attached once per <Transcript/> root. Observes mutations so newly-added
// blocks (cold messages appearing via dangerouslySetInnerHTML) get picked up.

import { highlight } from './client';

const observedRoots = new WeakSet<Element>();

export function attachHighlightObserver(root: Element | null, theme?: string): () => void {
  if (!root || observedRoots.has(root)) return () => {};
  observedRoots.add(root);

  const visibility = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pre = entry.target as HTMLPreElement;
        const lang = pre.dataset.lang;
        if (!lang) continue;
        if (pre.dataset.highlighted === 'true') continue;
        const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
        // `theme` undefined → client detects from data-theme / prefers-color-scheme.
        void highlight(code, lang, theme as string).then((html) => {
          if (pre.isConnected) {
            pre.outerHTML = html;
          }
        });
        pre.dataset.highlighted = 'pending';
        visibility.unobserve(pre);
      }
    },
    { root: root as HTMLElement, rootMargin: '200px' },
  );

  const observeNewBlocks = () => {
    const blocks = root.querySelectorAll<HTMLPreElement>(
      'pre[data-lang]:not([data-highlighted])',
    );
    blocks.forEach((b) => visibility.observe(b));
  };

  const mut = new MutationObserver(observeNewBlocks);
  mut.observe(root, { subtree: true, childList: true });
  observeNewBlocks();

  return () => {
    mut.disconnect();
    visibility.disconnect();
  };
}
