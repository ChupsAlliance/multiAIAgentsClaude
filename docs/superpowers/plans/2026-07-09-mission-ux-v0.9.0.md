# Mission UX v0.9.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cải thiện 3 UX điểm trong Mission workflow: history search/filter, question flow progress indicator, và agent stuck detection.

**Architecture:** Pure frontend cho features 1 & 2. Backend-assisted cho feature 3: `electron/ipc/mission.cjs` emit `mission:agent-stuck` event, frontend listen và hiển thị visual warning trên `AgentCard`.

**Tech Stack:** React 19, Electron IPC (CommonJS), Tailwind CSS, Lucide icons, existing `useToast` hook

## Global Constraints

- Không break bất kỳ feature hiện có: ToastProvider, PlanningStream timer, agent retry button
- Tất cả UI text mới phải tiếng Việt (consistent với codebase)
- Không thêm npm package mới
- `stuckWarning` field chỉ tồn tại trong frontend state, không persist vào backend
- Stuck checker emit không spam: interval 15s, thresholds 60s (no_log) và 90s (task_frozen)
- Spec: `docs/superpowers/specs/2026-07-09-mission-ux-v0.9.0-design.md`

---

## File Map

| File | Thay đổi |
|------|----------|
| `src/components/mission/MissionLauncher.jsx` | Thêm history search/filter UI + logic |
| `src/components/mission/QuestionCard.jsx` | Enhance step indicator + auto-advance + progress bar |
| `electron/ipc/mission.cjs` | Thêm agent activity tracker + stuck checker interval |
| `src/hooks/useMission.js` | Listen `mission:agent-stuck`, update `stuckWarning` state |
| `src/components/mission/AgentCard.jsx` | Hiển thị visual warning khi `agent.stuckWarning` |

---

## Task 1: History Search/Filter trong MissionLauncher

**Files:**
- Modify: `src/components/mission/MissionLauncher.jsx`

**Interfaces:**
- Consumes: `history` state (array of `{ description, project_path, team_size, timestamp }`) — đã có sẵn
- Produces: filtered history list hiển thị trong UI

- [ ] **Step 1: Thêm 2 state mới và computed values**

Trong `MissionLauncher`, sau dòng `const [showAllHistory, setShowAllHistory] = useState(false)`:

```js
const [historySearch, setHistorySearch] = useState('')
const [historyProjectFilter, setHistoryProjectFilter] = useState('all')
```

Ngay trước `return (`, thêm 2 computed values:

```js
const uniqueProjects = [...new Set(history.map(e => e.project_path).filter(Boolean))]

const filteredHistory = history.filter(entry => {
  const matchSearch = !historySearch.trim() ||
    entry.description?.toLowerCase().includes(historySearch.toLowerCase()) ||
    entry.project_path?.toLowerCase().includes(historySearch.toLowerCase())
  const matchProject = historyProjectFilter === 'all' ||
    entry.project_path === historyProjectFilter
  return matchSearch && matchProject
})
```

- [ ] **Step 2: Thêm `Search` vào import từ lucide-react**

Tìm dòng import lucide-react và thêm `Search`:

```js
import { Rocket, FolderOpen, Zap, History, Trash2, Cpu, Eye, EyeOff, Users,
  FlaskConical, Paperclip, FileText, Image, Folder, Upload, X, AtSign,
  Shield, ShieldCheck, ShieldQuestion, Brain, Search } from 'lucide-react'
```

- [ ] **Step 3: Cập nhật header label và thêm search UI**

Tìm đoạn History section (bắt đầu bằng `{history.length > 0 && (`). Thay dòng header `<p className="text-[10px]...">`:

```jsx
<p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono flex items-center gap-1.5 px-1">
  <History size={10} />
  {(historySearch.trim() || historyProjectFilter !== 'all')
    ? `Lịch sử (${filteredHistory.length}/${history.length})`
    : `Lịch sử (${history.length})`
  }
</p>
```

Ngay sau `<div className="space-y-1">` (container của các history entries), thêm search/filter row TRƯỚC danh sách entries:

```jsx
{/* Search + Filter row */}
<div className="flex gap-2 mb-2">
  <div className="relative flex-1">
    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-vs-muted pointer-events-none" />
    <input
      type="text"
      value={historySearch}
      onChange={e => setHistorySearch(e.target.value)}
      placeholder="Tìm mission..."
      className="w-full pl-7 pr-3 py-1.5 bg-vs-bg border border-vs-border rounded-md
                 text-xs font-mono text-vs-text placeholder-vs-muted/50
                 focus:outline-none focus:border-vs-accent/60"
    />
  </div>
  {uniqueProjects.length > 1 && (
    <select
      value={historyProjectFilter}
      onChange={e => setHistoryProjectFilter(e.target.value)}
      className="bg-vs-bg border border-vs-border rounded-md px-2 py-1.5
                 text-xs font-mono text-vs-muted focus:outline-none focus:border-vs-accent/60"
    >
      <option value="all">Tất cả projects</option>
      {uniqueProjects.map(p => (
        <option key={p} value={p}>{p.split(/[/\\]/).pop()}</option>
      ))}
    </select>
  )}
</div>
```

- [ ] **Step 4: Dùng `filteredHistory` thay vì `history` khi render entries**

Tìm dòng:
```jsx
{(showAllHistory ? history : history.slice(0, 5)).map((entry, i) => (
```
Thay bằng:
```jsx
{(showAllHistory ? filteredHistory : filteredHistory.slice(0, 5)).map((entry, i) => (
```

Tìm dòng hiển thị "Xem tất cả":
```jsx
{history.length > 5 && (
```
Thay bằng:
```jsx
{filteredHistory.length > 5 && (
```

Và dòng text bên trong:
```jsx
{showAllHistory ? 'Thu gọn' : `Xem tất cả (${history.length})`}
```
Thay bằng:
```jsx
{showAllHistory ? 'Thu gọn' : `Xem tất cả (${filteredHistory.length})`}
```

- [ ] **Step 5: Thêm empty state khi filter không có kết quả**

Ngay sau search/filter row (trước map entries), thêm:

```jsx
{filteredHistory.length === 0 && (
  <p className="text-[10px] text-vs-muted font-mono text-center py-3">
    Không tìm thấy mission nào
  </p>
)}
```

- [ ] **Step 6: Chạy app và verify thủ công**

```bash
npm run electron:dev
```

Kiểm tra:
- Gõ keyword trong search → entries filter real-time
- Select project từ dropdown → chỉ hiện project đó
- Header badge hiện `"(2/5)"` khi đang filter
- Empty state hiện khi không có kết quả
- Xóa search text → hiện lại toàn bộ

- [ ] **Step 7: Commit**

```bash
git add src/components/mission/MissionLauncher.jsx
git commit -m "feat: add history search/filter to MissionLauncher"
```

---

## Task 2: Question Flow Progress — Step Indicator

**Files:**
- Modify: `src/components/mission/QuestionCard.jsx`

**Interfaces:**
- Consumes: `questions` array, `activeIndex` state — đã có sẵn trong component
- Produces: enhanced `QuestionTab` với dots, header text Vietnamese, progress bar, auto-advance

- [ ] **Step 1: Cập nhật `QuestionTab` component**

Tìm function `QuestionTab` (lines 16-33 trong file hiện tại). Thay toàn bộ function bằng:

```jsx
function QuestionTab({ index, question, answer, isActive, onClick }) {
  const answered = answer != null && answer !== ''
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
        isActive
          ? 'bg-vs-accent/20 border border-vs-accent text-white'
          : answered
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-vs-bg border border-vs-border text-vs-muted hover:border-vs-text/30 hover:text-vs-text'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${
        answered ? 'bg-green-400' : isActive ? 'bg-vs-accent' : 'bg-vs-border'
      }`} />
      {answered
        ? <CheckCircle size={10} />
        : <span className="text-[11px]">Q{index + 1}</span>
      }
    </button>
  )
}
```

- [ ] **Step 2: Cập nhật import — bỏ `Circle`**

Tìm dòng:
```js
import { HelpCircle, CheckCircle, Circle, SkipForward, Send, AlertCircle } from 'lucide-react'
```
Thay bằng:
```js
import { HelpCircle, CheckCircle, SkipForward, Send, AlertCircle } from 'lucide-react'
```

- [ ] **Step 3: Cập nhật header text sang Vietnamese**

Tìm trong JSX return, đoạn header với:
```jsx
<span className="text-sm font-semibold text-amber-300">
  Lead has {questions.length} question{questions.length > 1 ? 's' : ''}
</span>
```
Thay bằng:
```jsx
<span className="text-sm font-semibold text-amber-300">
  {answeredCount === questions.length
    ? `Đã trả lời ${answeredCount}/${questions.length} câu`
    : `Lead đang hỏi câu ${activeIndex + 1}/${questions.length}`
  }
</span>
```

- [ ] **Step 4: Thêm progress bar sau tab switcher**

Tìm closing `</div>` của tab switcher block (`{questions.length > 1 && (...)}`) — ngay sau `</div>` đó, thêm:

```jsx
{/* Progress bar */}
<div className="h-0.5 bg-vs-border/30">
  <div
    className="h-full bg-vs-accent transition-all duration-300"
    style={{ width: `${(answeredCount / questions.length) * 100}%` }}
  />
</div>
```

- [ ] **Step 5: Thêm auto-advance sau khi chọn option**

Tìm function `handleSelectOption`:
```js
const handleSelectOption = (option) => {
  setAnswer(activeIndex, { selectedOption: option, skipped: false })
}
```
Thay bằng:
```js
const handleSelectOption = (option) => {
  setAnswer(activeIndex, { selectedOption: option, skipped: false })
  // Auto-advance to next unanswered question after brief delay
  const next = answers.findIndex((a, i) =>
    i > activeIndex && !a.skipped && a.selectedOption == null && !a.freeText.trim()
  )
  if (next !== -1) setTimeout(() => setActiveIndex(next), 150)
}
```

- [ ] **Step 6: Verify thủ công trong app**

Kiểm tra với một mission Deep Plan (có multiple questions):
- Header hiện `"Lead đang hỏi câu 1/3"`
- Chọn option ở Q1 → tự động nhảy sang Q2 sau 150ms
- Dot tab Q1 đổi màu xanh lá + CheckCircle icon
- Progress bar tăng sau mỗi câu trả lời
- Header đổi thành `"Đã trả lời 3/3 câu"` khi xong hết

- [ ] **Step 7: Commit**

```bash
git add src/components/mission/QuestionCard.jsx
git commit -m "feat: enhance QuestionCard with step indicators, progress bar, and auto-advance"
```

---

## Task 3: Backend Agent Stuck Detection

**Files:**
- Modify: `electron/ipc/mission.cjs`

**Interfaces:**
- Consumes: `sendToWindow` function (đã có sẵn), các điểm `sendToWindow('mission:log', entry)` đã có
- Produces: emit `mission:agent-stuck` event với `{ agent, silent_ms, reason: 'no_log'|'task_frozen' }`

- [ ] **Step 1: Thêm module-level variables cho stuck detection**

Tìm đoạn module-level variables (lines 33-38 trong file hiện tại):
```js
let missionState  = null;
let childProcess  = null;
let watcherInterval = null;
let autosaveInterval = null;
let agentTeamsCompletionTimer = null;
const mockupServers = {};
```
Thêm sau đoạn đó:

```js
// ── Agent stuck detection ──
let stuckCheckerInterval = null;
const agentLastActivity = new Map();  // agentName → lastLogTimestamp (ms)
const agentLastTask = new Map();      // agentName → { text, since }
```

- [ ] **Step 2: Thêm helper `recordAgentActivity`**

Ngay sau function `inferPhase` (khoảng line 90), thêm:

```js
// ─────────────────────────────────────────────────────────────────
// recordAgentActivity — track last log timestamp + task text per agent
// Called every time a log entry with an agent field is emitted.
// ─────────────────────────────────────────────────────────────────
function recordAgentActivity(agentName, taskText) {
  agentLastActivity.set(agentName, Date.now());
  if (taskText !== undefined) {
    const prev = agentLastTask.get(agentName);
    if (!prev || prev.text !== taskText) {
      agentLastTask.set(agentName, { text: taskText, since: Date.now() });
    }
  }
}
```

- [ ] **Step 3: Thêm `startStuckChecker` và `stopStuckChecker` functions**

Ngay sau `stopAutosave` function (khoảng line 468), thêm:

```js
// ─────────────────────────────────────────────────────────────────
// startStuckChecker / stopStuckChecker
// Detects agents that go silent (60s no log) or frozen (90s same task).
// Interval: 15s. Emits mission:agent-stuck to frontend.
// ─────────────────────────────────────────────────────────────────
function startStuckChecker(sendToWindow) {
  stopStuckChecker();
  agentLastActivity.clear();
  agentLastTask.clear();
  stuckCheckerInterval = setInterval(() => {
    if (!missionState || missionState.status !== 'Running') return;
    const now_ = Date.now();
    for (const [agentName, lastSeen] of agentLastActivity) {
      const silentMs = now_ - lastSeen;
      if (silentMs >= 60_000) {
        sendToWindow('mission:agent-stuck', {
          agent: agentName,
          silent_ms: silentMs,
          reason: 'no_log',
        });
      }
      const taskInfo = agentLastTask.get(agentName);
      if (taskInfo && (now_ - taskInfo.since) >= 90_000) {
        sendToWindow('mission:agent-stuck', {
          agent: agentName,
          silent_ms: now_ - taskInfo.since,
          reason: 'task_frozen',
        });
      }
    }
  }, 15_000);
}

function stopStuckChecker() {
  if (stuckCheckerInterval !== null) {
    clearInterval(stuckCheckerInterval);
    stuckCheckerInterval = null;
  }
  agentLastActivity.clear();
  agentLastTask.clear();
}
```

- [ ] **Step 4: Gọi `startStuckChecker` khi mission bắt đầu chạy**

Tìm function `startAutosave()` call trong launch_mission handler (nơi mission bắt đầu run — khoảng sau `watcherInterval = setInterval`). Thêm ngay sau `startAutosave()`:

```js
startStuckChecker(sendToWindow);
```

- [ ] **Step 5: Gọi `stopStuckChecker` trong cleanup**

Tìm function `stopWatcher()` và `stopAutosave()` trong cleanup code (chỗ mission kết thúc, có `killChild()`). Thêm `stopStuckChecker()` ngay cạnh:

```js
stopWatcher();
stopAutosave();
stopStuckChecker();  // ← thêm dòng này
```

Có nhiều điểm cleanup trong file — tìm tất cả nơi gọi `stopWatcher()` + `stopAutosave()` cùng nhau và thêm `stopStuckChecker()` vào mỗi chỗ đó.

- [ ] **Step 6: Gọi `recordAgentActivity` tại các điểm emit mission:log có agent**

`sendToWindow('mission:log', entry)` được gọi ở nhiều nơi trong file. Chỉ cần gọi ở những nơi entry có `agent` field thực sự (không phải `System`, `User`, `Lead` trong planning). Tìm hàm `handleParsedEvent` (khoảng line 189) — đây là nơi emit log chính cho agents đang thực thi. Ngay SAU dòng `sendToWindow('mission:log', entry)` trong handleParsedEvent, thêm:

```js
if (entry.agent && entry.agent !== 'System' && entry.agent !== 'User') {
  recordAgentActivity(entry.agent, entry.message);
}
```

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: add backend agent stuck detection (60s no-log, 90s task-frozen)"
```

---

## Task 4: Frontend Stuck Warning — useMission.js + AgentCard

**Files:**
- Modify: `src/hooks/useMission.js`
- Modify: `src/components/mission/AgentCard.jsx`

**Interfaces:**
- Consumes: `mission:agent-stuck` IPC event từ backend (Task 3)
- Produces: `agent.stuckWarning: boolean` trong missionState, visual warning trong AgentCard

- [ ] **Step 1: Thêm listener `mission:agent-stuck` trong useMission.js**

Tìm block `Promise.all([...])` trong `setup()` function (khoảng line 164). Thêm vào cuối danh sách listeners, ngay trước `])`:

```js
// ── Agent stuck warning (backend-detected) ──
listen('mission:agent-stuck', (e) => {
  const { agent, silent_ms, reason } = e.payload
  const mins = Math.round(silent_ms / 60_000)
  const msg = reason === 'task_frozen'
    ? `${agent} có thể đang bị kẹt (task không đổi ${mins} phút)`
    : `${agent} không có hoạt động trong ${mins} phút`
  toast.warn('Agent có thể bị stuck', msg)

  setMissionState(prev => {
    if (!prev) return prev
    return {
      ...prev,
      agents: prev.agents.map(a =>
        a.name === agent ? { ...a, stuckWarning: true } : a
      ),
    }
  })
}),
```

- [ ] **Step 2: Clear `stuckWarning` khi agent có log mới**

Trong handler `listen('mission:log', ...)`, tìm dòng:
```js
logBuffer.current.push(entry)
```
Ngay SAU dòng đó, thêm:
```js
// Clear stuck warning khi có log mới từ agent
if (entry.agent) {
  setMissionState(prev => {
    if (!prev) return prev
    const targetAgent = prev.agents.find(a => a.name === entry.agent)
    if (!targetAgent?.stuckWarning) return prev
    return {
      ...prev,
      agents: prev.agents.map(a =>
        a.name === entry.agent ? { ...a, stuckWarning: false } : a
      ),
    }
  })
}
```

- [ ] **Step 3: Thêm `AlertTriangle` vào import trong AgentCard.jsx**

Tìm dòng import:
```js
import { Zap, Brain, Coins, ChevronDown, ChevronRight, Eye, RotateCcw } from 'lucide-react'
```
Thay bằng:
```js
import { Zap, Brain, Coins, ChevronDown, ChevronRight, Eye, RotateCcw, AlertTriangle } from 'lucide-react'
```

- [ ] **Step 4: Destructure `stuckWarning` trong AgentCard**

Tìm dòng:
```js
const { name, role, status, current_task, model } = agent
```
Thay bằng:
```js
const { name, role, status, current_task, model, stuckWarning } = agent
```

- [ ] **Step 5: Thêm stuck warning vào card border logic**

Tìm className của card wrapper div (dòng bắt đầu `<div className={`rounded-lg border...`)`). Hiện tại logic border là:
```jsx
<div className={`rounded-lg border transition-colors overflow-hidden ${
  isSelected
    ? 'border-vs-accent ring-1 ring-vs-accent/40 bg-vs-accent/10'
    : status === 'Working'
      ? 'border-vs-green/40 bg-vs-green/5'
      : status === 'Error'
        ? 'border-vs-red/40 bg-vs-red/5'
        : status === 'Done'
          ? 'border-vs-comment/30 bg-vs-comment/5'
          : 'border-vs-border bg-vs-panel'
}`}>
```
Thay bằng (thêm `stuckWarning` check trước `isSelected`):
```jsx
<div className={`rounded-lg border transition-colors overflow-hidden ${
  stuckWarning && !isSelected
    ? 'border-yellow-500/60 bg-yellow-500/5 animate-pulse-subtle'
    : isSelected
      ? 'border-vs-accent ring-1 ring-vs-accent/40 bg-vs-accent/10'
      : status === 'Working'
        ? 'border-vs-green/40 bg-vs-green/5'
        : status === 'Error'
          ? 'border-vs-red/40 bg-vs-red/5'
          : status === 'Done'
            ? 'border-vs-comment/30 bg-vs-comment/5'
            : 'border-vs-border bg-vs-panel'
}`}>
```

- [ ] **Step 6: Thêm stuck warning badge dưới `current_task`**

Tìm đoạn JSX hiển thị `current_task`:
```jsx
{current_task && (
  <div className="mt-1 px-2 py-1 bg-black/20 rounded text-[10px] text-vs-text font-mono leading-relaxed truncate overflow-hidden">
    {current_task}
  </div>
)}
```
Ngay SAU closing `)}` của block đó, thêm:
```jsx
{stuckWarning && (
  <div className="mt-1 flex items-center gap-1 text-[10px] text-yellow-400 font-mono">
    <AlertTriangle size={9} />
    Có thể bị stuck
  </div>
)}
```

- [ ] **Step 7: Verify thủ công**

Trong Electron devtools console, giả lập event:
```js
// Mở DevTools (Ctrl+Shift+I trong Electron window)
// Không thể mock IPC từ renderer, nên test bằng cách:
// 1. Chạy mission thực
// 2. Đợi backend tự emit sau 60s không có log
// Hoặc: tạm thời giảm threshold xuống 5s trong mission.cjs để test nhanh
```

Kiểm tra:
- AgentCard hiện border vàng + `"Có thể bị stuck"` badge khi event đến
- Toast warning hiện với message đúng
- Border xóa đi khi agent có log mới

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useMission.js src/components/mission/AgentCard.jsx
git commit -m "feat: add frontend stuck warning display (useMission listener + AgentCard badge)"
```

---

## Task 5: Verification — Build & Smoke Test

**Files:** Read-only verification

- [ ] **Step 1: Build production**

```bash
npm run electron:dev
```

Expected: Vite build thành công, Electron window mở.

- [ ] **Step 2: Test Feature 1 — History search/filter**

Mở app → tab Dashboard → nếu có history:
- Gõ text vào search box → entries filter real-time
- Chọn project từ dropdown → chỉ hiện project đó
- Combine search + filter → AND logic
- Badge "Lịch sử (X/Y)" hiện đúng
- Empty state khi filter = 0 kết quả

- [ ] **Step 3: Test Feature 2 — Question progress**

Launch một mission với Permission Mode = `Deep Plan`:
- QuestionCard header hiện `"Lead đang hỏi câu 1/X"`
- Tab dots đúng màu (grey/blue/green)
- Progress bar tăng sau mỗi câu
- Chọn option → auto-advance sau 150ms
- Header đổi khi xong hết

- [ ] **Step 4: Test Feature 3 — Stuck detection (manual)**

Tạm thời đổi threshold trong `mission.cjs` xuống 10s để test:
```js
// TEMP TEST ONLY — đổi lại sau:
if (silentMs >= 10_000) {  // was 60_000
```

Chạy mission, đợi 10s → kiểm tra toast warn + AgentCard border vàng. Sau khi xác nhận, đổi lại threshold về `60_000`.

- [ ] **Step 5: Regression check**

Verify các features cũ vẫn hoạt động:
- ToastProvider còn hoạt động (launch mission thất bại → hiện toast.error)
- PlanningStream timer còn chạy (3 phút → toast.info "Lead đang suy nghĩ...")
- Agent Retry button vẫn hiện khi agent.status = 'Error'

- [ ] **Step 6: Final commit nếu có fix nhỏ**

```bash
git add -p  # review trước khi add
git commit -m "fix: post-verification adjustments for v0.9.0"
```
