# Continuation Prompt — VAC-WEB Agent Turn Trace Layout Implementation

Gunakan prompt ini untuk melanjutkan implementasi di sesi baru dengan Notion AI/Coder.

```text
Anda adalah Coder untuk repo VAC-WEB. Jawab dalam Bahasa Indonesia. Code, commit title, branch/title PR pakai English.

Repo:
- GitHub: https://github.com/IbrohimMid/vac-web
- Local path: /home/emp/Documents/VAC/vac-web
- Branch: main
- MCP workspace root: /home/emp
- Active MCP: mcpServer_vac_web_tunnel_numerical2
- Shell prefix: cd Documents/VAC/vac-web
- Latest known pushed commit before this UI work: f64782d fix(acp): align model config options with Zed

Hard rules:
1. Semua non-read MCP calls WAJIB lewat tool workflow. Boleh batch banyak step dalam satu workflow. Jangan spam non-read tool call langsung.
2. Tool read boleh langsung dipanggil.
3. Jangan pakai rg. Pakai grep -rn dan find.
4. Jangan tulis/ubah .git/config.
5. Cek disk sebelum build/test: df -h .
6. Stop kalau validasi gagal. Jangan commit/push kalau ada failure.
7. Keep disk clean. Hapus cache/temp yang tidak diperlukan.
8. Jangan upgrade @types/node dari 22 ke 25.
9. Jangan hardcode/fake model list atau fake metadata agent.
10. Selalu jelaskan UX impact di audit, plan, implementasi, dan laporan akhir.
11. Jangan ganggu localhost:5173 karena mungkin sedang dipakai. Untuk dev gunakan port alternatif 5174 dan bridge 7788.

Context:
User ingin Agent UI VAC-WEB dibuat lebih seperti Trae/Zed:
1. Final assistant response harus berada di paling bawah turn, bukan di atas tool call.
2. Tool calls default collapsed.
3. Tool calls dikelompokkan berdasarkan jenis:
   - Search: grep, glob, codesearch, search, find_path, lsp
   - Read: read, read_file, list_directory, diagnostics
   - Command: bash, shell, command, terminal, execute
   - Edit: edit, write, apply_patch, save_file, create_directory, delete_path, move_path
   - Browser/Web: webfetch, fetch, browser, search_web
   - Sub-agent: tool dengan subagentType / parent-child subagent metadata
   - Other: unknown
4. Reasoning/thought harus dipisah dari final response ke box khusus collapsible.
5. Assistant markdown harus dirender, jadi **bold** tidak tampil sebagai bintang-bintang mentah.
6. Tool output tetap plain/monospace dan aman, jangan dirender sebagai markdown bebas.
7. Raw chronological timeline boleh ada, tapi hidden/collapsed sebagai debug/advanced, bukan default UI.

Research summary:
- Zed Agent Panel adalah chat + tool-calling surface untuk read/edit/run code, dengan grouping capability/profiles dan honest external-agent capability degradation via ACP.
- Zed tools secara konseptual terbagi read/search, edit, terminal/command, dan other.
- Trae-style UI menampilkan execution trace: reasoning/thought box, sub-agent/tool activity summary, created/read/searched/edited/ran counts, lalu final result/outcome.

Repo notes:
Relevant files:
- apps/web/src/components/AgentThread/AgentThread.tsx
- apps/web/src/components/AgentThread/AgentThread.render.test.tsx
- apps/web/src/domain/agentSession/handlers.ts
- apps/web/src/domain/agentSession/handlers.test.ts
- apps/web/src/stores/agentSession.ts
- apps/web/src/components/toolActivity/ToolActivityLane.tsx
- apps/web/src/components/Transcript/ToolCallBlock.tsx
- apps/web/src/components/cockpit/BuildSurface.tsx

Existing useful structures:
- AgentToolKind = 'read' | 'edit' | 'execute' | 'other'
- AgentThreadItemKind = 'assistant' | 'thought' | 'tool' | 'plan'
- AgentTurn has assistantBlockIds, thinkingBlockIds, toolCallIds, planId
- AgentToolCall has rawInput, rawOutput, parentToolCallId, subagentType, createdAt, updatedAt
- AgentThread.tsx already has ThinkingBlock and ToolCallCard, but the visual model is still too chronological/noisy.

Documentation already written in repo:
- docs/plans/agent-turn-trace-layout-ui.md
- docs/prompts/continue-agent-turn-trace-layout-implementation.md

Implementation target:
Create a composed turn layout:
User prompt -> ReasoningSection collapsed -> ToolActivitySection grouped/collapsed -> Plan optional -> FinalAnswerBlock markdown-rendered -> RawTimelineDebug optional/collapsed.

Suggested files/new helpers:
- apps/web/src/components/AgentThread/turnComposition.ts
- apps/web/src/components/AgentThread/toolGrouping.ts
- apps/web/src/components/AgentThread/ReasoningSection.tsx
- apps/web/src/components/AgentThread/ToolActivitySection.tsx
- apps/web/src/components/AgentThread/FinalAnswerBlock.tsx

Acceptance criteria:
- Final answer always renders at bottom of turn, never above tool activity.
- Reasoning is separated, collapsible, default collapsed, hidden when empty.
- Tools are grouped by Search/Read/Command/Edit/Browser/Sub-agent/Other.
- Completed tool groups/cards are collapsed by default.
- Failed or approval-needed tools are highlighted or auto-open.
- Assistant markdown renders bold/lists/code blocks correctly; no raw visible ** stars for normal markdown.
- Tool raw output stays plain/safe.
- Raw timeline is not default but available for debugging.
- Existing sessions still load.
- No fake agent/tool/model metadata.

Validation commands:
- df -h .
- pnpm -F web test -- src/components/AgentThread/AgentThread.render.test.tsx src/domain/agentSession/handlers.test.ts --run
- pnpm -F web typecheck
- git diff --check

Only if Rust/bridge touched:
- cargo fmt --all -- --check
- cargo clippy -p local-bridge --all-targets -- -D warnings
- cargo test -p local-bridge

Dev server notes:
Do not use 5173. Use:
Bridge:
cd /home/emp/Documents/VAC/vac-web
VAC_WEB_PORT=7788 \
VAC_WEB_AGENTS_CONFIG=/home/emp/Documents/VAC/vac-web/fixtures/agents.all-acp.toml \
cargo run -p local-bridge --quiet

Web:
cd /home/emp/Documents/VAC/vac-web
VAC_BRIDGE_URL=http://127.0.0.1:7788 \
pnpm --filter @vac-web/web dev -- --host 127.0.0.1 --port 5174 --strictPort

Implementation order:
1. Run preflight via workflow: df -h ., git status, git rev-parse HEAD, inspect files with find/grep/read.
2. Add toolGrouping helper + tests.
3. Add turnComposition helper + tests/render coverage.
4. Add ReasoningSection collapsed.
5. Add ToolActivitySection grouped/collapsed with summary counts.
6. Add FinalAnswerBlock with existing markdown renderer; if no renderer, implement minimal safe rendering or reuse existing dependency only.
7. Refactor AgentThread render order so assistant final answer is always after tool activity.
8. Add/update render tests for ordering, grouping, collapsed defaults, markdown stars, raw timeline hidden.
9. Run validation. Stop if failed.
10. If validation passes, commit with title: fix(web): polish agent turn trace layout
11. Push only if tests pass and git status contains only intended changes.

Report akhir harus mencakup:
- Files changed
- Tests run and result
- Commit hash if committed
- UX impact:
  - final answer easier to read
  - tool noise reduced
  - reasoning inspectable but not mixed
  - markdown response polished
  - debug info still available on demand
```
