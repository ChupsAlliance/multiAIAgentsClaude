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
