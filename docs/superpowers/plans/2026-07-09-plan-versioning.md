# Plan Versioning & Diff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lưu version history của plan (initial/replan/manual_edit/rollback) vào snapshot file, hiện timeline + diff viewer trong PlanDocument, cho phép rollback về version cũ.

**Architecture:** Extend snapshot JSON với `plan_versions[]`. Backend có 2 IPC handlers mới (`save_plan_version`, `get_plan_versions`). Frontend có `PlanVersionHistory.jsx` component dùng `diffPlanChanges()` đã có.

**Tech Stack:** React 19, Electron IPC, existing `diffPlanChanges()` in `src/utils/planMarkdown.js`, Tailwind CSS, Lucide icons

## Global Constraints

- `plan_versions` chỉ append, không xóa
- Rollback tạo version mới, không overwrite lịch sử
- Tối đa 50 versions per mission (oldest dropped)
- Không thêm npm package mới
- UI text: tiếng Việt
- Không break flow replan/apply hiện có

---

## File Structure

- **Modify:** `electron/ipc/mission.cjs` — 2 IPC handlers + gọi save tại applyPlanToState và replan_mission
- **Create:** `src/components/mission/PlanVersionHistory.jsx` — timeline + diff viewer
- **Modify:** `src/components/mission/PlanDocument.jsx` — thêm "Lịch sử" button và mount PlanVersionHistory

---

### Task 1: IPC handlers `save_plan_version` và `get_plan_versions`

**Files:**
- Modify: `electron/ipc/mission.cjs`

**Interfaces:**
- Produces: IPC `save_plan_version(missionId, trigger, agents, tasks)` → `{ version, label }`
- Produces: IPC `get_plan_versions(missionId)` → `PlanVersion[]` (mới nhất trước)

- [ ] **Step 1: Đọc snapshot file structure**

```bash
grep -n "saveMissionSnapshot\|loadSnapshot\|agent-teams-snapshots\|JSON.stringify\|JSON.parse" electron/ipc/mission.cjs | head -20
```

Hiểu cách đọc/ghi snapshot file để biết chính xác nơi thêm `plan_versions`.

- [ ] **Step 2: Thêm helper `formatVersionLabel`**

Tìm cuối phần helper functions trong `mission.cjs` (trước phần IPC handler registration), thêm:

```js
function formatVersionLabel(trigger, versionNum, replanCount) {
  const now = new Date()
  const hhmm = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  switch (trigger) {
    case 'initial': return 'Plan ban đầu'
    case 'replan': return `Replan #${replanCount}`
    case 'manual_edit': return `Chỉnh sửa lúc ${hhmm}`
    case 'rollback': return `Khôi phục v${versionNum}`
    default: return `Version ${versionNum}`
  }
}
```

- [ ] **Step 3: Thêm IPC handler `save_plan_version`**

```js
ipcMain.handle('save_plan_version', async (event, { missionId, trigger, agents, tasks }) => {
  try {
    const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`)
    let snapshot = {}
    try {
      const raw = await fs.readFile(snapshotPath, 'utf-8')
      snapshot = JSON.parse(raw)
    } catch { /* snapshot chưa tồn tại */ }

    const versions = snapshot.plan_versions || []
    const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1
    const replanCount = versions.filter(v => v.trigger === 'replan').length + (trigger === 'replan' ? 1 : 0)

    const newVersion = {
      version: nextVersion,
      timestamp: Date.now(),
      trigger,
      label: formatVersionLabel(trigger, nextVersion, replanCount),
      agents: JSON.parse(JSON.stringify(agents)),
      tasks: JSON.parse(JSON.stringify(tasks)),
    }

    versions.push(newVersion)

    // Drop oldest nếu > 50
    const trimmed = versions.length > 50 ? versions.slice(versions.length - 50) : versions

    snapshot.plan_versions = trimmed
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8')

    return { version: newVersion.version, label: newVersion.label }
  } catch (err) {
    console.error('save_plan_version error:', err)
    return { error: err.message }
  }
})
```

- [ ] **Step 4: Thêm IPC handler `get_plan_versions`**

```js
ipcMain.handle('get_plan_versions', async (event, { missionId }) => {
  try {
    const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`)
    const raw = await fs.readFile(snapshotPath, 'utf-8')
    const snapshot = JSON.parse(raw)
    const versions = snapshot.plan_versions || []
    return [...versions].reverse() // mới nhất trước
  } catch {
    return []
  }
})
```

- [ ] **Step 5: Gọi save_plan_version khi plan parse lần đầu**

Tìm hàm `applyPlanToState` trong `mission.cjs`. Ngay sau khi plan được apply vào state lần đầu (check: chỉ khi `missionState.plan_versions` chưa có hoặc rỗng), thêm:

```js
// Lưu version initial — chỉ lần đầu
if (!missionState.plan_versions?.length) {
  ipcMain.emit('save_plan_version_internal', null, {
    missionId: missionState.id,
    trigger: 'initial',
    agents: missionState.agents,
    tasks: missionState.tasks,
  })
}
```

Hoặc gọi trực tiếp helper (tách logic ra helper function để tránh circular IPC call):

```js
async function savePlanVersionInternal(missionId, trigger, agents, tasks) {
  // Same logic as ipcMain.handle('save_plan_version', ...) above
  // Extracted để dùng nội bộ
}
```

Gọi `await savePlanVersionInternal(missionState.id, 'initial', agents, tasks)` trong `applyPlanToState`.

- [ ] **Step 6: Gọi save_plan_version khi replan**

Tìm handler `replan_mission`. Sau khi plan mới được apply, thêm:

```js
await savePlanVersionInternal(missionId, 'replan', newAgents, newTasks)
```

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: add save_plan_version and get_plan_versions IPC handlers"
```

---

### Task 2: PlanVersionHistory component

**Files:**
- Create: `src/components/mission/PlanVersionHistory.jsx`

**Interfaces:**
- Consumes: `diffPlanChanges` from `src/utils/planMarkdown.js`
- Consumes: IPC `get_plan_versions`, `save_plan_version` (via `window.electron.ipcRenderer.invoke`)
- Produces: `<PlanVersionHistory missionId currentAgents currentTasks onRollback />` component

- [ ] **Step 1: Tìm cách gọi IPC từ frontend**

```bash
grep -n "ipcRenderer\|invoke\|window\.electron" src/hooks/useMission.js | head -10
```

Ghi nhớ pattern invoke (ví dụ `window.electron.ipcRenderer.invoke('handler-name', args)`).

- [ ] **Step 2: Tìm diffPlanChanges signature**

```bash
grep -n "export function diffPlanChanges\|diffPlanChanges" src/utils/planMarkdown.js | head -5
```

- [ ] **Step 3: Tạo component**

```jsx
// src/components/mission/PlanVersionHistory.jsx
import { useState, useEffect, useCallback } from 'react'
import { Clock, ChevronLeft, RotateCcw } from 'lucide-react'
import { diffPlanChanges } from '../../utils/planMarkdown'

export function PlanVersionHistory({ missionId, currentAgents, currentTasks, onRollback }) {
  const [versions, setVersions] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [showDiff, setShowDiff] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(null) // version to rollback to
  const [loading, setLoading] = useState(false)

  const loadVersions = useCallback(async () => {
    const result = await window.electron.ipcRenderer.invoke('get_plan_versions', { missionId })
    setVersions(result || [])
  }, [missionId])

  useEffect(() => { loadVersions() }, [loadVersions])

  const handleViewDiff = (version) => {
    setSelectedVersion(version)
    setShowDiff(true)
  }

  const handleRollbackConfirm = async () => {
    if (!confirmRollback) return
    setLoading(true)
    await window.electron.ipcRenderer.invoke('save_plan_version', {
      missionId,
      trigger: 'rollback',
      agents: confirmRollback.agents,
      tasks: confirmRollback.tasks,
    })
    onRollback(confirmRollback.agents, confirmRollback.tasks)
    setConfirmRollback(null)
    await loadVersions()
    setLoading(false)
  }

  // Diff hiện tại vs version được chọn
  const diff = selectedVersion
    ? diffPlanChanges(
        { agents: selectedVersion.agents, tasks: selectedVersion.tasks },
        { agents: currentAgents, tasks: currentTasks }
      )
    : null

  if (showDiff && selectedVersion) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-vs-border">
          <button onClick={() => setShowDiff(false)} className="text-vs-muted hover:text-vs-text">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-mono text-vs-text">{selectedVersion.label}</span>
        </div>

        {/* Summary */}
        <div className="px-3 py-2 border-b border-vs-border">
          <span className="text-[10px] font-mono text-vs-muted">{diff?.summary || 'Không có thay đổi'}</span>
        </div>

        {/* Diff 2-column */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* Added agents */}
          {diff?.addedAgents?.map(a => (
            <div key={a.name} className="px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-xs font-mono text-green-400">
              + Agent: {a.name}
            </div>
          ))}
          {/* Removed agents */}
          {diff?.removedAgents?.map(a => (
            <div key={a.name} className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-xs font-mono text-red-400">
              - Agent: {a.name}
            </div>
          ))}
          {/* Modified agents */}
          {diff?.modifiedAgents?.map(a => (
            <div key={a.name} className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs font-mono text-yellow-400">
              ~ Agent: {a.name}
            </div>
          ))}
          {/* Added tasks */}
          {diff?.addedTasks?.map(t => (
            <div key={t.id} className="px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-xs font-mono text-green-400">
              + Task: {t.title}
            </div>
          ))}
          {/* Removed tasks */}
          {diff?.removedTasks?.map(t => (
            <div key={t.id} className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-xs font-mono text-red-400">
              - Task: {t.title}
            </div>
          ))}
          {/* Modified tasks */}
          {diff?.modifiedTasks?.map(t => (
            <div key={t.id} className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs font-mono text-yellow-400">
              ~ Task: {t.title}
            </div>
          ))}
          {!diff?.hasChanges && (
            <p className="text-[10px] text-vs-muted font-mono text-center py-4">Không có sự khác biệt</p>
          )}
        </div>
      </div>
    )
  }

  if (confirmRollback) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-vs-border">
          <button onClick={() => setConfirmRollback(null)} className="text-vs-muted hover:text-vs-text">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-mono text-vs-text">Xác nhận khôi phục</span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs font-mono text-vs-text">
            Khôi phục về <span className="text-amber-300">{confirmRollback.label}</span>?
            Thao tác này sẽ tạo version mới.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleRollbackConfirm}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-mono bg-vs-accent text-white rounded hover:bg-vs-accent/80 disabled:opacity-50"
            >
              {loading ? 'Đang khôi phục...' : 'Khôi phục'}
            </button>
            <button
              onClick={() => setConfirmRollback(null)}
              className="px-3 py-1.5 text-xs font-mono border border-vs-border text-vs-muted rounded hover:text-vs-text"
            >
              Hủy
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-vs-border">
        <Clock size={12} className="text-vs-muted" />
        <span className="text-xs font-mono text-vs-text font-semibold">Lịch sử Plan</span>
        <span className="text-[10px] font-mono text-vs-muted ml-auto">{versions.length} version</span>
      </div>

      {versions.length === 0 ? (
        <p className="text-[10px] text-vs-muted font-mono text-center py-6">Chưa có lịch sử</p>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-vs-border/30">
          {versions.map((v, i) => (
            <div key={v.version} className="px-3 py-2.5 hover:bg-vs-surface/50">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`text-xs font-mono ${i === 0 ? 'text-vs-accent' : 'text-vs-text'}`}>
                    {v.label}
                  </span>
                  {i === 0 && (
                    <span className="ml-2 text-[9px] font-mono text-vs-accent border border-vs-accent/40 rounded px-1">
                      hiện tại
                    </span>
                  )}
                  <p className="text-[10px] text-vs-muted font-mono mt-0.5">
                    {new Date(v.timestamp).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </p>
                </div>
                {i !== 0 && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleViewDiff(v)}
                      className="text-[10px] font-mono text-vs-muted hover:text-vs-text border border-vs-border rounded px-1.5 py-0.5"
                    >
                      Diff
                    </button>
                    <button
                      onClick={() => setConfirmRollback(v)}
                      className="text-[10px] font-mono text-vs-muted hover:text-amber-300 border border-vs-border rounded px-1.5 py-0.5"
                    >
                      <RotateCcw size={9} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/mission/PlanVersionHistory.jsx
git commit -m "feat: add PlanVersionHistory component with timeline, diff view, and rollback"
```

---

### Task 3: Tích hợp PlanVersionHistory vào PlanDocument

**Files:**
- Modify: `src/components/mission/PlanDocument.jsx`

**Interfaces:**
- Consumes: `PlanVersionHistory` from Task 2
- Consumes: IPC `save_plan_version` (gọi khi apply edit)

- [ ] **Step 1: Tìm toolbar và apply handler trong PlanDocument**

```bash
grep -n "handleApply\|Xuất MD\|toolbar\|Clock\|Download" src/components/mission/PlanDocument.jsx | head -20
```

- [ ] **Step 2: Thêm import**

```js
import { Clock } from 'lucide-react'
import { PlanVersionHistory } from './PlanVersionHistory'
```

- [ ] **Step 3: Thêm state**

```js
const [showVersionHistory, setShowVersionHistory] = useState(false)
```

- [ ] **Step 4: Thêm button "Lịch sử" vào toolbar**

Tìm toolbar div (nơi có nút "Xuất MD" / Export). Thêm button cạnh đó:

```jsx
<button
  onClick={() => setShowVersionHistory(prev => !prev)}
  className={`flex items-center gap-1 px-2 py-1 text-xs font-mono rounded border transition-colors ${
    showVersionHistory
      ? 'border-vs-accent text-vs-accent bg-vs-accent/10'
      : 'border-vs-border text-vs-muted hover:text-vs-text'
  }`}
>
  <Clock size={11} />
  Lịch sử
</button>
```

- [ ] **Step 5: Thêm PlanVersionHistory panel**

Trong layout của PlanDocument (bên cạnh editor), thêm panel slide-in:

```jsx
{showVersionHistory && (
  <div className="w-72 shrink-0 border-l border-vs-border bg-vs-surface overflow-hidden flex flex-col">
    <PlanVersionHistory
      missionId={missionState?.id}
      currentAgents={missionState?.agents || []}
      currentTasks={missionState?.tasks || []}
      onRollback={(agents, tasks) => {
        // Apply rollback vào missionState qua existing mechanism
        // Tìm hàm updatePlan hoặc dispatch tương đương
        handleApplyRollback(agents, tasks)
        setShowVersionHistory(false)
      }}
    />
  </div>
)}
```

- [ ] **Step 6: Gọi save_plan_version khi apply manual edit**

Trong `handleApply` (hàm apply plan edits khi Ctrl+S), sau khi apply thành công, thêm:

```js
// Save manual_edit version
await window.electron.ipcRenderer.invoke('save_plan_version', {
  missionId: missionState.id,
  trigger: 'manual_edit',
  agents: parsedAgents,  // agents sau khi parse
  tasks: parsedTasks,    // tasks sau khi parse
})
```

- [ ] **Step 7: Verify**

```bash
npm run dev
```

- Click "Lịch sử" button → panel slide in từ phải
- Apply edit → version `manual_edit` xuất hiện trong timeline
- Click "Diff" → xem thay đổi
- Click Rollback → confirm dialog → apply → version `rollback` thêm vào timeline

- [ ] **Step 8: Chạy tests**

```bash
npm test
```

Expected: tất cả pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/mission/PlanDocument.jsx
git commit -m "feat: integrate PlanVersionHistory panel into PlanDocument with manual_edit save"
```