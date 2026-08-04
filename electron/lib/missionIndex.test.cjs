import { describe, test, expect } from 'vitest'
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
