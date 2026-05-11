# Agent Turn Trace Layout UI Plan

Status: planned
Repo: `IbrohimMid/vac-web`
Local path: `/home/emp/Documents/VAC/vac-web`
Target area: VAC-WEB AgentThread / agent session UI
Target commit title: `fix(web): polish agent turn trace layout`

## Goal

Polish the VAC-WEB agent transcript so it behaves like a human-readable agent turn rather than a raw chronological event log.

The final UX should be:

```text
User prompt

[Reasoning] collapsed
  Thought / analysis / planning stream

[Tool Activity] collapsed summary
  Search · 4
  Read · 8
  Command · 2
  Edit · 3
  Browser · 1
  Sub-agent · 1

[Plan] optional compact/collapsed

Final assistant response
```

## User-visible problems to fix

1. Assistant response can appear above tool calls. It should be anchored at the bottom of the turn.
2. Tool calls are too noisy. They should be collapsed by default.
3. Tool calls are not grouped by type. They should be grouped as Search, Read, Command, Edit, Browser/Web, Sub-agent, Other.
4. Reasoning/thought and final response are visually mixed. Reasoning needs a dedicated collapsible box.
5. Assistant markdown is shown as raw text in places, so `**bold**` appears with visible stars.
6. Raw/debug timeline should remain available, but not be the default reading experience.

## Research basis

### Zed patterns

- Zed Agent Panel is a chat + tool-calling surface where agents can read, edit, and run code.
- Zed groups capabilities by profile/mode: write-like, ask/read-only-like, minimal-like.
- Zed tools are conceptually grouped into read/search tools, edit tools, terminal/command activity, and other tools.
- Zed external agents via ACP can have different capabilities, so UI must degrade honestly and not invent fake metadata.

### Trae patterns

- Trae/Trae SOLO style emphasizes an execution trace: task, thought/reasoning, sub-agent/tool activity, created/read/searched/edited/ran summary, then final outcome.
- Reasoning is visually separate and collapsible.
- Tool activity is summarized first and details are available on demand.

## Current VAC-WEB audit notes

Relevant files:

```text
apps/web/src/components/AgentThread/AgentThread.tsx
apps/web/src/components/AgentThread/AgentThread.render.test.tsx
apps/web/src/domain/agentSession/handlers.ts
apps/web/src/domain/agentSession/handlers.test.ts
apps/web/src/stores/agentSession.ts
apps/web/src/components/toolActivity/ToolActivityLane.tsx
apps/web/src/components/Transcript/ToolCallBlock.tsx
apps/web/src/components/cockpit/BuildSurface.tsx
```

Known structures already available:

```ts
type AgentToolKind = 'read' | 'edit' | 'execute' | 'other';
type AgentThreadItemKind = 'assistant' | 'thought' | 'tool' | 'plan';
```

`AgentTurn` already tracks:

```text
assistantBlockIds
thinkingBlockIds
toolCallIds
planId
```

`AgentToolCall` already has useful metadata:

```text
rawInput
rawOutput
parentToolCallId
subagentType
createdAt
updatedAt
```

Current problem: `AgentThread.tsx` effectively behaves like a chronological timeline. There is already a `ThinkingBlock` and `ToolCallCard`, but they do not yet produce the desired Trae/Zed-style turn composition.

## Implementation principles

1. Do not over-engineer backend. This should be mostly frontend composition/rendering.
2. Keep raw chronological data for debugging; do not use it as the default visual order.
3. Be honest. If no thought metadata exists, do not fake reasoning. If a tool cannot be classified, place it in `Other`.
4. Sort by time only inside each visual section/group, not across the whole turn.
5. Tool output remains plain/monospace. Assistant response gets markdown rendering.
6. Failed tools or approval-required tools may auto-open/highlight; completed tools stay collapsed.

## Phase 0 — Preflight audit

Checklist:

```yaml
preflight:
  - check_disk_space
  - check_git_status
  - confirm_HEAD_and_origin
  - inspect_agent_thread_files
  - inspect_existing_markdown_renderer
  - identify_tests_that_lock_chronological_order
```

Use `grep -rn` and `find`; do not use `rg`.

UX impact: prevents blind edits and keeps the implementation scoped to visible transcript problems.

## Phase 1 — Turn Composition View Model

Create a frontend composition layer so visual layout is not driven by raw event arrival order.

Target type:

```ts
type AgentTurnComposition = {
  turnId: string;
  userMessage?: AgentThreadItem;
  reasoningBlocks: AgentThoughtBlock[];
  toolCalls: AgentToolCall[];
  plan?: AgentPlan;
  assistantBlocks: AgentAssistantBlock[];
  rawItems: AgentThreadItem[];
};
```

Target render order:

```tsx
<AgentTurnCard>
  <UserPrompt />
  <ReasoningSection blocks={composition.reasoningBlocks} />
  <ToolActivitySection tools={composition.toolCalls} />
  <PlanSection plan={composition.plan} />
  <FinalAnswerBlock blocks={composition.assistantBlocks} />
  <RawTimelineDebug items={composition.rawItems} />
</AgentTurnCard>
```

Tests:

```text
renders final assistant response after tool activity
late tool update does not move final answer above tool activity
thinking block renders in reasoning section regardless of stream arrival order
```

UX impact: the final answer becomes the bottom-line outcome of the turn, not a random stream fragment.

## Phase 2 — Dedicated Reasoning Section

Target UI:

```text
▸ Reasoning · 3 thoughts · 1.2k chars
```

Rules:

```yaml
reasoning_section:
  default_collapsed: true
  hidden_when_empty: true
  source_of_truth: transcript.thought_delta
  fallback_markers:
    - '<think>...</think>'
    - 'Thought:'
    - 'Reasoning:'
  avoid_aggressive_splitting: true
```

Do not split ordinary markdown such as `**Reasoning**` unless the marker is explicit and safe.

Tests:

```text
reasoning renders in a dedicated collapsed section
assistant final answer does not include thought_delta content
explicit <think> content is stripped from final answer and shown in reasoning fallback
regular markdown bold is not misclassified as reasoning
```

UX impact: reasoning becomes inspectable on demand but no longer pollutes the answer.

## Phase 3 — Tool Activity Grouping

Add classifier:

```ts
type ToolGroupId =
  | 'search'
  | 'read'
  | 'command'
  | 'edit'
  | 'browser'
  | 'subagent'
  | 'other';
```

Suggested mapping:

```yaml
tool_groups:
  search:
    label: Search
    names: [grep, glob, codesearch, search, find_path, lsp]
  read:
    label: Read
    kinds: [read]
    names: [read, read_file, list_directory, diagnostics]
  command:
    label: Command
    kinds: [execute]
    names: [bash, shell, command, terminal, execute]
  edit:
    label: Edit
    kinds: [edit]
    names: [edit, write, apply_patch, save_file, create_directory, delete_path, move_path]
  browser:
    label: Browser / Web
    names: [webfetch, fetch, browser, search_web]
  subagent:
    label: Sub-agent
    condition: subagentType_present
  other:
    label: Other
```

Default open policy:

```yaml
tool_group_open_policy:
  completed: false
  running: false
  failed: true
  requires_approval: true
  debug_mode: true

tool_card_open_policy:
  completed: false
  running: false
  failed: true
  requires_approval: true
  nested_subagent: false
```

Tests:

```text
groups grep and glob under Search
groups bash under Command
groups read/read_file/list_directory under Read
groups edit/write/apply_patch under Edit
groups subagent tools separately
tool groups are collapsed by default
failed tool group opens or highlights by default
```

UX impact: the transcript becomes scannable. Users can see what the agent did without reading every tool payload.

## Phase 4 — Trae-style Tool Summary

Target summary:

```text
Tool Activity · Searched 6 · Read 12 · Ran 3 · Edited 4
```

Summary labels:

```yaml
summary_labels:
  search: Searched
  read: Read
  command: Ran
  edit: Edited
  browser: Browsed
  subagent: Delegated
  failed: Failed
  approval: Needs approval
```

UX impact: gives confidence that the agent worked while keeping the UI quiet.

## Phase 5 — Final Answer Markdown Rendering

Problem: assistant response sometimes renders raw markdown stars.

Target:

```tsx
<FinalAnswerBlock>
  <MarkdownRenderer content={assistant.content} />
</FinalAnswerBlock>
```

Requirements:

```yaml
assistant_markdown:
  bold_no_raw_asterisks: true
  lists_rendered: true
  code_blocks_rendered: true
  links_clickable: true
  unsafe_html_sanitized: true

tool_output:
  markdown_rendering: false
  plain_or_monospace: true
  escaped_safe: true
```

Prefer reusing an existing markdown renderer in the repo. Avoid adding a dependency unless absolutely necessary.

Tests:

```text
assistant markdown renders bold without visible asterisks
tool raw output preserves markdown markers as plain text
assistant markdown sanitizes unsafe html
```

UX impact: final answer looks like polished content, not raw stream/debug text.

## Phase 6 — Raw Timeline Debug Mode

Keep raw event chronology behind an advanced collapsed section.

```yaml
raw_timeline:
  default_visible: false
  available_in_debug: true
  contents:
    - assistant_delta
    - thought_delta
    - tool.call.created
    - tool.call.updated
    - plan.updated
```

Tests:

```text
raw timeline is hidden by default
raw timeline can be expanded for debugging
```

UX impact: normal users get a clean conversation; developers keep observability.

## Phase 7 — Styling polish

Visual hierarchy:

```yaml
visual_hierarchy:
  high:
    - final_answer
    - failed_tool
    - approval_required
  medium:
    - tool_activity_summary
    - plan
  low:
    - completed_tool_details
    - reasoning
    - raw_timeline
```

Suggested CSS surfaces:

```css
.agent-reasoning {
  border: 1px solid var(--border-muted);
  background: var(--surface-muted);
  border-radius: 12px;
}

.agent-tool-activity {
  border: 1px solid var(--border-muted);
  background: var(--surface-subtle);
  border-radius: 12px;
}

.agent-final-answer {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  border-radius: 14px;
  padding: 14px 16px;
}
```

UX impact: users can visually separate result, trace, errors, and details at a glance.

## Phase 8 — Optional handler normalization

Only if reasoning still arrives inside assistant text.

Allowed split markers:

```yaml
reasoning_split_markers:
  allowed:
    - '<think>...</think>'
    - 'Thought:'
    - 'Reasoning:'
  not_allowed:
    - arbitrary_bold_markdown
    - any_text_inside_double_asterisks
```

UX impact: prevents reasoning leak without corrupting normal markdown answers.

## Validation plan

Before validation/build, check disk:

```bash
df -h .
```

Frontend validation:

```bash
pnpm -F web test -- src/components/AgentThread/AgentThread.render.test.tsx src/domain/agentSession/handlers.test.ts --run
pnpm -F web typecheck
git diff --check
```

Rust validation is only needed if bridge/runtime code is touched:

```bash
cargo fmt --all -- --check
cargo clippy -p local-bridge --all-targets -- -D warnings
cargo test -p local-bridge
```

Rule: stop on validation failure. Do not commit or push if any validation fails.

## Browser QA

Use non-conflicting ports because `5173` may already be used.

Bridge:

```bash
cd /home/emp/Documents/VAC/vac-web
VAC_WEB_PORT=7788 \
VAC_WEB_AGENTS_CONFIG=/home/emp/Documents/VAC/vac-web/fixtures/agents.all-acp.toml \
cargo run -p local-bridge --quiet
```

Web:

```bash
cd /home/emp/Documents/VAC/vac-web
VAC_BRIDGE_URL=http://127.0.0.1:7788 \
pnpm --filter @vac-web/web dev -- --host 127.0.0.1 --port 5174 --strictPort
```

URL:

```text
http://localhost:5174
```

QA checklist:

```yaml
browser_qa:
  layout:
    - final_answer_is_below_tool_activity
    - no_assistant_response_above_tool_calls
    - reasoning_is_collapsed
    - tool_activity_is_collapsed
  grouping:
    - search_group_contains_grep_glob_codesearch
    - read_group_contains_file_reads
    - command_group_contains_bash_terminal
    - edit_group_contains_write_edit_patch
    - subagent_group_contains_subagent_activity
  markdown:
    - bold_text_does_not_show_asterisks
    - lists_render_as_lists
    - code_blocks_render_as_code
    - tool_output_stays_plain
  streaming:
    - answer_streams_at_bottom
    - tool_updates_do_not_reorder_answer_above_trace
    - running_status_updates_group_summary
  regression:
    - existing_sessions_still_load
    - empty_reasoning_does_not_show_empty_box
    - no_tool_turn_does_not_show_tool_activity
    - long_tool_output_does_not_expand_by_default
```

## Acceptance criteria

```yaml
acceptance_criteria:
  layout:
    final_answer:
      position: bottom_of_turn
      never_above_tool_activity: true
    reasoning:
      separated_from_answer: true
      collapsible: true
      default_collapsed: true
      hidden_when_empty: true
    tools:
      grouped_by_type: true
      default_collapsed: true
      failed_or_approval_visible: true
      raw_input_output_available_on_expand: true
    markdown:
      assistant_bold_no_raw_asterisks: true
      assistant_lists_rendered: true
      assistant_code_blocks_rendered: true
      tool_output_plain_safe: true
    debug:
      raw_timeline_not_default: true
      raw_timeline_available: true
  validation:
    web_tests_pass: true
    web_typecheck_pass: true
    git_diff_check_pass: true
    no_unrelated_files_changed: true
```

## Expected files to change during implementation

Likely existing files:

```text
apps/web/src/components/AgentThread/AgentThread.tsx
apps/web/src/components/AgentThread/AgentThread.render.test.tsx
apps/web/src/domain/agentSession/handlers.ts
apps/web/src/domain/agentSession/handlers.test.ts
apps/web/src/stores/agentSession.ts
```

Potential new files:

```text
apps/web/src/components/AgentThread/toolGrouping.ts
apps/web/src/components/AgentThread/ToolActivitySection.tsx
apps/web/src/components/AgentThread/ReasoningSection.tsx
apps/web/src/components/AgentThread/FinalAnswerBlock.tsx
apps/web/src/components/AgentThread/turnComposition.ts
```

## Risks and mitigations

```yaml
risks:
  chronological_tests_fail:
    mitigation: update expectations to composed layout; keep raw event order in debug mode
  markdown_renderer_missing:
    mitigation: reuse existing renderer first; avoid new dependency if possible
  wrong_tool_grouping:
    mitigation: classify by kind first; unknown goes to Other
  reasoning_parser_too_aggressive:
    mitigation: only split explicit markers like <think>; never split arbitrary bold text
  streaming_flicker:
    mitigation: anchor final answer section and sort only inside sections/groups
```
