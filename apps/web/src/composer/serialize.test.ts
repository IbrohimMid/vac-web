// Stage I — serializer contract.
// vitest runs in node, but happy-dom isn't configured. We construct a
// minimal DOM-shaped fake (just the bits `serialize` reads: nodeType,
// nodeValue, tagName, childNodes, dataset, textContent) so tests stay in
// node mode without pulling jsdom into the build.

import { describe, expect, it } from 'vitest';
import { serialize, type MentionRef } from './serialize';

interface FakeNode {
  nodeType: number;
  nodeValue?: string | null;
  tagName?: string;
  childNodes?: FakeNode[];
  dataset?: Record<string, string>;
  textContent?: string;
}

const text = (s: string): FakeNode => ({ nodeType: 3, nodeValue: s });

const el = (
  tag: string,
  children: FakeNode[] = [],
  dataset: Record<string, string> = {},
  textContent?: string,
): FakeNode => ({
  nodeType: 1,
  tagName: tag.toUpperCase(),
  childNodes: children,
  dataset,
  ...(textContent !== undefined ? { textContent } : {}),
});

const chip = (m: MentionRef): FakeNode =>
  el(
    'span',
    [text(`@${m.label}`)],
    {
      mention: '1',
      mentionId: m.id,
      mentionKind: m.kind,
      mentionLabel: m.label,
      mentionPayload: m.payload,
    },
    `@${m.label}`,
  );

const root = (children: FakeNode[]): FakeNode => el('div', children);

describe('serialize', () => {
  it('plain text passes through', () => {
    const r = serialize(root([text('hello world')]) as unknown as Node);
    expect(r.text).toBe('hello world');
    expect(r.mentions).toEqual([]);
  });

  it('mention chip emits token + structured ref', () => {
    const m: MentionRef = {
      id: 'file:src/foo.ts',
      kind: 'file',
      label: 'src/foo.ts',
      payload: 'src/foo.ts',
    };
    const r = serialize(
      root([text('look at '), chip(m), text(' please')]) as unknown as Node,
    );
    expect(r.text).toBe('look at @src/foo.ts please');
    expect(r.mentions).toEqual([m]);
  });

  it('multiple chips preserve order', () => {
    const a: MentionRef = { id: 'a', kind: 'file', label: 'a.ts', payload: 'a.ts' };
    const b: MentionRef = { id: 'b', kind: 'file', label: 'b.ts', payload: 'b.ts' };
    const r = serialize(
      root([chip(a), text(' and '), chip(b)]) as unknown as Node,
    );
    expect(r.text).toBe('@a.ts and @b.ts');
    expect(r.mentions.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('<br> becomes \\n', () => {
    const r = serialize(
      root([text('one'), el('br'), text('two')]) as unknown as Node,
    );
    expect(r.text).toBe('one\ntwo');
  });

  it('block-level <div> wraps lines', () => {
    const r = serialize(
      root([
        el('div', [text('line one')]),
        el('div', [text('line two')]),
      ]) as unknown as Node,
    );
    expect(r.text).toBe('line one\nline two');
  });

  it('collapses 3+ consecutive newlines to 2', () => {
    const r = serialize(
      root([text('a'), el('br'), el('br'), el('br'), text('b')]) as unknown as Node,
    );
    expect(r.text).toBe('a\n\nb');
  });

  it('returns empty for null root', () => {
    const r = serialize(null);
    expect(r.text).toBe('');
    expect(r.mentions).toEqual([]);
  });

  it('chip without recursing into nested children', () => {
    // If chip happens to have nested text, it must NOT be included; only the
    // dataset.mentionLabel / @label token is emitted.
    const m: MentionRef = { id: 'x', kind: 'file', label: 'x.ts', payload: 'x.ts' };
    const chipWithExtra: FakeNode = {
      nodeType: 1,
      tagName: 'SPAN',
      dataset: {
        mention: '1',
        mentionId: m.id,
        mentionKind: m.kind,
        mentionLabel: m.label,
        mentionPayload: m.payload,
      },
      childNodes: [text('SHOULD_NOT_APPEAR')],
    };
    const r = serialize(root([chipWithExtra]) as unknown as Node);
    expect(r.text).toBe('@x.ts');
    expect(r.text).not.toContain('SHOULD_NOT_APPEAR');
  });

  it('trims surrounding whitespace', () => {
    const r = serialize(root([text('  hi  ')]) as unknown as Node);
    expect(r.text).toBe('hi');
  });
});
