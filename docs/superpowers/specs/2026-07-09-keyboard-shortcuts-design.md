# Keyboard Shortcuts — Design Spec

> **Topic C / Feature 1:** Unified keyboard shortcut system with help overlay

---

## Goal

Thay thế các inline `addEventListener` rải rác bằng một hệ thống shortcuts tập trung, thêm shortcuts mới cho các action quan trọng, và hiện help overlay khi nhấn `?`.

## Architecture

- Thêm npm package `react-hotkeys-hook` (~3kb gzipped)
- `src/hooks/useAppHotkeys.js` — định nghĩa toàn bộ shortcuts, export registry object
- `src/components/common/ShortcutsHelpModal.jsx` — help overlay, data từ registry
- Migrate shortcuts cũ (Ctrl+S, Tab, Enter/Escape) vào hook tập trung
- Components không còn inline `window.addEventListener` cho shortcuts

## Tech Stack

React 19, `react-hotkeys-hook` v4, Tailwind CSS, Lucide icons

---

## Global Constraints

- Không break shortcuts hiện có (Ctrl+S apply plan, Tab indent, Enter/Escape inline edits)
- Text trong help overlay: tiếng Việt
- Shortcuts không fire khi focus đang ở trong `<input>`, `<textarea>`, `[contenteditable]` — trừ khi explicitly opted in
- Không thêm npm package nào khác ngoài `react-hotkeys-hook`

---

## Shortcut Registry

Định nghĩa trong `src/hooks/useAppHotkeys.js` dưới dạng array of groups:

```js
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
```

---

## Files Modified / Created

- **Create:** `src/hooks/useAppHotkeys.js`
- **Create:** `src/components/common/ShortcutsHelpModal.jsx`
- **Modify:** `src/components/mission/PlanDocument.jsx` — remove inline Ctrl+S, Tab handlers; call `useAppHotkeys`
- **Modify:** `src/components/mission/PlanReview.jsx` — remove inline Enter/Escape handlers; call `useAppHotkeys`
- **Modify:** `src/components/mission/MissionLauncher.jsx` — add Ctrl+Enter via hook
- **Modify:** `src/pages/MissionControlPage.jsx` — mount `ShortcutsHelpModal`, wire `?` toggle

---

## `useAppHotkeys` Hook

```js
// src/hooks/useAppHotkeys.js
import { useHotkeys } from 'react-hotkeys-hook'

export function useAppHotkeys({ scope, handlers }) {
  // scope: 'global' | 'plan-document' | 'plan-review' | 'mission-launcher'
  // handlers: { 'ctrl+s': fn, '?': fn, ... }
  // Each hotkey registered with enableOnFormTags: false (default)
  // Exception: ctrl+s registered with enableOnFormTags: ['INPUT', 'TEXTAREA']
}

export { SHORTCUT_GROUPS }
```

---

## `ShortcutsHelpModal` Component

- Trigger: `?` key (global, không fire khi typing trong input)
- Layout: modal overlay, centered, max-w-lg
- Content: groups từ `SHORTCUT_GROUPS`, mỗi shortcut hiện `<kbd>` styled key + description
- Close: Escape hoặc click backdrop
- Không có state server-side, chỉ `useState(isOpen)`

```jsx
// Render mỗi shortcut:
<div className="flex items-center justify-between py-1">
  <span className="text-vs-text text-sm">{description}</span>
  <kbd className="px-2 py-0.5 bg-vs-bg border border-vs-border rounded text-xs font-mono text-vs-muted">
    {keys}
  </kbd>
</div>
```

---

## Migration Map (shortcuts cũ → hook)

| File | Shortcut cũ | Migration |
|---|---|---|
| `PlanDocument.jsx:299-316` | `keydown` → Tab indent, Ctrl+S apply | Move to `useAppHotkeys({ scope: 'plan-document' })` |
| `PlanReview.jsx:91,167` | `keydown` → Enter save, Escape cancel (inline edit) | Keep inline (component-local, not global) |
| `PlanReview.jsx:553-554` | `window.addEventListener` Escape → close BulkSkillModal | Move to `useAppHotkeys` |
| `PlanReview.jsx:1069` | Enter in replan input → handleReplan | Keep inline (input-specific) |
| `PlanningStream.jsx:111` | Enter → submit mockup feedback | Keep inline (input-specific) |
| `ChangelogModal.jsx:70-71` | Escape → close | Move to `useAppHotkeys` hoặc giữ inline (acceptable) |

**Rule:** `window.addEventListener` global Escape handlers → migrate. Input-specific Enter handlers → giữ inline.

---

## Testing Checklist

- [ ] `?` hiện help overlay khi không focus input
- [ ] `?` không fire khi đang gõ trong textarea
- [ ] Escape đóng overlay
- [ ] Ctrl+S vẫn hoạt động trong PlanDocument
- [ ] Ctrl+Enter launch mission trong MissionLauncher
- [ ] `1` / `2` switch tab trong PlanReview (khi không focus input)
- [ ] `R` trigger replan (khi không focus input)
- [ ] Ctrl+D deploy (khi plan ready)
- [ ] Ctrl+E mở export menu
- [ ] Help overlay hiện đúng nhóm và phím
- [ ] Không có double-fire (cũ + mới)
