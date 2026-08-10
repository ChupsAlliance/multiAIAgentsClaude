# CI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire GitHub Actions CI (lint, unit-test, build-check, e2e) into this repo so `main` is protected by automated checks, fixing the prerequisite bugs (Vitest false-positive test-file sweep, missing ESLint config, ~85 latent lint violations) that would otherwise make the pipeline permanently red.

**Architecture:** One `.github/workflows/ci.yml` with 4 parallel jobs, all on `windows-latest`, triggered on PRs and pushes to `main`. Before that workflow can be trusted, two local bugs must be fixed first: (1) Vitest's default include glob currently sweeps up Playwright `.spec.ts` files, causing 3 false test-file failures; (2) no ESLint config exists at all, and the codebase has accumulated ~85 real violations across ~85 call sites that must be fixed with zero suppression hacks. Branch protection is applied last, as a separate human-confirmed step, after the workflow has proven itself on a real PR.

**Tech Stack:** GitHub Actions, ESLint v9 flat config (`@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `globals`), Vitest, Playwright, `gh` CLI.

## Global Constraints

- All 4 CI jobs run on `windows-latest` (matches production; app is Windows-only).
- No new external services or secrets — only the default `GITHUB_TOKEN`.
- ESLint config additions must not introduce `eslint-disable` blanket suppressions to force a clean run — every flagged violation gets a real fix or a deliberate, visible rule-level decision in the config file itself.
- No change to `electron:build` (the real installer-producing script) or `electron-builder` config.
- Branch protection is applied only after explicit user confirmation, as its own final step, never bundled silently into an earlier task.
- `npm run lint` must exit 0 by the end of Task 5 — that is the proof the `lint` CI job will actually pass, not just run.
- `npx vitest run` must report 0 failed files (down from 3) with the same 403 passed / 1 skipped real test count, by the end of Task 1.

---

### Task 1: Fix Vitest test-discovery bug (prerequisite)

**Files:**
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `npx vitest run` no longer sweeps up `tests/specs/**` (Playwright `.spec.ts` files) into the Vitest run.

- [ ] **Step 1: Confirm the current failure baseline**

Run: `npx vitest run`
Expected: 3 failed test files (Playwright specs under `tests/specs/` throwing `Playwright Test did not expect test.describe() to be called here`), 52 passed test files, 1 skipped (56 total files); 403 passed / 1 skipped individual tests (404 total).

- [ ] **Step 2: Add `test.exclude` to `vitest.config.ts`**

Current full file content:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    passWithNoTests: true,
  },
})
```

Replace with:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    passWithNoTests: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/release/**',
      'tests/specs/**',
    ],
  },
})
```

The first four `exclude` entries restore Vitest's own built-in defaults explicitly (setting `exclude` overrides the built-in list rather than extending it), so nothing already excluded becomes newly included. `tests/specs/**` is the new entry that fixes the bug.

- [ ] **Step 3: Verify the fix**

Run: `npx vitest run`
Expected: 0 failed test files, 55 passed, 1 skipped (56 total files — same file count as before, now all resolving correctly); 403 passed / 1 skipped individual tests (404 total, unchanged) — proving the fix only removed the false positives, not real coverage.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "fix: exclude Playwright specs from Vitest's default test glob"
```

---

### Task 2: Add ESLint flat config + dependencies + npm script

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (add `lint` script + devDependencies)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `npm run lint` runs and reports errors/warnings (not yet 0 errors — that's Tasks 3-5). Later tasks fix every violation this surfaces.

- [ ] **Step 1: Install ESLint and plugins as devDependencies**

```bash
npm install --save-dev eslint@^9.39.5 @eslint/js@^10.0.1 eslint-plugin-react@^7.37.5 eslint-plugin-react-hooks@^7.1.1 globals@^17.9.0
```

- [ ] **Step 2: Create `eslint.config.js`**

```js
import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

const scopedFiles = ['src/**/*.{js,jsx}', 'electron/**/*.{js,cjs}', 'scripts/**/*.{js,cjs}']

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'tests/**',
      'playwright-report/**',
      'test-results/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.cjs',
      'vite.config*.js',
      'src/assets/pixel-agents-webview/**',
    ],
  },
  {
    files: scopedFiles,
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      // Codebase convention: a leading underscore marks a binding as
      // intentionally unused (already used in e.g. pixelAgents.cjs's
      // `_getMainWindow`, copilotAdapter.cjs's `_opts`) — recognize it
      // instead of flagging every catch(_) {} and unused _-prefixed param.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Electron's custom <webview> element supports a real `preload` attribute
      // that eslint-plugin-react's DOM property list doesn't know about.
      'react/no-unknown-property': ['error', { ignore: ['preload'] }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['electron/**/*.{js,cjs}', 'scripts/**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      // webview-preload.cjs runs in an Electron webview's browser context
      // despite its .cjs extension, so it needs browser globals too.
      globals: { ...globals.node, ...globals.browser, ...globals.vitest },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Test files under electron/ use ESM import/export despite their .cjs/.js
    // extension — Vitest transforms them regardless, but raw ESLint parsing
    // needs sourceType: 'module' here to match.
    files: ['electron/**/*.test.{js,cjs}'],
    languageOptions: {
      sourceType: 'module',
    },
  },
]
```

- [ ] **Step 3: Add the `lint` script to `package.json`**

In the `scripts` block, add (alongside the existing `"test": "vitest run"` entry):

```json
"lint": "eslint .",
```

- [ ] **Step 4: Verify the config loads and reports the known baseline**

Run: `npm run lint`
Expected: exits non-zero, reporting **92 problems (83 errors, 9 warnings)** — no parse errors, no findings inside `src/assets/pixel-agents-webview/**` or any other ignored path. This is the accurate starting count Tasks 3-5 drive to zero errors. (The 9 warnings are `react-hooks/exhaustive-deps` and are non-blocking — `npm run lint`'s default exit code is 0 when only warnings remain, so they do not need to be fixed for this plan's exit criteria.)

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "feat: add ESLint flat config"
```

---

### Task 3: Fix all `no-unused-vars` violations (34 sites, 22 files)

**Files:**
- Modify: `electron/ipc/history.cjs:158`
- Modify: `electron/ipc/mission.backend.test.cjs:250`
- Modify: `electron/ipc/mission.cjs:336,834,2848,3192,3543`
- Modify: `electron/ipc/mission.test.cjs:79,100`
- Modify: `electron/ipc/system.check_for_updates.test.js:1`
- Modify: `electron/ipc/system.cjs:166`
- Modify: `electron/lib/missionIndex.test.cjs:137`
- Modify: `electron/lib/qcqa.cjs:84`
- Modify: `src/App.jsx:30`
- Modify: `src/components/mission/MissionDashboard.jsx:52-58`
- Modify: `src/components/mission/PlanReview.jsx:9,11,998`
- Modify: `src/components/mission/PromptPreview.jsx:5`
- Modify: `src/components/mission/QuestionCard.jsx:16`
- Modify: `src/components/ui/ToastProvider.test.jsx:1`
- Modify: `src/hooks/useAppHotkeys.js:35`
- Modify: `src/hooks/useMission.js:905`
- Modify: `src/hooks/useTauriFileDrop.js:12`
- Modify: `src/main.jsx:9`
- Modify: `src/pages/DashboardPage.jsx:1,8,31,83-86`
- Modify: `src/pages/OnboardingPage.jsx:80`
- Modify: `src/sections/BestPractices.jsx:30-35`
- Modify: `src/utils/exportPlan.test.js:3`

**Interfaces:**
- Consumes: `eslint.config.js` from Task 2 (the `argsIgnorePattern`/`varsIgnorePattern`/`caughtErrorsIgnorePattern: '^_'` options already cleared 78 underscore-named findings; this task fixes the 34 that remain).
- Produces: `npm run lint` reports 0 `no-unused-vars` findings.

For each site below, only the exact line(s) shown change — do not touch surrounding code.

- [ ] **Step 1: `electron/ipc/history.cjs:158`**

`getMainWindow` is unused inside `registerHistory`, but sibling modules `files.cjs`, `mission.cjs` use the identically-named parameter for real, and `pixelAgents.cjs` already marks its own unused case as `_getMainWindow` — adopt that existing convention rather than deleting the parameter (keeps the `register*(getMainWindow)` signature uniform across all IPC modules).

Before: `module.exports = function registerHistory(getMainWindow) {`
After: `module.exports = function registerHistory(_getMainWindow) {`

- [ ] **Step 2: `electron/ipc/mission.backend.test.cjs:250`**

`sendCalls` is declared and never read anywhere else in the file. Delete the line:

Before: `    const sendCalls = [];`
After: (line removed)

- [ ] **Step 3: `electron/ipc/mission.cjs` (5 sites)**

Line 336 — `qcVerdict` parameter unused in `enqueueQaCheck`:
Before: `function enqueueQaCheck(task, agent, qcVerdict) {`
After: `function enqueueQaCheck(task, agent, _qcVerdict) {`

Line 834 — `catch (e)` binding unused (body is just a comment):
Before: `    } catch (e) {`
After: `    } catch {`

Line 2848 — `newStatus` computed and never read afterward (only `taskIdUpd`/`newOwner` are used in the following block). Delete the line:
Before: `                const newStatus  = (input.status || '').toString();`
After: (line removed)

Line 3192 — `nextAttempt` arrow-function parameter unused:
Before: `        retrySpawn: (nextAttempt) => spawnResumeOrFreshAttempt({ missionId, sendToWindow, promptOverride: prompt, reasonForLog })`
After: `        retrySpawn: (_nextAttempt) => spawnResumeOrFreshAttempt({ missionId, sendToWindow, promptOverride: prompt, reasonForLog })`

Line 3543 — `catch (err)` binding unused (body never reads `err`):
Before: `    } catch (err) {`
After: `    } catch {`

- [ ] **Step 4: `electron/ipc/mission.test.cjs:79,100`**

Both sites are `mission.__setQcQaRunnerForTest(async (opts) => ({ verdict: 'PASS' }))` — `opts` is the mock's only parameter and is never read. Since it's a no-arg-needed test stub, drop the parameter entirely (both occurrences, identical fix):

Before: `    mission.__setQcQaRunnerForTest(async (opts) => ({ verdict: 'PASS' }))`
After: `    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))`

- [ ] **Step 5: `electron/ipc/system.check_for_updates.test.js:1`**

`beforeEach` is imported but only `afterEach` is used in the file:

Before: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'`
After: `import { describe, it, expect, vi, afterEach } from 'vitest'`

- [ ] **Step 6: `electron/ipc/system.cjs:166`**

Same pattern as Step 1 — adopt the existing `_`-prefix convention rather than deleting the shared-signature parameter:

Before: `module.exports = function registerSystem(getMainWindow) {`
After: `module.exports = function registerSystem(_getMainWindow) {`

- [ ] **Step 7: `electron/lib/missionIndex.test.cjs:137`**

`enqueueChunk` and `flushPending` are destructured but never used in the `describe('queryIndex', ...)` block (only `queryIndex` and `vectorsPathFor` are used):

Before: `  const { enqueueChunk, flushPending, queryIndex, vectorsPathFor } = require('./missionIndex.cjs');`
After: `  const { queryIndex, vectorsPathFor } = require('./missionIndex.cjs');`

- [ ] **Step 8: `electron/lib/qcqa.cjs:84`**

`backend` and `log` are documented options (see the JSDoc block directly above the function) accepted for forward compatibility but not yet read in the function body. Rename the local bindings via destructuring rename (keeps the external `{ backend, log }` object-property contract callers may already pass, marks the local bindings as intentionally unused):

Before: `function runQcQaCheck({ spawnFn, buildArgs, promptViaStdin, parseLine, spawnClaude, prompt, projectPath, model, stage, timeoutMs = 180000, backend, log }) {`
After: `function runQcQaCheck({ spawnFn, buildArgs, promptViaStdin, parseLine, spawnClaude, prompt, projectPath, model, stage, timeoutMs = 180000, backend: _backend, log: _log }) {`

- [ ] **Step 9: `src/App.jsx:30`**

`markSeen` is destructured from `useChangelog()` but never called anywhere in the file:

Before: `  const { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen, updateInfo } = useChangelog(appVersion)`
After: `  const { showChangelog, shouldAutoShow, openChangelog, closeChangelog, updateInfo } = useChangelog(appVersion)`

- [ ] **Step 10: `src/components/mission/MissionDashboard.jsx:52-58`**

`onOfficeDragStart` is a `useCallback` whose only reference (`onMouseDown={onOfficeDragStart}` at line 291) sits inside a commented-out JSX block (`{/* <div ... /> */}`) — it is genuinely dead code, not a live handler. Delete the whole callback:

Before:
```js
  const onOfficeDragStart = useCallback((e) => {
    isOfficeDragging.current = true
    officeStartX.current = e.clientX
    officeStartWidth.current = officePanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [officePanelWidth])

```
After: (block removed entirely, including the trailing blank line)

- [ ] **Step 11: `src/components/mission/PlanReview.jsx` (3 sites)**

Line 9 — `Wrench` icon imported from `lucide-react`, never used in JSX:
Before: `  Wrench, MessageSquare, Info, Plus, Trash2, X, GripVertical,`
After: `  MessageSquare, Info, Plus, Trash2, X, GripVertical,`

Line 11 — `Edit3` icon imported, never used in JSX:
Before: `  RefreshCw, ListTodo, Edit3, AlertCircle, GitFork`
After: `  RefreshCw, ListTodo, AlertCircle, GitFork`

Line 998 — `editingTask` computed and never referenced anywhere else in the file. Delete the line:
Before: `  const editingTask = editingDetailId ? localTasks.find(t => t.id === editingDetailId) : null`
After: (line removed)

- [ ] **Step 12: `src/components/mission/PromptPreview.jsx:5`**

`onEdit` destructured in `PromptCard`'s props but never called in the function body:

Before: `function PromptCard({ agent, prompt, onEdit, onSave }) {`
After: `function PromptCard({ agent, prompt, onEdit: _onEdit, onSave }) {`

- [ ] **Step 13: `src/components/mission/QuestionCard.jsx:16`**

`question` destructured in `QuestionTab`'s props but never referenced in the function body (only `index`, `answer`, `isActive`, `onClick` are used):

Before: `function QuestionTab({ index, question, answer, isActive, onClick }) {`
After: `function QuestionTab({ index, question: _question, answer, isActive, onClick }) {`

- [ ] **Step 14: `src/components/ui/ToastProvider.test.jsx:1`**

`act` imported from `@testing-library/react` but never used:

Before: `import { render, screen, act } from '@testing-library/react'`
After: `import { render, screen } from '@testing-library/react'`

- [ ] **Step 15: `src/hooks/useAppHotkeys.js:35`**

`scope` destructured in `useAppHotkeys`'s params (documented in the JSDoc above as a real, intended public option) but not read in the function body:

Before: `export function useAppHotkeys({ scope, handlers }) {`
After: `export function useAppHotkeys({ scope: _scope, handlers }) {`

- [ ] **Step 16: `src/hooks/useMission.js:905`**

`catch (err)` binding unused — the handler only shows a hardcoded toast message:

Before: `    } catch (err) {`
After: `    } catch {`

- [ ] **Step 17: `src/hooks/useTauriFileDrop.js:12`**

`useCallback` imported but never used in the file:

Before: `import { useState, useEffect, useRef, useCallback } from 'react'`
After: `import { useState, useEffect, useRef } from 'react'`

- [ ] **Step 18: `src/main.jsx:9`**

`Prism` default import binding is never referenced directly — only its side effect (registering the global the subsequent `prismjs/components/prism-*` imports attach language grammars to) matters. Convert to a side-effect-only import:

Before: `import Prism from 'prismjs'`
After: `import 'prismjs'`

- [ ] **Step 19: `src/pages/DashboardPage.jsx` (4 sites)**

Line 1 — `useRef` imported, never used:
Before: `import { useState, useEffect, useRef } from 'react'`
After: `import { useState, useEffect } from 'react'`

Line 8 — `Trash2` icon imported, never used in JSX:
Before: `  Clock, Play, Trash2, AlertCircle, Settings`
After: `  Clock, Play, AlertCircle, Settings`

Line 31 — `output` state value is never read (only `setOutput` is called, inside the `claude-output` listener and inside `clearSession`). Use array-hole destructuring to skip the unused first element rather than introducing an artificial `_`-prefixed binding:
Before: `  const [output, setOutput] = useState({})`
After: `  const [, setOutput] = useState({})`

Lines 83-86 — `clearSession` is defined but never called from anywhere in the file (no button is wired to it). Delete the whole function:
Before:
```js
  const clearSession = (id) => {
    setSessions(prev => prev.filter(s => s.id !== id))
    setOutput(prev => { const n = { ...prev }; delete n[id]; return n })
  }

```
After: (block removed entirely, including the trailing blank line)

- [ ] **Step 20: `src/pages/OnboardingPage.jsx:80`**

`isFuture` computed inside the `STEPS.map(...)` callback but never referenced in the returned JSX (only `isDone`/`isActive` are used). Delete the line:

Before: `            const isFuture = i > step`
After: (line removed)

- [ ] **Step 21: `src/sections/BestPractices.jsx:30-35`**

`hookConfig` is a template-string constant never rendered anywhere in the component (unlike the neighboring `goodExample`/`badExample` constants, which are passed to a `CodeBlock`). Delete the whole constant:

Before:
```js
const hookConfig = `# src-tauri hooks (nếu cần gate quality)
# TeammateIdle hook: chạy khi teammate sắp idle
# Exit code 2 = yêu cầu teammate tiếp tục làm việc

# TaskCompleted hook: chạy khi task được mark complete  
# Exit code 2 = ngăn task được mark complete`

```
After: (block removed entirely, including the trailing blank line)

- [ ] **Step 22: `src/utils/exportPlan.test.js:3`**

`downloadBlob` imported but no test in the file calls it:

Before: `import { generateSlug, generateFilename, generateHTML, downloadBlob } from './exportPlan'`
After: `import { generateSlug, generateFilename, generateHTML } from './exportPlan'`

- [ ] **Step 23: Verify**

Run: `npm run lint`
Expected: 0 `no-unused-vars` findings remain (58 problems remaining: 40 `react/no-unescaped-entities`, 4 `no-useless-assignment`, 2 `preserve-caught-error`, 2 `no-useless-escape`, 1 `no-control-regex`, plus the 9 pre-existing non-blocking `react-hooks/exhaustive-deps` warnings).

- [ ] **Step 24: Run the full test suite to confirm no behavior changed**

Run: `npx vitest run`
Expected: same 0 failed files / 403 passed / 1 skipped result as Task 1's Step 3 — these are lint-only edits (dead code removal, parameter renames, import trimming), so no test outcome should change.

- [ ] **Step 25: Commit**

```bash
git add electron/ipc/history.cjs electron/ipc/mission.backend.test.cjs electron/ipc/mission.cjs electron/ipc/mission.test.cjs electron/ipc/system.check_for_updates.test.js electron/ipc/system.cjs electron/lib/missionIndex.test.cjs electron/lib/qcqa.cjs src/App.jsx src/components/mission/MissionDashboard.jsx src/components/mission/PlanReview.jsx src/components/mission/PromptPreview.jsx src/components/mission/QuestionCard.jsx src/components/ui/ToastProvider.test.jsx src/hooks/useAppHotkeys.js src/hooks/useMission.js src/hooks/useTauriFileDrop.js src/main.jsx src/pages/DashboardPage.jsx src/pages/OnboardingPage.jsx src/sections/BestPractices.jsx src/utils/exportPlan.test.js
git commit -m "fix: resolve all no-unused-vars ESLint violations"
```

---

### Task 4: Fix `no-useless-assignment`, `preserve-caught-error`, `no-control-regex`, `no-useless-escape` (9 findings, 5 files)

**Files:**
- Modify: `electron/lib/recordingStore.cjs:81,153`
- Modify: `src/data/promptWrapper.js:176`
- Modify: `electron/ipc/mission.cjs:4600`
- Modify: `electron/ipc/system.cjs:179,345`
- Modify: `electron/ipc/mission.cjs:130`
- Modify: `src/sections/Setup.jsx:12`

**Interfaces:**
- Consumes: nothing new from Task 3.
- Produces: `npm run lint` reports 0 findings for these 4 rules.

- [ ] **Step 1: `electron/lib/recordingStore.cjs:81` — `no-useless-assignment`**

`files` is initialized to `[]` but both the `try` and `catch` branches unconditionally overwrite it before any read:

Before: `  let files = [];`
After: `  let files;`

- [ ] **Step 2: `electron/lib/recordingStore.cjs:153` — `no-useless-assignment`**

Same pattern, in `deleteRecording()`:

Before: `  let existed = false;`
After: `  let existed;`

- [ ] **Step 3: `src/data/promptWrapper.js:176` — `no-useless-assignment`**

Same pattern:

Before: `  let permissionSection = ''`
After: `  let permissionSection`

- [ ] **Step 4: `electron/ipc/mission.cjs:4600` — `no-useless-assignment`**

Same pattern — `versions` is unconditionally overwritten inside the `try`, and the `catch` branch returns early without ever reading the `[]` default:

Before: `    let versions = [];`
After: `    let versions;`

- [ ] **Step 5: `electron/ipc/system.cjs:179` — `preserve-caught-error`**

The rethrown error drops the original error's stack/context. Attach it via the standard `cause` option:

Before:
```js
    } catch (e) {
      throw new Error(e.stderr || 'Claude CLI not found. Please install Claude Code first.');
    }
```
After:
```js
    } catch (e) {
      throw new Error(e.stderr || 'Claude CLI not found. Please install Claude Code first.', { cause: e });
    }
```

- [ ] **Step 6: `electron/ipc/system.cjs:345` — `preserve-caught-error`**

Same pattern:

Before:
```js
    } catch (err) {
      throw new Error(`Failed to save office layout: ${err.message}`);
    }
```
After:
```js
    } catch (err) {
      throw new Error(`Failed to save office layout: ${err.message}`, { cause: err });
    }
```

- [ ] **Step 7: `electron/ipc/mission.cjs:130` — `no-control-regex`**

The regex deliberately matches the ANSI escape control character (`\x1b`) to strip terminal color codes from agent output — this is intentional, not a mistake. Add a targeted disable comment with reasoning, rather than turning the rule off project-wide:

Before:
```js
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
```
After:
```js
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex -- \x1b deliberately matches the ANSI escape control character to strip terminal color codes
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
```

- [ ] **Step 8: `src/sections/Setup.jsx:12` — `no-useless-escape`**

`\.` and `\s` are not recognized JS string escape sequences — JavaScript silently drops the backslash at runtime, so this Setup guide is currently rendering `%USERPROFILEclaudesettings.json` instead of the intended path with literal backslashes. This is a genuine, previously-invisible display bug, not just a lint nitpick. Fix with proper double-backslash escaping:

Before: `%USERPROFILE%\.claude\settings.json`
After: `%USERPROFILE%\\.claude\\settings.json`

- [ ] **Step 9: Verify**

Run: `npm run lint`
Expected: 0 findings for `no-useless-assignment`, `preserve-caught-error`, `no-control-regex`, `no-useless-escape` (49 problems remaining: 40 `react/no-unescaped-entities` errors + 9 non-blocking warnings).

- [ ] **Step 10: Run the full test suite**

Run: `npx vitest run`
Expected: same 0 failed / 403 passed / 1 skipped result as before.

- [ ] **Step 11: Commit**

```bash
git add electron/lib/recordingStore.cjs src/data/promptWrapper.js electron/ipc/mission.cjs electron/ipc/system.cjs src/sections/Setup.jsx
git commit -m "fix: resolve no-useless-assignment, preserve-caught-error, no-control-regex, no-useless-escape violations"
```

---

### Task 5: Fix `react/no-unescaped-entities` (40 findings, 10 files) + final lint verification

**Files:**
- Modify: `src/components/ChangelogModal.jsx:110`
- Modify: `src/components/Sidebar.jsx:186`
- Modify: `src/components/mission/MissionLauncher.jsx:554`
- Modify: `src/pages/MissionControlPage.jsx:477`
- Modify: `src/pages/RecordingsPage.jsx:116`
- Modify: `src/sections/DashboardGuide.jsx:151,171`
- Modify: `src/sections/HowItWorks.jsx:130,144`
- Modify: `src/sections/LauncherGuide.jsx:30-31,207,231`
- Modify: `src/sections/PlanReviewGuide.jsx:139,143,258,266,267,268,277,385`
- Modify: `src/sections/TeamInteraction.jsx:114`

**Interfaces:**
- Consumes: nothing new from Task 4.
- Produces: `npm run lint` exits 0.

Every finding here is a literal `"` or `'` character inside JSX text (not inside a JS string or attribute) — fix by replacing it with the HTML entity ESLint's own message recommends: `&quot;` for `"`, `&apos;` for `'`. No other text on the line changes.

- [ ] **Step 1: `src/components/ChangelogModal.jsx:110`**

Before: `              <h2 className="text-sm font-bold text-vs-heading">What's New</h2>`
After: `              <h2 className="text-sm font-bold text-vs-heading">What&apos;s New</h2>`

- [ ] **Step 2: `src/components/Sidebar.jsx:186`**

Before: `            {appVersion ? \`v${appVersion}\` : '...'} &middot; What's New`
After: `            {appVersion ? \`v${appVersion}\` : '...'} &middot; What&apos;s New`

- [ ] **Step 3: `src/components/mission/MissionLauncher.jsx:554`**

Before: `                  Không tìm thấy file "{mentionQuery}" trong project`
After: `                  Không tìm thấy file &quot;{mentionQuery}&quot; trong project`

- [ ] **Step 4: `src/pages/MissionControlPage.jsx:477`**

Before: `                    "{recoverableMission.description?.slice(0, 80) || 'Unnamed mission'}" was interrupted ({recoverableMission.phase}, {recoverableMission.log_count} log entries).`
After: `                    &quot;{recoverableMission.description?.slice(0, 80) || 'Unnamed mission'}&quot; was interrupted ({recoverableMission.phase}, {recoverableMission.log_count} log entries).`

- [ ] **Step 5: `src/pages/RecordingsPage.jsx:116`**

Before: `                  Bật "Ghi lại phiên chạy" khi khởi chạy mission ở Mission Control để tạo bản ghi đầu tiên.`
After: `                  Bật &quot;Ghi lại phiên chạy&quot; khi khởi chạy mission ở Mission Control để tạo bản ghi đầu tiên.`

- [ ] **Step 6: `src/sections/DashboardGuide.jsx:151,171`**

Line 151:
Before: `                    <td className="px-4 py-2 text-vs-string">"{cmd}"</td>`
After: `                    <td className="px-4 py-2 text-vs-string">&quot;{cmd}&quot;</td>`

Line 171:
Before: `            Trong Intervention Panel, nút <strong>"+ Agent"</strong> cho phép define agent tùy chỉnh:`
After: `            Trong Intervention Panel, nút <strong>&quot;+ Agent&quot;</strong> cho phép define agent tùy chỉnh:`

- [ ] **Step 7: `src/sections/HowItWorks.jsx:130,144`**

Line 130:
Before: `                Bạn có thể xem trước trong Launcher bằng nút "Xem System Prompt".`
After: `                Bạn có thể xem trước trong Launcher bằng nút &quot;Xem System Prompt&quot;.`

Line 144:
Before: `                Nếu bạn thêm "Custom Instructions" trong Plan Review, nó sẽ được include vào prompt của subagent đó.`
After: `                Nếu bạn thêm &quot;Custom Instructions&quot; trong Plan Review, nó sẽ được include vào prompt của subagent đó.`

- [ ] **Step 8: `src/sections/LauncherGuide.jsx:30-31,207,231`**

Lines 30-31 (one JSX text node spanning two lines, one quote on each):
Before:
```jsx
              <p className="text-vs-string">"Tạo ứng dụng React quản lý bài kiểm tra. Hỗ trợ single choice A,B,C,D.
              Có form tạo câu hỏi, xem danh sách, và chạy bài kiểm tra."</p>
```
After:
```jsx
              <p className="text-vs-string">&quot;Tạo ứng dụng React quản lý bài kiểm tra. Hỗ trợ single choice A,B,C,D.
              Có form tạo câu hỏi, xem danh sách, và chạy bài kiểm tra.&quot;</p>
```

Line 207:
Before: `                  Nút "Browse" mở folder picker. Bỏ trống = agents tự tạo project mới.`
After: `                  Nút &quot;Browse&quot; mở folder picker. Bỏ trống = agents tự tạo project mới.`

Line 231:
Before: `             Nút <strong>"Xem System Prompt"</strong> (icon mắt 👁) ở Launcher cho phép`
After: `             Nút <strong>&quot;Xem System Prompt&quot;</strong> (icon mắt 👁) ở Launcher cho phép`

- [ ] **Step 9: `src/sections/PlanReviewGuide.jsx:139,143,258,266,267,268,277,385`**

Line 139:
Before: `                <span className="text-vs-muted ml-2">"Build a login form"</span>`
After: `                <span className="text-vs-muted ml-2">&quot;Build a login form&quot;</span>`

Line 143:
Before: `                <span className="text-vs-string ml-2">"Build login form using React Hook Form + Zod validation. Fields: email (email format), password (min 8 chars). Use shadcn/ui Input + Button. On submit → POST /api/auth/login. Handle 401 → error toast. Files: src/components/LoginForm.tsx, src/schemas/auth.ts"</span>`
After: `                <span className="text-vs-string ml-2">&quot;Build login form using React Hook Form + Zod validation. Fields: email (email format), password (min 8 chars). Use shadcn/ui Input + Button. On submit → POST /api/auth/login. Handle 401 → error toast. Files: src/components/LoginForm.tsx, src/schemas/auth.ts&quot;</span>`

Line 258:
Before: `            Mỗi agent card có textarea <strong>"Custom instructions"</strong> — thêm hướng dẫn đặc biệt.`
After: `            Mỗi agent card có textarea <strong>&quot;Custom instructions&quot;</strong> — thêm hướng dẫn đặc biệt.`

Line 266:
Before: `              <p className="text-vs-string">"Dùng Tailwind CSS thay vì CSS modules. Import từ @/components/."</p>`
After: `              <p className="text-vs-string">&quot;Dùng Tailwind CSS thay vì CSS modules. Import từ @/components/.&quot;</p>`

Line 267:
Before: `              <p className="text-vs-string">"Viết tests với Vitest, không dùng Jest. Coverage tối thiểu 80%."</p>`
After: `              <p className="text-vs-string">&quot;Viết tests với Vitest, không dùng Jest. Coverage tối thiểu 80%.&quot;</p>`

Line 268:
Before: `              <p className="text-vs-string">"API endpoint phải return JSON với format: {'{ success: boolean, data: T, error?: string }'}"</p>`
After: `              <p className="text-vs-string">&quot;API endpoint phải return JSON với format: {'{ success: boolean, data: T, error?: string }'}&quot;</p>`

Line 277:
Before: `             Skill Files — Thêm "kỹ năng" cho agent`
After: `             Skill Files — Thêm &quot;kỹ năng&quot; cho agent`

Line 385:
Before: `            Nút <strong>"Prompt Preview"</strong> mở màn hình xem prompt hoàn chỉnh cho từng agent.`
After: `            Nút <strong>&quot;Prompt Preview&quot;</strong> mở màn hình xem prompt hoàn chỉnh cho từng agent.`

- [ ] **Step 10: `src/sections/TeamInteraction.jsx:114`**

Before: `          Task status đôi khi <strong>lag</strong> vài giây — đây là known limitation của experimental feature. Nếu cần update chính xác, hỏi lead: <code className="font-mono bg-vs-overlay/20 px-1 rounded">"What is the status of all tasks?"</code>`
After: `          Task status đôi khi <strong>lag</strong> vài giây — đây là known limitation của experimental feature. Nếu cần update chính xác, hỏi lead: <code className="font-mono bg-vs-overlay/20 px-1 rounded">&quot;What is the status of all tasks?&quot;</code>`

- [ ] **Step 11: Final lint verification**

Run: `npm run lint`
Expected: **exit code 0** — 0 errors. (9 `react-hooks/exhaustive-deps` warnings remain; these are pre-existing, non-blocking, and out of scope for this plan.)

- [ ] **Step 12: Full test suite + build verification**

Run: `npx vitest run`
Expected: 0 failed / 403 passed / 1 skipped (unchanged — these were pure JSX text edits).

Run: `npm run build`
Expected: exits 0.

Run: `npx vite build --config vite.config.electron.mjs`
Expected: exits 0.

- [ ] **Step 13: Commit**

```bash
git add src/components/ChangelogModal.jsx src/components/Sidebar.jsx src/components/mission/MissionLauncher.jsx src/pages/MissionControlPage.jsx src/pages/RecordingsPage.jsx src/sections/DashboardGuide.jsx src/sections/HowItWorks.jsx src/sections/LauncherGuide.jsx src/sections/PlanReviewGuide.jsx src/sections/TeamInteraction.jsx
git commit -m "fix: resolve react/no-unescaped-entities ESLint violations"
```

---

### Task 6: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run lint` (Task 5), `npm test` (Task 1 fix), `npm run build` (existing), `npx vite build --config vite.config.electron.mjs` (existing), `npm run test:e2e` (existing, `pretest:e2e` already builds the Electron bundle it needs).
- Produces: 4 named GitHub Actions status checks (`lint`, `unit-test`, `build-check`, `e2e`) that report on every PR to `main` and every push to `main`.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  unit-test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  build-check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npx vite build --config vite.config.electron.mjs

  e2e:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:e2e
      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 7
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: add GitHub Actions CI workflow (lint, unit-test, build-check, e2e)"
```

---

### Task 7: Push, open PR, verify all checks, apply branch protection

**Files:** none (repo/GitHub operations only).

**Interfaces:**
- Consumes: the branch produced by Tasks 1-6.
- Produces: `main` gated by 4 required status checks.

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Add CI pipeline (lint, unit-test, build-check, e2e)" --body "$(cat <<'EOF'
## Summary
- Fixes the Vitest config bug that was sweeping Playwright specs into `npx vitest run` (previously mis-closed as an upstream Vite race — it was a deterministic project-side config gap).
- Adds ESLint (flat config) and fixes all ~85 real violations it surfaces, with zero suppression comments.
- Adds `.github/workflows/ci.yml`: 4 parallel jobs (`lint`, `unit-test`, `build-check`, `e2e`) on `windows-latest`.

## Test plan
- [x] `npx vitest run` — 0 failed files, 403 passed / 1 skipped
- [x] `npm run lint` — exit 0
- [x] `npm run build` — exit 0
- [x] `npx vite build --config vite.config.electron.mjs` — exit 0
- [ ] All 4 CI jobs report green on this PR
EOF
)"
```

- [ ] **Step 2: Wait for all 4 checks to report**

```bash
gh pr checks <pr-number> --watch
```

Expected: `lint`, `unit-test`, `build-check`, `e2e` all report success. If any job fails, fix the root cause (return to the relevant earlier task) — do not proceed to Step 3 with a red check.

- [ ] **Step 3: Apply branch protection — requires explicit user confirmation before running**

This is the step that actually closes Issue #7's complaint ("nothing gates merges"). Ask the user to confirm before running, per this project's standing practice of confirming before actions that affect shared repo settings:

```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[checks][][context]=lint" \
  -f "required_status_checks[checks][][context]=unit-test" \
  -f "required_status_checks[checks][][context]=build-check" \
  -f "required_status_checks[checks][][context]=e2e" \
  -f "enforce_admins=false" \
  -f "required_pull_request_reviews=null" \
  -f "restrictions=null"
```

(Adjust `{owner}/{repo}` to the actual repo slug, and the exact `gh api` field syntax to whatever the installed `gh` version expects — verify with `gh api repos/{owner}/{repo}/branches/main/protection --method GET` first to confirm current state before and after.)

- [ ] **Step 4: Update the tracking doc**

In `docs/critical-issues-review-2026-08-08.md`, mark Issue #7 as fixed (`- [x] Fixed`, with a short summary of the CI workflow + prerequisite fixes, matching the style of Issues #1-#6's existing entries). Also update Issue #8's entry to note the correction: the "upstream Vite race" closure was wrong — the real cause was the missing `tests/specs/**` Vitest exclude, fixed as part of this issue's Task 1.

- [ ] **Step 5: Commit the tracking doc update**

```bash
git add docs/critical-issues-review-2026-08-08.md
git commit -m "docs: mark issue #7 (CI pipeline) fixed, correct issue #8's closure"
```

- [ ] **Step 6: Use `superpowers:finishing-a-development-branch`** to merge/PR/keep per the standard menu (the PR from Step 1 may already satisfy this — confirm with the user which of the skill's options applies given the PR is already open).
