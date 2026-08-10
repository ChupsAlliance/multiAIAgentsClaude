# Export / Plan Version History IPC Wiring Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken `window.electron.ipcRenderer.invoke(...)` calls in `ExportDropdown.jsx`, `PlanVersionHistory.jsx`, and `PlanDocument.jsx` by switching them to the existing `invoke()` helper from `@tauri-apps/api/core` (the dominant IPC convention already used by 15+ other files), and add regression tests for all three call sites.

**Architecture:** Pure frontend wiring fix — three files each get one new import and 1-2 one-line call-site replacements. No backend, preload, or shim changes. Each fix ships with a Vitest + React Testing Library test file that mocks `@tauri-apps/api/core`'s `invoke` and drives the component through its real user interaction (dropdown click, rollback confirm, manual-edit apply).

**Tech Stack:** React 19, Vitest, `@testing-library/react`, `@testing-library/user-event`.

## Global Constraints

- No changes to `electron/preload.cjs`, `electron/ipc/mission.cjs`, or any other backend file.
- No changes to `src/lib/tauri-shim/core.js`.
- No change to any call site's existing error-handling shape (toast vs. console.error vs. silent) — only the broken `window.electron...` reference is replaced with `invoke(...)`.
- No new IPC commands, no new whitelist entries.
- Follow the codebase's dominant IPC convention: `import { invoke } from '@tauri-apps/api/core'` then `invoke(command, args)` — not `window.electronAPI.invoke` directly.

---

### Task 1: Fix `ExportDropdown.jsx` wiring + tests

**Files:**
- Modify: `src/components/mission/ExportDropdown.jsx:2-5` (imports), `:61` (`export_plan_markdown` call), `:96` (`export_plan_pdf` call)
- Test: `src/components/mission/ExportDropdown.test.jsx` (new file)

**Interfaces:**
- Consumes: `invoke(command: string, args: object) => Promise<any>` from `@tauri-apps/api/core` (already exists, unchanged).
- Produces: nothing new exported — `ExportDropdown`'s existing props (`missionState`, `projectPath`, `onToast`, `externalOpen`) and behavior contract are unchanged, only the broken IPC call is fixed.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mission/ExportDropdown.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { ExportDropdown } from './ExportDropdown'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const missionState = {
  id: 'm1',
  description: 'Test mission',
  project_path: '/tmp/proj',
  requirement: 'Build X',
  mission_context: 'ctx',
  agents: [{ name: 'Dev', role: 'Backend', model: 'sonnet', reason: 'r' }],
  tasks: [{ id: 't1', title: 'Task 1', why: 'w', depends_on: [], detail: '', priority: 'high', assigned_agent: 'Dev' }],
}

describe('ExportDropdown', () => {
  beforeEach(() => { invoke.mockReset() })

  test('clicking Markdown export calls invoke(export_plan_markdown) and shows success toast', async () => {
    invoke.mockResolvedValueOnce({ success: true })
    const onToast = vi.fn()
    const user = userEvent.setup()
    render(<ExportDropdown missionState={missionState} projectPath="/tmp/proj" onToast={onToast} />)

    await user.click(screen.getByTitle('Xuất ra file (Ctrl+E)'))
    await user.click(screen.getByText('Markdown (.md)'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('export_plan_markdown', {
      markdown: expect.any(String),
      projectPath: '/tmp/proj',
    }))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('success', expect.stringContaining('Đã xuất')))
  })

  test('clicking Markdown export shows a failure toast when invoke rejects', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    const onToast = vi.fn()
    const user = userEvent.setup()
    render(<ExportDropdown missionState={missionState} projectPath="/tmp/proj" onToast={onToast} />)

    await user.click(screen.getByTitle('Xuất ra file (Ctrl+E)'))
    await user.click(screen.getByText('Markdown (.md)'))

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('error', expect.stringContaining('boom')))
  })

  test('clicking PDF export calls invoke(export_plan_pdf) and shows success toast when resolved', async () => {
    invoke.mockResolvedValueOnce({ success: true })
    const onToast = vi.fn()
    const user = userEvent.setup()
    render(<ExportDropdown missionState={missionState} projectPath="/tmp/proj" onToast={onToast} />)

    await user.click(screen.getByTitle('Xuất ra file (Ctrl+E)'))
    await user.click(screen.getByText('PDF (.pdf)'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('export_plan_pdf', {
      htmlContent: expect.any(String),
      description: 'Test mission',
    }))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('success', 'Đã xuất PDF'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/mission/ExportDropdown.test.jsx`

Expected: all 3 tests FAIL. `ExportDropdown.jsx` still calls `window.electron.ipcRenderer.invoke(...)`, which throws `TypeError: Cannot read properties of undefined (reading 'ipcRenderer')` inside the existing `try/catch` — the mocked `invoke` from `@tauri-apps/api/core` is never called, so the first test's `expect(invoke).toHaveBeenCalledWith(...)` times out via `waitFor`, and the toast assertions see the generic `TypeError` message instead of `'boom'`/success.

- [ ] **Step 3: Fix the wiring**

In `src/components/mission/ExportDropdown.jsx`, add the import after the existing `planToMarkdown` import (line 5):

```js
import { invoke } from '@tauri-apps/api/core'
```

Replace line 61:

```js
await window.electron.ipcRenderer.invoke('export_plan_markdown', {
```

with:

```js
await invoke('export_plan_markdown', {
```

Replace line 96:

```js
const result = await window.electron.ipcRenderer.invoke('export_plan_pdf', {
```

with:

```js
const result = await invoke('export_plan_pdf', {
```

No other change — both call sites keep their existing `try/catch` and toast calls exactly as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/mission/ExportDropdown.test.jsx`

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/ExportDropdown.jsx src/components/mission/ExportDropdown.test.jsx
git commit -m "fix: wire ExportDropdown to invoke() instead of nonexistent window.electron"
```

---

### Task 2: Fix `PlanVersionHistory.jsx` wiring + tests

**Files:**
- Modify: `src/components/mission/PlanVersionHistory.jsx:1-3` (imports), `:15` (`get_plan_versions` call), `:34` (`save_plan_version` call)
- Test: `src/components/mission/PlanVersionHistory.test.jsx` (new file)

**Interfaces:**
- Consumes: `invoke(command: string, args: object) => Promise<any>` from `@tauri-apps/api/core`.
- Produces: nothing new exported — `PlanVersionHistory`'s existing props (`missionId`, `currentAgents`, `currentTasks`, `onRollback`) and behavior contract are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mission/PlanVersionHistory.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { PlanVersionHistory } from './PlanVersionHistory'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const versions = [
  { version: 2, label: 'v2 - rollback', timestamp: Date.now(), agents: [], tasks: [] },
  { version: 1, label: 'v1 - initial', timestamp: Date.now() - 1000, agents: [], tasks: [] },
]

describe('PlanVersionHistory', () => {
  beforeEach(() => { invoke.mockReset() })

  test('on mount, calls invoke(get_plan_versions) and renders each returned version label', async () => {
    invoke.mockResolvedValueOnce(versions)
    render(
      <PlanVersionHistory missionId="m1" currentAgents={[]} currentTasks={[]} onRollback={vi.fn()} />
    )

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_plan_versions', { missionId: 'm1' }))
    expect(await screen.findByText('v2 - rollback')).toBeInTheDocument()
    expect(screen.getByText('v1 - initial')).toBeInTheDocument()
    expect(screen.queryByText('Chưa có lịch sử')).not.toBeInTheDocument()
  })

  test('confirming a rollback calls invoke(save_plan_version) then onRollback', async () => {
    invoke.mockResolvedValueOnce(versions) // initial loadVersions() on mount
    const onRollback = vi.fn()
    const user = userEvent.setup()
    render(
      <PlanVersionHistory missionId="m1" currentAgents={[]} currentTasks={[]} onRollback={onRollback} />
    )
    await screen.findByText('v1 - initial')

    invoke.mockResolvedValueOnce(undefined) // save_plan_version(trigger: rollback)
    invoke.mockResolvedValueOnce(versions)  // loadVersions() re-fetch after rollback

    await user.click(screen.getByTitle('Khôi phục về version này'))
    await user.click(screen.getByRole('button', { name: 'Khôi phục' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_plan_version', {
      missionId: 'm1',
      trigger: 'rollback',
      agents: [],
      tasks: [],
    }))
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith([], []))
  })

  test('shows the rollback error banner when the confirmed rollback invoke rejects', async () => {
    invoke.mockResolvedValueOnce(versions) // initial loadVersions() on mount
    const user = userEvent.setup()
    render(
      <PlanVersionHistory missionId="m1" currentAgents={[]} currentTasks={[]} onRollback={vi.fn()} />
    )
    await screen.findByText('v1 - initial')

    invoke.mockRejectedValueOnce(new Error('save failed'))

    await user.click(screen.getByTitle('Khôi phục về version này'))
    await user.click(screen.getByRole('button', { name: 'Khôi phục' }))

    expect(await screen.findByText('save failed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/mission/PlanVersionHistory.test.jsx`

Expected: all 3 tests FAIL. `loadVersions()` still calls `window.electron.ipcRenderer.invoke(...)`, which throws inside its `try/catch`, is logged via `console.error`, and sets `versions` to `[]` — so the panel always renders "Chưa có lịch sử" and the mocked `invoke` is never called, failing every assertion.

- [ ] **Step 3: Fix the wiring**

In `src/components/mission/PlanVersionHistory.jsx`, add the import after the existing `diffPlanChanges` import (line 3):

```js
import { invoke } from '@tauri-apps/api/core'
```

Replace line 15:

```js
const result = await window.electron.ipcRenderer.invoke('get_plan_versions', { missionId })
```

with:

```js
const result = await invoke('get_plan_versions', { missionId })
```

Replace line 34:

```js
await window.electron.ipcRenderer.invoke('save_plan_version', {
```

with:

```js
await invoke('save_plan_version', {
```

No other change — both call sites keep their existing `try/catch` blocks exactly as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/mission/PlanVersionHistory.test.jsx`

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/PlanVersionHistory.jsx src/components/mission/PlanVersionHistory.test.jsx
git commit -m "fix: wire PlanVersionHistory to invoke() instead of nonexistent window.electron"
```

---

### Task 3: Fix `PlanDocument.jsx` wiring + tests

**Files:**
- Modify: `src/components/mission/PlanDocument.jsx:1-13` (imports), `:454` (`save_plan_version` call inside `confirmApply`)
- Test: `src/components/mission/PlanDocument.test.jsx` (new file — scoped only to the manual-edit-save behavior relevant to this fix, not full component coverage; no test file exists for this component today)

**Interfaces:**
- Consumes: `invoke(command: string, args: object) => Promise<any>` from `@tauri-apps/api/core`; `planToMarkdown(agents, tasks, { projectPath, requirement, mission_context }) => string` from `../../utils/planMarkdown` (used only by the test to construct an edited markdown string that produces a real diff).
- Produces: nothing new exported — `PlanDocument`'s existing props (`agents`, `tasks`, `missionContext`, `projectPath`, `requirement`, `missionId`, `onApply`) and behavior contract are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mission/PlanDocument.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { PlanDocument } from './PlanDocument'
import { planToMarkdown } from '../../utils/planMarkdown'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const agents = [{ name: 'Dev', role: 'Backend developer', model: 'sonnet', reason: 'r' }]
const tasks = [{ id: 't1', title: 'Build API', why: 'w', depends_on: [], detail: '', priority: 'high', assigned_agent: 'Dev' }]
const meta = { projectPath: '/tmp/proj', requirement: 'Build X', mission_context: 'ctx' }

// Edits the raw markdown textarea to a version with a real, diff-detectable change
// (an agent role change), then drives the Apply → confirm-in-modal flow.
async function editMarkdownAndApply(user) {
  const editedMarkdown = planToMarkdown(
    [{ ...agents[0], role: 'Backend developer v2' }],
    tasks,
    meta
  )
  const textarea = screen.getByRole('textbox')
  fireEvent.change(textarea, { target: { value: editedMarkdown } })

  const applyButton = await screen.findByText('Áp dụng thay đổi')
  await user.click(applyButton)

  const confirmButton = await screen.findByRole('button', { name: 'Áp dụng' })
  await user.click(confirmButton)
}

describe('PlanDocument manual-edit plan version save', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue({})
  })

  test('saves a manual_edit plan version via invoke when missionId is set', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <PlanDocument
        agents={agents}
        tasks={tasks}
        missionContext="ctx"
        projectPath="/tmp/proj"
        requirement="Build X"
        missionId="m1"
        onApply={onApply}
      />
    )

    await editMarkdownAndApply(user)

    expect(invoke).toHaveBeenCalledWith('save_plan_version', expect.objectContaining({
      missionId: 'm1',
      trigger: 'manual_edit',
      agents: expect.any(Array),
      tasks: expect.any(Array),
    }))
    expect(onApply).toHaveBeenCalled()
  })

  test('does not call invoke when missionId is falsy', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <PlanDocument
        agents={agents}
        tasks={tasks}
        missionContext="ctx"
        projectPath="/tmp/proj"
        requirement="Build X"
        missionId={null}
        onApply={onApply}
      />
    )

    await editMarkdownAndApply(user)

    expect(invoke).not.toHaveBeenCalled()
    expect(onApply).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/mission/PlanDocument.test.jsx`

Expected: the first test FAILS — `confirmApply` still uses `window.electron?.ipcRenderer?.invoke(...)`, which silently evaluates to `undefined` (no throw, since `window.electron` is optionally-chained), so the mocked `invoke` from `@tauri-apps/api/core` is never called and `expect(invoke).toHaveBeenCalledWith(...)` fails. The second test PASSES already (invoke was never going to be called either way when `missionId` is falsy) — that's expected; it isn't evidence the fix is done, only that this specific assertion doesn't discriminate. The fix's correctness is proven by the first test going from fail to pass in Step 4.

- [ ] **Step 3: Fix the wiring**

In `src/components/mission/PlanDocument.jsx`, add the import after the existing `BusinessSummary` import (line 13):

```js
import { invoke } from '@tauri-apps/api/core'
```

Replace lines 452-458 (inside `confirmApply`):

```js
    // Save manual_edit version after successful apply
    if (missionId) {
      window.electron?.ipcRenderer?.invoke('save_plan_version', {
        missionId,
        trigger: 'manual_edit',
        agents: newAgents,
        tasks: newTasks,
      }).catch(err => console.error('Failed to save plan version:', err))
    }
```

with:

```js
    // Save manual_edit version after successful apply
    if (missionId) {
      invoke('save_plan_version', {
        missionId,
        trigger: 'manual_edit',
        agents: newAgents,
        tasks: newTasks,
      }).catch(err => console.error('Failed to save plan version:', err))
    }
```

Only the `window.electron?.ipcRenderer?.invoke(...)` reference is replaced with a plain `invoke(...)` call — the `?.`/`?.` optional chaining is dropped because it existed only to avoid throwing on a nonexistent nested global; `invoke()` is a plain imported function (always callable) that internally throws when `window.electronAPI` is missing, and the existing `.catch(...)` already handles that. The `if (missionId)` guard and `.catch(...)` best-effort handling are unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/mission/PlanDocument.test.jsx`

Expected: PASS — both tests green.

- [ ] **Step 5: Run the full project test suite to check for regressions**

Run: `npx vitest run`

Expected: same pass/fail counts as before this plan for every file outside `src/components/mission/ExportDropdown.jsx`, `PlanVersionHistory.jsx`, `PlanDocument.jsx` and their new test files — this plan only touches those three components. Pre-existing unrelated Playwright-under-Vitest failures in `tests/specs/*.spec.ts`, if present, are not introduced by this task.

- [ ] **Step 6: Commit**

```bash
git add src/components/mission/PlanDocument.jsx src/components/mission/PlanDocument.test.jsx
git commit -m "fix: wire PlanDocument manual-edit plan version save to invoke()"
```

---

### Task 4: Update tracking doc

**Files:**
- Modify: `docs/critical-issues-review-2026-08-08.md` (issue #5 section)

**Interfaces:**
- Consumes: nothing from Tasks 1-3's code — this task only records that the fix landed, citing file/line evidence.
- Produces: nothing consumed by later tasks (final task in this plan).

The current issue #5 entry reads:

```markdown
## 5. Export / plan version history completely broken
- **Where:** `src/components/mission/ExportDropdown.jsx:61,96`, `src/components/mission/PlanVersionHistory.jsx:15,34`, `src/components/mission/PlanDocument.jsx:454`
- **Bug:** These call `window.electron.ipcRenderer.invoke(...)`, but the preload script (`electron/preload.cjs:49`) only exposes `window.electronAPI` (`.invoke`/`.on`). `window.electron` is never defined.
- **Effect:** "Export Markdown/PDF" always fails (caught, shows a failure toast). Plan version history (`PlanVersionHistory.jsx`) silently renders an always-empty list — rollback is impossible. `PlanDocument.jsx:454` uses optional chaining, so manual-edit versions are silently never persisted (no error shown at all). Backend IPC handlers (`save_plan_version`, `get_plan_versions`, `export_plan_markdown`, `export_plan_pdf`) are correctly whitelisted — this is a pure frontend wiring bug.
- [ ] Fixed
```

- [ ] **Step 1: Update the entry**

Following the exact pattern already used for issues #2, #3, and #4 in this same file (a `**Fix (...)**:` line added above the checkbox, then the checkbox flipped), replace the `- [ ] Fixed` line and add a fix line so the entry reads:

```markdown
## 5. Export / plan version history completely broken
- **Where:** `src/components/mission/ExportDropdown.jsx:61,96`, `src/components/mission/PlanVersionHistory.jsx:15,34`, `src/components/mission/PlanDocument.jsx:454`
- **Bug:** These call `window.electron.ipcRenderer.invoke(...)`, but the preload script (`electron/preload.cjs:49`) only exposes `window.electronAPI` (`.invoke`/`.on`). `window.electron` is never defined.
- **Effect:** "Export Markdown/PDF" always fails (caught, shows a failure toast). Plan version history (`PlanVersionHistory.jsx`) silently renders an always-empty list — rollback is impossible. `PlanDocument.jsx:454` uses optional chaining, so manual-edit versions are silently never persisted (no error shown at all). Backend IPC handlers (`save_plan_version`, `get_plan_versions`, `export_plan_markdown`, `export_plan_pdf`) are correctly whitelisted — this is a pure frontend wiring bug.
- **Fix (design doc `docs/superpowers/specs/2026-08-10-export-plan-version-wiring-design.md`, plan `docs/superpowers/plans/2026-08-10-export-plan-version-wiring.md`):** All three call sites now use the `invoke()` helper from `@tauri-apps/api/core` (`src/lib/tauri-shim/core.js`), matching the dominant IPC convention already used by 15+ other files in this codebase, instead of the nonexistent `window.electron.ipcRenderer.invoke(...)` global. `PlanDocument.jsx:454` also dropped its now-unnecessary `?.`/`?.` optional chaining, since `invoke()` is a plain always-callable function. No backend, preload, or shim changes. Verified with new component tests: `ExportDropdown.test.jsx`, `PlanVersionHistory.test.jsx`, `PlanDocument.test.jsx`.
- [x] Fixed
```

- [ ] **Step 2: Commit**

```bash
git add docs/critical-issues-review-2026-08-08.md
git commit -m "docs: mark issue #5 (export/plan version history IPC wiring) as fixed"
```
