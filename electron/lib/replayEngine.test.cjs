'use strict';

// ─── replayEngine.test.cjs ───────────────────────────────────────
// Unit tests for electron/lib/replayEngine.cjs.
//
// replayEngine is DI-based (init({ sendToWindow, isMissionRunning }))
// and reads recordings via electron/lib/recordingStore.cjs's
// getRecording(). We isolate these tests from the real filesystem by
// pointing RECORDINGS_DIR_OVERRIDE at a fresh temp dir per test and
// writing fixture recording JSON files directly with recordingStore's
// own saveRecording() (so fixtures always match the real schema).
//
// setTimeout-driven scheduling (scheduleNext/fireDueEvent) is tested
// with Vitest fake timers — no real waiting, no waitForTimeout-style
// flakiness.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

// This test file targets genuine CommonJS source modules (electron/lib/*.cjs).
// We need Node's real `require()` (with its cache, so vi.resetModules() can
// evict and reload them per test) rather than a static ESM `import`, so we
// create one bound to this file's location.
const require = createRequire(import.meta.url);

describe('replayEngine.cjs', () => {
  let tmpDir;
  let replayEngine;
  let recordingStore;
  let recordingSchema;
  let sendToWindow;
  let sentEvents;
  let isMissionRunningMock;

  function freshRecording({ id = 'rec-1', name = 'Test recording', events }) {
    const evts = events || [
      recordingSchema.createEvent(0, 'recording:init', { description: 'demo' }),
      recordingSchema.createEvent(100, 'mission:status', { status: 'launching' }),
      recordingSchema.createEvent(500, 'mission:agent-spawned', { agent_name: 'Lead' }),
      recordingSchema.createEvent(1200, 'mission:log', { message: 'done' }),
    ];
    return recordingSchema.createRecording({ id, name, missionId: 'm-1', createdAt: Date.now() }, evts);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-engine-test-'));
    process.env.RECORDINGS_DIR_OVERRIDE = tmpDir;

    // Fresh module instances per test — these modules hold module-level
    // state (replayEngine's `session`, recordingStore reads env at call
    // time) so resetModules() avoids cross-test bleed of `session`.
    vi.resetModules();
    replayEngine = require('./replayEngine.cjs');
    recordingStore = require('./recordingStore.cjs');
    recordingSchema = require('./recordingSchema.cjs');

    sentEvents = [];
    sendToWindow = vi.fn((channel, payload) => {
      sentEvents.push({ channel, payload });
    });
    isMissionRunningMock = vi.fn(() => false);
    replayEngine.init({ sendToWindow, isMissionRunning: isMissionRunningMock });
  });

  afterEach(() => {
    replayEngine.stop();
    vi.useRealTimers();
    delete process.env.RECORDINGS_DIR_OVERRIDE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Scenario: replay_start với speed='instant' (Instant/Infinity) ──
  // Given 1 file recording hợp lệ
  // When replay_start với speed=Infinity (Instant)
  // Then toàn bộ event được gửi trong thời gian rất ngắn (<1s) theo đúng thứ tự gốc
  describe('given a valid recording file, when replay_start with instant speed', () => {
    it('sends every event synchronously, in original order, without waiting', () => {
      const recording = freshRecording({});
      recordingStore.saveRecording(recording);

      const startedAtMs = Date.now();
      const result = replayEngine.start({ recordingId: recording.id, speed: 'instant' });

      expect(result.ok).toBe(true);
      expect(result.eventCount).toBe(recording.events.length);
      // speed is reported back as the string 'instant' (Infinity isn't JSON-safe over IPC)
      expect(result.speed).toBe('instant');

      // No real or fake time needed to elapse — instant mode flushes synchronously.
      const elapsedMs = Date.now() - startedAtMs;
      expect(elapsedMs).toBeLessThan(1000);

      const businessEvents = sentEvents.filter(e => e.channel !== 'replay:progress');
      expect(businessEvents.map(e => e.channel)).toEqual(
        recording.events.map(e => `replay:${e.channel}`)
      );
      expect(businessEvents.map(e => e.payload)).toEqual(
        recording.events.map(e => e.payload)
      );
    });

    it('also accepts the bare Infinity value for instant speed', () => {
      const recording = freshRecording({ id: 'rec-infinity' });
      recordingStore.saveRecording(recording);

      const result = replayEngine.start({ recordingId: recording.id, speed: Infinity });
      expect(result.ok).toBe(true);

      const businessEvents = sentEvents.filter(e => e.channel !== 'replay:progress');
      expect(businessEvents).toHaveLength(recording.events.length);
    });

    it('sends a final replay:progress event marked finished', () => {
      const recording = freshRecording({ id: 'rec-progress' });
      recordingStore.saveRecording(recording);

      replayEngine.start({ recordingId: recording.id, speed: 'instant' });

      const progressEvents = sentEvents.filter(e => e.channel === 'replay:progress');
      const last = progressEvents[progressEvents.length - 1];
      expect(last.payload.finished).toBe(true);
      expect(last.payload.currentMs).toBe(recording.durationMs);
    });
  });

  // ── Scenario: replay_pause rồi replay_resume ─────────────────────
  // Given replay đang chạy
  // When replay_pause rồi replay_resume
  // Then event tiếp theo được phát đúng từ vị trí đã dừng, không phát lại event cũ
  describe('given replay is running at normal speed, when paused then resumed', () => {
    it('resumes from the paused position without re-emitting already-sent events', () => {
      const recording = freshRecording({
        id: 'rec-pause-resume',
        events: [
          recordingSchema.createEvent(0, 'recording:init', { n: 0 }),
          recordingSchema.createEvent(1000, 'mission:log', { n: 1 }),
          recordingSchema.createEvent(3000, 'mission:log', { n: 2 }),
        ],
      });
      recordingStore.saveRecording(recording);

      const result = replayEngine.start({ recordingId: recording.id, speed: 1 });
      expect(result.ok).toBe(true);

      // event[0] has relativeTimestamp=0 → scheduled with a 0ms setTimeout;
      // a 0ms timer tick flushes it without advancing simulated time further.
      let businessEvents = () => sentEvents.filter(e => e.channel !== 'replay:progress');
      vi.advanceTimersByTime(0);
      expect(businessEvents()).toHaveLength(1);
      expect(businessEvents()[0].payload).toEqual({ n: 0 });

      // Advance halfway to event[1] (1000ms gap), then pause.
      vi.advanceTimersByTime(400);
      const pauseResult = replayEngine.pause();
      expect(pauseResult.ok).toBe(true);
      expect(pauseResult.paused).toBe(true);
      expect(pauseResult.eventIndex).toBe(1); // event[0] already sent, event[1] pending

      // While paused, advancing time must NOT fire the pending event.
      vi.advanceTimersByTime(5000);
      expect(businessEvents()).toHaveLength(1);

      // Resume — should schedule the remaining ~600ms delay, not the full 1000ms again.
      const resumeResult = replayEngine.resume();
      expect(resumeResult.ok).toBe(true);
      expect(resumeResult.paused).toBe(false);

      // Advancing less than the remaining delay must not fire it yet.
      vi.advanceTimersByTime(500);
      expect(businessEvents()).toHaveLength(1);

      // Advancing past the remaining delay fires event[1], and only event[1] (not a repeat of event[0]).
      vi.advanceTimersByTime(200);
      expect(businessEvents()).toHaveLength(2);
      expect(businessEvents()[1].payload).toEqual({ n: 1 });
      expect(businessEvents().filter(e => JSON.stringify(e.payload) === JSON.stringify({ n: 0 }))).toHaveLength(1);
    });

    it('pausing when no session exists returns an error, not a throw', () => {
      const result = replayEngine.pause();
      expect(result.error).toBeDefined();
    });

    it('resuming after the last event was sent (paused with nothing left) reports finished without re-emitting', () => {
      const recording = freshRecording({
        id: 'rec-resume-finished',
        events: [recordingSchema.createEvent(0, 'mission:log', { n: 0 })],
      });
      recordingStore.saveRecording(recording);
      replayEngine.start({ recordingId: recording.id, speed: 1 });
      // Fire the sole (relativeTimestamp=0) event, then pause before the
      // engine's own end-of-events check runs — this reproduces the race
      // where resume() is called with index already at events.length.
      vi.advanceTimersByTime(0);
      const businessEvents = () => sentEvents.filter(e => e.channel !== 'replay:progress');
      expect(businessEvents()).toHaveLength(1);
      replayEngine.pause();

      const resumeResult = replayEngine.resume();
      expect(resumeResult.ok).toBe(true);
      expect(resumeResult.finished).toBe(true);
      // No duplicate emission of the already-sent event.
      expect(businessEvents()).toHaveLength(1);
    });
  });

  // ── Scenario: replay_seek tới positionMs giữa chừng ───────────────
  // Given replay đang chạy
  // When replay_seek tới positionMs giữa chừng
  // Then toàn bộ event có relativeTimestamp <= positionMs được gửi ngay lập tức đúng thứ tự
  describe('given replay is running, when seeking to a mid-timeline position', () => {
    it('immediately flushes every event with relativeTimestamp <= positionMs, in order', () => {
      const recording = freshRecording({
        id: 'rec-seek',
        events: [
          recordingSchema.createEvent(0, 'recording:init', { n: 0 }),
          recordingSchema.createEvent(500, 'mission:log', { n: 1 }),
          recordingSchema.createEvent(1500, 'mission:log', { n: 2 }),
          recordingSchema.createEvent(3000, 'mission:log', { n: 3 }),
        ],
      });
      recordingStore.saveRecording(recording);

      replayEngine.start({ recordingId: recording.id, speed: 1 });
      // Immediately pause so the seek's flushed set is deterministic
      // (start() already auto-fires event[0] synchronously).
      replayEngine.pause();
      sentEvents.length = 0; // isolate assertions to the seek() call itself

      const seekResult = replayEngine.seek({ positionMs: 1500 });
      expect(seekResult.ok).toBe(true);
      expect(seekResult.currentMs).toBe(1500);
      expect(seekResult.eventIndex).toBe(3); // events[0..2] are <= 1500ms

      const businessEvents = sentEvents.filter(e => e.channel !== 'replay:progress');
      expect(businessEvents.map(e => e.payload)).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
    });

    it('seeking to 0 flushes only events at relativeTimestamp 0', () => {
      const recording = freshRecording({
        id: 'rec-seek-zero',
        events: [
          recordingSchema.createEvent(0, 'recording:init', { n: 0 }),
          recordingSchema.createEvent(200, 'mission:log', { n: 1 }),
        ],
      });
      recordingStore.saveRecording(recording);
      replayEngine.start({ recordingId: recording.id, speed: 1 });
      replayEngine.pause();
      sentEvents.length = 0;

      replayEngine.seek({ positionMs: 0 });
      const businessEvents = sentEvents.filter(e => e.channel !== 'replay:progress');
      expect(businessEvents.map(e => e.payload)).toEqual([{ n: 0 }]);
    });

    it('seeking past the end flushes all events and keeps paused state as it was', () => {
      const recording = freshRecording({
        id: 'rec-seek-end',
        events: [
          recordingSchema.createEvent(0, 'recording:init', { n: 0 }),
          recordingSchema.createEvent(200, 'mission:log', { n: 1 }),
        ],
      });
      recordingStore.saveRecording(recording);
      replayEngine.start({ recordingId: recording.id, speed: 1 });
      replayEngine.pause();

      const seekResult = replayEngine.seek({ positionMs: 999999 });
      expect(seekResult.eventIndex).toBe(2);
      expect(seekResult.paused).toBe(true);
    });

    it('seeking with no active session returns an error', () => {
      const result = replayEngine.seek({ positionMs: 100 });
      expect(result.error).toBeDefined();
    });
  });

  // ── Guard: refuses to start while a real mission is running ──────
  describe('given a real mission is currently running, when replay_start is called', () => {
    it('refuses to start and returns an error', () => {
      const recording = freshRecording({ id: 'rec-guarded' });
      recordingStore.saveRecording(recording);
      isMissionRunningMock.mockReturnValue(true);

      const result = replayEngine.start({ recordingId: recording.id, speed: 'instant' });
      expect(result.error).toBeDefined();
      expect(sentEvents).toHaveLength(0);
    });
  });

  describe('given an unknown recordingId, when replay_start is called', () => {
    it('returns an error without throwing', () => {
      const result = replayEngine.start({ recordingId: 'does-not-exist', speed: 1 });
      expect(result.error).toBeDefined();
    });
  });

  describe('stop()', () => {
    it('clears the active session so isActive() becomes false', () => {
      const recording = freshRecording({ id: 'rec-stop' });
      recordingStore.saveRecording(recording);
      replayEngine.start({ recordingId: recording.id, speed: 1 });
      expect(replayEngine.isActive()).toBe(true);

      replayEngine.stop();
      expect(replayEngine.isActive()).toBe(false);
    });

    it('cancels any pending scheduled timer so no further events fire', () => {
      const recording = freshRecording({
        id: 'rec-stop-timer',
        events: [
          recordingSchema.createEvent(0, 'recording:init', { n: 0 }),
          recordingSchema.createEvent(5000, 'mission:log', { n: 1 }),
        ],
      });
      recordingStore.saveRecording(recording);
      replayEngine.start({ recordingId: recording.id, speed: 1 });
      replayEngine.stop();

      sentEvents.length = 0;
      vi.advanceTimersByTime(10000);
      expect(sentEvents).toHaveLength(0);
    });
  });

  describe('normalizeSpeed', () => {
    it('maps 1, 2, 5 to themselves', () => {
      expect(replayEngine.normalizeSpeed(1)).toBe(1);
      expect(replayEngine.normalizeSpeed(2)).toBe(2);
      expect(replayEngine.normalizeSpeed(5)).toBe(5);
    });

    it('maps "instant", Infinity, 0, and "Infinity" all to Infinity', () => {
      expect(replayEngine.normalizeSpeed('instant')).toBe(Infinity);
      expect(replayEngine.normalizeSpeed(Infinity)).toBe(Infinity);
      expect(replayEngine.normalizeSpeed(0)).toBe(Infinity);
      expect(replayEngine.normalizeSpeed('Infinity')).toBe(Infinity);
    });

    it('defaults any unrecognized value to 1x', () => {
      expect(replayEngine.normalizeSpeed(3)).toBe(1);
      expect(replayEngine.normalizeSpeed('bogus')).toBe(1);
      expect(replayEngine.normalizeSpeed(undefined)).toBe(1);
    });
  });
});
