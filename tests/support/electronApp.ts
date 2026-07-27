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
    FAKE_CLAUDE_DELAY_MS: String(options.fakeClaudeDelayMs ?? 20),
  };
  if (fakeClaudeScriptPath) {
    env.FAKE_CLAUDE_SCRIPT = fakeClaudeScriptPath;
  }

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env,
    cwd: REPO_ROOT,
  });

  const window = await app.firstWindow();

  // Skip the onboarding/setup screen (App.jsx redirects to /setup unless
  // localStorage.agent_teams_setup_done is set) — this must run before the
  // app's own scripts, so it's an init script rather than a post-load
  // localStorage.setItem call. Onboarding/setup itself is out of scope for
  // recording/replay E2E coverage.
  await window.addInitScript(() => {
    window.localStorage.setItem('agent_teams_setup_done', '1');
  });
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
