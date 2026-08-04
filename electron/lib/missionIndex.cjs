'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

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

module.exports = {
  buildChunksFromLogEntry,
  buildChunkFromFileChange,
  buildChunkFromTask,
  buildChunkFromMessage,
  vectorsPathFor,
  embedText,
  enqueueChunk,
  flushPending,
};
