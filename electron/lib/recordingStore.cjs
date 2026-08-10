'use strict';

// ─── recordingStore.cjs ──────────────────────────────────────────
// Lớp lưu trữ (file store) cho các recording business-events.
// Mỗi recording là 1 file JSON trong thư mục:
//     ~/.claude/agent-teams-recordings/<recordingId>.json
// Ngoài ra duy trì 1 file index.json chứa metadata tất cả recording
// để list nhanh mà không phải đọc toàn bộ event của từng file.
// ─────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { extractMetadata, validateRecording } = require('./recordingSchema.cjs');

// ─────────────────────────────────────────────────────────────────
// getRecordingsDir — thư mục chứa recordings (tạo nếu chưa có).
// Có thể override qua env RECORDINGS_DIR_OVERRIDE (dùng cho unit test
// để trỏ sang thư mục tạm, không đụng ~/.claude thật).
// ─────────────────────────────────────────────────────────────────
function getRecordingsDir() {
  const override = process.env.RECORDINGS_DIR_OVERRIDE;
  const dir = (override && override.length > 0)
    ? override
    : path.join(os.homedir(), '.claude', 'agent-teams-recordings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getIndexPath() {
  return path.join(getRecordingsDir(), 'index.json');
}

function getRecordingPath(recordingId) {
  return path.join(getRecordingsDir(), `${recordingId}.json`);
}

// ─────────────────────────────────────────────────────────────────
// readIndex — đọc index.json, trả về mảng metadata (rỗng nếu lỗi).
// ─────────────────────────────────────────────────────────────────
function readIndex() {
  try {
    const raw = fs.readFileSync(getIndexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(entries) {
  const arr = Array.isArray(entries) ? entries : [];
  fs.writeFileSync(getIndexPath(), JSON.stringify(arr, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────────
// upsertIndexEntry — thêm / cập nhật 1 metadata trong index theo id.
// ─────────────────────────────────────────────────────────────────
function upsertIndexEntry(meta) {
  const entries = readIndex();
  const idx = entries.findIndex(e => e && e.id === meta.id);
  if (idx >= 0) entries[idx] = meta;
  else entries.push(meta);
  // sắp xếp mới nhất trước (createdAt giảm dần)
  entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  writeIndex(entries);
}

function removeIndexEntry(recordingId) {
  const entries = readIndex().filter(e => e && e.id !== recordingId);
  writeIndex(entries);
}

// ─────────────────────────────────────────────────────────────────
// rebuildIndex — quét thư mục, dựng lại index từ header các file JSON.
// Dùng để tự phục hồi khi index.json bị mất / lệch với file thực tế.
// ─────────────────────────────────────────────────────────────────
function rebuildIndex() {
  const dir = getRecordingsDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
  } catch {
    files = [];
  }
  const entries = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const rec = JSON.parse(raw);
      if (rec && rec.id) entries.push(extractMetadata(rec));
    } catch {
      // bỏ qua file hỏng
    }
  }
  entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  writeIndex(entries);
  return entries;
}

// ─────────────────────────────────────────────────────────────────
// saveRecording — ghi 1 recording ra file + cập nhật index.
// Trả về metadata của recording đã lưu.
// Ném lỗi nếu recording không hợp lệ.
// ─────────────────────────────────────────────────────────────────
function saveRecording(recording) {
  const res = validateRecording(recording);
  if (!res.valid) {
    throw new Error(`Recording không hợp lệ: ${res.error}`);
  }
  getRecordingsDir();
  const filePath = getRecordingPath(recording.id);
  fs.writeFileSync(filePath, JSON.stringify(recording, null, 2), 'utf8');
  const meta = extractMetadata(recording);
  upsertIndexEntry(meta);
  return meta;
}

// ─────────────────────────────────────────────────────────────────
// listRecordings — trả về mảng metadata (không kèm events).
// Ưu tiên đọc từ index.json; nếu index rỗng nhưng có file trên đĩa,
// tự rebuild để đảm bảo nhất quán.
// ─────────────────────────────────────────────────────────────────
function listRecordings() {
  let entries = readIndex();
  if (entries.length === 0) {
    // index có thể chưa tồn tại — thử dựng lại từ file thực tế
    entries = rebuildIndex();
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────
// getRecording — đọc đầy đủ 1 recording theo id (kèm events).
// Trả về object recording, hoặc null nếu không tồn tại / hỏng.
// ─────────────────────────────────────────────────────────────────
function getRecording(recordingId) {
  try {
    const raw = fs.readFileSync(getRecordingPath(recordingId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// deleteRecording — xoá file recording + cập nhật index.
// Trả về true nếu file đã bị xoá, false nếu không tồn tại.
// ─────────────────────────────────────────────────────────────────
function deleteRecording(recordingId) {
  const filePath = getRecordingPath(recordingId);
  let existed;
  try {
    fs.unlinkSync(filePath);
    existed = true;
  } catch {
    existed = false;
  }
  removeIndexEntry(recordingId);
  return existed;
}

// ─────────────────────────────────────────────────────────────────
// renameRecording — đổi field `name` trong file JSON + index.
// Trả về metadata mới, hoặc null nếu recording không tồn tại.
// ─────────────────────────────────────────────────────────────────
function renameRecording(recordingId, newName) {
  const rec = getRecording(recordingId);
  if (!rec) return null;
  rec.name = newName != null ? String(newName) : '';
  fs.writeFileSync(getRecordingPath(recordingId), JSON.stringify(rec, null, 2), 'utf8');
  const meta = extractMetadata(rec);
  upsertIndexEntry(meta);
  return meta;
}

module.exports = {
  getRecordingsDir,
  getIndexPath,
  getRecordingPath,
  readIndex,
  writeIndex,
  rebuildIndex,
  saveRecording,
  listRecordings,
  getRecording,
  deleteRecording,
  renameRecording,
};
