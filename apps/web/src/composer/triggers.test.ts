// matchTrigger contract — locks the trigger detection used by both
// SlashPalette (`/`) and MentionPicker (`@`) entry points.

import { describe, expect, it } from 'vitest';
import { matchTrigger } from './triggers';

describe('matchTrigger — slash', () => {
  it('opens at editor start (single `/`)', () => {
    expect(matchTrigger('/', '/')).toBe('');
  });

  it('opens at editor start with query (`/foo`)', () => {
    expect(matchTrigger('/foo', '/')).toBe('foo');
  });

  it('opens after whitespace (`hello /qu`)', () => {
    expect(matchTrigger('hello /qu', '/')).toBe('qu');
  });

  it('opens after newline', () => {
    expect(matchTrigger('one\n/two', '/')).toBe('two');
  });

  it('does NOT open mid-word (`http://`)', () => {
    expect(matchTrigger('http://', '/')).toBeNull();
  });

  it('does NOT open when whitespace between trigger and caret (`/foo `)', () => {
    expect(matchTrigger('/foo ', '/')).toBeNull();
  });

  it('does NOT open when trigger absent', () => {
    expect(matchTrigger('hello world', '/')).toBeNull();
  });

  it('returns empty query when caret is right after `/`', () => {
    expect(matchTrigger('hello /', '/')).toBe('');
  });
});

describe('matchTrigger — mention', () => {
  it('opens at start with `@`', () => {
    expect(matchTrigger('@', '@')).toBe('');
  });

  it('opens after whitespace (`see @foo`)', () => {
    expect(matchTrigger('see @foo', '@')).toBe('foo');
  });

  it('does NOT open mid-word (`me@example`)', () => {
    expect(matchTrigger('me@example', '@')).toBeNull();
  });

  it('most-recent trigger wins (`@a @b`)', () => {
    // No whitespace between @b and caret → matches @b
    expect(matchTrigger('@a @b', '@')).toBe('b');
  });

  it('returns null when whitespace between trigger and caret (`@foo `)', () => {
    expect(matchTrigger('@foo ', '@')).toBeNull();
  });
});

describe('matchTrigger — empty input', () => {
  it('returns null on empty string', () => {
    expect(matchTrigger('', '/')).toBeNull();
    expect(matchTrigger('', '@')).toBeNull();
  });
});
