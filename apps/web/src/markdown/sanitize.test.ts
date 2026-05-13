// Phase 2.6 red-team: DOMPurify sanitizer must neutralize common XSS vectors
// in message content.

import { describe, expect, it } from 'vitest';
import { sanitize } from './sanitize';

describe('markdown sanitizer', () => {
  const attacks = [
    { name: 'script tag', input: '<script>alert(1)</script>hello', forbid: /<script/i },
    { name: 'img onerror', input: '<img src=x onerror="alert(1)">', forbid: /onerror/i },
    { name: 'svg onload', input: '<svg onload="alert(1)"></svg>', forbid: /onload/i },
    { name: 'iframe', input: '<iframe src="http://evil"></iframe>', forbid: /<iframe/i },
    {
      name: 'javascript URI in anchor',
      input: '<a href="javascript:alert(1)">click</a>',
      forbid: /javascript:/i,
    },
    { name: 'style block', input: '<style>body{display:none}</style>', forbid: /<style/i },
    {
      name: 'event handler attr',
      input: '<p onmouseover="alert(1)">hi</p>',
      forbid: /onmouseover/i,
    },
    {
      name: 'data URI HTML',
      input: '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      forbid: /data:text\/html/i,
    },
    {
      name: 'embed tag',
      input: '<embed src="http://evil"></embed>',
      forbid: /<embed/i,
    },
    {
      name: 'object tag',
      input: '<object data="http://evil"></object>',
      forbid: /<object/i,
    },
  ];

  for (const a of attacks) {
    it(`neutralizes: ${a.name}`, () => {
      const out = sanitize(a.input);
      expect(out).not.toMatch(a.forbid);
    });
  }


  it('blocks file URI anchors in generic markdown output', () => {
    const out = sanitize('<a href="file:///etc/passwd">local</a>');
    expect(out).not.toMatch(/href="file:/i);
    expect(out).toContain('local');
  });

  it('blocks file URI images in generic markdown output', () => {
    const out = sanitize('<img src="file:///etc/passwd" alt="local file">');
    expect(out).not.toMatch(/src="file:/i);
    expect(out).toContain('alt="local file"');
  });

  it('preserves safe markdown output', () => {
    const input =
      '<p><strong>bold</strong> <em>italic</em> <a href="https://example.com">link</a></p>';
    const out = sanitize(input);
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    expect(out).toContain('href="https://example.com"');
  });

  it('adds rel+target to external anchors', () => {
    const out = sanitize('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('allows data-lang attr on pre blocks (for Shiki)', () => {
    const out = sanitize('<pre data-lang="rust"><code>fn main(){}</code></pre>');
    expect(out).toContain('data-lang="rust"');
  });
});
