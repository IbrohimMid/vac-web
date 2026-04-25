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
  focus(): void;
  clear(): void;
}

interface Props {
  placeholder?: string;
  disabled?: boolean;
  /** Submit fired by Enter (Shift+Enter inserts a newline; Enter during
   *  IME composition is silently ignored — the composition handler manages it). */
  onSubmit(): void;
  /** Called on every input mutation with the live plain-text-ish view used to
   *  detect `/` + `@` triggers. Caller decides what to do (open palette/picker). */
  onTextChange(plainText: string, caret: { atStart: boolean; afterWhitespace: boolean }): void;
}

export const ContentEditable = forwardRef<ContentEditableHandle, Props>(
  function ContentEditable({ placeholder, disabled, onSubmit, onTextChange }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const [empty, setEmpty] = useState(true);

    useImperativeHandle(ref, () => ({
      root: () => rootRef.current,
      insertChip: (triggerText, chip) => insertChipAtTrigger(rootRef.current, triggerText, chip),
      focus: () => rootRef.current?.focus(),
      clear: () => {
        if (rootRef.current) {
          rootRef.current.innerHTML = '';
          setEmpty(true);
          onTextChange('', { atStart: true, afterWhitespace: true });
        }
      },
    }));

    const handleInput = () => {
      const root = rootRef.current;
      if (!root) return;
      const txt = root.textContent ?? '';
      setEmpty(txt.length === 0);
      const caret = inspectCaret(root);
      onTextChange(txt, caret);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
        e.preventDefault();
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

function inspectCaret(
  root: HTMLDivElement,
): { atStart: boolean; afterWhitespace: boolean } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return { atStart: true, afterWhitespace: true };
  }
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return { atStart: true, afterWhitespace: true };
  }
  // atStart: caret offset 0 in the first text-bearing child
  const atStart = range.startOffset === 0 && range.startContainer === root;
  // afterWhitespace: char immediately before caret is whitespace OR caret at start
  const node = range.startContainer;
  if (node.nodeType === 3) {
    const txt = node.nodeValue ?? '';
    const off = range.startOffset;
    if (off === 0) return { atStart, afterWhitespace: true };
    const prev = txt.charAt(off - 1);
    return { atStart, afterWhitespace: /\s/.test(prev) };
  }
  return { atStart, afterWhitespace: true };
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
