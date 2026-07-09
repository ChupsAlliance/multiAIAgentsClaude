# Export Nhiều Format — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay nút "Xuất MD" bằng dropdown "Xuất" với 4 format: Markdown (đã có), JSON, HTML (self-contained), PDF (Electron printToPDF).

**Architecture:** `src/utils/exportPlan.js` chứa utility functions. `ExportDropdown.jsx` là UI component. Markdown IPC giữ nguyên. PDF qua IPC handler mới `export_plan_pdf`. JSON và HTML download client-side.

**Tech Stack:** React 19, Electron `printToPDF()`, Tailwind CSS, Lucide icons. Không thêm npm package.

## Global Constraints

- Không break `export_plan_markdown` IPC handler hiện có
- File naming: `<slug>-<YYYY-MM-DD>.<ext>` — slug: lowercase, spaces→dashes, max 40 chars, bỏ ký tự đặc biệt
- HTML: self-contained, inline CSS, readable offline
- JSON: include `{ id, description, project_path, status, phase, agents, tasks, log, file_changes, plan_versions, started_at, ended_at }`
- PDF: native save dialog
- UI text: tiếng Việt
- Không thêm npm package

---

## File Structure

- **Create:** `src/utils/exportPlan.js` — generateSlug, generateFilename, generateHTML, downloadBlob, downloadJSON, downloadHTML
- **Create:** `src/components/mission/ExportDropdown.jsx` — dropdown UI component
- **Modify:** `src/components/mission/PlanDocument.jsx` — replace "Xuất MD" button với ExportDropdown
- **Modify:** `electron/ipc/mission.cjs` — thêm `export_plan_pdf` handler

---

### Task 1: `exportPlan.js` utilities

**Files:**
- Create: `src/utils/exportPlan.js`

**Interfaces:**
- Produces: `generateSlug(description)` → string
- Produces: `generateFilename(description, ext)` → string
- Produces: `generateHTML(missionState)` → string (full HTML doc)
- Produces: `downloadBlob(blob, filename)` → void
- Produces: `downloadJSON(missionState)` → void
- Produces: `downloadHTML(missionState)` → void

- [ ] **Step 1: Viết failing tests**

```js
// src/utils/exportPlan.test.js
import { describe, it, expect } from 'vitest'
import { generateSlug, generateFilename, generateHTML, downloadBlob } from './exportPlan'

describe('generateSlug', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(generateSlug('Build Auth System')).toBe('build-auth-system')
  })
  it('strips special characters', () => {
    expect(generateSlug('Fix bug: #123 (urgent!)')).toBe('fix-bug-123-urgent')
  })
  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(60)
    expect(generateSlug(long).length).toBeLessThanOrEqual(40)
  })
  it('handles empty string', () => {
    expect(generateSlug('')).toBe('mission')
  })
})

describe('generateFilename', () => {
  it('formats correctly', () => {
    const filename = generateFilename('Build Auth', 'pdf')
    expect(filename).toMatch(/^build-auth-\d{4}-\d{2}-\d{2}\.pdf$/)
  })
})

describe('generateHTML', () => {
  it('returns valid HTML string', () => {
    const state = {
      description: 'Test mission',
      project_path: '/home/user/project',
      status: 'Done',
      phase: 'Done',
      agents: [{ name: 'Agent1', role: 'Developer', model: 'sonnet', status: 'Done' }],
      tasks: [{ id: 'task-0', title: 'Task 1', why: 'reason', detail: '', depends_on: [], status: 'completed', assigned_agent: 'Agent1' }],
      log: [],
      file_changes: [],
      plan_versions: [],
      started_at: Date.now(),
      ended_at: null,
    }
    const html = generateHTML(state)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Test mission')
    expect(html).toContain('Agent1')
    expect(html).toContain('Task 1')
  })
})
```

- [ ] **Step 2: Chạy test để verify fail**

```bash
npx vitest run src/utils/exportPlan.test.js
```

Expected: FAIL với "Cannot find module './exportPlan'"

- [ ] **Step 3: Implement `exportPlan.js`**

```js
// src/utils/exportPlan.js

export function generateSlug(description) {
  if (!description?.trim()) return 'mission'
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // strip special chars
    .replace(/\s+/g, '-')           // spaces → dashes
    .replace(/-+/g, '-')            // collapse multiple dashes
    .slice(0, 40)
    .replace(/-$/, '')              // trailing dash
}

export function generateFilename(description, ext) {
  const slug = generateSlug(description)
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return `${slug}-${date}.${ext}`
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadJSON(missionState) {
  const { id, description, project_path, status, phase, agents, tasks,
          log, file_changes, plan_versions, started_at, ended_at } = missionState
  const data = { id, description, project_path, status, phase, agents, tasks,
                 log, file_changes, plan_versions, started_at, ended_at }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, generateFilename(description, 'json'))
}

export function generateHTML(missionState) {
  const { description, project_path, status, agents = [], tasks = [], plan_versions = [], started_at } = missionState
  const date = started_at ? new Date(started_at).toLocaleDateString('vi-VN') : ''

  const agentRows = agents.map(a =>
    `<tr><td>${a.name}</td><td>${a.role}</td><td>${a.model || '—'}</td><td>${a.status}</td></tr>`
  ).join('')

  const taskRows = tasks.map(t => `
    <div class="task">
      <div class="task-title">${t.title} <span class="badge ${t.status}">${t.status}</span></div>
      ${t.why ? `<div class="task-why">${t.why}</div>` : ''}
      ${t.depends_on?.length ? `<div class="task-deps">Phụ thuộc: ${t.depends_on.join(', ')}</div>` : ''}
      ${t.assigned_agent ? `<div class="task-agent">Agent: ${t.assigned_agent}</div>` : ''}
    </div>
  `).join('')

  const versionRows = plan_versions.length ? plan_versions.map(v =>
    `<tr><td>${v.version}</td><td>${v.label}</td><td>${new Date(v.timestamp).toLocaleString('vi-VN')}</td></tr>`
  ).join('') : ''

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>${description || 'Mission Plan'}</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; background: #1e1e2e; color: #cdd6f4; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { color: #89b4fa; font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { color: #89b4fa; font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #313244; padding-bottom: 0.25rem; }
  .meta { color: #6c7086; font-size: 0.85rem; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
  th { background: #313244; padding: 0.5rem; text-align: left; color: #89b4fa; }
  td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #313244; }
  .task { background: #313244; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
  .task-title { font-weight: 600; margin-bottom: 0.25rem; }
  .task-why { color: #6c7086; font-size: 0.8rem; }
  .task-deps { color: #fab387; font-size: 0.8rem; margin-top: 0.25rem; }
  .task-agent { color: #a6e3a1; font-size: 0.8rem; }
  .badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
  .badge.completed { background: #a6e3a1; color: #1e1e2e; }
  .badge.in_progress { background: #89b4fa; color: #1e1e2e; }
  .badge.pending { background: #6c7086; color: #1e1e2e; }
</style>
</head>
<body>
<h1>${description || 'Mission Plan'}</h1>
<div class="meta">Project: ${project_path || '—'} | Ngày: ${date} | Status: ${status || '—'}</div>

<h2>Agents (${agents.length})</h2>
<table>
  <thead><tr><th>Tên</th><th>Vai trò</th><th>Model</th><th>Trạng thái</th></tr></thead>
  <tbody>${agentRows}</tbody>
</table>

<h2>Tasks (${tasks.length})</h2>
${taskRows || '<p style="color:#6c7086">Chưa có tasks</p>'}

${plan_versions.length ? `
<h2>Lịch sử version (${plan_versions.length})</h2>
<table>
  <thead><tr><th>Version</th><th>Nhãn</th><th>Thời gian</th></tr></thead>
  <tbody>${versionRows}</tbody>
</table>
` : ''}
</body>
</html>`
}

export function downloadHTML(missionState) {
  const html = generateHTML(missionState)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  downloadBlob(blob, generateFilename(missionState.description, 'html'))
}
```

- [ ] **Step 4: Chạy tests**

```bash
npx vitest run src/utils/exportPlan.test.js
```

Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/exportPlan.js src/utils/exportPlan.test.js
git commit -m "feat: add exportPlan utilities (slug, filename, HTML, JSON, download)"
```

---

### Task 2: IPC handler `export_plan_pdf`

**Files:**
- Modify: `electron/ipc/mission.cjs`

**Interfaces:**
- Consumes: `generateHTML` logic (re-implement server-side hoặc nhận HTML string từ frontend)
- Produces: IPC `export_plan_pdf({ htmlContent, description })` → `{ success, filePath }` hoặc `{ success: false, error }`

- [ ] **Step 1: Tìm nơi thêm handler và import dialog**

```bash
grep -n "^const { dialog\|ipcMain.handle('export\|BrowserWindow" electron/ipc/mission.cjs | head -10
```

Verify `dialog` và `BrowserWindow` đã được import từ `electron`. Nếu chưa, thêm vào destructure.

- [ ] **Step 2: Thêm handler**

```js
ipcMain.handle('export_plan_pdf', async (event, { htmlContent, description }) => {
  let pdfWindow = null
  try {
    // Tạo BrowserWindow ẩn
    pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
    })

    // Load HTML content
    const encoded = Buffer.from(htmlContent, 'utf-8').toString('base64')
    await pdfWindow.loadURL(`data:text/html;base64,${encoded}`)

    // Print to PDF
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
    })

    // Native save dialog
    const slug = (description || 'mission')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)
    const date = new Date().toISOString().slice(0, 10)
    const defaultFilename = `${slug}-${date}.pdf`

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })

    if (canceled || !filePath) return { success: false, error: 'cancelled' }

    await require('fs').promises.writeFile(filePath, pdfBuffer)
    return { success: true, filePath }
  } catch (err) {
    console.error('export_plan_pdf error:', err)
    return { success: false, error: err.message }
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy()
  }
})
```

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: add export_plan_pdf IPC handler using Electron printToPDF"
```

---

### Task 3: ExportDropdown component + tích hợp vào PlanDocument

**Files:**
- Create: `src/components/mission/ExportDropdown.jsx`
- Modify: `src/components/mission/PlanDocument.jsx`

**Interfaces:**
- Consumes: `downloadJSON`, `downloadHTML`, `generateHTML` từ `src/utils/exportPlan.js`
- Consumes: IPC `export_plan_markdown` (existing), IPC `export_plan_pdf` (Task 2)
- Consumes: `useToast` hook (existing pattern trong codebase)
- Produces: `<ExportDropdown missionState projectPath />` component

- [ ] **Step 1: Tìm toast pattern**

```bash
grep -n "useToast\|toast\.success\|toast\.error" src/components/mission/PlanDocument.jsx | head -5
```

Ghi nhớ cách gọi toast trong PlanDocument.

- [ ] **Step 2: Tạo ExportDropdown**

```jsx
// src/components/mission/ExportDropdown.jsx
import { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown, Loader2 } from 'lucide-react'
import { downloadJSON, downloadHTML, generateHTML, generateFilename } from '../../utils/exportPlan'

export function ExportDropdown({ missionState, projectPath, onToast }) {
  const [open, setOpen] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleMarkdown = async () => {
    setOpen(false)
    try {
      await window.electron.ipcRenderer.invoke('export_plan_markdown', {
        projectPath,
        missionId: missionState.id,
      })
      onToast?.('success', `Đã xuất ${generateFilename(missionState.description, 'md')}`)
    } catch (err) {
      onToast?.('error', `Xuất thất bại: ${err.message}`)
    }
  }

  const handleJSON = () => {
    setOpen(false)
    try {
      downloadJSON(missionState)
      onToast?.('success', `Đã xuất ${generateFilename(missionState.description, 'json')}`)
    } catch (err) {
      onToast?.('error', `Xuất thất bại: ${err.message}`)
    }
  }

  const handleHTML = () => {
    setOpen(false)
    try {
      downloadHTML(missionState)
      onToast?.('success', `Đã xuất ${generateFilename(missionState.description, 'html')}`)
    } catch (err) {
      onToast?.('error', `Xuất thất bại: ${err.message}`)
    }
  }

  const handlePDF = async () => {
    setOpen(false)
    setPdfLoading(true)
    try {
      const htmlContent = generateHTML(missionState)
      const result = await window.electron.ipcRenderer.invoke('export_plan_pdf', {
        htmlContent,
        description: missionState.description,
      })
      if (result.success) {
        onToast?.('success', `Đã xuất PDF`)
      } else if (result.error !== 'cancelled') {
        onToast?.('error', `Xuất PDF thất bại: ${result.error}`)
      }
    } catch (err) {
      onToast?.('error', `Xuất PDF thất bại: ${err.message}`)
    } finally {
      setPdfLoading(false)
    }
  }

  const items = [
    { label: 'Markdown (.md)', onClick: handleMarkdown },
    { label: 'JSON (.json)', onClick: handleJSON },
    { label: 'HTML (.html)', onClick: handleHTML },
    { label: 'PDF (.pdf)', onClick: handlePDF, loading: pdfLoading },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(prev => !prev)}
        disabled={pdfLoading}
        className="flex items-center gap-1 px-2 py-1 text-xs font-mono border border-vs-border text-vs-muted rounded hover:text-vs-text hover:border-vs-text/30 transition-colors disabled:opacity-50"
      >
        {pdfLoading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        Xuất
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-vs-surface border border-vs-border rounded-md shadow-lg z-20 overflow-hidden">
          {items.map(({ label, onClick, loading }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={loading}
              className="w-full text-left px-3 py-2 text-xs font-mono text-vs-text hover:bg-vs-accent/10 hover:text-vs-accent transition-colors disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Replace "Xuất MD" button trong PlanDocument**

```bash
grep -n "Xuất MD\|export_plan_markdown\|Download" src/components/mission/PlanDocument.jsx | head -10
```

Tìm button "Xuất MD" trong JSX, thay bằng:

```jsx
import { ExportDropdown } from './ExportDropdown'

// Trong JSX, thay button "Xuất MD":
<ExportDropdown
  missionState={missionState}
  projectPath={missionState?.project_path}
  onToast={(type, msg) => {
    if (type === 'success') toast.success('Export', msg)
    else toast.error('Export thất bại', msg)
  }}
/>
```

Xóa import `Download` từ lucide nếu không còn dùng ở nơi khác trong file.

- [ ] **Step 4: Verify**

```bash
npm run dev
```

- Dropdown "Xuất" hiện trong toolbar PlanDocument
- Click "Markdown (.md)" → file `.md` ghi ra projectPath
- Click "JSON (.json)" → browser download file json
- Click "HTML (.html)" → browser download file html, readable offline
- Click "PDF (.pdf)" → native save dialog hiện → chọn path → file pdf tạo ra
- Toast success/error hiện đúng

- [ ] **Step 5: Chạy tests**

```bash
npm test
```

Expected: tất cả pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/mission/ExportDropdown.jsx src/components/mission/PlanDocument.jsx
git commit -m "feat: add ExportDropdown with Markdown/JSON/HTML/PDF export options"
```