# Mission Companion (Live Side-Channel Q&A + Post-Mission Debrief) — Design

## Problem

Today a running mission is a black box the user cannot poke at, and a
finished mission is a pile of logs the user must dig through alone:

- **While running:** the only way to talk to a mission is
  `InterventionPanel` (`src/components/mission/InterventionPanel.jsx`),
  which *queues* a message for the Lead — it does not run until the Lead's
  current turn finishes, and it never answers back. There is no way to ask
  "what are you doing right now" or "why did you pick library X" without
  waiting for and possibly derailing the Lead's own train of thought.
- **After completion:** `MissionDashboard` (read-only history view) and
  `FileChangesPanel`/`ActivityLog` are the only way to understand what
  happened. Nobody is available to explain *why* something was built a
  certain way, point at the relevant file, or notice something the user
  didn't think to check.

Both problems share one root cause: nothing owns "understanding a mission's
context and being ready to talk about it" as a first-class capability. Both
also share the same raw materials (`missionState.log`, `.file_changes`,
`.tasks`, `.messages`) and the same project files on disk. This spec designs
one shared foundation for a lightweight per-mission RAG index, and two
features built on it.

## Goals

- **Live side-channel Q&A ("ask now"):** while a mission is executing, the
  user can ask a question and get an answer within seconds, without
  interrupting, pausing, or in any way perturbing the Lead process that is
  actually driving the mission. Steering the mission itself (new
  instructions) stays exactly as it is today — through
  `InterventionPanel`/`continue_mission` — this is purely a read-only
  parallel channel.
- **Post-mission debrief agent:** once a mission reaches `Done`, it gets an
  auto-generated summary, and from then on — any time later, from mission
  history — the user can open a chat scoped to that mission and ask
  follow-up questions. The agent answers from a lightweight per-mission
  index built from the mission's own data, with tools to read the real
  project files/logs on demand when the index isn't enough.
- **Chat sessions, not one infinite thread:** each "Ask this mission" click
  either resumes a specific prior chat session (full history reloaded, chat
  continues naturally) or starts a brand-new session (no memory of other
  sessions). All sessions persist and are individually re-openable later —
  this mirrors the existing mission-history browsing model, just one level
  deeper (sessions inside a mission, the way missions sit inside history).
- No new external services, servers, or databases. Embeddings run locally
  in the existing Electron main process.

## Out of scope

- Any change to how `InterventionPanel`/`continue_mission` queue and apply
  new instructions to the *running* Lead — that mechanism is untouched.
  This spec adds a second, independent channel; it does not touch the first.
- Actually pausing/injecting into the live `claude -p` subprocess mid-stream.
  The live side-channel never talks to the running Lead process at all — it
  reads `missionState` and spawns its own short-lived, separate process.
  True mid-stream interruption of the driving process is a different,
  substantially riskier problem (the current `claude -p` wiring is one-way
  stdin→stdout) and is explicitly not attempted here.
- Cross-mission memory (recalling facts across *different* missions/projects).
  Every index and every chat session is scoped to exactly one mission.
- Any external memory service (e.g. `agentmemory`/iii-engine). Considered
  during brainstorming and rejected for this scope: it's a standalone
  runtime with its own process/ports/storage, aimed at cross-session,
  cross-project memory — much bigger than "remember one finished mission."
- Automatic session-history summarization/truncation within a single chat
  session. Each resumed session reloads its full message history verbatim;
  if a session ever grows large enough for that to matter, that's a
  follow-up, not part of this design.
- Editing/deleting individual chat messages, multi-user access, or any
  auth/sharing model — single local user, same trust model as the rest of
  the app.

## Design

### 1. Shared foundation: per-mission vector index

Every mission gets a lightweight, incrementally-built index of its own data
— no external DB, no server.

**Storage:** `~/.claude/agent-teams-snapshots/{missionId}.vectors.json`
(same directory `saveMissionSnapshot`/`get_mission_detail` already use,
`electron/ipc/mission.cjs:766`, `electron/ipc/history.cjs:11`), shape:

```json
{
  "missionId": "mission-...",
  "chunks": [
    { "id": "log-142", "text": "...", "vector": [0.01, ...], "source": { "type": "log", "ts": 172... } },
    { "id": "file-src/App.jsx-3", "text": "...", "vector": [...], "source": { "type": "file_change", "path": "src/App.jsx" } },
    { "id": "task-task-4", "text": "...", "vector": [...], "source": { "type": "task", "id": "task-4" } }
  ]
}
```

**Chunking sources** (one chunk per event, not a sliding window over raw
text — the existing structured data already gives natural chunk
boundaries):
- Each `LogEntry` with `log_type` in `{'result', 'error', 'message',
  'plan-ready'}` (the meaningful ones — not every `tool`/`info` line, which
  would be mostly noise) → one chunk of `agent: message`.
- Each `FileChange` → one chunk combining `path`, `action`, and
  `content_preview`/`diff_new` (whichever is present, already capped at
  ~2000 chars by `buildFileChangeFromInput`/`upsertFileChange`,
  `mission.cjs:1636-1685` — no additional truncation needed here).
- Each completed `Task` → one chunk of `title` + `detail`.
- Each `Message` (Agent Teams inter-agent DM) → one chunk of `from → to:
  content`.

**Embedding:** `@huggingface/transformers` (transformers.js), running the
`Xenova/all-MiniLM-L6-v2` quantized model (~25MB, widely used default for
this exact library — small enough to bundle, no Python/network dependency
at runtime after first download). Loaded once per app session (lazy, on
first use) in a new module `electron/lib/missionIndex.cjs`.

**Incremental updates:** the index is appended to as the mission runs, not
rebuilt from scratch:
- Hook into the same emit points that already push to `missionState.log` /
  `.file_changes` / `.tasks` (`handleParsedEvent`, `upsertFileChange`, task
  completion in `readProcessStdout_deploy`) — after each push, also enqueue
  the new item for embedding.
- Embedding is batched and debounced (e.g. every 3s of idle, or every 20
  queued items) off the hot path, so it never blocks stream-JSON parsing.
- On mission completion (`watchProcessExit_deploy`'s terminal branch,
  alongside `saveMissionSnapshot`), flush any remaining queued chunks and
  write the vectors file.
- If the mission is later resumed/continued (`continue_mission`), the same
  index file is reused and keeps growing — one index per `missionState.id`
  for its whole lifetime, matching how `agents[]`/`log[]` already
  accumulate across intervention cycles (`ARCHITECTURE.md` §7.3).

**Query:** cosine similarity, brute-force over `chunks[]` (missions are
bounded in size — thousands of chunks at most — brute force is fast enough
and avoids pulling in a vector-index library for what is, at this scale, a
non-problem).

**Failure mode:** if transformers.js fails to load (offline first run,
unsupported platform) the index degrades to keyword/substring matching over
the same chunk `text` fields — Q&A and debrief still work, just with worse
recall on paraphrased questions. Nothing in the mission's core execution
path depends on the index; it is purely additive.

### 2. Live side-channel Q&A

**UI:** a new, separate input — NOT part of `InterventionPanel` (which
keeps its existing "queue an instruction for the Lead" role unchanged). A
small collapsible panel/tab in `MissionDashboard`, e.g. "Ask" alongside the
existing Tasks/Activity/Messages/Files tabs, always available while a
mission is `Running`/`Executing`.

**Flow per question:**
1. Embed the question (same model as §1).
2. Top-K (e.g. 6) chunks from the mission's *current* index (built so far,
   even mid-execution) + a compact snapshot of live state (agent statuses,
   current tasks, phase — same shape `buildMissionSummary` already
   produces, `mission.cjs:972`).
3. Spawn a **separate, short-lived** process via the existing
   `spawnAgentProcess` (`mission.cjs:1201`) — same backend-adapter
   primitive Standard/Agent-Teams/Copilot already use, just with a small
   single-turn prompt and no `--resume` (a fresh disposable session every
   time). Given a tool to read a specific log range or file from
   `missionState.project_path` if the top-K context isn't enough (mirrors
   `read_file_content`, `electron/ipc/files.cjs`).
4. Answer streams back over a new IPC event; this process is fully
   independent of `childProcess` (the Lead's driving process) — it is never
   killed by `killChild()`, never touches `missionState` mutation, and its
   failure/timeout has zero effect on the running mission.

**New IPC:**

| Command | Input | Output |
|---|---|---|
| `ask_mission_live` | `{ question }` (implicit: current mission) | `{ answer }` (or streamed via event) |

**New event:** `mission:companion-answer` `{ question, answer, timestamp }`.

No new status/phase values on `missionState` — this feature is read-only
and orthogonal to the state machine in `ARCHITECTURE.md` §7.1.

### 3. Post-mission debrief agent

**Auto-summary on completion:** in the terminal branch of
`watchProcessExit_deploy` (same place `saveToHistory`/`saveMissionSnapshot`
already run, `mission.cjs` around the exit handler), one extra short
`spawnAgentProcess` call generates a structured debrief:

```json
{
  "goal": "...", "agents_involved": ["Lead", "backend-dev", ...],
  "key_files": ["src/App.jsx", ...], "issues_encountered": ["..."],
  "outcome": "..."
}
```

Saved as `debrief_summary` on the snapshot (`{missionId}.json`) — a pure
addition to the existing snapshot shape, non-breaking for any code reading
older snapshots (field simply absent).

**Chat sessions storage:**

```
~/.claude/agent-teams-snapshots/{missionId}.chats/{chatId}.json
```

```json
{
  "id": "chat-1735...", "missionId": "mission-...",
  "title": "Why was X library used?",
  "createdAt": 1735..., "updatedAt": 1735...,
  "messages": [{ "role": "user" | "assistant", "content": "...", "timestamp": 1735... }]
}
```

`title` is derived from the first user question (truncated), matching the
lightweight, no-extra-round-trip approach used elsewhere in this app (no
separate "generate a title" LLM call).

**UI:** `MissionHistoryPanel`/history detail view gets a new entry point,
"Ask this mission" (or similar), opening a per-mission chat browser:
- List of existing sessions for this mission (title, last updated,
  message count) — new sibling list to the existing mission-history list,
  one level deeper.
- "New chat" button → empty session.
- Selecting a session loads its full `messages[]` and continues from there.

**Flow per question (new or resumed session):**
1. Load the target chat's full `messages[]` (empty if new).
2. Embed the latest question, top-K search against
   `{missionId}.vectors.json` (built during/after the mission — same index
   as §1, now complete).
3. Call `spawnAgentProcess` with: full prior `messages[]` as conversation
   history + top-K retrieved chunks + tools to read a project file in full
   (`missionState.project_path` is preserved on the snapshot) or fetch a
   wider log range — agentic, multi-turn-tool-call, no time pressure since
   the mission itself is done (unlike §2, which is optimized for
   "seconds").
4. Append both the user question and the assistant answer to
   `messages[]`, write the session file, bump `updatedAt`.

**New IPC:**

| Command | Input | Output |
|---|---|---|
| `list_mission_chats` | `{ missionId }` | `[{ id, title, createdAt, updatedAt, messageCount }]` |
| `get_mission_chat` | `{ missionId, chatId }` | full chat object |
| `ask_mission_chat` | `{ missionId, chatId: string \| null, question }` | `{ chatId, answer }` (creates chat if `chatId` is null) |
| `delete_mission_chat` | `{ missionId, chatId }` | — |

These live in `electron/ipc/history.cjs` (they operate on completed/history
missions, not the live `missionState` singleton) alongside the existing
`get_mission_detail` etc.

### 4. Module layout

New file `electron/lib/missionIndex.cjs`, following the existing
`electron/lib/` convention (`qcqa.cjs`, `replayEngine.cjs`):
- `embedText(text)` — lazy-loads the transformers.js pipeline once, returns
  a vector (or `null` on load failure, triggering the keyword-match
  fallback from §1).
- `enqueueChunk(missionId, chunk)` / `flushPending(missionId)` — incremental
  index writer.
- `queryIndex(missionId, question, k)` — top-K cosine similarity (or
  substring fallback).

`electron/ipc/mission.cjs` calls into this for the incremental
enqueue-on-event hooks (§1) and the live Q&A handler (§2).
`electron/ipc/history.cjs` calls into it for chat sessions (§3), since
those operate on a `missionId` that may not be the currently-live mission.

## Testing strategy

- **Unit — `missionIndex.cjs`:** chunk builders produce expected shapes
  from sample `LogEntry`/`FileChange`/`Task`/`Message` objects;
  `queryIndex` returns top-K ranked by cosine similarity against a small
  fixed set of pre-computed vectors (mock `embedText` to avoid loading the
  real model in unit tests); fallback path exercised by forcing
  `embedText` to return `null`.
- **Unit — incremental indexing:** simulate a sequence of mission events,
  assert the vectors file accumulates chunks correctly across multiple
  flushes and across a `continue_mission` cycle (index persists and grows,
  doesn't reset).
- **Integration — live Q&A (`ask_mission_live`):** using the existing
  fake-`claude`-subprocess test harness (per `ARCHITECTURE.md`/existing
  mission tests), assert that asking a question while a mission is
  `Running` spawns a *second*, independent process, that `childProcess`
  (the Lead's process) is untouched/never killed, and that the answer event
  fires without altering `missionState.status`/`phase`.
- **Integration — debrief + chat sessions:** drive a mission to
  `Completed`, assert `debrief_summary` is written to the snapshot; then
  exercise `ask_mission_chat` with `chatId: null` (creates a session file)
  and again with that returned `chatId` (appends to the same file,
  previous messages present in the prompt sent to the mocked backend).
- **Regression:** existing snapshot/history reading code
  (`get_mission_detail`, `MissionHistoryPanel`) unaffected by the new
  `debrief_summary` field and the new sibling `.chats/` directory — assert
  old-shaped snapshots (no `debrief_summary`) still load without error.

## Open questions for the implementation plan

- Exact debounce/batch tuning for incremental embedding (§1) — needs a
  real profiling pass against a representative mission log volume during
  implementation, not guessed here.
- Whether `Xenova/all-MiniLM-L6-v2` ships bundled with the app (bigger
  installer) or is downloaded lazily on first use (smaller installer,
  requires network once) — a packaging trade-off for
  `superpowers:writing-plans` / DevOps to decide.
- Exact tool set exposed to the short-lived Q&A/debrief processes (read
  file, read log range, list file changes) — to be enumerated precisely
  against the existing `electron/ipc/files.cjs` handlers during planning.
- UI placement/visual design of the "Ask" tab and the per-mission chat
  session browser — left to implementation, following existing
  `MissionDashboard`/`MissionHistoryPanel` patterns.
