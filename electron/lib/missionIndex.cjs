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

module.exports = {
  buildChunksFromLogEntry,
  buildChunkFromFileChange,
  buildChunkFromTask,
  buildChunkFromMessage,
  vectorsPathFor,
  embedText,
  enqueueChunk,
  flushPending,
  scheduleFlush,
  queryIndex,
};
