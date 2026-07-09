# Mission UX v0.9.0 — Design Spec

> **Topic B:** History search/filter · Question flow progress · Agent stuck detection

---

## Goal

Cải thiện 3 điểm UX quan trọng trong Mission workflow:
1. **History search/filter** — tìm kiếm và lọc lịch sử missions nhanh hơn
2. **Question flow progress** — hiển thị rõ tiến trình Q&A (`"Lead đang hỏi câu 2/3"`)
3. **Agent stuck detection** — phát hiện nhạy hơn khi agent không hoạt động

## Architecture

- Features 1 & 2: pure frontend, không chạm backend
- Feature 3: hybrid — backend emit `mission:agent-stuck` event, frontend listen + hiển thị visual warning
- Approach B (backend-assisted) được chọn cho stuck detection vì chính xác hơn pure timer

## Tech Stack

React 19, Electron IPC (mission.cjs), Tailwind CSS, Lucide icons, existing `useToast` hook

---

## Global Constraints

- Không break bất kỳ feature nào hiện có (ToastProvider, PlanningStream timer, retry button)
- Tất cả UI text mới: tiếng Việt (consistent với codebase hiện tại)
- Không thêm npm package mới
- `stuckWarning` field chỉ tồn tại trong frontend state, không persist vào backend
- Stuck checker emit tối đa 1 lần per agent per 15s cycle (không spam)

---

## Feature 1: History Search/Filter

### Files Modified
- `src/components/mission/MissionLauncher.jsx`

### State
```js
const [historySearch, setHistorySearch] = useState('')
const [historyProjectFilter, setHistoryProjectFilter] = useState('all')
```

### Computed filtered list
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

### UI Structure
Nằm trong block `{history.length > 0 && (...)}`, thêm trước danh sách entries:

```jsx
{/* Search + Filter row */}
<div className="flex gap-2 mb-2">
  <div className="relative flex-1">
    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-vs-muted" />
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

Header badge đổi thành:
```jsx
// Khi đang filter: "Lịch sử (3/12)"
// Khi không filter: "Lịch sử (12)"
const historyLabel = (historySearch.trim() || historyProjectFilter !== 'all')
  ? `Lịch sử (${filteredHistory.length}/${history.length})`
  : `Lịch sử (${history.length})`
```

Empty state khi filter không có kết quả:
```jsx
{filteredHistory.length === 0 && (
  <p className="text-[10px] text-vs-muted font-mono text-center py-3">
    Không tìm thấy mission nào
  </p>
)}
```

Show/hide all dùng `filteredHistory` thay vì `history`.

### Icon import thêm
```js
import { ..., Search } from 'lucide-react'
```

---

## Feature 2: Question Flow Progress (Step Indicator)

### Files Modified
- `src/components/mission/QuestionCard.jsx`

### `QuestionTab` component — enhanced
Thay `Circle` icon bằng colored dot + số thứ tự rõ hơn:

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
      {answered ? <CheckCircle size={10} /> : <span className="text-[11px]">Q{index + 1}</span>}
    </button>
  )
}
```

### Header text — Vietnamese + context-aware
```jsx
{/* Trong header div */}
<span className="text-sm font-semibold text-amber-300">
  {answeredCount === questions.length
    ? `Đã trả lời ${answeredCount}/${questions.length} câu`
    : `Lead đang hỏi câu ${activeIndex + 1}/${questions.length}`
  }
</span>
```

### Progress bar — dưới tab row
```jsx
{/* Ngay sau closing tag của tab switcher div */}
<div className="h-0.5 bg-vs-border/30">
  <div
    className="h-full bg-vs-accent transition-all duration-300"
    style={{ width: `${(answeredCount / questions.length) * 100}%` }}
  />
</div>
```

### Auto-advance sau khi chọn option
Trong `handleSelectOption`:
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

### Icon import — thêm `CheckCircle` nếu chưa có
```js
import { HelpCircle, CheckCircle, Circle, SkipForward, Send, AlertCircle } from 'lucide-react'
// CheckCircle đã có sẵn trong import hiện tại ✓
```

---

## Feature 3: Agent Stuck Detection (Backend-assisted)

### Files Modified
- `electron/ipc/mission.cjs` — thêm activity tracker + stuck checker
- `src/hooks/useMission.js` — listen `mission:agent-stuck`, update state
- `src/components/mission/AgentCard.jsx` — visual warning khi `agent.stuckWarning`

---

### 3a. Backend: `electron/ipc/mission.cjs`

Tìm chỗ khởi tạo mission run (nơi emit `mission:log`), thêm:

```js
// ── Agent stuck detection ──
const agentLastActivity = new Map()  // agentName → lastLogTimestamp (ms)
const agentLastTask = new Map()       // agentName → { text, since }
let stuckCheckerInterval = null
let missionIsRunning = true

// Gọi hàm này mỗi khi emit một log entry có agent field:
function recordAgentActivity(agentName, currentTaskText) {
  agentLastActivity.set(agentName, Date.now())
  if (currentTaskText !== undefined) {
    const prev = agentLastTask.get(agentName)
    if (!prev || prev.text !== currentTaskText) {
      agentLastTask.set(agentName, { text: currentTaskText, since: Date.now() })
    }
  }
}

// Checker interval — chạy mỗi 15s
stuckCheckerInterval = setInterval(() => {
  if (!missionIsRunning) return
  const now = Date.now()
  for (const [agentName, lastSeen] of agentLastActivity) {
    const silentMs = now - lastSeen
    // no_log: không có log 60s+
    if (silentMs >= 60_000) {
      mainWindow.webContents.send('mission:agent-stuck', {
        agent: agentName,
        silent_ms: silentMs,
        reason: 'no_log',
      })
    }
    // task_frozen: current_task text không đổi 90s+
    const taskInfo = agentLastTask.get(agentName)
    if (taskInfo && (now - taskInfo.since) >= 90_000) {
      mainWindow.webContents.send('mission:agent-stuck', {
        agent: agentName,
        silent_ms: now - taskInfo.since,
        reason: 'task_frozen',
      })
    }
  }
}, 15_000)
```

**Cleanup** — thêm vào hàm cleanup hiện có (nơi clear các setTimeout 30s/50s):
```js
// Trong cleanup():
missionIsRunning = false
if (stuckCheckerInterval) clearInterval(stuckCheckerInterval)
agentLastActivity.clear()
agentLastTask.clear()
```

**recordAgentActivity call** — gọi ngay khi emit `mission:log` với agent field:
```js
// Ngay trước hoặc sau dòng emit mission:log:
if (logEntry.agent) recordAgentActivity(logEntry.agent, logEntry.current_task)
```

---

### 3b. Frontend: `useMission.js`

Thêm listener trong `Promise.all([...])` block:

```js
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

**Clear stuckWarning khi agent active lại** — trong handler `listen('mission:log')`, ngay sau `logBuffer.current.push(entry)`:
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

---

### 3c. Frontend: `AgentCard.jsx`

**Border + pulse khi stuck:**
```jsx
// Trong card wrapper className:
className={`... border transition-colors ${
  agent.stuckWarning
    ? 'border-yellow-500/60 animate-pulse-subtle'
    : 'border-vs-border'
}`}
```

**Warning badge** — hiện dưới dòng status/current_task:
```jsx
{agent.stuckWarning && (
  <span className="flex items-center gap-1 text-[10px] text-yellow-400 font-mono mt-0.5">
    <AlertTriangle size={9} />
    Có thể bị stuck
  </span>
)}
```

**Icon import thêm:**
```js
import { ..., AlertTriangle } from 'lucide-react'
```

---

## Testing Checklist

### Feature 1 — History search/filter
- [ ] Gõ keyword trong requirement text → filtered correctly
- [ ] Gõ keyword trong project path → filtered correctly
- [ ] Select project dropdown → chỉ hiện missions của project đó
- [ ] Combine search + filter → AND logic hoạt động
- [ ] Filter = 0 kết quả → hiện empty state message
- [ ] Header badge hiện `"(3/12)"` khi đang filter
- [ ] "Xem tất cả" / "Thu gọn" vẫn hoạt động với filtered list
- [ ] Search reset → hiện lại toàn bộ history
- [ ] History = 0 → không hiện search bar

### Feature 2 — Question progress
- [ ] Header hiện `"Lead đang hỏi câu 1/3"` khi bắt đầu
- [ ] Header cập nhật khi click tab khác
- [ ] Header hiện `"Đã trả lời 3/3 câu"` khi xong hết
- [ ] Dot màu xanh khi tab đã trả lời
- [ ] Dot màu vs-accent khi tab đang active
- [ ] Progress bar tăng theo số câu đã trả lời
- [ ] Auto-advance sang câu tiếp sau khi chọn option
- [ ] Auto-advance không xảy ra khi là câu cuối
- [ ] Skip vẫn hoạt động đúng
- [ ] Submit chỉ enable khi allAnswered

### Feature 3 — Stuck detection
- [ ] Emit `mission:agent-stuck` sau 60s không có log
- [ ] Emit với `reason: 'task_frozen'` sau 90s task text không đổi
- [ ] Toast warn hiện khi event đến
- [ ] AgentCard hiện border vàng + "Có thể bị stuck" badge
- [ ] Warning tự xóa khi agent có log entry mới
- [ ] Checker không emit sau mission stopped/completed
- [ ] Cleanup gọi khi mission ends (no memory leak)
