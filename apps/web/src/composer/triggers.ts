// Pure trigger matchers — extracted from Composer/ContentEditable so the
// detection logic is testable without a real DOM.
//
// Both `/` and `@` triggers fire when the trigger char appears at the start
// of the text-before-caret OR after whitespace, with no whitespace between
// trigger and caret. This shape matches the prototype's UX while staying
// independent of how the editor exposes caret position.
//
// Returns the query (chars after the trigger up to caret) on match, or
// `null` when no trigger is currently active.

export function matchTrigger(textBeforeCaret: string, trigger: '/' | '@'): string | null {
  // Walk back from caret. Find the most-recent trigger occurrence that is
  // either at offset 0 or preceded by whitespace, with no whitespace between
  // it and caret end.
  for (let i = textBeforeCaret.length - 1; i >= 0; i--) {
    const ch = textBeforeCaret[i];
    if (ch === undefined) continue;
    // Whitespace between caret and trigger position invalidates a non-yet-found
    // match — `/foo bar` with caret at end is no longer a slash trigger.
    if (/\s/.test(ch)) return null;
    if (ch === trigger) {
      const before = i === 0 ? '' : textBeforeCaret[i - 1] ?? '';
      if (i === 0 || /\s/.test(before)) {
        return textBeforeCaret.slice(i + 1);
      }
      return null;
    }
  }
  return null;
}
