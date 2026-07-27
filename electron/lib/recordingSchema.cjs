'use strict';

// ─── recordingSchema.cjs ─────────────────────────────────────────
// Định nghĩa cấu trúc (schema) của MỘT recording business-events và
// các hàm helper thuần (plain-object) để tạo / validate event.
//
// Không dùng class — chỉ export các factory + validator trả về plain
// objects, dễ serialize thẳng ra JSON.
//
// ─── Ví dụ JSON mẫu của 1 recording ──────────────────────────────
// {
//   "schemaVersion": 1,
//   "id": "rec-1721990000000",
//   "name": "Demo ghi lại mission tạo tính năng X",
//   "missionId": "mission-1721989000000",
//   "createdAt": 1721990000000,
//   "durationMs": 84213,
//   "missionDescription": "Thêm nút Record và màn hình phát lại",
//   "projectPath": "E:/Project/multiAIAgentsClaude",
//   "events": [
//     {
//       "relativeTimestamp": 0,
//       "channel": "recording:init",
//       "payload": {
//         "prompt": "...",
//         "description": "Thêm nút Record...",
//         "model": "sonnet",
//         "projectPath": "E:/Project/multiAIAgentsClaude",
//         "missionState": { "agents": [...], "tasks": [...], "mission_context": null }
//       }
//     },
//     { "relativeTimestamp": 12,  "channel": "mission:status",        "payload": { "status": "launching" } },
//     { "relativeTimestamp": 340, "channel": "mission:agent-spawned", "payload": { "agent_name": "Lead", "role": "Lead Coordinator" } },
//     { "relativeTimestamp": 902, "channel": "mission:log",           "payload": { "timestamp": 172199..., "agent": "Lead", "message": "..." } }
//   ]
// }
// ─────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

// Kênh khởi tạo đặc biệt — luôn là event đầu tiên của 1 recording.
const INIT_CHANNEL = 'recording:init';

// Danh sách các IPC channel (business events) mà 1 recording hỗ trợ.
// Bao gồm mọi channel `sendToWindow(...)` hiện có trong mission.cjs.
const SUPPORTED_CHANNELS = [
  INIT_CHANNEL,
  // core mission events
  'mission:log',
  'mission:agent-spawned',
  'mission:task-update',
  'mission:file-change',
  'mission:agent-message',
  'mission:status',
  'mission:agent-stuck',
  'mission:raw-line',
  // planning / plan versions
  'mission:plan-ready',
  // mockup-related
  'mission:mockup',
  // question / answer flow
  'mission:question',
  'mission:answer-sent',
  // team lifecycle & reassignment
  'mission:team-event',
  'mission:task-reassigned',
];

const SUPPORTED_CHANNEL_SET = new Set(SUPPORTED_CHANNELS);

// ─────────────────────────────────────────────────────────────────
// isSupportedChannel — có phải channel replay được hay không.
// Bất kỳ channel bắt đầu bằng "mission:" đều coi là hợp lệ (future-proof),
// cộng thêm channel init đặc biệt.
// ─────────────────────────────────────────────────────────────────
function isSupportedChannel(channel) {
  if (typeof channel !== 'string' || channel.length === 0) return false;
  if (SUPPORTED_CHANNEL_SET.has(channel)) return true;
  return channel.startsWith('mission:');
}

// ─────────────────────────────────────────────────────────────────
// createEvent — tạo 1 event chuẩn của recording.
//   relativeTimestamp: số ms tính từ lúc bắt đầu ghi (>= 0)
//   channel:           tên IPC event gốc
//   payload:           nguyên dữ liệu gốc gửi kèm event đó
// ─────────────────────────────────────────────────────────────────
function createEvent(relativeTimestamp, channel, payload) {
  return {
    relativeTimestamp: Math.max(0, Math.round(relativeTimestamp) || 0),
    channel,
    payload: payload === undefined ? null : payload,
  };
}

// ─────────────────────────────────────────────────────────────────
// createInitEvent — event khởi tạo đặc biệt 'recording:init'.
// Chứa toàn bộ snapshot ban đầu để replay dựng lại state trước khi
// phát các event tiếp theo.
//   snapshot: { prompt, description, model, projectPath, missionState }
// relativeTimestamp luôn = 0 (mốc bắt đầu).
// ─────────────────────────────────────────────────────────────────
function createInitEvent(snapshot) {
  const snap = snapshot || {};
  const missionState = snap.missionState || {};
  const payload = {
    prompt: snap.prompt != null ? snap.prompt : '',
    description: snap.description != null ? snap.description : '',
    model: snap.model != null ? snap.model : 'sonnet',
    projectPath: snap.projectPath != null ? snap.projectPath : '',
    executionMode: snap.executionMode != null ? snap.executionMode : 'standard',
    missionState: {
      agents: Array.isArray(missionState.agents) ? missionState.agents : [],
      tasks: Array.isArray(missionState.tasks) ? missionState.tasks : [],
      mission_context: missionState.mission_context != null ? missionState.mission_context : null,
    },
  };
  return createEvent(0, INIT_CHANNEL, payload);
}

// ─────────────────────────────────────────────────────────────────
// createRecording — dựng object recording hoàn chỉnh để ghi ra JSON.
//   meta:   { id, name, missionId, createdAt, missionDescription, projectPath }
//   events: mảng event (đã bao gồm 'recording:init' ở đầu nếu có)
// durationMs được suy ra từ relativeTimestamp lớn nhất nếu không truyền.
// ─────────────────────────────────────────────────────────────────
function createRecording(meta, events) {
  const evts = Array.isArray(events) ? events : [];
  const m = meta || {};
  let durationMs = m.durationMs;
  if (durationMs == null) {
    durationMs = evts.reduce((max, e) => Math.max(max, e && e.relativeTimestamp ? e.relativeTimestamp : 0), 0);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: m.id,
    name: m.name != null ? m.name : '',
    missionId: m.missionId != null ? m.missionId : null,
    createdAt: m.createdAt != null ? m.createdAt : Date.now(),
    durationMs,
    missionDescription: m.missionDescription != null ? m.missionDescription : '',
    projectPath: m.projectPath != null ? m.projectPath : '',
    events: evts,
  };
}

// ─────────────────────────────────────────────────────────────────
// extractMetadata — lấy phần metadata (không kèm events) của 1
// recording, dùng cho danh sách / index.json để list nhanh.
// ─────────────────────────────────────────────────────────────────
function extractMetadata(recording) {
  const r = recording || {};
  return {
    schemaVersion: r.schemaVersion != null ? r.schemaVersion : SCHEMA_VERSION,
    id: r.id,
    name: r.name != null ? r.name : '',
    missionId: r.missionId != null ? r.missionId : null,
    createdAt: r.createdAt != null ? r.createdAt : 0,
    durationMs: r.durationMs != null ? r.durationMs : 0,
    missionDescription: r.missionDescription != null ? r.missionDescription : '',
    projectPath: r.projectPath != null ? r.projectPath : '',
    eventCount: Array.isArray(r.events) ? r.events.length : 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// validateEvent — kiểm tra cấu trúc cơ bản của 1 event.
// Trả về { valid: boolean, error?: string }.
// ─────────────────────────────────────────────────────────────────
function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: 'event không phải object' };
  }
  if (typeof event.relativeTimestamp !== 'number' || Number.isNaN(event.relativeTimestamp) || event.relativeTimestamp < 0) {
    return { valid: false, error: 'relativeTimestamp phải là số >= 0' };
  }
  if (typeof event.channel !== 'string' || event.channel.length === 0) {
    return { valid: false, error: 'channel phải là chuỗi không rỗng' };
  }
  if (!isSupportedChannel(event.channel)) {
    return { valid: false, error: `channel không được hỗ trợ: ${event.channel}` };
  }
  if (!('payload' in event)) {
    return { valid: false, error: 'thiếu trường payload' };
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────
// validateRecording — kiểm tra cấu trúc cơ bản của cả recording.
// Trả về { valid: boolean, error?: string }.
// ─────────────────────────────────────────────────────────────────
function validateRecording(recording) {
  if (!recording || typeof recording !== 'object') {
    return { valid: false, error: 'recording không phải object' };
  }
  if (typeof recording.id !== 'string' || recording.id.length === 0) {
    return { valid: false, error: 'id phải là chuỗi không rỗng' };
  }
  if (!Array.isArray(recording.events)) {
    return { valid: false, error: 'events phải là mảng' };
  }
  for (let i = 0; i < recording.events.length; i++) {
    const res = validateEvent(recording.events[i]);
    if (!res.valid) {
      return { valid: false, error: `events[${i}]: ${res.error}` };
    }
  }
  // events phải được sắp xếp không giảm theo relativeTimestamp
  for (let i = 1; i < recording.events.length; i++) {
    if (recording.events[i].relativeTimestamp < recording.events[i - 1].relativeTimestamp) {
      return { valid: false, error: `events[${i}] có relativeTimestamp nhỏ hơn event trước — không đúng thứ tự thời gian` };
    }
  }
  return { valid: true };
}

module.exports = {
  SCHEMA_VERSION,
  INIT_CHANNEL,
  SUPPORTED_CHANNELS,
  isSupportedChannel,
  createEvent,
  createInitEvent,
  createRecording,
  extractMetadata,
  validateEvent,
  validateRecording,
};
