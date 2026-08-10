import { describe, test, expect, afterEach } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const {
  buildChunksFromLogEntry, buildChunkFromFileChange, buildChunkFromTask, buildChunkFromMessage,
} = require('./missionIndex.cjs')

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
    // First real embedText call in the suite may need to download/load the
    // model (or fall through the ONNX runtime and latch embedFailed) — allow
    // more headroom than the 5s default so this doesn't flake in CI/offline.
  }, 60000);

  test('flushPending appends to an existing file across multiple flushes', async () => {
    enqueueChunk(missionId, { id: 'log-1', text: 'first', source: { type: 'log', ts: 1 } });
    await flushPending(missionId);

    enqueueChunk(missionId, { id: 'log-2', text: 'second', source: { type: 'log', ts: 2 } });
    await flushPending(missionId);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written.chunks.map(c => c.id)).toEqual(['log-1', 'log-2']);
  }, 60000);
});

describe('queryIndex', () => {
  const { queryIndex, vectorsPathFor } = require('./missionIndex.cjs');
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
