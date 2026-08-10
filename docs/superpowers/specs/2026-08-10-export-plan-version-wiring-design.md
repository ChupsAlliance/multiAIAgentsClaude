# Export / plan version history broken IPC wiring — design

**Tracked issue:** #5 in `docs/critical-issues-review-2026-08-08.md` — "Export / plan version history completely broken"

## Problem

Three frontend components call `window.electron.ipcRenderer.invoke(...)`:

- `src/components/mission/ExportDropdown.jsx:61` (`export_plan_markdown`) and `:96` (`export_plan_pdf`)
- `src/components/mission/PlanVersionHistory.jsx:15` (`get_plan_versions`) and `:34` (`save_plan_version`)
- `src/components/mission/PlanDocument.jsx:454` (`save_plan_version`, via `window.electron?.ipcRenderer?.invoke(...)`)

`window.electron` is never defined. `electron/preload.cjs:49` only exposes `window.electronAPI` (`.invoke(command, args)` / `.on(event, callback)`) via `contextBridge.exposeInMainWorld('electronAPI', {...})`. There is no `window.electron` global anywhere in this codebase.

Effect:
- "Export Markdown" / "Export PDF" (`ExportDropdown.jsx`) always throw `Cannot read properties of undefined (reading 'ipcRenderer')`, caught by the existing `try/catch`, surfaced as a failure toast.
- `PlanVersionHistory.jsx`'s `loadVersions()` throws the same error inside its `try/catch`, which logs to console and sets `versions` to `[]` — the panel always renders "Chưa có lịch sử" (empty), making rollback impossible even though versions may exist server-side.
- `PlanDocument.jsx:454` uses optional chaining (`window.electron?.ipcRenderer?.invoke(...)`), so the call silently evaluates to `undefined` — no error, no save, no toast. Manual-edit plan versions are never persisted, with no indication anything went wrong.

The backend IPC handlers themselves are correct and already whitelisted: `save_plan_version`, `get_plan_versions`, `export_plan_markdown`, `export_plan_pdf` are all registered in `electron/ipc/mission.cjs:4675-4787` and listed in `preload.cjs`'s `ALLOWED_COMMANDS`. This is a pure frontend wiring bug — no backend change needed.

## Fix

Replace the nonexistent `window.electron.ipcRenderer.invoke(...)` calls with the `invoke()` helper from the Tauri-compatibility shim (`src/lib/tauri-shim/core.js`), imported as `import { invoke } from '@tauri-apps/api/core'`. This is the dominant convention already used by 15 other files in this codebase (`src/hooks/useMission.js`, `src/components/mission/AskMissionPanel.jsx`, `src/pages/MissionControlPage.jsx`, etc.) — none of them call `window.electronAPI.invoke` directly. The shim itself calls `window.electronAPI.invoke(command, args)` and throws a clear `'electronAPI not available — are you running in Electron?'` error if `window.electronAPI` is missing, instead of the current silent-`undefined`/opaque-`TypeError` failure modes.

### `src/components/mission/ExportDropdown.jsx`

- Add `import { invoke } from '@tauri-apps/api/core'` to the top imports.
- Line 61: `await window.electron.ipcRenderer.invoke('export_plan_markdown', { markdown, projectPath: project_path || projectPath })` → `await invoke('export_plan_markdown', { markdown, projectPath: project_path || projectPath })`.
- Line 96: `await window.electron.ipcRenderer.invoke('export_plan_pdf', { htmlContent, description: missionState?.description })` → `await invoke('export_plan_pdf', { htmlContent, description: missionState?.description })`.
- No other change — both call sites already have `try/catch` with a toast on failure; the caught error message will now be either the real IPC error or the shim's own "not available" message, both meaningfully more useful than today's `undefined` `TypeError`.

### `src/components/mission/PlanVersionHistory.jsx`

- Add `import { invoke } from '@tauri-apps/api/core'` to the top imports.
- Line 15: `const result = await window.electron.ipcRenderer.invoke('get_plan_versions', { missionId })` → `const result = await invoke('get_plan_versions', { missionId })`.
- Line 34: `await window.electron.ipcRenderer.invoke('save_plan_version', { missionId, trigger: 'rollback', agents: confirmRollback.agents, tasks: confirmRollback.tasks })` → `await invoke('save_plan_version', { missionId, trigger: 'rollback', agents: confirmRollback.agents, tasks: confirmRollback.tasks })`.
- No other change — existing `try/catch` blocks are unaffected.

### `src/components/mission/PlanDocument.jsx`

- Add `import { invoke } from '@tauri-apps/api/core'` to the top imports.
- Line 454: `window.electron?.ipcRenderer?.invoke('save_plan_version', { missionId, trigger: 'manual_edit', agents: newAgents, tasks: newTasks }).catch(err => console.error('Failed to save plan version:', err))` → `invoke('save_plan_version', { missionId, trigger: 'manual_edit', agents: newAgents, tasks: newTasks }).catch(err => console.error('Failed to save plan version:', err))`.
- Drop the `?.`/`?.` optional chaining on `window.electron`/`ipcRenderer` — it exists only because the previous code accessed a nonexistent nested global and needed to avoid throwing on the property access itself. `invoke()` is a plain imported function (always callable) that internally throws a `Promise` rejection when `window.electronAPI` is missing, which the existing `.catch(...)` already handles. Behavior is unchanged (a missing bridge still fails silently to console, matching this call site's existing "best-effort auto-save" intent — this call is not on the user's critical path, unlike the other two components) but the failure mode when `electronAPI` genuinely is absent becomes a real logged error instead of a silently skipped call.

## Global constraints

- No changes to `electron/preload.cjs`, `electron/ipc/mission.cjs`, or any other backend file — the backend handlers and whitelist are already correct.
- No changes to `src/lib/tauri-shim/core.js` — the shim's existing behavior (throw when `window.electronAPI` is missing) is exactly what these call sites should get.
- No change to any call site's existing error-handling shape (toast vs. console.error vs. silent) — only the broken global reference is corrected. `ExportDropdown.jsx` and `PlanVersionHistory.jsx` keep user-visible error handling (toast / rollback error banner); `PlanDocument.jsx:454` keeps its console-only best-effort handling, since that call is an auto-save side effect after `onApply` has already succeeded, not the user's primary action.
- No new IPC commands, no new whitelist entries.

## Testing

Follow the existing component-test convention already used in this repo (see `src/components/mission/AskMissionPanel.test.jsx`): `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(...) }))` at module scope, combined with `@testing-library/react`'s `render`/`screen`/`userEvent`.

- **`src/components/mission/ExportDropdown.test.jsx`** (new file):
  - Clicking "Markdown (.md)" calls `invoke('export_plan_markdown', { markdown: <string>, projectPath: <string> })` with the markdown generated from `missionState`, and shows a success toast when the mocked `invoke` resolves.
  - Clicking "Markdown (.md)" shows a failure toast (via `onToast('error', ...)`) when the mocked `invoke` rejects.
  - Clicking "PDF (.pdf)" calls `invoke('export_plan_pdf', { htmlContent: <string>, description: <string|undefined> })` and shows a success toast when the mocked `invoke` resolves `{ success: true }`.

- **`src/components/mission/PlanVersionHistory.test.jsx`** (new file):
  - On mount, calls `invoke('get_plan_versions', { missionId })` and renders each returned version's `label` in the list (replacing the current always-empty "Chưa có lịch sử" state when the mock resolves a non-empty array).
  - Confirming a rollback calls `invoke('save_plan_version', { missionId, trigger: 'rollback', agents: <...>, tasks: <...> })`, then calls `onRollback(agents, tasks)`.
  - When the confirmed rollback's `invoke` call rejects, the rollback error banner renders with the rejected error's message (existing `rollbackError` state/UI, unchanged).

- **`src/components/mission/PlanDocument.test.jsx`** (new file — none exists today for this component; scope this test file to only the manual-edit-save behavior relevant to this fix, not full component coverage):
  - After applying a manual edit with a non-null `missionId`, `invoke('save_plan_version', { missionId, trigger: 'manual_edit', agents: <...>, tasks: <...> })` is called.
  - When `missionId` is falsy, `invoke` is not called at all (matches the existing `if (missionId) { ... }` guard).

No changes needed to any existing test file.
