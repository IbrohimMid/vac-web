//! Slice 32 (event-catalog parity): static-source check that every event id
//! emitted by the local bridge (via `emit_controller_event(_, "X", _)` or
//! direct `ServerEvent { event_type: "X".into(), .. }` literals) is present
//! in the generated `EVENT_CATALOG` constant or in an explicit allowlist of
//! ids we know are intentionally undeclared today.
//!
//! This intentionally scans *source files* on disk rather than runtime
//! call sites because the bridge runtime is large and most emitters live
//! behind multi-step async flows. Static scanning gives us a fast,
//! deterministic regression gate without the cost of integration setup.
//!
//! When you add a new `emit_controller_event(_, "foo.bar", _)` call you
//! have two options:
//!   1. add `foo.bar` to `config/control-plane/event-catalog.yaml` and
//!      regenerate (preferred), or
//!   2. add `foo.bar` to `KNOWN_UNCATALOGED_EVENTS` here, with a
//!      tracking comment, until step 1 lands.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use local_bridge::generated::event_catalog::EVENT_CATALOG;

/// Source subtree inside `apps/local-bridge/` that the parity scan reads.
/// Keep this broad: direct `ServerEvent` literals now live outside translator
/// modules too, and they must not bypass catalog ownership.
const SOURCE_ROOT: &str = "src";

/// Event ids that are emitted today but are not yet declared in
/// `event-catalog.yaml`. This list is the explicit migration backlog;
/// every entry here is a TODO to either promote into the catalog or
/// remove the emitter. Keep it sorted alphabetically.
// Slice 32: drained on 2026-05-18. Every production emitted id is now in
// `EVENT_CATALOG`; the allowlist stays as the migration-target shape
// so future emit sites can be tracked here before promotion.
const KNOWN_UNCATALOGED_EVENTS: &[&str] = &[];

/// Qualified event ids that only appear inside test helper code and are not
/// bridge protocol events. Keep this tiny and sorted; production emitters
/// belong in `event-catalog.yaml`, not here.
const TEST_ONLY_EVENTS: &[&str] = &["test.event"];

fn workspace_local_bridge_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR is `apps/local-bridge` when this test is built
    // by `cargo test -p local-bridge`. Source files are addressed
    // relative to that directory.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn collect_emitted_ids() -> HashSet<String> {
    let root = workspace_local_bridge_dir();
    let source_root = root.join(SOURCE_ROOT);
    let mut ids = HashSet::new();
    collect_emitted_ids_from_dir(&source_root, &mut ids);
    ids
}

fn collect_emitted_ids_from_dir(dir: &std::path::Path, ids: &mut HashSet<String>) {
    let entries = fs::read_dir(dir)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", dir.display()));
    for entry in entries {
        let entry = entry.unwrap_or_else(|err| panic!("failed to read dir entry: {err}"));
        let path = entry.path();
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        if file_name == "target" || file_name == "generated" {
            continue;
        }
        if path.is_dir() {
            collect_emitted_ids_from_dir(&path, ids);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));
        extract_ids(&content, ids);
    }
}

/// Extract every literal id from:
///   * `emit_controller_event(.., "X", ..)` helper calls
///   * direct `ServerEvent { event_type: "X".into(), .. }` literals
///
/// Only literal string arguments are considered; dynamic ids require a manual
/// catalog entry or a narrow allowlist entry until static extraction can prove
/// the exact emitted ids.
fn extract_ids(source: &str, out: &mut HashSet<String>) {
    extract_helper_call_ids(source, out);
    extract_event_type_literal_ids(source, out);
}

fn extract_helper_call_ids(source: &str, out: &mut HashSet<String>) {
    let needle = "emit_controller_event";
    let mut cursor = 0;
    while let Some(rel) = source[cursor..].find(needle) {
        let start = cursor + rel + needle.len();
        cursor = start;
        // skip until first '(' (the call open paren); bail if missing
        let bytes = source.as_bytes();
        let mut i = start;
        while i < bytes.len() && bytes[i] != b'(' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        // skip the first argument (the controller). Find the comma that
        // is at top-level (depth 0 ignoring the open paren).
        i += 1;
        let mut depth = 1i32;
        let mut comma_idx: Option<usize> = None;
        while i < bytes.len() && depth > 0 {
            match bytes[i] {
                b'(' => depth += 1,
                b')' => depth -= 1,
                b',' if depth == 1 => {
                    comma_idx = Some(i);
                    break;
                }
                _ => {}
            }
            i += 1;
        }
        let Some(c) = comma_idx else { continue };
        if let Some((id, next)) = literal_after_comma(source, c) {
            out.insert(id.to_string());
            cursor = next;
        }
    }
}

fn extract_event_type_literal_ids(source: &str, out: &mut HashSet<String>) {
    let needle = "event_type:";
    let mut cursor = 0;
    while let Some(rel) = source[cursor..].find(needle) {
        let start = cursor + rel + needle.len();
        cursor = start;
        let bytes = source.as_bytes();
        let mut j = start;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'"' {
            continue;
        }
        j += 1;
        let lit_start = j;
        while j < bytes.len() && bytes[j] != b'"' {
            j += 1;
        }
        if j >= bytes.len() {
            continue;
        }
        out.insert(source[lit_start..j].to_string());
        cursor = j + 1;
    }
}

fn literal_after_comma(source: &str, comma_idx: usize) -> Option<(&str, usize)> {
    let bytes = source.as_bytes();
    let mut j = comma_idx + 1;
    while j < bytes.len() && bytes[j].is_ascii_whitespace() {
        j += 1;
    }
    if j >= bytes.len() || bytes[j] != b'"' {
        // Non-literal id (e.g. a variable). Skip; the test cannot
        // statically verify these.
        return None;
    }
    j += 1;
    let lit_start = j;
    while j < bytes.len() && bytes[j] != b'"' {
        j += 1;
    }
    if j >= bytes.len() {
        return None;
    }
    Some((&source[lit_start..j], j + 1))
}

#[test]
fn catalog_ids_are_unique() {
    let mut seen: HashSet<&str> = HashSet::new();
    for entry in EVENT_CATALOG.iter() {
        assert!(
            seen.insert(entry.id),
            "duplicate event id in EVENT_CATALOG: {}",
            entry.id,
        );
    }
}

#[test]
fn catalog_ids_are_well_formed() {
    // Every id must look like `module.event` with snake_case segments.
    for entry in EVENT_CATALOG.iter() {
        let id = entry.id;
        assert!(
            id.contains('.'),
            "event id missing namespace separator: {id}"
        );
        for ch in id.chars() {
            assert!(
                ch.is_ascii_lowercase() || ch == '.' || ch == '_' || ch.is_ascii_digit(),
                "event id has unexpected char {ch:?}: {id}"
            );
        }
    }
}

#[test]
fn catalog_ids_are_sorted() {
    // The codegen pipeline sorts entries alphabetically; protect that
    // invariant so manual hand-edits don't silently regress drift
    // detection ergonomics.
    let ids: Vec<&str> = EVENT_CATALOG.iter().map(|e| e.id).collect();
    let mut sorted = ids.clone();
    sorted.sort();
    assert_eq!(
        ids, sorted,
        "EVENT_CATALOG must stay sorted alphabetically — re-run `node scripts/codegen-event-catalog.mjs`"
    );
}

#[test]
fn allowlist_does_not_overlap_catalog() {
    let catalog: HashSet<&str> = EVENT_CATALOG.iter().map(|e| e.id).collect();
    for id in KNOWN_UNCATALOGED_EVENTS {
        assert!(
            !catalog.contains(id),
            "event id {id:?} is now in EVENT_CATALOG — remove it from KNOWN_UNCATALOGED_EVENTS in tests/event_catalog_parity.rs"
        );
    }
}

#[test]
fn allowlist_is_sorted_and_unique() {
    let mut prev: Option<&str> = None;
    let mut seen: HashSet<&str> = HashSet::new();
    for id in KNOWN_UNCATALOGED_EVENTS {
        assert!(
            seen.insert(id),
            "duplicate id in KNOWN_UNCATALOGED_EVENTS: {id}"
        );
        if let Some(p) = prev {
            assert!(
                p < *id,
                "KNOWN_UNCATALOGED_EVENTS must be sorted; {p:?} should come after {id:?}"
            );
        }
        prev = Some(*id);
    }
}

#[test]
fn every_emitted_id_is_known() {
    let catalog: HashSet<&str> = EVENT_CATALOG.iter().map(|e| e.id).collect();
    let allowlist: HashSet<&str> = KNOWN_UNCATALOGED_EVENTS.iter().copied().collect();
    let test_only: HashSet<&str> = TEST_ONLY_EVENTS.iter().copied().collect();
    let emitted = collect_emitted_ids();
    // Only consider ids that look like `module.event`. Inner-event
    // strings like `"created"` or `"resume_failed"` are payload
    // discriminators on a structured event, not full event ids, and
    // are out of scope for this parity gate.
    let qualified: Vec<&str> = emitted
        .iter()
        .filter(|id| id.contains('.'))
        .map(|s| s.as_str())
        .collect();
    assert!(
        !qualified.is_empty(),
        "no emit_controller_event calls found"
    );

    let mut unknown: Vec<&str> = qualified
        .iter()
        .copied()
        .filter(|id| !catalog.contains(id) && !allowlist.contains(id) && !test_only.contains(id))
        .collect();
    unknown.sort();
    unknown.dedup();
    assert!(
        unknown.is_empty(),
        "emitted event ids not in catalog and not in KNOWN_UNCATALOGED_EVENTS: {:?}. \
         Either add them to config/control-plane/event-catalog.yaml (then regenerate) \
         or to KNOWN_UNCATALOGED_EVENTS in tests/event_catalog_parity.rs.",
        unknown
    );
}

#[test]
fn allowlist_entries_are_actually_emitted() {
    // Guard against the allowlist drifting out of sync. If an id is
    // listed but no longer emitted by the source, drop it.
    let emitted = collect_emitted_ids();
    let mut stale: Vec<&str> = KNOWN_UNCATALOGED_EVENTS
        .iter()
        .filter(|id| !emitted.contains(**id))
        .copied()
        .collect();
    stale.sort();
    assert!(
        stale.is_empty(),
        "stale entries in KNOWN_UNCATALOGED_EVENTS (no emitter found): {:?}. \
         Remove them from tests/event_catalog_parity.rs.",
        stale
    );
}
