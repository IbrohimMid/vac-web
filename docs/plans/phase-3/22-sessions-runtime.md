# Plan 22 — Sessions + Runtime tabs

**Phase**: 3 · **Depends on**: Plans 12, 19 · **Blocks**: Phase 3 exit · **Est**: 1 day

## Goal

Two workbench tabs operators need constantly:
- **Sessions**: list, resume, rename, close; view metadata per session.
- **Runtime**: background jobs (watchers, cron, long-running agents), with live logs and cancel.

## Why this is hard

Both tabs surface long-lived state. Session snapshot restore must be lossless (UI state + transcript). Runtime job logs are dense; virtualize.

## Scope

### In
- Sessions tab: list with status, profile, project, duration, attach count.
- Resume via `SessionSnapshot`.
- Runtime tab: jobs with live log stream, cancel, inspect.

### Out
- Session sharing / collaboration (Phase 7).
- Gantt / dependency view for runtime (post-v1).

## Deliverables

```
apps/web/src/
├── stores/
│   ├── sessions.ts         # list view state (not current session slice)
│   └── runtime.ts
├── components/
│   └── Workbench/
│       ├── Sessions/
│       │   ├── SessionsTab.tsx
│       │   ├── SessionRow.tsx
│       │   └── SessionInfo.tsx
│       └── Runtime/
│           ├── RuntimeTab.tsx
│           ├── JobRow.tsx
│           └── JobLogs.tsx
```

## Stages

### S1 — Sessions store (0.2 day)

```ts
interface SessionsSlice {
  list: SessionSummary[];
  refresh(): void;
  resume(id: SessionId): Promise<void>;
  rename(id, title): Promise<void>;
  close(id): Promise<void>;
}
```

`SessionSummary`: id, title, profile, project, createdAt, lastActiveAt, attachCount, status, tokenUsage.

Fetch via `session.list`. Update on `session.updated` and `session.closed` events.

**Exit**: list reflects server truthfully.

### S2 — `<SessionsTab/>` (0.2 day)

```tsx
function SessionsTab() {
  const list = useSessions(s => s.list, shallow);
  const [filter, setFilter] = useState<Filter>({});
  const filtered = useMemo(() => filterSessions(list, filter), [list, filter]);
  return (
    <section className="sessions-tab">
      <FilterBar filter={filter} setFilter={setFilter} />
      <Virtualized items={filtered} renderItem={s => <SessionRow key={s.id} session={s} />} />
    </section>
  );
}
```

Filter: by profile, by status, by project.

**Exit**: list renders; filters work; virtualization at > 100 sessions.

### S3 — `<SessionRow/>` actions (0.2 day)

Each row: title (editable), profile badge, project name, last active, action menu (Resume, Rename, Close).

Resume: calls `session.resume { sessionId }`, switches active session in `session.ts` store, triggers snapshot replay.

Rename: inline edit; commits on Enter or blur; calls `session.rename`.

Close: confirmation (`confirm` overlay); calls `session.close { sessionId }`.

**Exit**: all actions work; UI reflects server events (e.g., close from another tab updates here).

### S4 — Session snapshot apply (0.1 day)

On resume: bridge sends `session.snapshot` event with full state (messages, workbench tab, overlays, etc). Client stores reset + apply:
- Transcript store: `order` + `messages` replaced.
- Workbench: `activeTab` set.
- Overlays: snapshot's overlay stack applied (if syncable).

**Exit**: resumed session visually identical to when closed.

### S5 — Runtime store (0.1 day)

```ts
interface RuntimeSlice {
  jobs: Map<JobId, RuntimeJob>;
  logs: Map<JobId, RingBuffer<LogLine>>;
  refresh(): void;
  cancel(id): Promise<void>;
  appendLog(id, line): void;
}
```

`RuntimeJob`: id, kind (watcher/cron/agent), status, startedAt, lastHeartbeat, description.

Log ring buffer: cap 5000 lines per job.

**Exit**: store works.

### S6 — `<RuntimeTab/>` (0.2 day)

List jobs; click → split view with logs.

```tsx
function RuntimeTab() {
  const jobs = useRuntime(s => [...s.jobs.values()], shallow);
  const [activeId, setActiveId] = useState<JobId | null>(null);
  return (
    <section className="runtime-tab">
      <aside><JobList jobs={jobs} active={activeId} onSelect={setActiveId} /></aside>
      {activeId && <JobLogs jobId={activeId} />}
    </section>
  );
}
```

Status badges per `ux-grammar.md` severity.

**Exit**: jobs visible; selection shows logs.

### S7 — `<JobLogs/>` (0.1 day)

Virtualized line list; auto-scroll to bottom unless user scrolled up.

Log line: timestamp + severity + text. Monospaced.

Click line → expand for structured fields (if any).

Stream: `runtime.job_log` events append; coalesce if > 200 lines/s.

**Exit**: live log streaming visible without jank.

### S8 — Cancel + inspect (0.1 day)

Cancel: confirmation → `runtime.cancel_job { jobId }`. Status updates via event.

Inspect: overlay with full job definition (command, env, schedule, owner).

**Exit**: cancel works; inspector populated.

## Testing

- Unit: stores.
- Integration: resume session → UI state identical.
- Stress: 100 live jobs, 500 log lines/s → FPS stable.

## Exit criteria

- [ ] Sessions list + actions work.
- [ ] Resume is lossless.
- [ ] Runtime jobs + logs + cancel work.
- [ ] `bench:workbench` tab switching still passes.

## Risks

| Risk | Mitigation |
|---|---|
| Session snapshot grows huge for long sessions | Compress server-side; chunk on wire; defer re-render of hot window only |
| Log streaming overwhelms main thread | Coalesce at bridge; ring buffer caps |
| Accidental close via keyboard | Confirmation dialog required for close |

## Related

- Plan 08 — session manager (server)
- Plan 19 — overlays (confirm, job inspector)
