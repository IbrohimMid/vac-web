// Single DOMPurify config shared between streaming renderer, completed-render
// path, and ColdMessage serialization. Any change here affects all three.

import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p', 'a', 'strong', 'em', 'code', 'pre', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'hr', 'br',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'img',
  'details', 'summary',
];

const ALLOWED_ATTR = [
  'href', 'title', 'src', 'alt', 'class', 'id',
  'target', 'rel',
  'data-lang', 'data-highlighted', 'data-msg-id',
];

const FORBID_ATTR = ['style', 'onerror', 'onload', 'onclick', 'onmouseover'];

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|file):|\/|#|$)/i;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if ('target' in node && node.tagName === 'A') {
    (node as HTMLAnchorElement).setAttribute('target', '_blank');
    (node as HTMLAnchorElement).setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitize(raw: string): string {
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: true,
  });
}
