# Export Nhiều Format — Design Spec

> **Topic C / Feature 3:** Export plan ra Markdown, JSON, HTML, PDF

---

## Goal

Thay nút "Xuất MD" đơn lẻ bằng dropdown "Xuất" với 4 format: Markdown (đã có), JSON, HTML (self-contained), PDF (qua Electron).

## Architecture

- Client-side: JSON và HTML export qua `<a download>` pattern (không cần IPC)
- Markdown: giữ nguyên IPC `export_plan_markdown` đã có
- PDF: IPC handler mới `export_plan_pdf` — backend tạo `BrowserWindow` ẩn, load HTML, gọi `printToPDF()`
- UI: dropdown button thay thế nút "Xuất MD" trong toolbar `PlanDocument.jsx`

## Tech Stack

React 19, Electron `printToPDF()`, Tailwind CSS, Lucide icons. Không thêm npm package mới.

---

## Global Constraints

- Không break `export_plan_markdown` IPC handler hiện có
- File naming: `<slug-of-description>-<YYYY-MM-DD>.<ext>`
  - Slug: lowercase, spaces → dashes, bỏ ký tự đặc biệt, max 40 chars
  - Ví dụ: `build-auth-system-2026-07-09.pdf`
- HTML export: self-contained (inline CSS, không external deps, readable offline)
- JSON export: include toàn bộ `missionState` (agents, tasks, log, file_changes, plan_versions)
- PDF: user chọn save location qua native dialog (`dialog.showSaveDialog`)
- UI text: tiếng Việt

---

## Export Formats

### Markdown (đã có)

IPC `export_plan_markdown` — ghi ra `<projectPath>/.claude-agent-team/mission-plan.md`. Giữ nguyên.

### JSON

Client-side, không cần IPC:
```js
const blob = new Blob([JSON.stringify(missionState, null, 2)], { type: 'application/json' })
const url = URL.createObjectURL(blob)
// trigger <a download={filename} href={url}> click
```

Include: `{ id, description, project_path, status, phase, agents, tasks, log, file_changes, plan_versions, started_at, ended_at }`

### HTML

Client-side, template string với inline CSS. Structure:
```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>{description}</title>
  <style>/* inline styles — dark theme matching app */</style>
</head>
<body>
  <h1>{description}</h1>
  <p>Project: {project_path} | Ngày: {date} | Status: {status}</p>

  <h2>Agents ({count})</h2>
  <table>...agent rows (name, role, model, status)...</table>

  <h2>Tasks ({count})</h2>
  <!-- mỗi task: title, why, detail, depends_on, assigned_agent, status -->

  <h2>Lịch sử version ({count})</h2>
  <!-- nếu plan_versions có data -->
</body>
</html>
```

### PDF

IPC `export_plan_pdf(missionId)`:
1. Frontend gọi IPC với `missionState` serialized
2. Backend tạo `BrowserWindow({ show: false, webPreferences: { offscreen: true } })`
3. Load HTML string (cùng template với HTML export) qua `loadURL('data:text/html,...')`
4. Sau `did-finish-load` → gọi `contents.printToPDF({ printBackground: true, pageSize: 'A4' })`
5. Gọi `dialog.showSaveDialog` để user chọn path
6. Ghi file, destroy BrowserWindow
7. Return `{ success: true, filePath }` hoặc `{ success: false, error }`

---

## Files Modified / Created

- **Modify:** `src/components/mission/PlanDocument.jsx` — thay nút "Xuất MD" bằng `ExportDropdown`
- **Create:** `src/components/mission/ExportDropdown.jsx` — dropdown với 4 options, logic client-side export
- **Create:** `src/utils/exportPlan.js` — `generateSlug(desc)`, `generateHTML(missionState)`, `downloadJSON(missionState)`, `downloadHTML(missionState)`
- **Modify:** `electron/ipc/mission.cjs` — thêm `export_plan_pdf` handler

---

## `ExportDropdown` Component

```jsx
// Props:
// missionState: object
// projectPath: string

// Dropdown items:
// - "Markdown (.md)" → invoke existing export_plan_markdown IPC
// - "JSON (.json)"   → downloadJSON(missionState)
// - "HTML (.html)"   → downloadHTML(missionState)
// - "PDF (.pdf)"     → invoke export_plan_pdf IPC, show loading state

// Loading state: PDF export có thể mất 2-3s
// Success toast: "Đã xuất [filename]"
// Error toast: "Xuất thất bại: [error]"
```

**UI:**
```
[↓ Xuất ▾]
  ├ Markdown (.md)
  ├ JSON (.json)
  ├ HTML (.html)
  └ PDF (.pdf)
```

Dropdown dùng Headless UI pattern (div + absolute positioning), close khi click outside hoặc Escape.

---

## `exportPlan.js` Utilities

```js
export function generateSlug(description)  // → string (lowercase, dashes, max 40)
export function generateFilename(description, ext)  // → "slug-YYYY-MM-DD.ext"
export function generateHTML(missionState)  // → string (full HTML document)
export function downloadBlob(blob, filename)  // → void (trigger download)
export function downloadJSON(missionState)  // → void
export function downloadHTML(missionState)  // → void
```

---

## Testing Checklist

- [ ] Dropdown mở khi click "Xuất"
- [ ] Dropdown đóng khi click outside hoặc Escape
- [ ] Markdown export ghi đúng file (behavior cũ unchanged)
- [ ] JSON export download file với đúng filename
- [ ] JSON content chứa agents, tasks, log, file_changes
- [ ] HTML export download file self-contained (readable offline)
- [ ] HTML hiện đúng agents table, tasks list, plan versions
- [ ] PDF export mở native save dialog
- [ ] PDF file readable (không blank, không crash)
- [ ] PDF export hiện loading state trong khi xử lý
- [ ] Success/error toast hiện sau export
- [ ] Filename slug đúng format (`build-auth-2026-07-09.pdf`)
- [ ] Ký tự đặc biệt trong description được strip khỏi slug
