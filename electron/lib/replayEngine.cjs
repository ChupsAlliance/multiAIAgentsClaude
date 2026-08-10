'use strict';

// ─── replayEngine.cjs ────────────────────────────────────────────
// Máy phát lại (playback) 1 recording đã load.
// Phát tuần tự từng event tới renderer qua ĐÚNG channel gốc đã lưu,
// dùng setTimeout đệ quy (không setInterval cố định) để tôn trọng
// khoảng cách thời gian thực giữa các event, chia cho `speed`.
//
// Module này ĐỘC LẬP hoàn toàn với luồng mission thật:
//   - không đụng vào activeRecording hay missionState
//   - từ chối chạy nếu có mission thật đang Running (do caller kiểm tra
//     qua hàm isMissionRunning truyền vào lúc init)
//
// speed: 1 | 2 | 5 | Infinity (Infinity = 'Tức thời' — phát hết ngay,
// không delay).
// ─────────────────────────────────────────────────────────────────

const { getRecording } = require('./recordingStore.cjs');

// ── Trạng thái phát lại (module-level, chỉ 1 phiên replay tại 1 thời điểm) ──
let session = null;
// session = {
//   recording, events, totalMs,
//   speed,
//   index,            // event kế tiếp sẽ phát
//   timer,            // handle setTimeout đang chờ
//   paused,
//   pausedRemainingMs, // ms còn lại của delay khi bị pause giữa chừng
//   nextScheduledAt,   // Date.now() mốc dự kiến phát event kế tiếp
// }

// Dependencies được inject lúc init.
let deps = {
  sendToWindow: () => {},
  isMissionRunning: () => false,
};

function init({ sendToWindow, isMissionRunning }) {
  if (typeof sendToWindow === 'function') deps.sendToWindow = sendToWindow;
  if (typeof isMissionRunning === 'function') deps.isMissionRunning = isMissionRunning;
}

// ─────────────────────────────────────────────────────────────────
// normalizeSpeed — chỉ chấp nhận 1, 2, 5, hoặc Infinity.
// Chuỗi 'Infinity' / 'instant' / 0 cũng coi là tức thời.
// ─────────────────────────────────────────────────────────────────
function normalizeSpeed(speed) {
  if (speed === Infinity || speed === 'Infinity' || speed === 'instant' || speed === 0) {
    return Infinity;
  }
  const n = Number(speed);
  if (n === 2) return 2;
  if (n === 5) return 5;
  if (n === Infinity) return Infinity;
  return 1; // mặc định 1x
}

function clearTimer() {
  if (session && session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// emitEvent — gửi 1 event ra renderer với channel prefixed `replay:`
// + phát kèm replay:progress để frontend cập nhật thanh tua.
// ─────────────────────────────────────────────────────────────────
function emitEvent(event) {
  if (!event) return;
  deps.sendToWindow(`replay:${event.channel}`, event.payload);
  deps.sendToWindow('replay:progress', {
    currentMs: event.relativeTimestamp,
    totalMs: session ? session.totalMs : 0,
    eventIndex: session ? session.index : 0,
  });
}

// ─────────────────────────────────────────────────────────────────
// scheduleNext — lên lịch phát event kế tiếp dựa trên khoảng cách
// thời gian với event trước, chia cho speed.
// ─────────────────────────────────────────────────────────────────
function scheduleNext() {
  if (!session || session.paused) return;

  // Hết event → kết thúc phiên phát.
  if (session.index >= session.events.length) {
    finishPlayback();
    return;
  }

  // Chế độ tức thời: phát hết ngay lập tức trong 1 vòng đồng bộ.
  if (session.speed === Infinity) {
    while (session && !session.paused && session.index < session.events.length) {
      const ev = session.events[session.index];
      emitEvent(ev);
      session.index += 1;
    }
    finishPlayback();
    return;
  }

  const ev = session.events[session.index];
  const prevTs = session.index > 0 ? session.events[session.index - 1].relativeTimestamp : 0;
  const gapMs = Math.max(0, ev.relativeTimestamp - prevTs);
  const delay = gapMs / session.speed;

  session.nextScheduledAt = Date.now() + delay;
  session.pausedRemainingMs = null;
  session.timer = setTimeout(fireDueEvent, delay);
}

// ─────────────────────────────────────────────────────────────────
// fireDueEvent — phát event tại con trỏ hiện tại rồi lên lịch tiếp.
// ─────────────────────────────────────────────────────────────────
function fireDueEvent() {
  if (!session || session.paused) return;
  const ev = session.events[session.index];
  emitEvent(ev);
  session.index += 1;
  scheduleNext();
}

// ─────────────────────────────────────────────────────────────────
// finishPlayback — dọn timer, phát progress cuối, giữ session ở
// trạng thái đã xong (index === length) để frontend biết đã hết.
// ─────────────────────────────────────────────────────────────────
function finishPlayback() {
  clearTimer();
  if (session) {
    session.paused = false;
    deps.sendToWindow('replay:progress', {
      currentMs: session.totalMs,
      totalMs: session.totalMs,
      eventIndex: session.events.length,
      finished: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// start — load recording theo id và bắt đầu phát.
// Trả về { ok, totalMs, eventCount } hoặc { error }.
// ─────────────────────────────────────────────────────────────────
function start({ recordingId, speed }) {
  if (deps.isMissionRunning()) {
    return { error: 'Không thể phát lại khi đang có mission thật chạy. Hãy dừng mission trước.' };
  }
  const recording = getRecording(recordingId);
  if (!recording) {
    return { error: `Không tìm thấy recording: ${recordingId}` };
  }
  const events = Array.isArray(recording.events) ? recording.events : [];

  // Dừng phiên cũ (nếu có) trước khi bắt đầu phiên mới.
  clearTimer();

  const totalMs = events.length > 0
    ? events[events.length - 1].relativeTimestamp
    : (recording.durationMs || 0);

  session = {
    recording,
    events,
    totalMs,
    speed: normalizeSpeed(speed),
    index: 0,
    timer: null,
    paused: false,
    pausedRemainingMs: null,
    nextScheduledAt: 0,
  };

  scheduleNext();
  // speed === Infinity không JSON-serialize được (→ null qua IPC),
  // nên trả 'instant' cho chế độ tức thời để frontend hiểu rõ.
  const speedOut = session.speed === Infinity ? 'instant' : session.speed;
  return { ok: true, totalMs, eventCount: events.length, speed: speedOut };
}

// ─────────────────────────────────────────────────────────────────
// pause — dừng timer, ghi lại phần delay còn lại để resume chính xác.
// ─────────────────────────────────────────────────────────────────
function pause() {
  if (!session) return { error: 'Chưa có phiên phát lại nào.' };
  if (session.paused) return { ok: true, paused: true };
  clearTimer();
  session.paused = true;
  // ms còn lại của delay đang chờ (nếu đang giữa 1 khoảng chờ)
  const remaining = session.nextScheduledAt - Date.now();
  session.pausedRemainingMs = remaining > 0 ? remaining : 0;
  return { ok: true, paused: true, eventIndex: session.index };
}

// ─────────────────────────────────────────────────────────────────
// resume — tiếp tục từ đúng vị trí, tôn trọng phần delay còn dở.
// ─────────────────────────────────────────────────────────────────
function resume() {
  if (!session) return { error: 'Chưa có phiên phát lại nào.' };
  if (!session.paused) return { ok: true, paused: false };
  session.paused = false;

  if (session.index >= session.events.length) {
    finishPlayback();
    return { ok: true, paused: false, finished: true };
  }

  // Nếu tức thời → xả hết ngay.
  if (session.speed === Infinity) {
    scheduleNext();
    return { ok: true, paused: false, eventIndex: session.index };
  }

  const remaining = session.pausedRemainingMs != null ? session.pausedRemainingMs : 0;
  session.nextScheduledAt = Date.now() + remaining;
  session.pausedRemainingMs = null;
  session.timer = setTimeout(fireDueEvent, remaining);
  return { ok: true, paused: false, eventIndex: session.index };
}

// ─────────────────────────────────────────────────────────────────
// seek — tua tới 1 mốc thời gian positionMs:
//   - gửi dồn ngay tất cả event có relativeTimestamp <= positionMs
//     (để renderer nhận đủ state tới mốc đó)
//   - đặt con trỏ ở event kế tiếp và tiếp tục phát bình thường.
// ─────────────────────────────────────────────────────────────────
function seek({ positionMs }) {
  if (!session) return { error: 'Chưa có phiên phát lại nào.' };
  const target = Math.max(0, Number(positionMs) || 0);

  clearTimer();
  const wasPaused = session.paused;

  // Đặt lại con trỏ về đầu để phát dồn nhất quán từ 0 → target.
  // (Đảm bảo state luôn đúng dù seek tiến hay lùi.)
  session.index = 0;
  while (session.index < session.events.length &&
         session.events[session.index].relativeTimestamp <= target) {
    emitEvent(session.events[session.index]);
    session.index += 1;
  }

  // Sau khi dồn xong: nếu đang paused thì giữ nguyên, ngược lại phát tiếp.
  if (wasPaused) {
    session.paused = true;
    session.pausedRemainingMs = null;
    return { ok: true, eventIndex: session.index, currentMs: target, paused: true };
  }

  session.paused = false;
  session.pausedRemainingMs = null;
  scheduleNext();
  return { ok: true, eventIndex: session.index, currentMs: target, paused: false };
}

// ─────────────────────────────────────────────────────────────────
// stop — dừng hẳn, dọn timer + xoá session.
// ─────────────────────────────────────────────────────────────────
function stop() {
  clearTimer();
  session = null;
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────
// isActive — có phiên replay đang tồn tại hay không (kể cả pause).
// ─────────────────────────────────────────────────────────────────
function isActive() {
  return session != null;
}

module.exports = {
  init,
  start,
  pause,
  resume,
  seek,
  stop,
  isActive,
  normalizeSpeed,
};
