# Keyboard Shortcuts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm `react-hotkeys-hook`, tạo shortcut registry tập trung, migrate global Escape handlers, thêm shortcuts mới, và hiện help overlay khi nhấn `?`.

**Architecture:** `useAppHotkeys.js` hook export `SHORTCUT_GROUPS` registry + register hotkeys. `ShortcutsHelpModal.jsx` đọc registry để render. Components migrate `window.addEventListener` global handlers sang hook, giữ inline input-specific handlers.

**Tech Stack:** React 19, `react-hotkeys-hook` v4, Tailwind CSS, Lucide icons

## Global Constraints

- Không break shortcuts hiện có: Ctrl+S apply plan, Tab indent trong editor, Enter/Escape inline edits trong PlanReview
- Shortcuts không fire khi focus trong `<input>`, `<textarea>` — trừ `ctrl+s` (opted in)
- Text help overlay: tiếng Việt
- Chỉ thêm `react-hotkeys-hook`, không package nào khác

---

## File Structure

- **Create:** `src/hooks/useAppHotkeys.js` — SHORTCUT_GROUPS registry + useHotkeys wrappers
- **Create:** `src/components/common/ShortcutsHelpModal.jsx` — help overlay `?`
- **Modify:** `src/components/mission/PlanDocument.jsx` — remove inline keydown handler, add useAppHotkeys
- **Modify:** `src/components/mission/PlanReview.jsx` — remove global Escape handler, add useAppHotkeys
- **Modify:** `src/components/mission/MissionLauncher.jsx` — add Ctrl+Enter via hook
- **Modify:** `src/pages/MissionControlPage.jsx` — mount ShortcutsHelpModal, wire `?` toggle

---

### Task 1: Install package + tạo SHORTCUT_GROUPS registry

**Files:**
- Create: `src/hooks/useAppHotkeys.js`

**Interfaces:**
- Produces: `SHORTCUT_GROUPS` array (imported by ShortcutsHelpModal và useAppHotkeys callers)
- Produces: `useAppHotkeys({ scope, handlers })` hook

- [ ] **Step 1: Install react-hotkeys-hook**

```bash
npm install react-hotkeys-hook
```

Expected output: package added to node_modules, package.json updated.

- [ ] **Step 2: Tạo registry và hook**

```js
// src/hooks/useAppHotkeys.js
import { useHotkeys } from 'react-hotkeys-hook'

export const SHORTCUT_GROUPS = [
  {
    group: 'Toàn cục',
    shortcuts: [
      { keys: '?', description: 'Hiện danh sách phím tắt', scope: 'global' },
      { keys: 'Escape', description: 'Đóng modal / overlay', scope: 'global' },
    ],
  },
  {
    group: 'Soạn thảo Plan',
    shortcuts: [
      { keys: 'ctrl+s', description: 'Áp dụng chỉnh sửa plan', scope: 'plan-document' },
      { keys: 'ctrl+e', description: 'Mở menu xuất file', scope: 'plan-document' },
      { keys: '1', description: 'Chuyển sang tab Visual', scope: 'plan-review' },
      { keys: '2', description: 'Chuyển sang tab Document', scope: 'plan-review' },
      { keys: 'r', description: 'Replan (khi không focus input)', scope: 'plan-review' },
    ],
  },
  {
    group: 'Mission',
    shortcuts: [
      { keys: 'ctrl+enter', description: 'Launch mission', scope: 'mission-launcher' },
      { keys: 'ctrl+d', description: 'Deploy plan', scope: 'plan-review' },
    ],
  },
]

/**
 * @param {Object} params
 * @param {string} params.scope - 'global' | 'plan-document' | 'plan-review' | 'mission-launcher'
 * @param {Record<string, () => void>} params.handlers - { 'ctrl+s': fn, ... }
 */
export function useAppHotkeys({ scope, handlers }) {
  const ctrlSHandler = handlers['ctrl+s']
  const questionHandler = handlers['?']
  const escapeHandler = handlers['escape']
  const ctrlEnterHandler = handlers['ctrl+enter']
  const ctrlDHandler = handlers['ctrl+d']
  const ctrlEHandler = handlers['ctrl+e']
  const key1Handler = handlers['1']
  const key2Handler = handlers['2']
  const keyRHandler = handlers['r']

  // ctrl+s fires even inside inputs (saving plan edits)
  useHotkeys('ctrl+s', (e) => { e.preventDefault(); ctrlSHandler?.() },
    { enableOnFormTags: ['INPUT', 'TEXTAREA'], enabled: !!ctrlSHandler })

  // ? only outside inputs
  useHotkeys('shift+/', () => questionHandler?.(),
    { enableOnFormTags: false, enabled: !!questionHandler })

  useHotkeys('escape', () => escapeHandler?.(),
    { enableOnFormTags: false, enabled: !!escapeHandler })

  useHotkeys('ctrl+enter', (e) => { e.preventDefault(); ctrlEnterHandler?.() },
    { enableOnFormTags: false, enabled: !!ctrlEnterHandler })

  useHotkeys('ctrl+d', (e) => { e.preventDefault(); ctrlDHandler?.() },
    { enableOnFormTags: false, enabled: !!ctrlDHandler })

  useHotkeys('ctrl+e', (e) => { e.preventDefault(); ctrlEHandler?.() },
    { enableOnFormTags: false, enabled: !!ctrlEHandler })

  useHotkeys('1', () => key1Handler?.(),
    { enableOnFormTags: false, enabled: !!key1Handler })

  useHotkeys('2', () => key2Handler?.(),
    { enableOnFormTags: false, enabled: !!key2Handler })

  useHotkeys('r', () => keyRHandler?.(),
    { enableOnFormTags: false, enabled: !!keyRHandler })
}
```

- [ ] **Step 3: Verify no syntax errors**

```bash
node --input-type=module < src/hooks/useAppHotkeys.js 2>&1 || true
```

(Will error on React imports but proves no syntax issues up to that point — acceptable.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAppHotkeys.js package.json package-lock.json
git commit -m "feat: add useAppHotkeys hook and SHORTCUT_GROUPS registry"
```

---

### Task 2: ShortcutsHelpModal component

**Files:**
- Create: `src/components/common/ShortcutsHelpModal.jsx`

**Interfaces:**
- Consumes: `SHORTCUT_GROUPS` from `src/hooks/useAppHotkeys.js`
- Produces: `<ShortcutsHelpModal isOpen={bool} onClose={fn} />` component

- [ ] **Step 1: Tạo component**

```jsx
// src/components/common/ShortcutsHelpModal.jsx
import { SHORTCUT_GROUPS } from '../../hooks/useAppHotkeys'

export function ShortcutsHelpModal({ isOpen, onClose }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-vs-surface border border-vs-border rounded-lg shadow-xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-vs-border">
          <h2 className="text-sm font-semibold text-vs-text font-mono">Phím tắt</h2>
          <button
            onClick={onClose}
            className="text-vs-muted hover:text-vs-text transition-colors text-xs font-mono"
          >
            Esc
          </button>
        </div>

        {/* Groups */}
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map(({ group, shortcuts }) => (
            <div key={group}>
              <h3 className="text-[10px] font-semibold text-vs-muted uppercase tracking-wider mb-2 font-mono">
                {group}
              </h3>
              <div className="space-y-1">
                {shortcuts.map(({ keys, description }) => (
                  <div key={keys} className="flex items-center justify-between py-1">
                    <span className="text-sm text-vs-text font-mono">{description}</span>
                    <kbd className="px-2 py-0.5 bg-vs-bg border border-vs-border rounded text-xs font-mono text-vs-muted">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/common/ShortcutsHelpModal.jsx
git commit -m "feat: add ShortcutsHelpModal help overlay component"
```

---

### Task 3: Mount modal + wire `?` toggle trong MissionControlPage

**Files:**
- Modify: `src/pages/MissionControlPage.jsx`

**Interfaces:**
- Consumes: `ShortcutsHelpModal` from Task 2
- Consumes: `useAppHotkeys` from Task 1

- [ ] **Step 1: Đọc file hiện tại**

```bash
# Xem imports và return JSX của MissionControlPage
head -50 src/pages/MissionControlPage.jsx
```

- [ ] **Step 2: Thêm import và state**

Tìm phần imports ở đầu file, thêm:
```js
import { useState } from 'react'
import { ShortcutsHelpModal } from '../components/common/ShortcutsHelpModal'
import { useAppHotkeys } from '../hooks/useAppHotkeys'
```

Trong component function, thêm state và hook:
```js
const [showShortcuts, setShowShortcuts] = useState(false)

useAppHotkeys({
  scope: 'global',
  handlers: {
    '?': () => setShowShortcuts(prev => !prev),
    'escape': () => setShowShortcuts(false),
  },
})
```

- [ ] **Step 3: Mount modal trong JSX**

Ngay trước closing tag của return JSX, thêm:
```jsx
<ShortcutsHelpModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
```

- [ ] **Step 4: Chạy app kiểm tra**

```bash
npm run dev
```

Nhấn `?` → overlay hiện. Nhấn Escape → overlay đóng. Click backdrop → overlay đóng.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MissionControlPage.jsx
git commit -m "feat: wire ? shortcut to open ShortcutsHelpModal in MissionControlPage"
```

---

### Task 4: Migrate PlanDocument global keydown → useAppHotkeys + thêm Ctrl+E

**Files:**
- Modify: `src/components/mission/PlanDocument.jsx`

**Interfaces:**
- Consumes: `useAppHotkeys` from Task 1

- [ ] **Step 1: Tìm inline keydown handler trong PlanDocument**

```bash
grep -n "keydown\|addEventListener\|ctrl.*s\|handleApply" src/components/mission/PlanDocument.jsx | head -20
```

- [ ] **Step 2: Xóa inline keydown handler**

Tìm block `useEffect` có `addEventListener('keydown', ...)` xử lý Ctrl+S và Tab. Xóa toàn bộ `useEffect` đó.

- [ ] **Step 3: Thêm import và useAppHotkeys**

```js
import { useAppHotkeys } from '../../hooks/useAppHotkeys'
```

Trong component, sau các state declarations, thêm:
```js
useAppHotkeys({
  scope: 'plan-document',
  handlers: {
    'ctrl+s': () => handleApply(),
    'ctrl+e': () => setShowExportMenu(prev => !prev), // Task sẽ được dùng sau khi ExportDropdown được thêm (Feature 3); nếu chưa có thì no-op
  },
})
```

Note: `Tab` indent handler là textarea-specific (fired on the textarea element itself), giữ nguyên inline trên `onKeyDown` của `<textarea>` — không phải global handler.

- [ ] **Step 4: Verify Ctrl+S vẫn hoạt động**

```bash
npm run dev
```

Mở PlanDocument, sửa một dòng, nhấn Ctrl+S → plan apply. Không có double-fire.

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/PlanDocument.jsx
git commit -m "refactor: migrate PlanDocument Ctrl+S to useAppHotkeys, add Ctrl+E slot"
```

---

### Task 5: Migrate PlanReview global Escape + thêm shortcuts mới

**Files:**
- Modify: `src/components/mission/PlanReview.jsx`

**Interfaces:**
- Consumes: `useAppHotkeys` from Task 1

- [ ] **Step 1: Tìm global Escape handler trong PlanReview**

```bash
grep -n "addEventListener\|removeEventListener\|keydown\|Escape" src/components/mission/PlanReview.jsx | head -20
```

- [ ] **Step 2: Xóa global Escape handler cho BulkSkillModal**

Tìm `useEffect` có `window.addEventListener('keydown', ...)` xử lý Escape để close BulkSkillModal (khoảng line 553-554). Xóa `useEffect` đó.

Inline Enter/Escape trong task title edit (onKeyDown trên input) — giữ nguyên, không migrate.

- [ ] **Step 3: Thêm import và useAppHotkeys**

```js
import { useAppHotkeys } from '../../hooks/useAppHotkeys'
```

Trong component, thêm:
```js
useAppHotkeys({
  scope: 'plan-review',
  handlers: {
    'escape': () => {
      setShowBulkSkillModal(false)
      // đóng bất kỳ modal nào đang mở trong PlanReview
    },
    '1': () => onTabChange?.('visual'),   // hoặc setActiveTab('visual') nếu state nội bộ
    '2': () => onTabChange?.('document'),
    'r': () => canReplan && handleReplan(),
    'ctrl+d': () => canDeploy && handleDeploy(),
  },
})
```

Thay `onTabChange`, `canReplan`, `canDeploy`, `handleReplan`, `handleDeploy` bằng tên thật trong file.

- [ ] **Step 4: Verify không double-fire**

```bash
npm run dev
```

Trong PlanReview: nhấn `1` → switch Visual tab. Nhấn `2` → switch Document tab. Nhấn Escape khi BulkSkillModal mở → modal đóng. Gõ `1` trong một input → không switch tab.

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/PlanReview.jsx
git commit -m "refactor: migrate PlanReview global Escape to useAppHotkeys, add 1/2/r/ctrl+d shortcuts"
```

---

### Task 6: Thêm Ctrl+Enter trong MissionLauncher

**Files:**
- Modify: `src/components/mission/MissionLauncher.jsx`

**Interfaces:**
- Consumes: `useAppHotkeys` from Task 1

- [ ] **Step 1: Tìm hàm launch trong MissionLauncher**

```bash
grep -n "handleLaunch\|handleSubmit\|launch_mission\|onLaunch" src/components/mission/MissionLauncher.jsx | head -10
```

- [ ] **Step 2: Thêm import và hook**

```js
import { useAppHotkeys } from '../../hooks/useAppHotkeys'
```

Trong component:
```js
useAppHotkeys({
  scope: 'mission-launcher',
  handlers: {
    'ctrl+enter': () => canLaunch && handleLaunch(),
  },
})
```

Thay `canLaunch` và `handleLaunch` bằng tên thật (condition khi launch button enabled, và hàm submit).

- [ ] **Step 3: Verify**

```bash
npm run dev
```

Trong MissionLauncher: điền description + project path → Ctrl+Enter → launch bắt đầu. Khi chưa điền đủ → Ctrl+Enter no-op.

- [ ] **Step 4: Chạy tests**

```bash
npm test
```

Expected: 61 passed (hoặc nhiều hơn nếu có tests mới).

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/MissionLauncher.jsx
git commit -m "feat: add Ctrl+Enter to launch mission via useAppHotkeys"
```