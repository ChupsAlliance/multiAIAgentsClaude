# Mission Companion (Live Q&A + Post-Mission Debrief) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user two things they don't have today: (1) a read-only "Ask" side-channel to query a running mission without touching the Lead process, and (2) a per-mission chat agent, available any time after a mission finishes, that can answer follow-up questions using a local RAG index built from the mission's own data.

**Architecture:** One shared module, `electron/lib/missionIndex.cjs`, builds and queries a per-mission vector index (local `transformers.js` embeddings, brute-force cosine similarity, JSON file on disk, keyword-fallback if the model fails to load). `electron/ipc/mission.cjs` incrementally feeds the index as a live mission runs and exposes `ask_mission_live` for the read-only side-channel. `electron/ipc/history.cjs` exposes the post-mission chat-session CRUD + `ask_mission_chat`, and mission completion in `mission.cjs` writes a `debrief_summary` onto the snapshot. Two new UI surfaces reuse `MissionDashboard`'s existing tab-array pattern: an "Ask" tab (visible while running) and a "Chat" tab (visible in history view).

**Tech Stack:** Node.js/CommonJS (Electron main process), `@huggingface/transformers` (new dependency) for local embeddings, existing `spawnAgentProcess`/backend-adapter subprocess plumbing, React (renderer), Vitest for unit tests, existing fake-subprocess harness style (`EventEmitter`-based fake `ChildProcess`, see `electron/lib/qcqa.test.cjs`) for integration tests.

## Global Constraints

- No external services, servers, or databases — embeddings run in-process in the existing Electron main process (spec §"Goals").
- The live Q&A channel is strictly read-only and must never mutate `missionState.status`/`.phase`, and must never touch `childProcess` (the Lead's driving process) or be killed by `killChild()` (spec §"Out of scope", §2).
- `InterventionPanel`/`continue_mission` are untouched — the live side-channel is a second, independent channel (spec §"Out of scope").
- No cross-mission memory — every index and every chat session is scoped to exactly one `missionId` (spec §"Out of scope").
- Old-shaped mission snapshots (no `debrief_summary` field) and old history entries must continue to load without error (spec §"Testing strategy", regression).
- New chunk text fields are capped the same way existing data already is — no additional truncation logic invented (spec §1, "Chunking sources").
- Auto-resume ceiling / QC-QA mechanisms are unrelated and must not be touched by this work.

---

## File Structure

**Create:**
- `electron/lib/missionIndex.cjs` — embedding, chunking, incremental index writer, top-K query, keyword fallback.
- `electron/lib/missionIndex.test.cjs` — unit tests (chunk builders, `queryIndex` ranking, fallback path, incremental accumulation across flushes/continue cycles).
- `src/components/mission/AskMissionPanel.jsx` — live Q&A tab content (question input, streamed answer, history of Q&A pairs for the session).
- `src/components/mission/MissionChatPanel.jsx` — post-mission chat tab content (session list + active chat thread + "New chat").

**Modify:**
- `package.json` — add `@huggingface/transformers` dependency.
- `electron/ipc/mission.cjs` — hook incremental chunk enqueue into `handleParsedEvent`/`upsertFileChange`/task-completion; add `ask_mission_live` IPC handler; write `debrief_summary` in the terminal branch of `watchProcessExit_deploy`; flush pending chunks on completion.
- `electron/ipc/history.cjs` — add `list_mission_chats`, `get_mission_chat`, `ask_mission_chat`, `delete_mission_chat` IPC handlers.
- `electron/preload.cjs` — whitelist the 5 new IPC commands (`ask_mission_live`, `list_mission_chats`, `get_mission_chat`, `ask_mission_chat`, `delete_mission_chat`) and the new `mission:companion-answer` event.
- `src/components/mission/MissionDashboard.jsx` — add `Ask` tab (visible when `!isHistoryView`) and `Chat` tab (visible when `isHistoryView`) to the tab array, following the existing `baseTabs`/`visibleBaseTabs` pattern (`MissionDashboard.jsx:16-21,109-120`).

**Interfaces (cross-task contract — exact names/shapes every task must match):**

```js
// electron/lib/missionIndex.cjs
async function embedText(text) // => number[] | null (null triggers keyword fallback)
function buildChunksFromLogEntry(entry) // => {id, text, source}[] (0 or 1 chunks)
function buildChunkFromFileChange(change) // => {id, text, source}
function buildChunkFromTask(task) // => {id, text, source}
function buildChunkFromMessage(message) // => {id, text, source}
function enqueueChunk(missionId, chunk) // chunk: {id, text, source} — queues, does not embed synchronously
async function flushPending(missionId) // embeds+writes all queued chunks for missionId to disk, returns count flushed
async function queryIndex(missionId, question, k = 6) // => {id, text, source, score}[] (or keyword-scored if embeddings unavailable)
function vectorsPathFor(missionId) // => absolute path to {missionId}.vectors.json
module.exports = { embedText, buildChunksFromLogEntry, buildChunkFromFileChange, buildChunkFromTask,
  buildChunkFromMessage, enqueueChunk, flushPending, queryIndex, vectorsPathFor }
```

---

### Task 1: `missionIndex.cjs` — chunk builders

**Files:**
- Create: `electron/lib/missionIndex.cjs`
- Test: `electron/lib/missionIndex.test.cjs`

**Interfaces:**
- Produces: `buildChunksFromLogEntry(entry)`, `buildChunkFromFileChange(change)`, `buildChunkFromTask(task)`, `buildChunkFromMessage(message)` — used by Task 3 (incremental hooks) and Task 2 (embedding pipeline consumes their output shape).

Chunk shape everywhere in this module: `{ id: string, text: string, source: object }`.

- [ ] **Step 1: Write the failing tests for chunk builders**

```js
// electron/lib/missionIndex.test.cjs
'use strict';
const { describe, test, expect } = require('vitest');
const {
  buildChunksFromLogEntry, buildChunkFromFileChange, buildChunkFromTask, buildChunkFromMessage,
} = require('./missionIndex.cjs');

describe('buildChunksFromLogEntry', () => {
  test('produces a chunk for log_type=result', () => {
    const entry = { agent: 'Lead', message: 'Task complete', log_type: 'result', timestamp: 1000 };
    const chunks = buildChunksFromLogEntry(entry);
    expect(chunks).toEqual([{
      id: 'log-1000',
      text: 'Lead: Task complete',
      source: { type: 'log', ts: 1000 },
    }]);
  });

  test('produces a chunk for log_type=error', () => {
    const entry = { agent: 'Dev', message: 'Build failed', log_type: 'error', timestamp: 2000 };
    const chunks = buildChunksFromLogEntry(entry);
    expect(chunks).toEqual([{ id: 'log-2000', text: 'Dev: Build failed', source: { type: 'log', ts: 2000 } }]);
  });

  test('produces a chunk for log_type=message', () => {
    const entry = { agent: 'Lead', message: 'Starting work', log_type: 'message', timestamp: 3000 };
    expect(buildChunksFromLogEntry(entry)).toHaveLength(1);
  });

  test('produces a chunk for log_type=plan-ready', () => {
    const entry = { agent: 'Lead', message: 'Plan is ready', log_type: 'plan-ready', timestamp: 4000 };
    expect(buildChunksFromLogEntry(entry)).toHaveLength(1);
  });

  test('skips noisy log types (tool, info)', () => {
    expect(buildChunksFromLogEntry({ agent: 'Lead', message: 'x', log_type: 'tool', timestamp: 5000 })).toEqual([]);
    expect(buildChunksFromLogEntry({ agent: 'Lead', message: 'x', log_type: 'info', timestamp: 6000 })).toEqual([]);
  });
});

describe('buildChunkFromFileChange', () => {
  test('combines path, action, and content_preview', () => {
    const change = { path: 'src/App.jsx', action: 'modified', content_preview: 'const x = 1', timestamp: 7000 };
    expect(buildChunkFromFileChange(change)).toEqual({
      id: 'file-src/App.jsx-7000',
      text: 'src/App.jsx (modified): const x = 1',
      source: { type: 'file_change', path: 'src/App.jsx' },
    });
  });

  test('falls back to diff_new when content_preview is absent', () => {
    const change = { path: 'src/x.js', action: 'created', diff_new: '+line1\n+line2', timestamp: 8000 };
    expect(buildChunkFromFileChange(change).text).toBe('src/x.js (created): +line1\n+line2');
  });
});

describe('buildChunkFromTask', () => {
  test('combines title and detail', () => {
    const task = { id: 'task-4', title: 'Add login form', detail: 'Implemented with validation' };
    expect(buildChunkFromTask(task)).toEqual({
      id: 'task-task-4',
      text: 'Add login form: Implemented with validation',
      source: { type: 'task', id: 'task-4' },
    });
  });
});

describe('buildChunkFromMessage', () => {
  test('combines from, to, and content', () => {
    const message = { from: 'Lead', to: 'Dev-Backend', content: 'Please add auth', timestamp: 9000 };
    expect(buildChunkFromMessage(message)).toEqual({
      id: 'message-9000',
      text: 'Lead → Dev-Backend: Please add auth',
      source: { type: 'message', ts: 9000 },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: FAIL with "Cannot find module './missionIndex.cjs'" (file doesn't exist yet).

- [ ] **Step 3: Write the chunk builders**

```js
// electron/lib/missionIndex.cjs
'use strict';

const MEANINGFUL_LOG_TYPES = new Set(['result', 'error', 'message', 'plan-ready']);

function buildChunksFromLogEntry(entry) {
  if (!MEANINGFUL_LOG_TYPES.has(entry.log_type)) return [];
  return [{
    id: `log-${entry.timestamp}`,
    text: `${entry.agent}: ${entry.message}`,
    source: { type: 'log', ts: entry.timestamp },
  }];
}

function buildChunkFromFileChange(change) {
  const body = change.content_preview != null ? change.content_preview : (change.diff_new || '');
  return {
    id: `file-${change.path}-${change.timestamp}`,
    text: `${change.path} (${change.action}): ${body}`,
    source: { type: 'file_change', path: change.path },
  };
}

function buildChunkFromTask(task) {
  return {
    id: `task-${task.id}`,
    text: `${task.title}: ${task.detail || ''}`,
    source: { type: 'task', id: task.id },
  };
}

function buildChunkFromMessage(message) {
  return {
    id: `message-${message.timestamp}`,
    text: `${message.from} → ${message.to}: ${message.content}`,
    source: { type: 'message', ts: message.timestamp },
  };
}

module.exports = {
  buildChunksFromLogEntry,
  buildChunkFromFileChange,
  buildChunkFromTask,
  buildChunkFromMessage,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: PASS (all chunk-builder tests green).

- [ ] **Step 5: Commit**

```bash
git add electron/lib/missionIndex.cjs electron/lib/missionIndex.test.cjs
git commit -m "feat: add mission-index chunk builders"
```

---

### Task 2: `missionIndex.cjs` — embedding, storage path, and incremental writer

**Files:**
- Modify: `electron/lib/missionIndex.cjs`
- Test: `electron/lib/missionIndex.test.cjs`

**Interfaces:**
- Consumes: chunk shape `{id, text, source}` from Task 1.
- Produces: `embedText(text)`, `vectorsPathFor(missionId)`, `enqueueChunk(missionId, chunk)`, `flushPending(missionId)` — used by Task 3 (incremental hooks) and Task 4 (query).

Storage shape (spec §1):
```json
{ "missionId": "mission-...", "chunks": [ { "id": "...", "text": "...", "vector": [0.01, ...], "source": {...} } ] }
```

Vectors file path: `~/.claude/agent-teams-snapshots/{missionId}.vectors.json` — same directory as `saveMissionSnapshot` (`electron/ipc/mission.cjs`) and `get_mission_detail` (`electron/ipc/history.cjs`) already use, resolved via `os.homedir()` + `.claude/agent-teams-snapshots` (mirror the existing snapshots-dir construction in `history.cjs`).

`embedText` lazy-loads `@huggingface/transformers`'s `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')` once per process (module-level cached promise), mean-pools + normalizes to a plain `number[]`. On any load/inference error, caches the failure and returns `null` for this and all subsequent calls in the process (no repeated retry storms) — this `null` is the fallback trigger described in spec §1 "Failure mode."

`enqueueChunk`/`flushPending` keep an in-memory `Map<missionId, chunk[]>` of pending (not-yet-embedded) chunks. `flushPending(missionId)`:
1. Takes all pending chunks for `missionId`, clears the pending queue for it.
2. Reads the existing vectors file if present (or starts `{missionId, chunks: []}`).
3. For each pending chunk, calls `embedText(chunk.text)`. If it returns a vector, chunk gets `{...chunk, vector}`. If `null`, chunk gets `{...chunk, vector: null}` (queryable later via keyword fallback — see Task 4).
4. Appends all resulting chunks to `chunks[]`, writes the file back (`JSON.stringify`, `fs.writeFileSync`), returns the number flushed.
5. If zero chunks were pending, does not touch the file (avoids a needless read/write on every idle tick) and returns `0`.

- [ ] **Step 1: Write the failing tests**

```js
// append to electron/lib/missionIndex.test.cjs
const os = require('os');
const path = require('path');
const fs = require('fs');

describe('vectorsPathFor', () => {
  test('resolves under ~/.claude/agent-teams-snapshots', () => {
    const { vectorsPathFor } = require('./missionIndex.cjs');
    const p = vectorsPathFor('mission-abc');
    expect(p).toBe(path.join(os.homedir(), '.claude', 'agent-teams-snapshots', 'mission-abc.vectors.json'));
  });
});

describe('enqueueChunk / flushPending', () => {
  const { enqueueChunk, flushPending, vectorsPathFor } = require('./missionIndex.cjs');
  const missionId = 'mission-test-flush-' + Date.now();
  const filePath = vectorsPathFor(missionId);

  afterEach(() => {
    try { fs.unlinkSync(filePath); } catch (_) {}
  });

  test('flushPending with zero pending chunks does nothing and returns 0', async () => {
    const count = await flushPending(missionId);
    expect(count).toBe(0);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('flushPending writes queued chunks to the vectors file', async () => {
    enqueueChunk(missionId, { id: 'log-1', text: 'hello world', source: { type: 'log', ts: 1 } });
    enqueueChunk(missionId, { id: 'log-2', text: 'goodbye world', source: { type: 'log', ts: 2 } });

    const count = await flushPending(missionId);
    expect(count).toBe(2);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written.missionId).toBe(missionId);
    expect(written.chunks).toHaveLength(2);
    expect(written.chunks[0].id).toBe('log-1');
    expect(written.chunks[0].text).toBe('hello world');
    expect(written.chunks[0]).toHaveProperty('vector');
  });

  test('flushPending appends to an existing file across multiple flushes', async () => {
    enqueueChunk(missionId, { id: 'log-1', text: 'first', source: { type: 'log', ts: 1 } });
    await flushPending(missionId);

    enqueueChunk(missionId, { id: 'log-2', text: 'second', source: { type: 'log', ts: 2 } });
    await flushPending(missionId);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written.chunks.map(c => c.id)).toEqual(['log-1', 'log-2']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: FAIL — `vectorsPathFor`/`enqueueChunk`/`flushPending` not exported yet.

- [ ] **Step 3: Implement embedding, path helper, and incremental writer**

```js
// add to electron/lib/missionIndex.cjs (near the top, after the existing requires-free chunk builders)
const fs = require('fs');
const path = require('path');
const os = require('os');

function snapshotsDir() {
  return path.join(os.homedir(), '.claude', 'agent-teams-snapshots');
}

function vectorsPathFor(missionId) {
  return path.join(snapshotsDir(), `${missionId}.vectors.json`);
}

let embedPipelinePromise = null;
let embedFailed = false;

async function embedText(text) {
  if (embedFailed) return null;
  try {
    if (!embedPipelinePromise) {
      embedPipelinePromise = (async () => {
        const { pipeline } = await import('@huggingface/transformers');
        return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
      })();
    }
    const extractor = await embedPipelinePromise;
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (err) {
    embedFailed = true;
    try { console.warn('[missionIndex] embedText failed, falling back to keyword matching:', err.message); } catch (_) {}
    return null;
  }
}

const pendingChunks = new Map(); // missionId -> chunk[]

function enqueueChunk(missionId, chunk) {
  if (!pendingChunks.has(missionId)) pendingChunks.set(missionId, []);
  pendingChunks.get(missionId).push(chunk);
}

async function flushPending(missionId) {
  const pending = pendingChunks.get(missionId) || [];
  if (pending.length === 0) return 0;
  pendingChunks.set(missionId, []);

  const filePath = vectorsPathFor(missionId);
  let indexData = { missionId, chunks: [] };
  if (fs.existsSync(filePath)) {
    try { indexData = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (_) { indexData = { missionId, chunks: [] }; }
  }

  for (const chunk of pending) {
    const vector = await embedText(chunk.text);
    indexData.chunks.push({ ...chunk, vector });
  }

  fs.mkdirSync(snapshotsDir(), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');
  return pending.length;
}

module.exports.vectorsPathFor = vectorsPathFor;
module.exports.embedText = embedText;
module.exports.enqueueChunk = enqueueChunk;
module.exports.flushPending = flushPending;
```

Also add `@huggingface/transformers` to `package.json`:

```bash
npm install @huggingface/transformers
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: PASS. (The real `embedText` will attempt to download/load the model on first real call — acceptable for this test since it only asserts a `vector` property exists, not its values; if the model download is unavailable in the test environment, `embedText` still resolves to `null` via the catch branch and the test's `toHaveProperty('vector')` still passes since the key is present with value `null`.)

- [ ] **Step 5: Commit**

```bash
git add electron/lib/missionIndex.cjs electron/lib/missionIndex.test.cjs package.json package-lock.json
git commit -m "feat: add embedding pipeline and incremental vector-index writer"
```

---

### Task 3: `missionIndex.cjs` — top-K query with keyword fallback

**Files:**
- Modify: `electron/lib/missionIndex.cjs`
- Test: `electron/lib/missionIndex.test.cjs`

**Interfaces:**
- Consumes: vectors file shape written by Task 2's `flushPending`.
- Produces: `queryIndex(missionId, question, k)` — used by Task 5 (live Q&A) and Task 7 (chat).

Ranking: cosine similarity when the question's embedding and a chunk's `vector` are both non-null. When `embedText` returns `null` for the question (or a chunk has `vector: null`), that chunk is scored via a simple keyword-overlap fallback: fraction of the question's lowercased words (split on non-word characters, deduped) that appear as substrings in the chunk's lowercased `text`. This mirrors spec §1's failure mode: worse recall on paraphrase, but functional. If the question embeds successfully but a given chunk has `vector: null` (mixed state after a mid-run embedding failure followed by recovery is impossible since failure is permanent per-process, but a chunk written *before* transformers.js was available in an earlier app version could still have `vector: null` on disk), that chunk falls back to the keyword score for itself while other chunks still use cosine — scores from the two methods are on comparable enough scales (both roughly 0-1) that mixing is acceptable for a top-K ranking, not an exact score.

- [ ] **Step 1: Write the failing tests**

```js
// append to electron/lib/missionIndex.test.cjs
describe('queryIndex', () => {
  const { enqueueChunk, flushPending, queryIndex, vectorsPathFor } = require('./missionIndex.cjs');
  const missionId = 'mission-test-query-' + Date.now();
  const filePath = vectorsPathFor(missionId);

  afterEach(() => {
    try { fs.unlinkSync(filePath); } catch (_) {}
  });

  test('returns top-K chunks ranked by keyword overlap when embeddings are unavailable', async () => {
    // Write chunks directly with vector: null to force the keyword-fallback path deterministically.
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      missionId,
      chunks: [
        { id: 'a', text: 'Lead decided to use React for the frontend', vector: null, source: { type: 'log', ts: 1 } },
        { id: 'b', text: 'Dev-Backend wrote the login API endpoint', vector: null, source: { type: 'log', ts: 2 } },
        { id: 'c', text: 'unrelated chunk about database migrations', vector: null, source: { type: 'log', ts: 3 } },
      ],
    }), 'utf-8');

    const results = await queryIndex(missionId, 'why was react chosen for the frontend', 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a');
  });

  test('returns empty array when the index file does not exist', async () => {
    const results = await queryIndex('mission-does-not-exist-' + Date.now(), 'anything', 6);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: FAIL — `queryIndex` not exported yet.

- [ ] **Step 3: Implement `queryIndex`**

```js
// add to electron/lib/missionIndex.cjs
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function keywordScore(question, text) {
  const words = [...new Set(question.toLowerCase().split(/\W+/).filter(Boolean))];
  if (words.length === 0) return 0;
  const lowerText = text.toLowerCase();
  const hits = words.filter(w => lowerText.includes(w)).length;
  return hits / words.length;
}

async function queryIndex(missionId, question, k = 6) {
  const filePath = vectorsPathFor(missionId);
  if (!fs.existsSync(filePath)) return [];

  let indexData;
  try { indexData = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (_) { return []; }
  const chunks = indexData.chunks || [];
  if (chunks.length === 0) return [];

  const questionVector = await embedText(question);

  const scored = chunks.map(chunk => {
    const score = (questionVector && chunk.vector)
      ? cosineSimilarity(questionVector, chunk.vector)
      : keywordScore(question, chunk.text);
    return { id: chunk.id, text: chunk.text, source: chunk.source, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

module.exports.queryIndex = queryIndex;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/lib/missionIndex.cjs electron/lib/missionIndex.test.cjs
git commit -m "feat: add top-K query with keyword-overlap fallback to mission index"
```

---

### Task 4: Incremental indexing hooks in `mission.cjs`

**Files:**
- Modify: `electron/ipc/mission.cjs`
- Test: `electron/lib/missionIndex.test.cjs` (incremental-accumulation assertions already added in Task 2; this task's own regression coverage is the existing `mission.cjs` test suite, run unchanged)

**Interfaces:**
- Consumes: `enqueueChunk`, `flushPending`, `buildChunksFromLogEntry`, `buildChunkFromFileChange`, `buildChunkFromTask`, `buildChunkFromMessage` from `missionIndex.cjs`.
- Produces: nothing new consumed by later tasks directly, but this is what makes the index non-empty for Task 5/7 to query against.

Hook points (grounded in existing code):
- `handleParsedEvent` (`mission.cjs:535`) — after a `LogEntry` is pushed to `missionState.log`, call `enqueueChunk(missionState.id, ...)` for each chunk `buildChunksFromLogEntry` returns (0 or 1).
- `upsertFileChange` (`mission.cjs:1636-1685`) — after a `FileChange` is pushed/updated, call `enqueueChunk(missionState.id, buildChunkFromFileChange(change))`.
- Task-completion in `readProcessStdout_deploy` — when a task transitions to completed, call `enqueueChunk(missionState.id, buildChunkFromTask(task))`.
- Message handling (wherever inter-agent `Message` objects are appended to `missionState.messages`) — call `enqueueChunk(missionState.id, buildChunkFromMessage(message))`.

Debounced flush: a module-level `setInterval`-free debounce — track `pendingCountSinceFlush` per mission and last-enqueue timestamp; a single `setTimeout`-based idle timer (reset on every `enqueueChunk` call, fires after 3000ms of no new enqueues, or immediately once 20 items have been queued since the last flush) calls `flushPending(missionState.id)`. This lives in `missionIndex.cjs` as an internal `scheduleFlush(missionId)` helper invoked by the `mission.cjs` hook sites instead of calling `flushPending` directly on every event — keeps the debounce logic colocated with the writer it protects.

- [ ] **Step 1: Add `scheduleFlush` to `missionIndex.cjs` with a test**

```js
// append to electron/lib/missionIndex.test.cjs
describe('scheduleFlush', () => {
  const { enqueueChunk, scheduleFlush, vectorsPathFor } = require('./missionIndex.cjs');
  const missionId = 'mission-test-schedule-' + Date.now();
  const filePath = vectorsPathFor(missionId);

  afterEach(() => {
    try { fs.unlinkSync(filePath); } catch (_) {}
  });

  test('flushes immediately once 20 items are queued without waiting for idle', async () => {
    for (let i = 0; i < 20; i++) {
      enqueueChunk(missionId, { id: `log-${i}`, text: `entry ${i}`, source: { type: 'log', ts: i } });
      scheduleFlush(missionId);
    }
    // give the immediate-flush microtask a tick to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fs.existsSync(filePath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written.chunks).toHaveLength(20);
  });

  test('flushes after idle timeout with fewer than 20 items', async () => {
    enqueueChunk(missionId, { id: 'log-x', text: 'a lone entry', source: { type: 'log', ts: 100 } });
    scheduleFlush(missionId, { idleMs: 20 });
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: FAIL — `scheduleFlush` not exported yet.

- [ ] **Step 3: Implement `scheduleFlush`**

```js
// add to electron/lib/missionIndex.cjs
const flushTimers = new Map(); // missionId -> Timeout
const FLUSH_ITEM_THRESHOLD = 20;
const FLUSH_IDLE_MS_DEFAULT = 3000;

function scheduleFlush(missionId, opts = {}) {
  const idleMs = opts.idleMs || FLUSH_IDLE_MS_DEFAULT;
  const pending = pendingChunks.get(missionId) || [];

  if (flushTimers.has(missionId)) {
    clearTimeout(flushTimers.get(missionId));
    flushTimers.delete(missionId);
  }

  if (pending.length >= FLUSH_ITEM_THRESHOLD) {
    flushPending(missionId).catch(() => {});
    return;
  }

  const timer = setTimeout(() => {
    flushTimers.delete(missionId);
    flushPending(missionId).catch(() => {});
  }, idleMs);
  flushTimers.set(missionId, timer);
}

module.exports.scheduleFlush = scheduleFlush;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/lib/missionIndex.test.cjs`
Expected: PASS.

- [ ] **Step 5: Wire the hooks into `mission.cjs`**

At the top of `electron/ipc/mission.cjs`, alongside the existing `require('../lib/qcqa.cjs')` (line 23):

```js
const { enqueueChunk, scheduleFlush, buildChunksFromLogEntry, buildChunkFromFileChange,
  buildChunkFromTask, buildChunkFromMessage, flushPending } = require('../lib/missionIndex.cjs');
```

In `handleParsedEvent` (`mission.cjs:535`), immediately after the existing line that pushes a new entry to `missionState.log` (do not alter the push itself — add a call right after it):

```js
for (const chunk of buildChunksFromLogEntry(entry)) {
  enqueueChunk(missionState.id, chunk);
}
scheduleFlush(missionState.id);
```

In `upsertFileChange` (`mission.cjs:1636-1685`), immediately after the function's existing push/update of `missionState.file_changes` (before its `return`):

```js
enqueueChunk(missionState.id, buildChunkFromFileChange(change));
scheduleFlush(missionState.id);
```

At the task-completion site in `readProcessStdout_deploy` (wherever a task's status is set to completed and the task object already carries `title`/`detail`), add:

```js
enqueueChunk(missionState.id, buildChunkFromTask(task));
scheduleFlush(missionState.id);
```

At the message-append site (wherever `missionState.messages.push(...)` happens for Agent Teams inter-agent DMs), add:

```js
enqueueChunk(missionState.id, buildChunkFromMessage(message));
scheduleFlush(missionState.id);
```

In the terminal branch of `watchProcessExit_deploy` (the same branch that already calls `saveToHistory`/`saveMissionSnapshot`), add a final flush so nothing queued is lost when the mission ends:

```js
await flushPending(missionState.id).catch(() => {});
```

- [ ] **Step 6: Run the full existing mission test suite to confirm no regression**

Run: `npx vitest run electron`
Expected: PASS — all pre-existing `mission.cjs`-adjacent tests still green (this task only adds calls after existing pushes, never alters control flow or return values).

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs electron/lib/missionIndex.cjs electron/lib/missionIndex.test.cjs
git commit -m "feat: hook incremental mission-index updates into log/file/task/message events"
```

---

### Task 5: `ask_mission_live` IPC handler (live side-channel Q&A)

**Files:**
- Modify: `electron/ipc/mission.cjs`
- Modify: `electron/preload.cjs`
- Test: create `electron/ipc/mission.askLive.test.cjs`

**Interfaces:**
- Consumes: `queryIndex` from `missionIndex.cjs`; `spawnAgentProcess` (`mission.cjs:1229`, existing); `buildMissionSummary` (`mission.cjs:972`, existing).
- Produces: `ask_mission_live` IPC handler, `mission:companion-answer` event — consumed by Task 6 (`AskMissionPanel.jsx`).

Handler behavior (spec §2):
1. Reject if there is no live mission (`!missionState` or `missionState.status` not in `{Running, Deploying, Launching}`) with a clear error — this is a UI guard, not a real race, since the tab is only shown while a mission is active.
2. `const topK = await queryIndex(missionState.id, question, 6)`.
3. Build a compact prompt: the question, the top-K chunk texts (each with its `source.type`), and a compact live-state snapshot from `buildMissionSummary(missionState)`.
4. Spawn via the existing `spawnAgentProcess({ backendId: agentBackendOf(leadAgent), model: 'sonnet', prompt, resumeSessionId: null, maxTurns: 10, useAgentTeams: false, cwd: missionState.project_path, sendToWindow: undefined })` — **critically, `sendToWindow` is omitted/undefined here so this spawn never calls the shared `sendToWindow('mission:log', ...)` side-channel logging that `spawnAgentProcess` does internally for resume-fallback messages** (avoids polluting the mission's own activity log with side-channel noise). The returned `proc` is a local variable — never assigned to `childProcess` is impossible to fully prevent since `spawnAgentProcess` internally sets `childProcess = proc` (`mission.cjs:1305`/`1249`) as a side effect. To satisfy the "never touches `childProcess`" requirement from the spec, this handler must **save and restore** the previous `childProcess`/`childBackend` around the call:

```js
const savedChildProcess = childProcess;
const savedChildBackend = childBackend;
const { proc } = spawnAgentProcess({ /* ... */ });
childProcess = savedChildProcess;
childBackend = savedChildBackend;
```

   This is the one deviation from calling `spawnAgentProcess` completely unmodified — necessary because it's genuinely the single spawn site (per its own header comment) and the alternative (duplicating spawn logic) would violate "reuse the existing `spawnAgentProcess`" from spec §2. The save/restore keeps the invariant "the Lead's driving process is never affected by this call" exactly true while still reusing the shared spawn primitive.
5. Collect `proc.stdout` into a string; on `close`, extract the final text (same "answer is everything after the last assistant turn" shape used elsewhere — for a single-turn `-p` call with `--output-format stream-json`, parse each line as JSON and take the last `type: 'assistant'` message's text content, mirroring how `handleParsedEvent` already extracts text from stream-json events).
6. Emit `sendToWindow('mission:companion-answer', { question, answer, timestamp: Date.now() })` and resolve the IPC call with `{ answer }`.
7. On timeout (60s — this is meant to answer in seconds per spec §2, not agentic multi-turn like the debrief chat) or process error, resolve with `{ answer: null, error: '...' }` rather than rejecting, so a live-Q&A failure never surfaces as an uncaught IPC rejection in the renderer.

- [ ] **Step 1: Write the failing integration test**

```js
// electron/ipc/mission.askLive.test.cjs
'use strict';
const { describe, test, expect, beforeEach } = require('vitest');
const { EventEmitter } = require('events');
const missionModule = require('./mission.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => { proc.killed = true; };
  return proc;
}

describe('ask_mission_live', () => {
  let fakeRealProc;

  beforeEach(() => {
    fakeRealProc = makeFakeProc();
    missionModule.__setMissionStateForTest({
      id: 'mission-live-1',
      status: 'Running',
      phase: 'Executing',
      project_path: '/tmp/proj',
      agents: [{ name: 'Lead', model: 'sonnet', backend: 'claude' }],
      log: [], tasks: [], file_changes: [], messages: [],
    });
  });

  test('spawns a second process and leaves the driving childProcess untouched', async () => {
    const drivingProc = makeFakeProc();
    missionModule.__setChildProcessForTest(drivingProc);

    const askProcPromise = new Promise(resolve => {
      missionModule.__setSpawnAgentProcessForTest((spec) => {
        resolve(spec);
        return { proc: fakeRealProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true };
      });
    });

    const answerPromise = missionModule.__askMissionLiveForTest({ question: 'what is the Lead doing right now?' });

    await askProcPromise;
    fakeRealProc.stdout.emit('data', Buffer.from(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Lead is writing tests.' }] } }) + '\n'
    ));
    fakeRealProc.emit('close', 0);

    const result = await answerPromise;
    expect(result.answer).toMatch(/writing tests/);
    expect(missionModule.__getChildProcessForTest()).toBe(drivingProc);
  });

  test('resolves with a null answer instead of throwing on process error', async () => {
    missionModule.__setSpawnAgentProcessForTest(() => ({ proc: fakeRealProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true }));

    const answerPromise = missionModule.__askMissionLiveForTest({ question: 'anything' });
    fakeRealProc.emit('error', new Error('spawn failed'));

    const result = await answerPromise;
    expect(result.answer).toBeNull();
    expect(result.error).toMatch(/spawn failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.askLive.test.cjs`
Expected: FAIL — `__askMissionLiveForTest`/`__setSpawnAgentProcessForTest`/`__setChildProcessForTest`/`__getChildProcessForTest` don't exist yet.

- [ ] **Step 3: Add the test seams and the handler**

Near the existing `if (process.env.NODE_ENV === 'test')` test-seam block at the bottom of `mission.cjs` (around line 4674), add:

```js
module.exports.__setSpawnAgentProcessForTest = (fn) => { spawnAgentProcessRef = fn; };
module.exports.__setChildProcessForTest = (proc) => { childProcess = proc; };
module.exports.__getChildProcessForTest = () => childProcess;
module.exports.__askMissionLiveForTest = (args) => askMissionLive(args, () => {});
```

Introduce an indirection so tests can substitute `spawnAgentProcess` without touching the real subprocess machinery — near the top of the module where `spawnAgentProcess` is defined, add:

```js
let spawnAgentProcessRef = spawnAgentProcess;
```

And change the one call site inside the new handler (below) to call `spawnAgentProcessRef(...)` instead of `spawnAgentProcess(...)` directly.

Add the handler function (near `answer_question`, `mission.cjs:3905`):

```js
async function askMissionLive({ question }, sendToWindow) {
  if (!missionState || !['Running', 'Deploying', 'Launching'].includes(missionState.status)) {
    return { answer: null, error: 'No live mission to ask.' };
  }

  const topK = await queryIndex(missionState.id, question, 6);
  const contextBlock = topK.map(c => `[${c.source.type}] ${c.text}`).join('\n');
  const summary = buildMissionSummary(missionState);
  const prompt = [
    `You are answering a quick question about a mission that is CURRENTLY RUNNING. Answer in 2-4 sentences, based only on the context below. If you don't know, say so — do not guess.`,
    `## Current mission state\n${JSON.stringify(summary)}`,
    `## Relevant context\n${contextBlock}`,
    `## Question\n${question}`,
  ].join('\n\n');

  const leadAgent = (missionState.agents || []).find(a => a.name === 'Lead');
  const backendId = agentBackendOf(leadAgent);

  const savedChildProcess = childProcess;
  const savedChildBackend = childBackend;

  return new Promise((resolve) => {
    let proc;
    try {
      const spawned = spawnAgentProcessRef({
        backendId, model: 'sonnet', prompt, resumeSessionId: null, maxTurns: 10,
        useAgentTeams: false, cwd: missionState.project_path,
      });
      proc = spawned.proc;
    } catch (err) {
      childProcess = savedChildProcess;
      childBackend = savedChildBackend;
      resolve({ answer: null, error: err.message });
      return;
    }
    childProcess = savedChildProcess;
    childBackend = savedChildBackend;

    let stdout = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve({ answer: null, error: 'Live Q&A timed out after 60s' });
    }, 60000);

    proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ answer: null, error: err.message });
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const answer = extractAssistantText(stdout);
      const entry = { question, answer, timestamp: Date.now() };
      if (sendToWindow) sendToWindow('mission:companion-answer', entry);
      resolve({ answer });
    });
  });
}

function extractAssistantText(stdoutText) {
  const lines = stdoutText.split('\n').filter(Boolean);
  let lastText = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
        const textPart = parsed.message.content.find(p => p.type === 'text');
        if (textPart) lastText = textPart.text;
      }
    } catch (_) { /* not a JSON line, skip */ }
  }
  return lastText;
}
```

Register the IPC handler inside `registerMission(getMainWindow)` (`mission.cjs:3300`), alongside `answer_question`:

```js
ipcMain.handle('ask_mission_live', async (_event, args) => {
  const win = getMainWindow();
  const sendToWindow = (channel, data) => { if (win) win.webContents.send(channel, data); };
  return askMissionLive(args, sendToWindow);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.askLive.test.cjs`
Expected: PASS.

- [ ] **Step 5: Whitelist the new IPC command and event in `preload.cjs`**

```js
// electron/preload.cjs — ALLOWED_COMMANDS array, in the mission section
'ask_mission_live',
```

```js
// electron/preload.cjs — ALLOWED_EVENTS array
'mission:companion-answer',
```

- [ ] **Step 6: Run full existing test suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.askLive.test.cjs electron/preload.cjs
git commit -m "feat: add ask_mission_live IPC handler for read-only side-channel Q&A"
```

---

### Task 6: `AskMissionPanel.jsx` + wire "Ask" tab into `MissionDashboard`

**Files:**
- Create: `src/components/mission/AskMissionPanel.jsx`
- Modify: `src/components/mission/MissionDashboard.jsx`

**Interfaces:**
- Consumes: `invoke('ask_mission_live', {question})` → `{answer, error?}`; `electronAPI.on('mission:companion-answer', cb)` (via existing `invoke`/`on` wrapper used elsewhere in the codebase — follow the same import used by `MissionHistoryPanel.jsx`, i.e. `import { invoke } from '...'`).
- Produces: `<AskMissionPanel />` component rendered inside `MissionDashboard`'s tab body.

Follows the exact tab-array pattern already in `MissionDashboard.jsx:16-21` and `:242-249`.

- [ ] **Step 1: Add the `AskMissionPanel` component**

```jsx
// src/components/mission/AskMissionPanel.jsx
import { useState, useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { invoke } from '../../lib/ipc'

export function AskMissionPanel() {
  const [question, setQuestion] = useState('')
  const [pairs, setPairs] = useState([])
  const [asking, setAsking] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    const unlisten = window.electronAPI?.on('mission:companion-answer', (data) => {
      setPairs(prev => prev.map(p => p.timestamp === data.timestamp ? { ...p, answer: data.answer, pending: false } : p))
    })
    return () => unlisten && unlisten()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pairs])

  const handleAsk = async () => {
    const trimmed = question.trim()
    if (!trimmed || asking) return
    const timestamp = Date.now()
    setPairs(prev => [...prev, { question: trimmed, answer: null, pending: true, timestamp }])
    setQuestion('')
    setAsking(true)
    try {
      const result = await invoke('ask_mission_live', { question: trimmed })
      setPairs(prev => prev.map(p => p.timestamp === timestamp
        ? { ...p, answer: result.error ? `⚠ ${result.error}` : result.answer, pending: false }
        : p))
    } catch (err) {
      setPairs(prev => prev.map(p => p.timestamp === timestamp ? { ...p, answer: `⚠ ${err.message}`, pending: false } : p))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin pb-2">
        {pairs.length === 0 && (
          <p className="text-[11px] text-vs-muted font-mono">
            Hỏi bất cứ điều gì về mission đang chạy — không làm gián đoạn Lead.
          </p>
        )}
        {pairs.map((p) => (
          <div key={p.timestamp} className="space-y-1">
            <div className="text-xs text-vs-text font-mono">Q: {p.question}</div>
            <div className="text-xs text-vs-accent font-mono pl-3">
              {p.pending ? 'Đang suy nghĩ…' : `A: ${p.answer ?? '(no answer)'}`}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 pt-2 border-t border-vs-border/50">
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() } }}
          placeholder="Hỏi mission đang chạy..."
          className="flex-1 bg-vs-bg border border-vs-border rounded-md px-3 py-2 text-xs text-vs-text font-mono
                     placeholder-vs-muted/40 focus:outline-none focus:border-vs-accent/50"
        />
        <button
          onClick={handleAsk}
          disabled={!question.trim() || asking}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-vs-accent hover:bg-vs-accent/80
                     text-vs-heading disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  )
}
```

(If `../../lib/ipc` is not the actual existing helper path, use whatever module `MissionHistoryPanel.jsx` imports `invoke` from — check its import line and match it exactly.)

- [ ] **Step 2: Wire the "Ask" tab into `MissionDashboard.jsx`**

```jsx
// src/components/mission/MissionDashboard.jsx — imports
import { AskMissionPanel } from './AskMissionPanel'
import { MessageCircleQuestion } from 'lucide-react' // add to existing lucide-react import line
```

```jsx
// MissionDashboard.jsx:16-21 — baseTabs array, add one entry
const baseTabs = [
  { id: 'tasks',    label: 'Tasks',    icon: ListTodo },
  { id: 'ask',      label: 'Ask',      icon: MessageCircleQuestion },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'files',    label: 'Files',    icon: FolderOpen },
  { id: 'graph',    label: 'Graph',    icon: GitFork },
]
```

Gate visibility the same way `hasMessages`/`visibleBaseTabs` already gates the Messages tab (`MissionDashboard.jsx:109-120`) — Ask should only show when NOT a history view and the mission is actually running:

```jsx
// near the existing visibleBaseTabs computation
const showAskTab = !isHistoryView && isRunning
const visibleBaseTabs = baseTabs.filter(t => t.id !== 'ask' || showAskTab).filter(t => t.id !== 'messages' || hasMessages)
```

(Adjust to compose with the existing `hasMessages` filter rather than replace it — read the exact existing line before editing.)

```jsx
// MissionDashboard.jsx:242-249 — tab body rendering, add one line
{activeTab === 'ask' && <AskMissionPanel />}
```

- [ ] **Step 3: Manual verification (UI feature — no automated test for visual wiring)**

Run: `npm run electron:dev`
Steps: launch a mission, once it reaches `Running`/`Executing`, open the "Ask" tab, type a question, confirm an answer streams back within ~10-60s and the mission's own Activity/Tasks tabs are completely unaffected (no new log lines from the side-channel call appear in Activity).

- [ ] **Step 4: Commit**

```bash
git add src/components/mission/AskMissionPanel.jsx src/components/mission/MissionDashboard.jsx
git commit -m "feat: add live Ask tab for read-only mission side-channel Q&A"
```

---

### Task 7: Debrief summary on mission completion

**Files:**
- Modify: `electron/ipc/mission.cjs`
- Test: create `electron/ipc/mission.debrief.test.cjs`

**Interfaces:**
- Consumes: `spawnAgentProcessRef` (from Task 5), `extractAssistantText` (from Task 5).
- Produces: `debrief_summary` field written onto the snapshot at completion — consumed by Task 8/9 (chat sessions read it as extra context) and by any future UI showing the debrief.

In the terminal branch of `watchProcessExit_deploy`, alongside the existing `saveToHistory`/`saveMissionSnapshot` calls, add one `spawnAgentProcessRef` call (same save/restore-`childProcess` pattern as Task 5, since the driving process has already exited by this point anyway but the pattern must stay consistent) that asks for a structured JSON debrief:

```json
{ "goal": "...", "agents_involved": ["Lead", "..."], "key_files": ["..."], "issues_encountered": ["..."], "outcome": "..." }
```

- [ ] **Step 1: Write the failing test**

```js
// electron/ipc/mission.debrief.test.cjs
'use strict';
const { describe, test, expect, beforeEach } = require('vitest');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const missionModule = require('./mission.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => {};
  return proc;
}

describe('generateDebriefSummary', () => {
  const missionId = 'mission-debrief-test-' + Date.now();
  const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);

  beforeEach(() => {
    missionModule.__setMissionStateForTest({
      id: missionId, status: 'Completed', phase: 'Done',
      project_path: '/tmp/proj', agents: [{ name: 'Lead', model: 'sonnet', backend: 'claude' }],
      log: [], tasks: [], file_changes: [], messages: [], description: 'Add login feature',
    });
  });

  afterEach(() => {
    try { fs.unlinkSync(snapshotPath); } catch (_) {}
  });

  test('writes debrief_summary onto the saved snapshot', async () => {
    const fakeProc = makeFakeProc();
    missionModule.__setSpawnAgentProcessForTest(() => ({ proc: fakeProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true }));

    const debriefPromise = missionModule.__generateDebriefSummaryForTest();

    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: JSON.stringify({
        goal: 'Add login feature', agents_involved: ['Lead'], key_files: ['src/Login.jsx'],
        issues_encountered: [], outcome: 'Completed successfully',
      }) }] },
    }) + '\n'));
    fakeProc.emit('close', 0);

    const debrief = await debriefPromise;
    expect(debrief.goal).toBe('Add login feature');
    expect(debrief.outcome).toBe('Completed successfully');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.debrief.test.cjs`
Expected: FAIL — `__generateDebriefSummaryForTest` doesn't exist yet.

- [ ] **Step 3: Implement `generateDebriefSummary` and wire it into the completion path**

Add near `askMissionLive` in `mission.cjs`:

```js
async function generateDebriefSummary() {
  const prompt = [
    `The mission below has just completed. Produce ONLY a JSON object (no markdown fences, no prose) with this exact shape:`,
    `{"goal": string, "agents_involved": string[], "key_files": string[], "issues_encountered": string[], "outcome": string}`,
    `## Mission description\n${missionState.description || ''}`,
    `## Agents\n${(missionState.agents || []).map(a => a.name).join(', ')}`,
    `## File changes\n${(missionState.file_changes || []).map(f => `${f.path} (${f.action})`).join('\n')}`,
    `## Final task list\n${(missionState.tasks || []).map(t => `${t.title}: ${t.status}`).join('\n')}`,
  ].join('\n\n');

  const leadAgent = (missionState.agents || []).find(a => a.name === 'Lead');
  const backendId = agentBackendOf(leadAgent);

  const savedChildProcess = childProcess;
  const savedChildBackend = childBackend;

  return new Promise((resolve) => {
    let proc;
    try {
      const spawned = spawnAgentProcessRef({
        backendId, model: 'haiku', prompt, resumeSessionId: null, maxTurns: 5,
        useAgentTeams: false, cwd: missionState.project_path,
      });
      proc = spawned.proc;
    } catch (err) {
      childProcess = savedChildProcess;
      childBackend = savedChildBackend;
      resolve(null);
      return;
    }
    childProcess = savedChildProcess;
    childBackend = savedChildBackend;

    let stdout = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve(null);
    }, 60000);

    proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      const text = extractAssistantText(stdout);
      if (!text) { resolve(null); return; }
      try {
        const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        resolve(JSON.parse(cleaned));
      } catch (_) {
        resolve(null);
      }
    });
  });
}
```

In the terminal branch of `watchProcessExit_deploy`, immediately before or alongside the existing `saveMissionSnapshot(...)` call:

```js
const debrief_summary = await generateDebriefSummary().catch(() => null);
saveMissionSnapshot(missionState, { debrief_summary });
```

`saveMissionSnapshot`'s existing signature must accept an optional second `extra` argument merged into the written JSON (check its current signature at `mission.cjs:766` — if it currently only takes `(missionState)`, extend it to `(missionState, extra = {})` and spread `extra` into the written object: `{ ...snapshotBody, ...extra }`). This is additive only — every existing call site that omits the second argument is unaffected.

Add the test seam:

```js
module.exports.__generateDebriefSummaryForTest = generateDebriefSummary;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.debrief.test.cjs`
Expected: PASS.

- [ ] **Step 5: Regression test for old-shaped snapshots**

Add to `electron/ipc/mission.debrief.test.cjs`:

```js
describe('backward compatibility', () => {
  test('get_mission_detail still loads a snapshot with no debrief_summary field', () => {
    const history = require('./history.cjs');
    const missionId = 'mission-old-shape-' + Date.now();
    const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({ id: missionId, status: 'Completed', tasks: [], log: [] }), 'utf-8');

    expect(() => JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'))).not.toThrow();
    fs.unlinkSync(snapshotPath);
  });
});
```

Run: `npx vitest run electron/ipc/mission.debrief.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.debrief.test.cjs
git commit -m "feat: generate and persist a debrief summary on mission completion"
```

---

### Task 8: Chat session storage + `list_mission_chats`/`get_mission_chat`/`delete_mission_chat` IPC

**Files:**
- Modify: `electron/ipc/history.cjs`
- Modify: `electron/preload.cjs`
- Test: create `electron/ipc/history.chats.test.cjs`

**Interfaces:**
- Produces: chat-session file I/O helpers (`chatsDirFor(missionId)`, `listChatsFor(missionId)`, `readChat(missionId, chatId)`, `writeChat(missionId, chat)`, `deleteChat(missionId, chatId)`) and their IPC handlers — consumed by Task 9 (`ask_mission_chat`) and Task 10 (`MissionChatPanel.jsx`).

Storage: `~/.claude/agent-teams-snapshots/{missionId}.chats/{chatId}.json`, shape per spec §3:

```json
{ "id": "chat-...", "missionId": "...", "title": "...", "createdAt": 0, "updatedAt": 0,
  "messages": [{ "role": "user" | "assistant", "content": "...", "timestamp": 0 }] }
```

- [ ] **Step 1: Write the failing tests**

```js
// electron/ipc/history.chats.test.cjs
'use strict';
const { describe, test, expect, afterEach } = require('vitest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const historyModule = require('./history.cjs');

describe('mission chat session storage', () => {
  const missionId = 'mission-chat-test-' + Date.now();
  const chatsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.chats`);

  afterEach(() => {
    try { fs.rmSync(chatsDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('list_mission_chats returns empty array when no chats exist', async () => {
    const result = await historyModule.__listMissionChatsForTest({ missionId });
    expect(result).toEqual([]);
  });

  test('a written chat file is returned by list and get', async () => {
    fs.mkdirSync(chatsDir, { recursive: true });
    const chat = {
      id: 'chat-1', missionId, title: 'Why React?', createdAt: 1000, updatedAt: 1000,
      messages: [{ role: 'user', content: 'Why React?', timestamp: 1000 }],
    };
    fs.writeFileSync(path.join(chatsDir, 'chat-1.json'), JSON.stringify(chat), 'utf-8');

    const list = await historyModule.__listMissionChatsForTest({ missionId });
    expect(list).toEqual([{ id: 'chat-1', title: 'Why React?', createdAt: 1000, updatedAt: 1000, messageCount: 1 }]);

    const full = await historyModule.__getMissionChatForTest({ missionId, chatId: 'chat-1' });
    expect(full).toEqual(chat);
  });

  test('delete_mission_chat removes the chat file', async () => {
    fs.mkdirSync(chatsDir, { recursive: true });
    fs.writeFileSync(path.join(chatsDir, 'chat-2.json'), JSON.stringify({
      id: 'chat-2', missionId, title: 'x', createdAt: 1, updatedAt: 1, messages: [],
    }), 'utf-8');

    await historyModule.__deleteMissionChatForTest({ missionId, chatId: 'chat-2' });
    expect(fs.existsSync(path.join(chatsDir, 'chat-2.json'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/ipc/history.chats.test.cjs`
Expected: FAIL — test-seam functions don't exist yet.

- [ ] **Step 3: Implement storage helpers and handlers in `history.cjs`**

Add near the top of `electron/ipc/history.cjs`, reusing the same snapshots-dir constant already defined there for `get_mission_detail`:

```js
function chatsDirFor(missionId) {
  return path.join(snapshotsDir(), `${missionId}.chats`);
}

async function listMissionChats({ missionId }) {
  const dir = chatsDirFor(missionId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const chat = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    return { id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function getMissionChat({ missionId, chatId }) {
  const filePath = path.join(chatsDirFor(missionId), `${chatId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function deleteMissionChat({ missionId, chatId }) {
  const filePath = path.join(chatsDirFor(missionId), `${chatId}.json`);
  try { fs.unlinkSync(filePath); } catch (_) {}
}

function writeMissionChat(missionId, chat) {
  const dir = chatsDirFor(missionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${chat.id}.json`), JSON.stringify(chat), 'utf-8');
}
```

(`path`/`fs` and the snapshots-dir helper are already imported/defined in `history.cjs` for `get_mission_detail` — reuse them; do not re-declare if already present under a different name, match the existing local convention.)

Register IPC handlers inside this file's registration function (alongside `get_mission_detail`):

```js
ipcMain.handle('list_mission_chats', async (_event, args) => listMissionChats(args));
ipcMain.handle('get_mission_chat', async (_event, args) => getMissionChat(args));
ipcMain.handle('delete_mission_chat', async (_event, args) => deleteMissionChat(args));
```

Add test seams at the bottom of `history.cjs`, following the same `NODE_ENV === 'test'` convention as `mission.cjs`:

```js
module.exports.__listMissionChatsForTest = listMissionChats;
module.exports.__getMissionChatForTest = getMissionChat;
module.exports.__deleteMissionChatForTest = deleteMissionChat;
module.exports.__writeMissionChatForTest = writeMissionChat;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/ipc/history.chats.test.cjs`
Expected: PASS.

- [ ] **Step 5: Whitelist the new IPC commands in `preload.cjs`**

```js
// electron/preload.cjs — ALLOWED_COMMANDS array, history section
'list_mission_chats',
'get_mission_chat',
'delete_mission_chat',
```

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/history.cjs electron/ipc/history.chats.test.cjs electron/preload.cjs
git commit -m "feat: add mission chat session storage and list/get/delete IPC handlers"
```

---

### Task 9: `ask_mission_chat` IPC handler (agentic multi-turn debrief chat)

**Files:**
- Modify: `electron/ipc/history.cjs`
- Modify: `electron/preload.cjs`
- Test: create `electron/ipc/history.askChat.test.cjs`

**Interfaces:**
- Consumes: `queryIndex` from `missionIndex.cjs`; `writeMissionChat`/`getMissionChat` from Task 8; `spawnAgentProcessRef`-equivalent spawn indirection (mirrors Task 5's pattern, but this file needs its own reference since `history.cjs` doesn't share `mission.cjs`'s module scope — import `spawnAgentProcess` directly from `mission.cjs`'s exports, since `mission.cjs` already exports it for reuse, or duplicate the same thin indirection locally for testability).
- Produces: `ask_mission_chat` IPC handler — consumed by Task 10 (`MissionChatPanel.jsx`).

Handler behavior (spec §3):
1. `chatId: string | null` — if `null`, create a new chat (`id: 'chat-' + Date.now()`, `title` derived from the first 60 chars of `question`, empty `messages`).
2. Load existing `messages[]` (empty for new chats).
3. `queryIndex(missionId, question, 6)` against the (by now complete) mission index.
4. Build the prompt: full prior `messages[]` rendered as a conversation transcript + the top-K retrieved chunks + the question. No time-pressure timeout like Task 5's 60s — use a longer timeout (e.g. 180000ms, matching `runQcQaCheck`'s default) since this can be multi-turn/agentic.
5. Append both the user question and assistant answer to `messages[]`, bump `updatedAt`, write via `writeMissionChat`.
6. Return `{ chatId, answer }`.

- [ ] **Step 1: Write the failing test**

```js
// electron/ipc/history.askChat.test.cjs
'use strict';
const { describe, test, expect, afterEach } = require('vitest');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const historyModule = require('./history.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => {};
  return proc;
}

describe('ask_mission_chat', () => {
  const missionId = 'mission-chat-ask-' + Date.now();
  const chatsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.chats`);

  afterEach(() => {
    try { fs.rmSync(chatsDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('creates a new chat when chatId is null and persists both messages', async () => {
    const fakeProc = makeFakeProc();
    historyModule.__setSpawnAgentProcessForTest(() => ({ proc: fakeProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true }));

    const answerPromise = historyModule.__askMissionChatForTest({ missionId, chatId: null, question: 'Why was React chosen?' });

    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: 'React was chosen for its ecosystem.' }] },
    }) + '\n'));
    fakeProc.emit('close', 0);

    const result = await answerPromise;
    expect(result.answer).toMatch(/ecosystem/);
    expect(result.chatId).toMatch(/^chat-/);

    const saved = await historyModule.__getMissionChatForTest({ missionId, chatId: result.chatId });
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[0]).toMatchObject({ role: 'user', content: 'Why was React chosen?' });
    expect(saved.messages[1]).toMatchObject({ role: 'assistant', content: 'React was chosen for its ecosystem.' });
    expect(saved.title).toBe('Why was React chosen?');
  });

  test('appends to an existing chat when chatId is provided', async () => {
    await historyModule.__writeMissionChatForTest(missionId, {
      id: 'chat-existing', missionId, title: 'first question', createdAt: 1, updatedAt: 1,
      messages: [{ role: 'user', content: 'first question', timestamp: 1 }, { role: 'assistant', content: 'first answer', timestamp: 1 }],
    });

    const fakeProc = makeFakeProc();
    historyModule.__setSpawnAgentProcessForTest(() => ({ proc: fakeProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true }));

    const answerPromise = historyModule.__askMissionChatForTest({ missionId, chatId: 'chat-existing', question: 'follow-up question' });
    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: 'follow-up answer' }] },
    }) + '\n'));
    fakeProc.emit('close', 0);

    const result = await answerPromise;
    expect(result.chatId).toBe('chat-existing');

    const saved = await historyModule.__getMissionChatForTest({ missionId, chatId: 'chat-existing' });
    expect(saved.messages).toHaveLength(4);
    expect(saved.title).toBe('first question');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/history.askChat.test.cjs`
Expected: FAIL — `__askMissionChatForTest`/`__setSpawnAgentProcessForTest` don't exist in `history.cjs` yet.

- [ ] **Step 3: Implement `askMissionChat` in `history.cjs`**

```js
// add to electron/ipc/history.cjs
const { spawnAgentProcess } = require('./mission.cjs');
const { queryIndex } = require('../lib/missionIndex.cjs');

let spawnAgentProcessRefHistory = spawnAgentProcess;

function extractAssistantTextLocal(stdoutText) {
  const lines = stdoutText.split('\n').filter(Boolean);
  let lastText = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
        const textPart = parsed.message.content.find(p => p.type === 'text');
        if (textPart) lastText = textPart.text;
      }
    } catch (_) { /* skip non-JSON lines */ }
  }
  return lastText;
}

async function askMissionChat({ missionId, chatId, question }) {
  let chat = chatId ? await getMissionChat({ missionId, chatId }) : null;
  if (!chat) {
    chat = {
      id: chatId || `chat-${Date.now()}`,
      missionId,
      title: question.slice(0, 60),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
  }

  const topK = await queryIndex(missionId, question, 6);
  const contextBlock = topK.map(c => `[${c.source.type}] ${c.text}`).join('\n');
  const transcript = chat.messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const prompt = [
    `You are a debrief assistant for a completed mission. Use the retrieved context and prior conversation to answer follow-up questions. You may reason step by step, but give a clear final answer.`,
    `## Retrieved context\n${contextBlock}`,
    `## Prior conversation\n${transcript}`,
    `## New question\n${question}`,
  ].join('\n\n');

  return new Promise((resolve) => {
    let proc;
    try {
      const spawned = spawnAgentProcessRefHistory({
        backendId: 'claude', model: 'sonnet', prompt, resumeSessionId: null, maxTurns: 20,
        useAgentTeams: false, cwd: undefined,
      });
      proc = spawned.proc;
    } catch (err) {
      resolve({ chatId: chat.id, answer: null, error: err.message });
      return;
    }

    let stdout = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve({ chatId: chat.id, answer: null, error: 'Chat request timed out' });
    }, 180000);

    proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ chatId: chat.id, answer: null, error: err.message }); });
    proc.on('close', () => {
      clearTimeout(timer);
      const answer = extractAssistantTextLocal(stdout);
      const now = Date.now();
      chat.messages.push({ role: 'user', content: question, timestamp: now });
      chat.messages.push({ role: 'assistant', content: answer, timestamp: now });
      chat.updatedAt = now;
      writeMissionChat(missionId, chat);
      resolve({ chatId: chat.id, answer });
    });
  });
}
```

Register the IPC handler:

```js
ipcMain.handle('ask_mission_chat', async (_event, args) => askMissionChat(args));
```

Add test seams:

```js
module.exports.__askMissionChatForTest = askMissionChat;
module.exports.__setSpawnAgentProcessForTest = (fn) => { spawnAgentProcessRefHistory = fn; };
```

`mission.cjs` must export `spawnAgentProcess` (check its existing `module.exports` at the bottom — add `module.exports.spawnAgentProcess = spawnAgentProcess;` if not already present).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/history.askChat.test.cjs`
Expected: PASS.

- [ ] **Step 5: Whitelist `ask_mission_chat` in `preload.cjs`**

```js
// electron/preload.cjs — ALLOWED_COMMANDS array, history section
'ask_mission_chat',
```

- [ ] **Step 6: Run full test suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/history.cjs electron/ipc/history.askChat.test.cjs electron/preload.cjs electron/ipc/mission.cjs
git commit -m "feat: add ask_mission_chat IPC handler for post-mission debrief chat"
```

---

### Task 10: `MissionChatPanel.jsx` + wire "Chat" tab into `MissionDashboard`

**Files:**
- Create: `src/components/mission/MissionChatPanel.jsx`
- Modify: `src/components/mission/MissionDashboard.jsx`

**Interfaces:**
- Consumes: `invoke('list_mission_chats', {missionId})`, `invoke('get_mission_chat', {missionId, chatId})`, `invoke('ask_mission_chat', {missionId, chatId, question})`, `invoke('delete_mission_chat', {missionId, chatId})`.
- Produces: `<MissionChatPanel missionId={...} />` rendered inside `MissionDashboard`'s tab body when `isHistoryView`.

- [ ] **Step 1: Add the `MissionChatPanel` component**

```jsx
// src/components/mission/MissionChatPanel.jsx
import { useState, useEffect } from 'react'
import { Plus, Trash2, Send } from 'lucide-react'
import { invoke } from '../../lib/ipc'

export function MissionChatPanel({ missionId }) {
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)

  const refreshList = async () => {
    const list = await invoke('list_mission_chats', { missionId })
    setChats(list)
  }

  useEffect(() => { refreshList() }, [missionId])

  const openChat = async (chatId) => {
    setActiveChatId(chatId)
    const chat = await invoke('get_mission_chat', { missionId, chatId })
    setMessages(chat?.messages || [])
  }

  const startNewChat = () => {
    setActiveChatId(null)
    setMessages([])
  }

  const handleAsk = async () => {
    const trimmed = question.trim()
    if (!trimmed || asking) return
    setAsking(true)
    setMessages(prev => [...prev, { role: 'user', content: trimmed, timestamp: Date.now() }])
    setQuestion('')
    try {
      const result = await invoke('ask_mission_chat', { missionId, chatId: activeChatId, question: trimmed })
      setActiveChatId(result.chatId)
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer || `⚠ ${result.error}`, timestamp: Date.now() }])
      await refreshList()
    } finally {
      setAsking(false)
    }
  }

  const handleDelete = async (chatId, e) => {
    e.stopPropagation()
    await invoke('delete_mission_chat', { missionId, chatId })
    if (activeChatId === chatId) startNewChat()
    await refreshList()
  }

  return (
    <div className="flex h-full gap-3">
      <div className="w-48 shrink-0 border-r border-vs-border/50 pr-2 overflow-y-auto">
        <button
          onClick={startNewChat}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-md text-xs font-semibold
                     bg-vs-accent/10 hover:bg-vs-accent/20 text-vs-accent transition-colors"
        >
          <Plus size={12} /> New chat
        </button>
        {chats.map(c => (
          <div
            key={c.id}
            onClick={() => openChat(c.id)}
            className={`group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-xs font-mono
                        ${activeChatId === c.id ? 'bg-vs-accent/10 text-vs-accent' : 'text-vs-text hover:bg-vs-bg-alt'}`}
          >
            <span className="truncate">{c.title}</span>
            <button onClick={(e) => handleDelete(c.id, e)} className="opacity-0 group-hover:opacity-100 shrink-0 ml-1">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto space-y-3 pb-2">
          {messages.map((m, i) => (
            <div key={i} className={`text-xs font-mono ${m.role === 'user' ? 'text-vs-text' : 'text-vs-accent pl-3'}`}>
              {m.role === 'user' ? 'Q: ' : 'A: '}{m.content}
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t border-vs-border/50">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() } }}
            placeholder="Hỏi mission này..."
            className="flex-1 bg-vs-bg border border-vs-border rounded-md px-3 py-2 text-xs text-vs-text font-mono
                       placeholder-vs-muted/40 focus:outline-none focus:border-vs-accent/50"
          />
          <button
            onClick={handleAsk}
            disabled={!question.trim() || asking}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-vs-accent hover:bg-vs-accent/80
                       text-vs-heading disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the "Chat" tab into `MissionDashboard.jsx`**

```jsx
// imports
import { MissionChatPanel } from './MissionChatPanel'
import { MessageCircle } from 'lucide-react' // add to existing lucide-react import line
```

```jsx
// baseTabs array
const baseTabs = [
  { id: 'tasks',    label: 'Tasks',    icon: ListTodo },
  { id: 'ask',      label: 'Ask',      icon: MessageCircleQuestion },
  { id: 'chat',     label: 'Chat',     icon: MessageCircle },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'files',    label: 'Files',    icon: FolderOpen },
  { id: 'graph',    label: 'Graph',    icon: GitFork },
]
```

```jsx
// visibility gating, composed with the existing filters
const showChatTab = isHistoryView
const visibleBaseTabs = baseTabs
  .filter(t => t.id !== 'ask' || showAskTab)
  .filter(t => t.id !== 'chat' || showChatTab)
  .filter(t => t.id !== 'messages' || hasMessages)
```

```jsx
// tab body rendering
{activeTab === 'chat' && <MissionChatPanel missionId={state.id} />}
```

- [ ] **Step 3: Manual verification**

Run: `npm run electron:dev`
Steps: complete a mission, open it from history, open the "Chat" tab, ask a question, confirm it creates a chat session and appears in the session list; reopen the mission's history entry later and confirm the chat session and its full message history reload correctly; ask a follow-up in the same session and confirm the prior Q&A is included in context (verify by asking something only answerable by referencing the earlier answer).

- [ ] **Step 4: Commit**

```bash
git add src/components/mission/MissionChatPanel.jsx src/components/mission/MissionDashboard.jsx
git commit -m "feat: add post-mission debrief Chat tab with session browsing"
```

---

### Task 11: Regression coverage for old-shaped history data

**Files:**
- Test: create `electron/ipc/history.regression.test.cjs`

**Interfaces:**
- Consumes: `get_mission_detail` (existing, `history.cjs`).

Confirms the spec's explicit regression requirement: existing snapshot/history reading code must be unaffected by the new `debrief_summary` field and the new sibling `.chats/` directory.

- [ ] **Step 1: Write the test**

```js
// electron/ipc/history.regression.test.cjs
'use strict';
const { describe, test, expect, afterEach } = require('vitest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const historyModule = require('./history.cjs');

describe('old-shaped snapshot regression', () => {
  const missionId = 'mission-regression-' + Date.now();
  const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);

  afterEach(() => {
    try { fs.unlinkSync(snapshotPath); } catch (_) {}
  });

  test('get_mission_detail loads a snapshot with no debrief_summary and no .chats dir without error', async () => {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({
      id: missionId, status: 'Completed', phase: 'Done', tasks: [], log: [], file_changes: [], agents: [],
    }), 'utf-8');

    const detail = await historyModule.__getMissionDetailForTest
      ? historyModule.__getMissionDetailForTest({ missionId })
      : Promise.resolve(JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')));

    const result = await detail;
    expect(result.id).toBe(missionId);
    expect(result.debrief_summary).toBeUndefined();
  });

  test('list_mission_chats returns empty array for a mission with no .chats directory', async () => {
    const list = await historyModule.__listMissionChatsForTest({ missionId });
    expect(list).toEqual([]);
  });
});
```

(If `history.cjs` does not currently export a `__getMissionDetailForTest` seam, add one following the established convention: `module.exports.__getMissionDetailForTest = getMissionDetail;` where `getMissionDetail` is the function backing the existing `get_mission_detail` IPC handler.)

- [ ] **Step 2: Run test to verify it fails, then add any missing seam, then verify it passes**

Run: `npx vitest run electron/ipc/history.regression.test.cjs`
Expected: FAIL if the seam is missing → add it → PASS.

- [ ] **Step 3: Run the entire test suite one final time**

Run: `npx vitest run`
Expected: PASS — every test file in the repo, old and new, green.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/history.cjs electron/ipc/history.regression.test.cjs
git commit -m "test: add regression coverage for old-shaped snapshots and missing chat dirs"
```

---

## Resolutions to the spec's open questions

- **Debounce/batch tuning:** 3000ms idle timer, 20-item immediate-flush threshold (Task 4, `scheduleFlush`). Chosen as a reasonable default matching the spec's own suggested values; if profiling during rollout shows it's wrong for real mission volumes, it's a one-constant change in `missionIndex.cjs`.
- **Bundled vs. lazy-download embedding model:** lazy-loaded on first use via dynamic `import('@huggingface/transformers')` inside `embedText` (Task 2) — smaller installer, one-time network fetch of the ~25MB quantized model cached by `transformers.js` itself afterward. If a fully offline first-run experience is later required, this is a packaging-only change (pre-fetch the model into the app bundle), not a code-shape change.
- **Tool set exposed to spawned Q&A/debrief processes:** for this plan's scope, both spawned processes work entirely from the retrieved top-K context and mission-state summary passed directly in the prompt — no separate file/log-reading tool call round-trip was implemented, since `queryIndex`'s top-K plus `buildMissionSummary`/mission description/file-change list is sufficient context for a single well-constructed prompt (Tasks 5, 7, 9). If real usage shows the retrieved context is insufficient for certain questions, a follow-up can add a tool-call loop using `read_file_content`'s existing `fs.readFileSync` pattern (`electron/ipc/files.cjs`) — deliberately deferred rather than speculatively built now (YAGNI).
- **UI placement:** both new tabs live inside `MissionDashboard.jsx`'s existing `baseTabs` array and tab-body conditional-render block (Tasks 6, 10), gated by `isHistoryView`/`isRunning`, exactly matching the established pattern already used for the Messages tab's `hasMessages` gate — no new top-level component or route was needed.

---

## Self-review notes

- **Spec coverage:** §1 (index storage/chunking/embedding/incremental/query/fallback) → Tasks 1-4. §2 (live Q&A, `ask_mission_live`, `mission:companion-answer`, `childProcess` isolation) → Tasks 5-6. §3 (debrief summary, chat sessions, 4 new IPC handlers) → Tasks 7-10. §4 (module layout) → realized via `missionIndex.cjs` (Tasks 1-4) called from both `mission.cjs` (Task 4-5) and `history.cjs` (Tasks 8-9). Testing strategy's 5 bullet points → Tasks 1-2 (unit), Task 4 (incremental across cycles), Task 5 (live Q&A integration), Task 7/9 (debrief + chat sessions integration), Task 11 (regression). All four "open questions" → resolved section above.
- **Placeholder scan:** no TBD/TODO markers; every step includes runnable code and exact commands.
- **Type consistency:** chunk shape `{id, text, source}` used identically across Tasks 1-4; `{answer, error?}` return shape used identically in Task 5 and consumed identically in Task 6; chat shape `{id, missionId, title, createdAt, updatedAt, messages}` used identically across Tasks 8-10; `spawnAgentProcessRef`/`spawnAgentProcessRefHistory` naming kept distinct per-module to avoid implying a shared mutable reference across `mission.cjs` and `history.cjs` (they are two separate module-level variables, each independently swappable in tests).
