// ─── recordingStore.test.cjs ─────────────────────────────────────
// Unit tests for electron/lib/recordingStore.cjs.
//
// Every test points RECORDINGS_DIR_OVERRIDE at its own fresh
// fs.mkdtempSync() directory (never the real
// ~/.claude/agent-teams-recordings) and removes it afterward, so
// tests are fully isolated from each other and from the real
// machine's recordings folder — satisfies the "mỗi test độc lập tự
// dọn file JSON tạo ra trong thư mục test riêng" requirement.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('recordingStore.cjs', () => {
  let tmpDir;
  let recordingStore;
  let recordingSchema;

  function makeRecording({ id, name, events, durationMs, createdAt }) {
    const evts = events || [
      recordingSchema.createEvent(0, 'recording:init', { description: 'demo' }),
      recordingSchema.createEvent(500, 'mission:status', { status: 'launching' }),
    ];
    return recordingSchema.createRecording(
      { id, name, missionId: 'm-1', createdAt: createdAt ?? Date.now(), durationMs },
      evts
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-store-test-'));
    process.env.RECORDINGS_DIR_OVERRIDE = tmpDir;

    // recordingStore/recordingSchema hold no meaningful module-level state
    // (getRecordingsDir() re-reads the env var on every call), but we still
    // reload fresh copies per test for full isolation and to match the
    // pattern used in replayEngine.test.cjs.
    delete require.cache[require.resolve('./recordingStore.cjs')];
    delete require.cache[require.resolve('./recordingSchema.cjs')];
    recordingStore = require('./recordingStore.cjs');
    recordingSchema = require('./recordingSchema.cjs');
  });

  afterEach(() => {
    delete process.env.RECORDINGS_DIR_OVERRIDE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getRecordingsDir', () => {
    it('honors RECORDINGS_DIR_OVERRIDE rather than the real ~/.claude path', () => {
      const dir = recordingStore.getRecordingsDir();
      expect(dir).toBe(tmpDir);
      expect(dir).not.toContain('.claude');
    });

    it('creates the directory if it does not exist yet', () => {
      const freshDir = path.join(tmpDir, 'nested', 'does-not-exist-yet');
      process.env.RECORDINGS_DIR_OVERRIDE = freshDir;
      expect(fs.existsSync(freshDir)).toBe(false);

      recordingStore.getRecordingsDir();
      expect(fs.existsSync(freshDir)).toBe(true);
    });
  });

  describe('saveRecording', () => {
    it('writes a JSON file named <id>.json inside the recordings dir', () => {
      const recording = makeRecording({ id: 'rec-abc', name: 'Demo 1' });
      recordingStore.saveRecording(recording);

      const filePath = path.join(tmpDir, 'rec-abc.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(onDisk.id).toBe('rec-abc');
      expect(onDisk.name).toBe('Demo 1');
    });

    it('updates index.json with the new recording metadata', () => {
      const recording = makeRecording({ id: 'rec-xyz', name: 'Demo 2' });
      recordingStore.saveRecording(recording);

      const index = recordingStore.readIndex();
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe('rec-xyz');
      expect(index[0].name).toBe('Demo 2');
      // index entries are metadata only — no `events` array bloat.
      expect(index[0].events).toBeUndefined();
    });

    it('throws and does not write a file when the recording is invalid', () => {
      const invalid = { id: '', events: [] }; // empty id → invalid per recordingSchema
      expect(() => recordingStore.saveRecording(invalid)).toThrow();
      expect(fs.readdirSync(tmpDir).filter(f => f.endsWith('.json') && f !== 'index.json')).toHaveLength(0);
    });
  });

  describe('listRecordings', () => {
    it('returns an empty array when no recordings exist', () => {
      expect(recordingStore.listRecordings()).toEqual([]);
    });

    it('returns metadata for all saved recordings, newest first', () => {
      recordingStore.saveRecording(makeRecording({ id: 'rec-old', name: 'Older', createdAt: 1000 }));
      recordingStore.saveRecording(makeRecording({ id: 'rec-new', name: 'Newer', createdAt: 2000 }));

      const list = recordingStore.listRecordings();
      expect(list.map(r => r.id)).toEqual(['rec-new', 'rec-old']);
    });

    it('rebuilds the index from disk if index.json is missing/empty', () => {
      recordingStore.saveRecording(makeRecording({ id: 'rec-1', name: 'One' }));
      // Simulate a corrupted/missing index.
      fs.writeFileSync(recordingStore.getIndexPath(), '[]', 'utf8');

      const list = recordingStore.listRecordings();
      expect(list.map(r => r.id)).toEqual(['rec-1']);
    });

    it('skips corrupted recording files when rebuilding the index', () => {
      recordingStore.saveRecording(makeRecording({ id: 'rec-good', name: 'Good' }));
      fs.writeFileSync(path.join(tmpDir, 'rec-bad.json'), '{not valid json', 'utf8');
      fs.writeFileSync(recordingStore.getIndexPath(), '[]', 'utf8');

      const list = recordingStore.rebuildIndex();
      expect(list.map(r => r.id)).toEqual(['rec-good']);
    });
  });

  describe('getRecording', () => {
    it('returns the full recording (including events) for a known id', () => {
      const recording = makeRecording({
        id: 'rec-full',
        name: 'Full',
        events: [
          recordingSchema.createEvent(0, 'recording:init', { a: 1 }),
          recordingSchema.createEvent(10, 'mission:log', { a: 2 }),
        ],
      });
      recordingStore.saveRecording(recording);

      const loaded = recordingStore.getRecording('rec-full');
      expect(loaded.events).toHaveLength(2);
      expect(loaded.events[1].payload).toEqual({ a: 2 });
    });

    it('returns null for an unknown id', () => {
      expect(recordingStore.getRecording('does-not-exist')).toBeNull();
    });
  });

  describe('deleteRecording', () => {
    it('removes the file from disk and the index entry', () => {
      recordingStore.saveRecording(makeRecording({ id: 'rec-del', name: 'ToDelete' }));
      expect(fs.existsSync(path.join(tmpDir, 'rec-del.json'))).toBe(true);

      const result = recordingStore.deleteRecording('rec-del');
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'rec-del.json'))).toBe(false);
      expect(recordingStore.listRecordings()).toEqual([]);
    });

    it('returns false when deleting an id that does not exist, without throwing', () => {
      expect(recordingStore.deleteRecording('nope')).toBe(false);
    });
  });

  // ── Scenario: rename_recording rồi list_recordings ────────────────
  // Given danh sách nhiều recordings
  // When rename_recording rồi list_recordings
  // Then tên mới phản ánh đúng trong danh sách
  describe('given multiple recordings exist, when renameRecording is called then listRecordings', () => {
    it('reflects the new Vietnamese name in the list, leaving other recordings untouched', () => {
      recordingStore.saveRecording(makeRecording({ id: 'rec-a', name: 'Bản ghi A', createdAt: 1000 }));
      recordingStore.saveRecording(makeRecording({ id: 'rec-b', name: 'Bản ghi B', createdAt: 2000 }));
      recordingStore.saveRecording(makeRecording({ id: 'rec-c', name: 'Bản ghi C', createdAt: 3000 }));

      const renameResult = recordingStore.renameRecording('rec-b', 'Demo khách hàng — vòng 2');
      expect(renameResult).not.toBeNull();
      expect(renameResult.name).toBe('Demo khách hàng — vòng 2');

      const list = recordingStore.listRecordings();
      const renamed = list.find(r => r.id === 'rec-b');
      expect(renamed.name).toBe('Demo khách hàng — vòng 2');

      // Other recordings' names are unaffected.
      expect(list.find(r => r.id === 'rec-a').name).toBe('Bản ghi A');
      expect(list.find(r => r.id === 'rec-c').name).toBe('Bản ghi C');

      // The rename is persisted to the full recording file too, not just the index.
      const fullRecord = recordingStore.getRecording('rec-b');
      expect(fullRecord.name).toBe('Demo khách hàng — vòng 2');
    });

    it('returns null and changes nothing when renaming an id that does not exist', () => {
      recordingStore.saveRecording(makeRecording({ id: 'rec-only', name: 'Only' }));
      const result = recordingStore.renameRecording('missing-id', 'New Name');
      expect(result).toBeNull();
      expect(recordingStore.listRecordings()).toHaveLength(1);
      expect(recordingStore.listRecordings()[0].name).toBe('Only');
    });
  });

  describe('test isolation guarantee', () => {
    it('never touches the real home-directory recordings path', () => {
      const realDir = path.join(os.homedir(), '.claude', 'agent-teams-recordings');
      recordingStore.saveRecording(makeRecording({ id: 'rec-isolated', name: 'Isolated' }));

      // The configured dir must be the temp dir, and the real dir (if it
      // happens to already exist on this machine from manual use) must not
      // contain any file this test created.
      expect(recordingStore.getRecordingsDir()).toBe(tmpDir);
      const realFile = path.join(realDir, 'rec-isolated.json');
      expect(fs.existsSync(realFile)).toBe(false);
    });
  });
});
