// tests/support/electronApp.ts
//
// Shared helper for launching an isolated instance of the Electron app
// under test. Every E2E spec calls launchApp() in its own test (or
// beforeEach) and closeApp() in its own afterEach — no shared/global
// Electron process, so tests remain independent and order-independent.
//
// Isolation strategy per launched instance:
//   1. Recordings dir: RECORDINGS_DIR_OVERRIDE env var points
//      electron/lib/recordingStore.cjs at a fresh temp directory
//      (see backend-recording-engine's override mechanism), so no test
//      ever reads/writes the real ~/.claude/agent-teams-recordings.
//   2. AI process: PATH is prepended with tests/fixtures/fake-claude,
//      which shadows the real `claude` binary with a fast, deterministic
//      stub (tests/fixtures/fake-claude/claude.cjs) so "running a mission"
//      in E2E never spawns the real Claude Code CLI / makes real API calls.
//   3. Each instance gets its own userData dir (via app temp profile) to
//      avoid clobbering any other app state between parallel/sequential runs.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FAKE_CLAUDE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'fake-claude');
const MAIN_ENTRY = path.join(REPO_ROOT, 'electron', 'main.cjs');

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  recordingsDir: string;
  userDataDir: string;
  fakeClaudeScriptPath: string | null;
  cleanup: () => Promise<void>;
}

export interface LaunchOptions {
  /** Custom fake-claude transcript lines (array of stdout lines). Defaults to the built-in short Vietnamese demo script. */
  fakeClaudeLines?: string[];
  /** Per-line delay (ms) for the fake claude stub. Defaults to 20ms. */
  fakeClaudeDelayMs?: number;
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// GitHub Actions windows-latest runners spawn child processes markedly
// slower than a local dev machine (Defender scanning, virtualization,
// taskkill-based cleanup overhead). Specs that rely on fakeClaudeDelayMs
// filler lines to buy real wall-clock time for a separate QC/QA
// subprocess round-trip (electron/lib/qcqa.cjs's runQcQaCheck) need that
// budget scaled up under CI, or the round-trip loses the race and the
// mission never reaches its expected state. Local runs are unaffected.
const CI_TIMING_MULTIPLIER = process.env.CI ? 3 : 1;

/** Scales a fakeClaudeDelayMs value for CI's slower process-spawn overhead. */
export function ciDelay(ms: number): number {
  return Math.round(ms * CI_TIMING_MULTIPLIER);
}

/** Scales a toBeVisible/expect timeout to match a ciDelay()-scaled script's longer real runtime. */
export function ciTimeout(ms: number): number {
  return Math.round(ms * CI_TIMING_MULTIPLIER);
}

/**
 * Launches a fresh, isolated Electron app instance for a single test.
 * Always pair with `cleanup()` (returned on the result) in an afterEach
 * or try/finally so no process or temp dir leaks between tests.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const recordingsDir = makeTempDir('agent-teams-recordings-test-');
  const userDataDir = makeTempDir('agent-teams-userdata-test-');

  let fakeClaudeScriptPath: string | null = null;
  if (options.fakeClaudeLines) {
    fakeClaudeScriptPath = path.join(recordingsDir, '__fake-claude-script.json');
    fs.writeFileSync(fakeClaudeScriptPath, JSON.stringify(options.fakeClaudeLines), 'utf8');
  }

  const pathSep = process.platform === 'win32' ? ';' : ':';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    // Shadow the real `claude` binary with our deterministic fixture.
    PATH: `${FAKE_CLAUDE_DIR}${pathSep}${process.env.PATH || ''}`,
    // Point recordingStore.cjs at an isolated temp dir for this test only.
    RECORDINGS_DIR_OVERRIDE: recordingsDir,
    FAKE_CLAUDE_DELAY_MS: String(ciDelay(options.fakeClaudeDelayMs ?? 20)),
    // tests/fixtures/fake-claude/claude.cjs uses this directory to persist a
    // per-stage invocation counter across the separate `claude` subprocesses
    // spawned for QC/QA checks (electron/lib/qcqa.cjs's runQcQaCheck), so it
    // can fail the first QC attempt for a task and pass on retry. Reusing
    // recordingsDir keeps it unique per launched app instance (no cross-test
    // collisions) without needing another temp dir to track/clean up.
    FAKE_QCQA_STATE_DIR: recordingsDir,
    // Prevent electron/ipc/system.cjs's checkForUpdates from hitting the
    // real GitHub API — a genuine "update available" response bypasses the
    // changelog_seen_version localStorage seed below and force-opens the
    // "What's New" modal on top of the app.
    DISABLE_UPDATE_CHECK: '1',
  };
  if (fakeClaudeScriptPath) {
    env.FAKE_CLAUDE_SCRIPT = fakeClaudeScriptPath;
  }
  // If the test runner's own environment was itself launched under Electron
  // (e.g. an editor/agent host embedding Node via Electron), it may inherit
  // ELECTRON_RUN_AS_NODE=1. That forces electron.exe into plain-Node CLI
  // parsing, which rejects every Electron/Chromium flag Playwright passes
  // (--remote-debugging-port, --inspect, etc.) with "bad option: ..." and
  // the app never launches. Strip it so the child always runs as real Electron.
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env,
    cwd: REPO_ROOT,
  });

  const window = await app.firstWindow();

  // electron/ipc/system.cjs's app_version comes from Electron's own
  // app.getVersion(), which — when launched unpackaged via `electron
  // main.cjs` (as this harness does, not `electron .`) — resolves to the
  // Electron runtime's own version, NOT this repo's package.json version.
  // Read the app's actual reported version at runtime rather than assuming
  // package.json's, so the changelog_seen_version seed below always matches
  // what ChangelogModal.jsx compares against.
  const { app_version: appVersion } = await window.evaluate(() =>
    window.electronAPI.invoke('get_system_info')
  );

  // Skip the onboarding/setup screen (App.jsx redirects to /setup unless
  // localStorage.agent_teams_setup_done is set) and the auto-opening "What's
  // New" changelog modal (ChangelogModal.jsx shows it whenever
  // changelog_seen_version !== the running app's version) — both must run
  // before the app's own scripts, so this is an init script rather than a
  // post-load localStorage.setItem call. Neither screen is in scope for
  // recording/replay E2E coverage.
  await window.addInitScript((version) => {
    window.localStorage.setItem('agent_teams_setup_done', '1');
    window.localStorage.setItem('changelog_seen_version', version);
  }, appVersion);
  await window.reload();
  await window.waitForLoadState('domcontentloaded');

  const cleanup = async () => {
    try {
      await app.close();
    } catch {
      // already closed — ignore
    }
    for (const dir of [recordingsDir, userDataDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  };

  return { app, window, recordingsDir, userDataDir, fakeClaudeScriptPath, cleanup };
}
