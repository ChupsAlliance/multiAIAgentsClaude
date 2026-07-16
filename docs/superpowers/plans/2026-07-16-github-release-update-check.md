# GitHub Release Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On app launch, silently check GitHub Releases for a newer version than the running app, and if found, show a download link to the `.exe` inside the existing "What's New" changelog modal.

**Architecture:** A new Electron IPC handler (`check_for_updates`) calls the GitHub REST API `releases/latest` endpoint, compares semver against `app.getVersion()`, and returns update info. The existing `get_system_info` handler gains an `app_version` field so the frontend has one source of truth for the running version (replacing the stale hardcoded `APP_VERSION` constant). `useChangelog()` and `ChangelogModal` are extended to fetch and display this update info alongside the existing changelog UI — no new modal, no new route.

**Tech Stack:** Electron main process (Node `fetch`, `ipcMain`), React hook (`useChangelog`), Vitest for unit tests.

## Global Constraints

- GitHub API endpoint: `https://api.github.com/repos/ChupsAlliance/multiAIAgentsClaude/releases/latest` (public repo, no auth needed).
- Request timeout: 5000ms via `AbortSignal.timeout(5000)`.
- All errors (network, non-2xx, timeout, malformed JSON) must be swallowed — return `{ hasUpdate: false, error: true }`, never throw, never surface an error to the user.
- Only the `.exe` asset's `browser_download_url` is used as the download link; if no `.exe` asset exists, fall back to `release.html_url`.
- Version comparison strips a leading `v` from `tag_name` (e.g. `v0.9.0` → `0.9.0`).
- No new dependencies (`electron-updater` or semver libraries) — write a small local `compareSemver` function.
- No auto-download/auto-install — only open the browser to the download URL via the existing `open_url` IPC command.
- No manual "check for updates" button — check happens once per app launch, automatically.
- `APP_VERSION` constant in `src/data/changelog.js` must be removed once all its call sites are migrated to the real `app.getVersion()` value.

---

### Task 1: `compareSemver` utility + unit tests

**Files:**
- Create: `electron/lib/compareSemver.cjs`
- Test: `electron/lib/compareSemver.test.js`

**Interfaces:**
- Produces: `compareSemver(a: string, b: string): number` — returns `1` if `a > b`, `-1` if `a < b`, `0` if equal or unparseable. Both inputs may or may not have a leading `v`; caller is responsible for stripping it (this function assumes plain `x.y.z` strings).

- [ ] **Step 1: Write the failing test**

```js
// electron/lib/compareSemver.test.js
import { describe, it, expect } from 'vitest'
import { compareSemver } from './compareSemver.cjs'

describe('compareSemver', () => {
  it('returns 1 when a has a greater major version', () => {
    expect(compareSemver('1.0.0', '0.9.0')).toBe(1)
  })
  it('returns 1 when a has a greater minor version', () => {
    expect(compareSemver('0.9.0', '0.8.5')).toBe(1)
  })
  it('returns 1 when a has a greater patch version', () => {
    expect(compareSemver('0.7.2', '0.7.1')).toBe(1)
  })
  it('returns -1 when a is less than b', () => {
    expect(compareSemver('0.7.0', '0.7.1')).toBe(-1)
  })
  it('returns 0 when versions are equal', () => {
    expect(compareSemver('0.7.1', '0.7.1')).toBe(0)
  })
  it('returns 0 for unparseable input', () => {
    expect(compareSemver('not-a-version', '0.7.1')).toBe(0)
    expect(compareSemver('0.7.1', 'also-bad')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/lib/compareSemver.test.js`
Expected: FAIL with "Cannot find module './compareSemver.cjs'" or similar

- [ ] **Step 3: Write minimal implementation**

```js
// electron/lib/compareSemver.cjs
'use strict';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function compareSemver(a, b) {
  const ma = SEMVER_RE.exec(a);
  const mb = SEMVER_RE.exec(b);
  if (!ma || !mb) return 0;

  for (let i = 1; i <= 3; i++) {
    const na = parseInt(ma[i], 10);
    const nb = parseInt(mb[i], 10);
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

module.exports = { compareSemver };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/lib/compareSemver.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/lib/compareSemver.cjs electron/lib/compareSemver.test.js
git commit -m "feat: add compareSemver utility for version comparison"
```

---

### Task 2: `check_for_updates` IPC handler + `app_version` field

**Files:**
- Modify: `electron/ipc/system.cjs`
- Test: `electron/ipc/system.check_for_updates.test.js`

**Interfaces:**
- Consumes: `compareSemver(a, b)` from Task 1 (`electron/lib/compareSemver.cjs`).
- Produces: IPC handler `check_for_updates` returning
  `{ hasUpdate: boolean, currentVersion?: string, latestVersion?: string, downloadUrl?: string, releaseNotesUrl?: string, error?: true }`.
  `get_system_info` response gains a new field `app_version: string` (alongside existing `claude_available`, `settings_path`, `settings_exist`, `agent_teams_enabled`, `platform`, `username`).

This task registers a real `ipcMain.handle`, which is awkward to unit test directly. Instead, extract the handler logic into a plain exported function so it can be tested without spinning up Electron's IPC machinery.

- [ ] **Step 1: Write the failing test**

```js
// electron/ipc/system.check_for_updates.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkForUpdates } from './system.cjs'

const REPO_URL = 'https://api.github.com/repos/ChupsAlliance/multiAIAgentsClaude/releases/latest'

describe('checkForUpdates', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('reports an update when the latest release tag is newer', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.9.0',
        html_url: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0',
        assets: [{ name: 'Claude.Agent.Teams.Setup.0.9.0.exe', browser_download_url: 'https://example.com/setup.exe' }],
      }),
    })

    const result = await checkForUpdates('0.7.1')

    expect(global.fetch).toHaveBeenCalledWith(REPO_URL, expect.objectContaining({ signal: expect.anything() }))
    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.7.1',
      latestVersion: '0.9.0',
      downloadUrl: 'https://example.com/setup.exe',
      releaseNotesUrl: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0',
    })
  })

  it('reports no update when already on the latest version', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.7.1',
        html_url: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.7.1',
        assets: [{ name: 'Claude.Agent.Teams.Setup.0.7.1.exe', browser_download_url: 'https://example.com/setup.exe' }],
      }),
    })

    const result = await checkForUpdates('0.7.1')
    expect(result.hasUpdate).toBe(false)
  })

  it('falls back to release.html_url when no .exe asset exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.9.0',
        html_url: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0',
        assets: [],
      }),
    })

    const result = await checkForUpdates('0.7.1')
    expect(result.downloadUrl).toBe('https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0')
  })

  it('swallows a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const result = await checkForUpdates('0.7.1')
    expect(result).toEqual({ hasUpdate: false })
  })

  it('swallows a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await checkForUpdates('0.7.1')
    expect(result).toEqual({ hasUpdate: false, error: true })
  })

  it('swallows a timeout', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    const result = await checkForUpdates('0.7.1')
    expect(result).toEqual({ hasUpdate: false, error: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/system.check_for_updates.test.js`
Expected: FAIL — `checkForUpdates` is not exported from `system.cjs`

- [ ] **Step 3: Write minimal implementation**

Modify `electron/ipc/system.cjs`. Add the require for `compareSemver` near the top (after existing requires), add the exported `checkForUpdates` function, register the new IPC handler, add `app_version` to `get_system_info`, and export `checkForUpdates` for testing.

Add near the top of the file, after `const os = require('os');`:

```js
const { compareSemver } = require('../lib/compareSemver.cjs');

const RELEASES_URL = 'https://api.github.com/repos/ChupsAlliance/multiAIAgentsClaude/releases/latest';

async function checkForUpdates(currentVersion) {
  try {
    const res = await fetch(RELEASES_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { hasUpdate: false };

    const release = await res.json();
    const latestVersion = release.tag_name.replace(/^v/, '');
    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
    const exeAsset = (release.assets || []).find(a => a.name.endsWith('.exe'));

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      downloadUrl: exeAsset ? exeAsset.browser_download_url : release.html_url,
      releaseNotesUrl: release.html_url,
    };
  } catch {
    return { hasUpdate: false, error: true };
  }
}
```

Inside `get_system_info`'s return object (`electron/ipc/system.cjs`, existing handler), add the `app_version` field:

```js
    return {
      claude_available: claudeOk,
      settings_path: settingsPath,
      settings_exist: settingsExist,
      agent_teams_enabled: agentTeamsEnabled,
      platform: process.platform === 'win32' ? 'windows' : process.platform,
      username: os.userInfo().username || '',
      app_version: app.getVersion(),
    };
```

Register the new IPC handler inside `module.exports = function registerSystem(getMainWindow) { ... }`, right before the `save_office_layout` handler:

```js
  // ─── check_for_updates ──────────────────────────────────────────
  ipcMain.handle('check_for_updates', async () => {
    return checkForUpdates(app.getVersion());
  });
```

At the very bottom of the file, change the export from an anonymous function assignment to attach the testable helper:

```js
module.exports.checkForUpdates = checkForUpdates;
```

(Keep the existing `module.exports = function registerSystem(getMainWindow) { ... }` — Node allows attaching additional properties to a function object, so `module.exports.checkForUpdates = checkForUpdates` after the function declaration works fine.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/system.check_for_updates.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/system.cjs electron/ipc/system.check_for_updates.test.js
git commit -m "feat: add check_for_updates IPC handler and app_version field"
```

---

### Task 3: Preload whitelist entry

**Files:**
- Modify: `electron/preload.cjs`

**Interfaces:**
- Consumes: none (whitelist entry only).
- Produces: `check_for_updates` becomes callable from the renderer via `invoke('check_for_updates')`.

- [ ] **Step 1: Add `check_for_updates` to `ALLOWED_COMMANDS`**

In `electron/preload.cjs`, in the `// system` group of `ALLOWED_COMMANDS`:

```js
const ALLOWED_COMMANDS = [
  // system
  'check_claude_available', 'get_system_info', 'enable_agent_teams',
  'read_settings', 'open_folder_in_explorer', 'launch_in_terminal', 'open_url',
  'check_for_updates',
  // files
  ...
```

- [ ] **Step 2: Verify by manual smoke check**

Run: `node -e "const m = require('./electron/preload.cjs')" 2>&1 || echo "expected: preload.cjs uses contextBridge and cannot run outside Electron, this just checks for syntax errors"`
Expected: No `SyntaxError` in output (a `contextBridge` runtime error is fine and expected outside Electron).

- [ ] **Step 3: Commit**

```bash
git add electron/preload.cjs
git commit -m "feat: whitelist check_for_updates IPC command in preload"
```

---

### Task 4: Migrate `APP_VERSION` off the hardcoded constant

**Files:**
- Modify: `src/data/changelog.js`
- Modify: `src/components/ChangelogModal.jsx`
- Modify: `src/components/Sidebar.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `invoke('get_system_info')` (existing IPC, now returns `app_version`).
- Produces: `useChangelog(currentVersion: string)` — hook signature changes to accept the real running version as a parameter instead of importing `APP_VERSION`. `ChangelogModal` accepts a new required prop `currentVersion: string`. `Sidebar` keeps its existing signature (`{ activeSection }`) — it already calls `get_system_info` locally on mount (for `agentTeamsOk`), so it captures `app_version` from that same response into local state rather than receiving a prop, since `Sidebar` is rendered independently from 4 different pages (`DashboardPage`, `DocsPage`, `MissionControlPage`, `PlaygroundPage`) with no shared parent that holds `App.jsx`'s state.

This task removes the stale `APP_VERSION` export and threads the real version down from `App.jsx` (for the changelog modal), which already calls `get_system_info` once on mount for the `/setup` redirect logic — reuse that same call's result instead of adding a second one. `Sidebar` gets its own version independently since it has no access to `App.jsx`'s state.

- [ ] **Step 1: Remove `APP_VERSION` export from `changelog.js`**

In `src/data/changelog.js`, delete line 9 (`export const APP_VERSION = '0.8.0'`). Leave the `changelog` array untouched.

- [ ] **Step 2: Update `useChangelog` and `ChangelogModal` to take `currentVersion` as a parameter**

In `src/components/ChangelogModal.jsx`, change the import and hook signature:

```js
import { changelog } from '../data/changelog'
```

```js
export function useChangelog(currentVersion) {
  const [showChangelog, setShowChangelog] = useState(false)
  const [shouldAutoShow, setShouldAutoShow] = useState(false)

  useEffect(() => {
    if (!currentVersion) return
    const seen = localStorage.getItem(SEEN_KEY)
    if (seen !== currentVersion) {
      setShouldAutoShow(true)
    }
  }, [currentVersion])

  const openChangelog = useCallback(() => setShowChangelog(true), [])
  const closeChangelog = useCallback(() => {
    setShowChangelog(false)
    if (currentVersion) localStorage.setItem(SEEN_KEY, currentVersion)
    setShouldAutoShow(false)
  }, [currentVersion])
  const markSeen = useCallback(() => {
    if (currentVersion) localStorage.setItem(SEEN_KEY, currentVersion)
    setShouldAutoShow(false)
  }, [currentVersion])

  return { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen }
}
```

Update `ChangelogModal` to accept `currentVersion` as a prop and use it everywhere `APP_VERSION` was used:

```js
export function ChangelogModal({ open, onClose, currentVersion }) {
  const [expandedVersions, setExpandedVersions] = useState(() => {
    return { [currentVersion]: true }
  })
  ...
```

Replace every remaining `APP_VERSION` reference in the file body (header subtitle `Agent Teams Guide v{APP_VERSION}` and `isCurrent = release.version === APP_VERSION`) with `currentVersion`.

- [ ] **Step 3: Thread `app_version` from `App.jsx` down to `ChangelogModal`**

In `src/App.jsx`, the existing `get_system_info` call (inside the setup-check `useEffect`) already fetches system info once on mount — capture `app_version` from it into state, and pass it to both `useChangelog` and `<ChangelogModal>`. Since `useChangelog` needs `currentVersion` synchronously-ish on mount but `get_system_info` is async, initialize the hook call with the state value (starts `undefined`, hook's effect re-runs once it's populated, per the `[currentVersion]` dependency added in Step 2):

```js
export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checked, setChecked] = useState(false)
  const [appVersion, setAppVersion] = useState(null)
  const { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen } = useChangelog(appVersion)
```

In the existing setup-check `useEffect` (the one calling `invoke('get_system_info')`), capture `app_version` in both the success and catch branches:

```js
  useEffect(() => {
    if (location.pathname === '/setup') {
      setChecked(true)
      return
    }
    const done = localStorage.getItem(SETUP_DONE_KEY)
    if (done) {
      setChecked(true)
    }
    // Always fetch system info (for setup check + app version), even if setup already done
    invoke('get_system_info').then(info => {
      setAppVersion(info.app_version)
      if (!done) {
        if (info.claude_available && info.agent_teams_enabled) {
          localStorage.setItem(SETUP_DONE_KEY, '1')
        } else {
          navigate('/setup')
        }
      }
      setChecked(true)
    }).catch(() => {
      if (!done) navigate('/setup')
      setChecked(true)
    })
  }, [])
```

Update the `<ChangelogModal>` render to pass `currentVersion`:

```js
      <ChangelogModal open={showChangelog} onClose={closeChangelog} currentVersion={appVersion} />
```

- [ ] **Step 4: Update `Sidebar.jsx` to fetch its own `app_version` instead of importing `APP_VERSION`**

`Sidebar` is rendered independently in `DashboardPage.jsx`, `DocsPage.jsx`, `MissionControlPage.jsx`, and `PlaygroundPage.jsx`, with no shared parent holding `App.jsx`'s state — so it fetches its own version via the `get_system_info` call it already makes on mount (for `agentTeamsOk`), rather than receiving a prop.

In `src/components/Sidebar.jsx`, remove the import:

```js
import { APP_VERSION } from '../data/changelog'
```

Keep the component signature unchanged (`export function Sidebar({ activeSection })`). Add `appVersion` state and capture it in the existing mount effect:

```js
  const [agentTeamsOk, setAgentTeamsOk] = useState(null)
  const [appVersion, setAppVersion] = useState(null)

  useEffect(() => {
    // Check once on mount only — not on every route change
    invoke('get_system_info').then(info => {
      setAgentTeamsOk(info.claude_available && info.agent_teams_enabled)
      setAppVersion(info.app_version)
    }).catch(() => setAgentTeamsOk(false))
  }, [])
```

Update the footer button to use local `appVersion` state:

```js
          <button
            onClick={() => window.__openChangelog?.()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md
                       text-[10px] font-mono text-vs-muted
                       hover:text-vs-accent hover:bg-vs-accent/10 transition-colors no-drag"
          >
            <Sparkles size={10} />
            {appVersion ? `v${appVersion}` : '...'} &middot; What's New
          </button>
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev` (or `npm run electron:dev` if testing the Electron shell) and confirm:
- Sidebar footer shows `v0.7.1 · What's New` (or current `package.json` version) instead of a stale hardcoded value.
- Opening "What's New" still shows the changelog list, with the current version's entry auto-expanded.

- [ ] **Step 6: Commit**

```bash
git add src/data/changelog.js src/components/ChangelogModal.jsx src/components/Sidebar.jsx src/App.jsx
git commit -m "refactor: replace hardcoded APP_VERSION with app.getVersion() via IPC"
```

---

### Task 5: Update banner in `ChangelogModal` + "up to date" status

**Files:**
- Modify: `src/components/ChangelogModal.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `invoke('check_for_updates')` (Task 2/3), `invoke('open_url', { url })` (existing IPC).
- Produces: `useChangelog(currentVersion)` return value gains `updateInfo: { hasUpdate: boolean, latestVersion?: string, downloadUrl?: string } | null`. `ChangelogModal` accepts a new prop `updateInfo`.

- [ ] **Step 1: Extend `useChangelog` to fetch update info**

In `src/components/ChangelogModal.jsx`, add the `invoke` import and update state/effect:

```js
import { invoke } from '@tauri-apps/api/core'
```

```js
export function useChangelog(currentVersion) {
  const [showChangelog, setShowChangelog] = useState(false)
  const [shouldAutoShow, setShouldAutoShow] = useState(false)
  const [updateInfo, setUpdateInfo] = useState(null)

  useEffect(() => {
    if (!currentVersion) return
    const seen = localStorage.getItem(SEEN_KEY)
    if (seen !== currentVersion) {
      setShouldAutoShow(true)
    }
  }, [currentVersion])

  useEffect(() => {
    invoke('check_for_updates').then(info => {
      setUpdateInfo(info)
      if (info.hasUpdate) setShouldAutoShow(true)
    }).catch(() => setUpdateInfo({ hasUpdate: false }))
  }, [])

  const openChangelog = useCallback(() => setShowChangelog(true), [])
  const closeChangelog = useCallback(() => {
    setShowChangelog(false)
    if (currentVersion) localStorage.setItem(SEEN_KEY, currentVersion)
    setShouldAutoShow(false)
  }, [currentVersion])
  const markSeen = useCallback(() => {
    if (currentVersion) localStorage.setItem(SEEN_KEY, currentVersion)
    setShouldAutoShow(false)
  }, [currentVersion])

  return { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen, updateInfo }
}
```

- [ ] **Step 2: Add the update banner and "up to date" status to `ChangelogModal`**

Add `updateInfo` to the component's props and destructure it:

```js
export function ChangelogModal({ open, onClose, currentVersion, updateInfo }) {
```

Add a handler to open the download link:

```js
  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      invoke('open_url', { url: updateInfo.downloadUrl })
    }
  }
```

Insert the banner right after the opening `{/* Content — scrollable */}` div, before the `{changelog.map(...)}` line:

```jsx
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {updateInfo?.hasUpdate && (
            <div className="rounded-lg border border-vs-accent/40 bg-vs-accent/10 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-vs-accent shrink-0" />
                <p className="text-[12px] text-white">
                  <span className="font-bold">Bản mới v{updateInfo.latestVersion}</span> đã có sẵn!
                </p>
              </div>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 rounded-md text-[11px] font-mono font-semibold shrink-0
                           bg-vs-accent text-black hover:bg-vs-accent/80 transition-colors"
              >
                Tải về ngay
              </button>
            </div>
          )}
          {changelog.map((release) => {
```

Update the footer to show the "up to date" status when there's no update, next to the existing version count text:

```jsx
        {/* Footer */}
        <div className="px-6 py-3 border-t border-vs-border flex items-center justify-between bg-vs-panel/30">
          <div className="flex items-center gap-3">
            <p className="text-[10px] text-vs-muted font-mono">
              {changelog.length} versions &middot; CHANGELOG.md
            </p>
            {updateInfo && !updateInfo.hasUpdate && (
              <p className="text-[10px] text-vs-green font-mono">✓ Đang dùng bản mới nhất</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-[11px] font-mono font-semibold
                       bg-vs-accent/20 text-vs-accent border border-vs-accent/30
                       hover:bg-vs-accent/30 transition-colors"
          >
            Got it
          </button>
        </div>
```

Import `Sparkles` is already imported at the top of the file (used elsewhere) — no new import needed for the banner icon.

- [ ] **Step 3: Pass `updateInfo` from `App.jsx` into `ChangelogModal`**

In `src/App.jsx`, destructure `updateInfo` from the hook and pass it to the modal:

```js
  const { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen, updateInfo } = useChangelog(appVersion)
```

```js
      <ChangelogModal open={showChangelog} onClose={closeChangelog} currentVersion={appVersion} updateInfo={updateInfo} />
```

- [ ] **Step 4: Manual verification**

Run: `npm run electron:dev`. To simulate an available update without waiting for a real new GitHub release, temporarily edit `electron/ipc/system.cjs`'s `check_for_updates` handler to return a hardcoded `{ hasUpdate: true, latestVersion: '99.0.0', downloadUrl: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases' }` and confirm:
- The changelog modal auto-opens on launch with the banner "Bản mới v99.0.0 đã có sẵn!" visible above the changelog list.
- Clicking "Tải về ngay" opens the URL in the default browser.
- Revert the temporary hardcoded change before committing.

Then test the normal path (real IPC handler restored) and confirm:
- If already on the latest real GitHub release, the modal (opened manually via "What's New") shows "✓ Đang dùng bản mới nhất" in the footer and no banner.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChangelogModal.jsx src/App.jsx
git commit -m "feat: show GitHub release update banner in changelog modal"
```

---

### Task 6: Final spec-coverage pass

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass, including the new `compareSemver.test.js` and `system.check_for_updates.test.js`.

- [ ] **Step 2: Verify no remaining references to the removed constant**

Run: `grep -rn "APP_VERSION" e:/Project/multiAIAgentsClaude/src`
Expected: No output (empty).

- [ ] **Step 3: Verify preload whitelist**

Run: `grep -n "check_for_updates" e:/Project/multiAIAgentsClaude/electron/preload.cjs`
Expected: One line showing `check_for_updates` in `ALLOWED_COMMANDS`.

- [ ] **Step 4: Commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore: final cleanup for GitHub release update check feature"
```

(Skip this commit if Steps 1–3 found nothing to fix.)
