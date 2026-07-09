# Plan Versioning & Diff — Design Spec

> **Topic C / Feature 2:** Version history cho plan với diff viewer và rollback

---

## Goal

Lưu mọi thay đổi của plan (replan từ Lead + manual edit từ user) thành version history. Cho phép xem diff giữa 2 version bất kỳ và rollback về version cũ.

## Architecture

- Extend snapshot file (`~/.claude/agent-teams-snapshots/<id>.json`) với field `plan_versions: PlanVersion[]`
- 2 IPC handlers mới trong `electron/ipc/mission.cjs`
- UI: panel "Lịch sử Plan" trong `PlanDocument.jsx` (toggle button, Clock icon)
- Tái dụng `diffPlanChanges()` đã có trong `src/utils/planMarkdown.js`

## Tech Stack

React 19, Electron IPC, existing `diffPlanChanges()`, Tailwind CSS, Lucide icons

---

## Global Constraints

- `plan_versions` chỉ append — không bao giờ xóa version cũ
- Rollback tạo version mới (không overwrite lịch sử)
- Tối đa 50 versions per mission (cũ nhất bị drop nếu vượt)
- Không thêm npm package mới
- UI text: tiếng Việt
- Không break flow replan/apply hiện có

---

## PlanVersion Schema

```js
{
  version: number,           // 1, 2, 3... (auto-increment)
  timestamp: number,         // Date.now() ms
  trigger: 'initial' | 'replan' | 'manual_edit' | 'rollback',
  label: string,             // "Plan ban đầu" / "Replan #2" / "Chỉnh sửa lúc 14:32" / "Khôi phục v3"
  agents: Agent[],           // snapshot của agents tại thời điểm này
  tasks: Task[],             // snapshot của tasks tại thời điểm này
}
```

---

## Khi Nào Tạo Version Mới

| Trigger | Nơi gọi | Label |
|---|---|---|
| `initial` | `applyPlanToState()` lần đầu (sau parse plan từ Lead) | `"Plan ban đầu"` |
| `replan` | `replan_mission` handler khi Lead gửi plan mới | `"Replan #N"` (N = số replan) |
| `manual_edit` | `export_plan_markdown` / apply edit handler khi user Ctrl+S | `"Chỉnh sửa lúc HH:mm"` |
| `rollback` | Khi user click "Khôi phục version này" | `"Khôi phục v{N}"` |

---

## IPC Handlers Mới

### `save_plan_version(missionId, trigger, agents, tasks)`

```js
// Append vào snapshot file
// Auto-compute version number (max existing + 1)
// Auto-compute label từ trigger
// Drop oldest nếu > 50 versions
// Return: { version: number, label: string }
```

### `get_plan_versions(missionId)`

```js
// Đọc snapshot file
// Return: PlanVersion[] (mới nhất trước) hoặc [] nếu chưa có
```

---

## Files Modified / Created

- **Modify:** `electron/ipc/mission.cjs` — thêm `save_plan_version`, `get_plan_versions` handlers; gọi `save_plan_version` tại `applyPlanToState` và `replan_mission`
- **Modify:** `src/components/mission/PlanDocument.jsx` — thêm version history panel, gọi `save_plan_version` khi apply edit
- **Create:** `src/components/mission/PlanVersionHistory.jsx` — timeline + diff viewer component
- **Modify:** `electron/ipc/mission.cjs` — IPC handler registration

---

## UI: Version History Panel

Nằm trong `PlanDocument.jsx`, toggle bằng button "Lịch sử" (Clock icon) ở toolbar. Panel slide in từ phải, width ~320px, không che editor.

**Timeline list:**
```
● Chỉnh sửa lúc 14:32        [Xem diff] [Khôi phục]
● Replan #2 — 13:55           [Xem diff] [Khôi phục]
● Replan #1 — 13:20           [Xem diff] [Khôi phục]
● Plan ban đầu — 13:00        (current base)
```

**Diff view** (khi click "Xem diff"):
- So sánh version được chọn với version hiện tại (latest)
- Dùng `diffPlanChanges(selectedVersion, currentPlan)`
- Hiển thị 2 cột: **Trước** (version cũ) | **Sau** (version hiện tại)
- Màu: added=xanh lá (`bg-green-500/10 border-green-500/30`), removed=đỏ (`bg-red-500/10 border-red-500/30`), modified=vàng (`bg-yellow-500/10 border-yellow-500/30`)
- Summary line: `"+2 task mới, 1 agent sửa"`

**Rollback:**
- Click "Khôi phục" → confirm dialog: `"Khôi phục về [label]? Thao tác này sẽ tạo version mới."`
- Confirm → gọi `save_plan_version(id, 'rollback', selectedVersion.agents, selectedVersion.tasks)` → apply vào missionState

---

## `PlanVersionHistory` Component

```jsx
// Props:
// missionId: string
// currentAgents: Agent[]
// currentTasks: Task[]
// onRollback: (agents, tasks) => void

// Internal state:
// versions: PlanVersion[]
// selectedVersion: PlanVersion | null  (for diff view)
// showDiff: boolean
```

---

## Testing Checklist

- [ ] Version `initial` được tạo khi plan parse lần đầu
- [ ] Version `replan` được tạo khi Lead gửi plan mới
- [ ] Version `manual_edit` được tạo khi user apply edit (Ctrl+S)
- [ ] Panel "Lịch sử" toggle đúng
- [ ] Timeline hiện đúng thứ tự (mới nhất trên)
- [ ] Diff hiện added/removed/modified với màu đúng
- [ ] Summary line đúng (`diffPlanChanges` output)
- [ ] Rollback tạo version mới (không overwrite)
- [ ] Rollback apply đúng agents/tasks vào missionState
- [ ] Rollback confirm dialog hiện trước khi execute
- [ ] Không vượt quá 50 versions (oldest dropped)
- [ ] Reload app vẫn giữ version history (persisted trong snapshot)
