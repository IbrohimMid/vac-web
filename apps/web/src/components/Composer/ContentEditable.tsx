// contentEditable composer (Stage I, behind `vac.composer.experimental`).
//
// Owns the editor div + IME guard + paste-as-plain-text + `/` and `@`
// trigger detection. Mention chip insertion delegated to caller via
// `onMentionInsert(node)` so MentionPicker stays callback-driven.
//
// Submit serialization happens in the parent via `serialize(rootRef.current)`.

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

export interface ContentEditableHandle {
  /** Returns the live editor root for the parent to serialize. */
  root(): HTMLDivElement | null;
  /** Insert a mention chip at the current selection, replacing the trigger
   *  range (`@queryText`) the caller passed in, then place caret after the chip. */
  insertChip(triggerText: string, chip: HTMLElement): void;
  replaceTriggerText(triggerText: string, text: string): void;
  focus(): void;
  clear(): void;
}

interface Props {
  placeholder?: string;
  disabled?: boolean;
  /** When true, Enter still preventDefaults the editor's newline insertion
   *  but does NOT call `onSubmit` — the active picker/palette is expected
   *  to consume the Enter via its own listener. */
  submitDisabled?: boolean;
  /** Submit fired by Enter (Shift+Enter inserts a newline; Enter during
   *  IME composition is silently ignored — the composition handler manages it). */
  onSubmit(): void;
  /** Called on every input mutation with:
   *   - `plain`: full plain-text view of the editor (for empty-state etc.)
   *   - `textBefore`: text from start of editor up to the caret (used by
   *     pure trigger matchers in `composer/triggers.ts`). */
  onTextChange(plain: string, textBefore: string): void;
}

export const ContentEditable = forwardRef<ContentEditableHandle, Props>(
  function ContentEditable(
    { placeholder, disabled, submitDisabled, onSubmit, onTextChange },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const [empty, setEmpty] = useState(true);

    useImperativeHandle(ref, () => ({
      root: () => rootRef.current,
      insertChip: (triggerText, chip) => insertChipAtTrigger(rootRef.current, triggerText, chip),
      replaceTriggerText: (triggerText, text) => replaceTriggerTextAtCaret(rootRef.current, triggerText, text),
      focus: () => rootRef.current?.focus(),
      clear: () => {
        if (rootRef.current) {
          rootRef.current.innerHTML = '';
          setEmpty(true);
          onTextChange('', '');
        }
      },
    }));

    const handleInput = () => {
      const root = rootRef.current;
      if (!root) return;
      const txt = root.textContent ?? '';
      setEmpty(txt.length === 0);
      const before = textBeforeCaret(root);
      onTextChange(txt, before);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // IME composition owns Enter; let the browser commit the candidate.
        if (composingRef.current) return;
        // Always preventDefault so the editor never inserts a stray newline
        // when the user wanted to submit / invoke a palette item.
        e.preventDefault();
        // When a picker/palette is open, do NOT submit. The picker's window
        // listener fires next (preventDefault doesn't stop propagation) and
        // owns this Enter.
        if (submitDisabled) return;
        onSubmit();
      }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      insertPlainText(text);
      handleInput();
    };

    return (
      <div
        ref={rootRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Composer"
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          // Some browsers fire 'compositionend' AFTER 'input' for the final char;
          // sync once more so onTextChange reflects the committed text.
          handleInput();
        }}
        data-placeholder={empty ? placeholder : undefined}
        data-experimental-composer="1"
        style={{
          minHeight: 56,
          padding: '12px 14px',
          outline: 'none',
          color: 'var(--ink)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-body)',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      />
    );
  },
);

// ---- DOM helpers --------------------------------------------------------

function insertPlainText(text: string): void {
  // Replace newlines with <br> so multi-line paste preserves visual structure
  // while keeping the underlying nodes simple (text + <br> only, no <div>).
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const lines = text.split(/\r?\n/);
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'));
    if (line.length > 0) frag.appendChild(document.createTextNode(line));
  });
  const lastChild = frag.lastChild;
  range.insertNode(frag);
  // Move caret to end of pasted content.
  if (lastChild) {
    range.setStartAfter(lastChild);
    range.setEndAfter(lastChild);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * Returns the editor's plain-text content from start up to the caret position
 * in document order. Used by `composer/triggers.ts::matchTrigger` so trigger
 * detection can reason about real char-before-trigger context (the previous
 * `inspectCaret` shape only saw the char immediately before the caret, which
 * was always the trigger char itself the moment it was typed).
 *
 * Walks DOM in order; mention chips contribute `@<label>` (matching the
 * serializer); <br> contributes \n; child collection stops at the caret's
 * range.startContainer + range.startOffset.
 */
function textBeforeCaret(root: HTMLDivElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return '';
  const out: string[] = [];
  collect(root, range.startContainer, range.startOffset, out, true);
  return out.join('');
}

/** Returns true if collection should stop (caret reached). */
function collect(
  node: Node,
  stopNode: Node,
  stopOffset: number,
  out: string[],
  isRoot: boolean,
): boolean {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const txt = node.nodeValue ?? '';
    if (node === stopNode) {
      out.push(txt.slice(0, stopOffset));
      return true;
    }
    out.push(txt);
    return false;
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return false;
  const el = node as HTMLElement;
  // Mention chip — emit `@<label>`, do NOT recurse.
  if (el.dataset.mention === '1') {
    const label = el.dataset.mentionLabel ?? el.textContent ?? '';
    out.push(`@${label}`);
    return el === stopNode;
  }
  if (el.tagName === 'BR') {
    out.push('\n');
    return el === stopNode;
  }
  // Block break before nested div/p (matches serializer behavior).
  if (!isRoot && (el.tagName === 'DIV' || el.tagName === 'P')) {
    const last = out[out.length - 1];
    if (last && !last.endsWith('\n')) out.push('\n');
  }
  // If caret is `(stopNode === el, stopOffset = N)` that means caret sits
  // before the Nth child. Iterate children, stopping when we hit the boundary.
  const childList = Array.from(el.childNodes);
  if (el === stopNode) {
    for (let i = 0; i < stopOffset && i < childList.length; i++) {
      const child = childList[i];
      if (child) collect(child, stopNode, stopOffset, out, false);
    }
    return true;
  }
  for (const child of childList) {
    if (collect(child, stopNode, stopOffset, out, false)) return true;
  }
  return false;
}


function replaceTriggerTextAtCaret(root: HTMLDivElement | null, triggerText: string, text: string): void {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== 3) {
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    return;
  }
  const before = (node.nodeValue ?? '').slice(0, range.startOffset);
  if (before.endsWith(triggerText)) {
    range.setStart(node, before.length - triggerText.length);
    range.deleteContents();
  }
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function insertChipAtTrigger(
  root: HTMLDivElement | null,
  triggerText: string,
  chip: HTMLElement,
): void {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  // Walk back from the caret to find `triggerText` ending at the caret
  // position. If found, replace it with the chip + a trailing space.
  const node = range.startContainer;
  if (node.nodeType !== 3) return;
  const before = (node.nodeValue ?? '').slice(0, range.startOffset);
  if (!before.endsWith(triggerText)) {
    // Defensive: just insert chip at caret without replacing.
    range.insertNode(chip);
  } else {
    const start = before.length - triggerText.length;
    range.setStart(node, start);
    range.deleteContents();
    range.insertNode(chip);
  }
  // Trailing space + caret after.
  const space = document.createTextNode(' ');
  chip.parentNode?.insertBefore(space, chip.nextSibling);
  range.setStartAfter(space);
  range.setEndAfter(space);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Build a mention chip DOM node ready to pass to `insertChip`. */
export function buildMentionChip(opts: {
  id: string;
  kind: 'file' | 'url' | 'page';
  label: string;
  payload: string;
}): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'context-chip';
  span.contentEditable = 'false';
  span.dataset.mention = '1';
  span.dataset.mentionId = opts.id;
  span.dataset.mentionKind = opts.kind;
  span.dataset.mentionLabel = opts.label;
  span.dataset.mentionPayload = opts.payload;
  span.textContent = `@${opts.label}`;
  return span;
}
