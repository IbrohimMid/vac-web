# Plan 25 — Mention search + context attach

**Phase**: 3 · **Depends on**: Plans 13, 24 (optional) · **Blocks**: Phase 3 exit · **Est**: 1 day

## Goal

`@` in the composer opens a fuzzy picker over project files + (optionally) connector sources. Selected mentions attach as context to the message. Paste tray manages multi-attachments.

## Why this is hard

Fuzzy search at interactive latency requires good indexing. File sets can be 10k+. Plus: connectors add heterogeneous items (Notion pages, PRs, Figma frames) that must coexist in one picker.

## Scope

### In
- `context.mention_search` bridge endpoint.
- File indexer (using `ignore` crate for gitignore-aware walk + `nucleo-matcher` for fuzzy score).
- Composer `@` trigger.
- Picker overlay with fuzzy filter + result previews.
- Attachments tray in composer.
- Paste detection: files, URLs, code blocks.

### Out
- Connector mention sources for v1 (stub interface; fill in Phase 4 as RTD/PM need it).
- Saved context presets (post-v1).

## Deliverables

```
apps/local-bridge/src/context/
├── mod.rs
├── file_index.rs         # walk + index
├── search.rs             # fuzzy match against index
├── attach.rs             # resolve attachments → injected into prompt
apps/web/src/
├── components/Composer/
│   ├── MentionPicker.tsx
│   ├── AttachmentsTray.tsx
│   └── PasteHandler.ts
```

## Stages

### S1 — File indexer (0.2 day)

```rust
pub struct FileIndex {
    pub project_root: PathBuf,
    pub paths: Vec<IndexedPath>,
    pub last_rebuild: Instant,
}
pub struct IndexedPath {
    pub rel: String,
    pub size: u64,
    pub mtime: i64,
    pub kind: FileKind,     // source / doc / test / ...
}
impl FileIndex {
    pub fn rebuild(project_root: &Path) -> Self { ... walk with ignore crate ... }
    pub fn incremental_update(&mut self, events: &[FsEvent]) { ... }
}
```

Watch project root with `notify` crate; incremental updates on change events.

Emit `FileIndexReady` once initial walk done.

**Exit**: index for 10k-file repo in < 2s; incremental in < 50ms.

### S2 — Fuzzy search (0.2 day)

```rust
pub fn search(query: &str, index: &FileIndex, limit: usize) -> Vec<MentionResult> {
    use nucleo_matcher::{Matcher, Config, Utf32Str};
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut scored: Vec<_> = index.paths.iter()
        .filter_map(|p| {
            let s = Utf32Str::Ascii(p.rel.as_bytes());
            matcher.fuzzy_match(s, Utf32Str::Ascii(query.as_bytes())).map(|score| (score, p))
        })
        .collect();
    scored.sort_by_key(|(s, _)| std::cmp::Reverse(*s));
    scored.into_iter().take(limit).map(|(_, p)| p.into()).collect()
}
```

Bridge endpoint: `context.mention_search { query, limit }` → results.

Optional: include connector items (PR, Notion page) from recently accessed sources.

**Exit**: 10k files searched in < 10ms.

### S3 — Composer `@` trigger (0.2 day)

In composer textarea:
- On each keystroke, detect if cursor is inside `@<token>` (simple regex on current line + cursor position).
- When `@<at least 1 char>`: open `file_search` overlay at cursor position anchored.
- Typing updates query.
- `↑/↓` navigates; `Enter` selects; `Esc` dismisses.

**Exit**: `@read` shows fuzzy-matched paths.

### S4 — `<MentionPicker/>` (0.2 day)

Overlay kind `file_search`. Anchored to composer cursor (popover, not center modal).

```tsx
function MentionPicker({ query, onPick, onCancel }) {
  const { data, isLoading } = useQuery(['mention-search', query],
    () => transport.send(sessionId, 'context.mention_search', { query, limit: 10 }));
  const [focused, setFocused] = useState(0);
  return (
    <div className="mention-picker" role="listbox">
      {data?.results.map((r, i) => (
        <div key={r.id} role="option" data-focused={i === focused} onClick={() => onPick(r)}>
          <KindIcon kind={r.kind} />
          <span>{r.rel}</span>
          <small>{r.preview}</small>
        </div>
      ))}
      {isLoading && <div>Searching...</div>}
    </div>
  );
}
```

Kind icons: file, doc, pr, notion-page, figma-frame (later).

**Exit**: picker navigates + picks correctly.

### S5 — Attachment tray (0.1 day)

Selected mentions become "chips" in composer bottom row:
```tsx
function AttachmentsTray() {
  const items = useComposer(s => s.attachments);
  return (
    <div className="attachments">
      {items.map(a => (
        <span key={a.id} className="chip">
          <KindIcon kind={a.kind} />
          {a.label}
          <button onClick={() => removeAttachment(a.id)}>×</button>
        </span>
      ))}
    </div>
  );
}
```

Click chip → preview (overlay or inline tooltip).

On submit: attachments included in `message.submit { text, attachments: [...] }`.

**Exit**: chips show, remove, include in submission.

### S6 — Paste handler (0.2 day)

On paste event in composer:
- Detect kind:
  - **File path** (regex: absolute or relative path) → attach as file reference.
  - **URL** (GitHub PR, Notion page, Figma) → attach as connector reference.
  - **Code block** (multi-line with `{` / `(` etc.) → create a temporary code attachment.
  - **Plain text** → insert as text.
- Show paste tray with detected kinds; user can convert (e.g., "paste as code" vs "paste as text").

Security: scan for secrets; if detected → warn + refuse to attach (avoid leaking tokens into prompts).

**Exit**: pasting a PR URL creates a PR attachment chip.

### S7 — Bridge attach resolver (0.1 day)

On `message.submit { attachments: [...] }`:
- For each attachment: fetch + inject content.
- File: `read_file` (respecting profile).
- PR / Notion / Figma: `connector.read.*` call.
- Secrets scan: rerun on fetched content; if secret → drop + emit warning notify.

Resolved content inserted as context block in prompt (engine handles).

**Exit**: mentioned file contents reach the agent prompt.

## Testing

- Unit: fuzzy search with fixtures.
- Integration: paste PR URL → chip → resolved in engine prompt.
- Perf: 10k-file index, search latency.

## Exit criteria

- [ ] `@` picker finds files fast (< 50ms round-trip).
- [ ] Paste detects common kinds.
- [ ] Attachments included in submission.
- [ ] Secret paste refused.

## Risks

| Risk | Mitigation |
|---|---|
| Large project root walk slow | `ignore` crate respects gitignore; async; progressive availability |
| Notify events spamming incremental update | Debounce |
| Connector item search slow | Scope to "recently accessed" only in v1 |
| Keyboard interaction conflicts with composer | Picker overlay captures keys while open; composer idle |

## Related

- [`connectors.md`](../../connectors.md)
- Plan 17 — palette (shares fuzzy patterns)
- Plan 19 — overlays
