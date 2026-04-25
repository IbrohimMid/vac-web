// contentEditable serialization (Stage I).
//
// Walks the editor DOM and emits:
//   - `text`: plain string with mention chips replaced by `@<label>` tokens
//             (so the server-side prompt sees a readable form).
//   - `mentions`: structured array preserving id/kind/label/payload binding.
//
// The chip is identified by `data-mention="1"` + `data-mention-id` /
// `-kind` / `-label` / `-payload` attributes set on insertion. Anything
// else (including pasted text) is treated as plain text.
//
// Block-level breaks (<br>, <div>, <p>) become `\n` in the output so a
// multi-line composer message reads as multi-line text on submit.

export interface MentionRef {
  id: string;
  kind: 'file' | 'url' | 'page';
  label: string;
  payload: string;
}

export interface SerializeResult {
  text: string;
  mentions: MentionRef[];
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'BR']);

export function serialize(root: Node | null): SerializeResult {
  if (!root) return { text: '', mentions: [] };
  const out: string[] = [];
  const mentions: MentionRef[] = [];
  walk(root, out, mentions, true);
  // Trim trailing whitespace + collapse repeated newlines (>2 → 2).
  const text = out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
  return { text, mentions };
}

function walk(node: Node, out: string[], mentions: MentionRef[], isRoot: boolean): void {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    out.push(node.nodeValue ?? '');
    return;
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
  const el = node as HTMLElement;

  // Mention chip — emit token + structured ref, do NOT recurse.
  if (el.dataset.mention === '1') {
    const id = el.dataset.mentionId ?? '';
    const kind = (el.dataset.mentionKind as MentionRef['kind']) ?? 'file';
    const label = el.dataset.mentionLabel ?? el.textContent ?? '';
    const payload = el.dataset.mentionPayload ?? '';
    mentions.push({ id, kind, label, payload });
    out.push(`@${label}`);
    return;
  }

  const tag = el.tagName;

  // <br> always breaks; nested <div>/<p> break only when the previous sibling
  // produced text (matches contenteditable's "press Enter ⇒ <div><br></div>"
  // shape on most browsers).
  if (tag === 'BR') {
    out.push('\n');
    return;
  }

  if (BLOCK_TAGS.has(tag) && !isRoot) {
    const last = out[out.length - 1];
    if (last && !last.endsWith('\n')) out.push('\n');
  }

  for (const child of Array.from(el.childNodes)) {
    walk(child, out, mentions, false);
  }
}
