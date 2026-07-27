# Replay Q&A/Mockup Timeline Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presentation Mode replay hiển thị "câu hỏi Lead hỏi → user trả lời" và "Lead đã tạo mockup: <title>" như các card mới trên timeline, dùng dữ liệu đã có sẵn trong mọi recording (kể cả recording cũ) — không sửa backend.

**Architecture:** `src/hooks/useReplay.js` lắng nghe thêm 3 channel IPC (`mission:question`, `mission:answer-sent`, `mission:mockup`) đã được replay engine phát lại (engine đã channel-agnostic), tích luỹ vào 2 mảng mới trên `replayMissionState`: `qa_events` và `mockup_events`. `src/components/mission/PresentationTimeline.jsx` đọc 2 mảng này trong `buildTimelineEvents()` và render chúng thành card riêng biệt (icon/màu khác biệt) xen kẽ đúng vị trí thời gian với các event khác.

**Tech Stack:** React 19, Vitest + @testing-library/react, `@tauri-apps/api/event` (`listen`) mock trong test.

## Global Constraints

- Chỉ sửa 2 file: `src/hooks/useReplay.js` và `src/components/mission/PresentationTimeline.jsx`. Không sửa `electron/ipc/mission.cjs`, `electron/lib/recordingSchema.cjs`, `electron/lib/recordingStore.cjs`, `electron/lib/replayEngine.cjs`.
- Không cần migrate recording cũ — dữ liệu `mission:question`/`mission:answer-sent`/`mission:mockup` đã tồn tại trong mọi recording từ trước.
- Card "câu hỏi" (1 câu hỏi): message format chính xác là `"Lead hỏi: {question}\n→ User trả lời: {answer}"`. Nhiều câu hỏi: nối các cặp Q/A bằng `"\n\n"`.
- Card "mockup": message format chính xác là `"Lead đã tạo mockup: {title}"`.
- Nếu `mission:answer-sent` đến mà không có `mission:question` chờ sẵn (recording cũ/thiếu dữ liệu), vẫn phải tạo entry hợp lệ với `questions: []`, không được throw.
- Toàn bộ text hiển thị bằng tiếng Việt, nhất quán với phần còn lại của `PresentationTimeline.jsx`.

---

### Task 1: `useReplay.js` — thêm channel listener và state tích luỹ cho Q&A/Mockup

**Files:**
- Modify: `src/hooks/useReplay.js:25-39` (EMPTY_STATE), `src/hooks/useReplay.js:57-197` (applyEvent switch), `src/hooks/useReplay.js:203-206` (channels array)
- Test: `src/hooks/useReplay.qa-mockup.test.jsx` (mới)

**Interfaces:**
- Consumes: `listen(channel, callback)` từ `@tauri-apps/api/event` (mock trong test); `invoke` từ `@tauri-apps/api/core` (mock trong test, trả `{ totalMs: 0, eventCount: 0, recording: {} }` cho `replay_start`).
- Produces: `replayMissionState.qa_events: Array<{ timestamp: number, questions: Array<{question: string}>, answers: Array<{question_index: number, answer: string}> }>` và `replayMissionState.mockup_events: Array<{ timestamp: number, title: string }>` — Task 2 (`PresentationTimeline.jsx`) đọc trực tiếp 2 field này từ `state` prop.

- [ ] **Step 1: Đọc lại file hiện tại để xác định đúng vị trí chèn**

Đọc `src/hooks/useReplay.js` toàn bộ (335 dòng) trước khi sửa — đảm bảo số dòng khớp, vì file có thể đã trôi dòng kể từ lúc viết plan.

- [ ] **Step 2: Viết test thất bại cho case `mission:question` + `mission:answer-sent` (có question chờ sẵn)**

Tạo file `src/hooks/useReplay.qa-mockup.test.jsx`:

```jsx
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { vi, afterEach, test, expect } from 'vitest'
import { useReplay } from './useReplay'

// Bắt các callback đăng ký qua listen(channel, cb) theo channel, để test
// tự bắn event mô phỏng replay engine phát lại.
const listeners = new Map()
function emit(channel, payload) {
  const cbs = listeners.get(channel) || []
  cbs.forEach(cb => cb({ payload }))
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'replay_start') {
      return Promise.resolve({ totalMs: 1000, eventCount: 2, recording: { name: 'demo' }, stepMarkers: [] })
    }
    return Promise.resolve(null)
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((channel, cb) => {
    if (!listeners.has(channel)) listeners.set(channel, [])
    listeners.get(channel).push(cb)
    return Promise.resolve(() => {
      const arr = listeners.get(channel) || []
      const idx = arr.indexOf(cb)
      if (idx >= 0) arr.splice(idx, 1)
    })
  }),
}))

afterEach(() => {
  cleanup()
  listeners.clear()
})

test('mission:question followed by mission:answer-sent produces one qa_events entry', async () => {
  const { result } = renderHook(() => useReplay('rec-1'))

  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:question', { questions: [{ question: 'Dùng React hay Vue?' }] })
  })
  act(() => {
    emit('mission:answer-sent', { answers: [{ question_index: 0, answer: 'React' }] })
  })

  await waitFor(() => expect(result.current.replayMissionState.qa_events).toHaveLength(1))
  const entry = result.current.replayMissionState.qa_events[0]
  expect(entry.questions).toEqual([{ question: 'Dùng React hay Vue?' }])
  expect(entry.answers).toEqual([{ question_index: 0, answer: 'React' }])
})

test('mission:answer-sent without a prior mission:question still produces an entry with empty questions', async () => {
  const { result } = renderHook(() => useReplay('rec-2'))

  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:answer-sent', { answers: [{ question_index: 0, answer: 'OK' }] })
  })

  await waitFor(() => expect(result.current.replayMissionState.qa_events).toHaveLength(1))
  const entry = result.current.replayMissionState.qa_events[0]
  expect(entry.questions).toEqual([])
  expect(entry.answers).toEqual([{ question_index: 0, answer: 'OK' }])
})

test('mission:mockup produces one mockup_events entry with title', async () => {
  const { result } = renderHook(() => useReplay('rec-3'))

  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:mockup', { title: 'Trang đăng nhập v2', spec: '...', url: 'http://localhost:1', port: 1 })
  })

  await waitFor(() => expect(result.current.replayMissionState.mockup_events).toHaveLength(1))
  expect(result.current.replayMissionState.mockup_events[0].title).toBe('Trang đăng nhập v2')
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run src/hooks/useReplay.qa-mockup.test.jsx`
Expected: FAIL — `replayMissionState.qa_events` là `undefined` (chưa tồn tại field này), hoặc timeout vì `mission:question`/`mission:answer-sent`/`mission:mockup` chưa được lắng nghe.

- [ ] **Step 4: Thêm field mới vào `EMPTY_STATE()`**

Trong `src/hooks/useReplay.js`, sửa `EMPTY_STATE`:

```js
const EMPTY_STATE = () => ({
  id: null,
  description: '',
  project_path: '',
  status: 'Running',
  phase: 'Executing',
  execution_mode: 'standard',
  agents: [],
  tasks: [],
  log: [],
  file_changes: [],
  raw_output: [],
  messages: [],
  qa_events: [],
  mockup_events: [],
  _pendingQuestion: null,
  started_at: Date.now(),
})
```

- [ ] **Step 5: Thêm 3 case mới trong `applyEvent`**

Trong `src/hooks/useReplay.js`, thêm 3 case này vào switch statement của `applyEvent` (chèn trước dòng `default: break` ở cuối switch, sau case `'mission:agent-stuck'`):

```js
      case 'mission:question': {
        const { questions } = payload
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          return { ...base, _pendingQuestion: { questions: questions || [], timestamp: Date.now() } }
        })
        break
      }
      case 'mission:answer-sent': {
        const { answers } = payload
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const pending = base._pendingQuestion
          const entry = {
            timestamp: pending ? pending.timestamp : Date.now(),
            questions: pending ? pending.questions : [],
            answers: answers || [],
          }
          return {
            ...base,
            qa_events: [...base.qa_events, entry],
            _pendingQuestion: null,
          }
        })
        break
      }
      case 'mission:mockup': {
        const { title } = payload
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const entry = { timestamp: Date.now(), title: title || '' }
          return { ...base, mockup_events: [...base.mockup_events, entry] }
        })
        break
      }
```

Lưu ý: `Date.now()` ở đây dùng làm timestamp hiển thị trên timeline (giống cách các case khác trong file, ví dụ `mission:agent-spawned`, dùng `timestamp || Date.now()` khi payload gốc không có timestamp riêng cho sự kiện UI này — `mission:question`/`mission:answer-sent`/`mission:mockup` không mang field `timestamp` trong payload gốc từ backend).

- [ ] **Step 6: Thêm 3 channel vào mảng `channels`**

Trong `src/hooks/useReplay.js`, sửa mảng `channels` (trong `useEffect` setup listener):

```js
      const channels = [
        'mission:status', 'mission:agent-spawned', 'mission:log', 'mission:file-change',
        'mission:task-update', 'mission:raw-line', 'mission:agent-message', 'mission:agent-stuck',
        'mission:question', 'mission:answer-sent', 'mission:mockup',
      ]
```

- [ ] **Step 7: Chạy test để xác nhận pass**

Run: `npx vitest run src/hooks/useReplay.qa-mockup.test.jsx`
Expected: PASS — cả 3 test.

- [ ] **Step 8: Chạy toàn bộ test suite để xác nhận không có regression**

Run: `npx vitest run`
Expected: PASS — tất cả test trước đó vẫn pass (bao gồm mọi test hiện có liên quan tới `useMission.js`, không đụng tới `useReplay.js` trước đây nên không có test cũ nào cho hook này).

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useReplay.js src/hooks/useReplay.qa-mockup.test.jsx
git commit -m "feat: capture Q&A and mockup events during replay"
```

---

### Task 2: `PresentationTimeline.jsx` — render card mới cho Q&A và Mockup

**Files:**
- Modify: `src/components/mission/PresentationTimeline.jsx:6-76` (EVENT_CONFIG, classifyEvent, buildTimelineEvents)
- Test: `src/components/mission/PresentationTimeline.qa-mockup.test.jsx` (mới)

**Interfaces:**
- Consumes: `state.qa_events: Array<{ timestamp: number, questions: Array<{question: string}>, answers: Array<{question_index: number, answer: string}> }>` và `state.mockup_events: Array<{ timestamp: number, title: string }>` — sản phẩm của Task 1.
- Produces: không có consumer nào khác trong plan này (component lá).

- [ ] **Step 1: Viết test thất bại cho card Q&A và Mockup**

Tạo file `src/components/mission/PresentationTimeline.qa-mockup.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { PresentationTimeline } from './PresentationTimeline'

const baseState = {
  agents: [],
  log: [],
  file_changes: [],
  tasks: [],
}

test('renders a qa card with question and answer text', () => {
  const state = {
    ...baseState,
    qa_events: [{
      timestamp: 1000,
      questions: [{ question: 'Dùng React hay Vue?' }],
      answers: [{ question_index: 0, answer: 'React' }],
    }],
    mockup_events: [],
  }
  render(<PresentationTimeline state={state} currentMs={10000} charsPerSecond={999} instant />)
  expect(screen.getByText(/Lead hỏi: Dùng React hay Vue\?/)).toBeInTheDocument()
  expect(screen.getByText(/User trả lời: React/)).toBeInTheDocument()
})

test('renders a mockup card with the mockup title', () => {
  const state = {
    ...baseState,
    qa_events: [],
    mockup_events: [{ timestamp: 1000, title: 'Trang đăng nhập v2' }],
  }
  render(<PresentationTimeline state={state} currentMs={10000} charsPerSecond={999} instant />)
  expect(screen.getByText(/Lead đã tạo mockup: Trang đăng nhập v2/)).toBeInTheDocument()
})

test('joins multiple questions in one qa_events entry with a blank line between pairs', () => {
  const state = {
    ...baseState,
    qa_events: [{
      timestamp: 1000,
      questions: [{ question: 'Câu 1?' }, { question: 'Câu 2?' }],
      answers: [{ question_index: 0, answer: 'Trả lời 1' }, { question_index: 1, answer: 'Trả lời 2' }],
    }],
    mockup_events: [],
  }
  render(<PresentationTimeline state={state} currentMs={10000} charsPerSecond={999} instant />)
  expect(screen.getByText(/Câu 1\?/)).toBeInTheDocument()
  expect(screen.getByText(/Câu 2\?/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run src/components/mission/PresentationTimeline.qa-mockup.test.jsx`
Expected: FAIL — không tìm thấy text nào (vì `qa_events`/`mockup_events` chưa được đọc trong `buildTimelineEvents`).

- [ ] **Step 3: Đọc lại file hiện tại để xác định đúng vị trí chèn**

Đọc `src/components/mission/PresentationTimeline.jsx` toàn bộ (161 dòng) trước khi sửa.

- [ ] **Step 4: Thêm import icon mới**

Trong `src/components/mission/PresentationTimeline.jsx`, sửa dòng import (dòng 2):

```jsx
import { Bot, CheckCircle2, FileEdit, MessageSquare, Sparkles, Wrench, AlertTriangle, Rocket, HelpCircle, LayoutTemplate } from 'lucide-react'
```

- [ ] **Step 5: Thêm 2 entry vào `EVENT_CONFIG`**

Sửa `EVENT_CONFIG` (dòng 6-15) — thêm 2 dòng trước `default`:

```js
const EVENT_CONFIG = {
  'agent-spawned': { icon: Rocket,        color: 'text-cyan-300',    ring: 'ring-cyan-400/30',    bg: 'bg-cyan-500/10' },
  'task-done':     { icon: CheckCircle2,  color: 'text-emerald-300', ring: 'ring-emerald-400/30', bg: 'bg-emerald-500/10' },
  'file-change':   { icon: FileEdit,      color: 'text-amber-300',   ring: 'ring-amber-400/30',   bg: 'bg-amber-500/10' },
  'message':       { icon: MessageSquare, color: 'text-fuchsia-300', ring: 'ring-fuchsia-400/30', bg: 'bg-fuchsia-500/10' },
  'tool':          { icon: Wrench,        color: 'text-yellow-300',  ring: 'ring-yellow-400/30',  bg: 'bg-yellow-500/10' },
  'error':         { icon: AlertTriangle, color: 'text-red-300',     ring: 'ring-red-400/30',     bg: 'bg-red-500/10' },
  'thinking':      { icon: Sparkles,      color: 'text-indigo-300',  ring: 'ring-indigo-400/30',  bg: 'bg-indigo-500/10' },
  'qa':            { icon: HelpCircle,    color: 'text-violet-300',  ring: 'ring-violet-400/30',  bg: 'bg-violet-500/10' },
  'mockup':        { icon: LayoutTemplate, color: 'text-rose-300',   ring: 'ring-rose-400/30',    bg: 'bg-rose-500/10' },
  default:         { icon: Bot,           color: 'text-slate-300',   ring: 'ring-slate-400/30',   bg: 'bg-slate-500/10' },
}
```

- [ ] **Step 6: Thêm 2 nhánh vào `classifyEvent`**

Sửa `classifyEvent` (dòng 17-26) — thêm 2 nhánh ở đầu hàm:

```js
function classifyEvent(entry) {
  if (entry.__kind === 'qa') return 'qa'
  if (entry.__kind === 'mockup') return 'mockup'
  if (entry.__kind === 'agent-spawned') return 'agent-spawned'
  if (entry.__kind === 'file-change') return 'file-change'
  if (entry.__kind === 'task-done') return 'task-done'
  if (entry.log_type === 'error') return 'error'
  if (entry.log_type === 'tool') return 'tool'
  if (entry.log_type === 'message') return 'message'
  if (entry.log_type === 'thinking') return 'thinking'
  return 'default'
}
```

- [ ] **Step 7: Thêm helper format Q&A và 2 vòng lặp mới trong `buildTimelineEvents`**

Sửa `buildTimelineEvents` (dòng 33-76) — thêm helper function ngay trước nó, và thêm 2 vòng lặp mới trong thân hàm (trước dòng `return events...`):

```js
function formatQaMessage(entry) {
  const questions = entry.questions || []
  const answers = entry.answers || []
  if (questions.length === 0) {
    return answers.map(a => `→ User trả lời: ${a.answer}`).join('\n\n')
  }
  return questions.map((q, i) => {
    const a = answers.find(ans => ans.question_index === i) || answers[i]
    const answerText = a ? a.answer : ''
    return `Lead hỏi: ${q.question}\n→ User trả lời: ${answerText}`
  }).join('\n\n')
}

function buildTimelineEvents(state) {
  if (!state) return []
  const events = []

  for (const a of state.agents || []) {
    if (a.spawned_at) {
      events.push({
        __kind: 'agent-spawned',
        timestamp: a.spawned_at,
        agent: a.name,
        message: `${a.name} (${a.role || 'Agent'}) bắt đầu tham gia mission`,
      })
    }
  }

  for (const l of state.log || []) {
    if (l.agent === 'System' && l.log_type === 'info') continue // skip noisy system chatter
    events.push({ ...l, __kind: 'log' })
  }

  for (const fc of state.file_changes || []) {
    events.push({
      __kind: 'file-change',
      timestamp: fc.timestamp,
      agent: fc.agent,
      message: `${fc.agent || 'Agent'} đã ${fc.action === 'create' ? 'tạo' : fc.action === 'delete' ? 'xoá' : 'chỉnh sửa'} file ${fc.path}`,
    })
  }

  for (const t of state.tasks || []) {
    if (t.status === 'completed' && t.completed_at) {
      events.push({
        __kind: 'task-done',
        timestamp: t.completed_at,
        agent: t.assigned_agent,
        message: `Hoàn thành task: ${t.title}`,
      })
    }
  }

  for (const qa of state.qa_events || []) {
    events.push({
      __kind: 'qa',
      timestamp: qa.timestamp,
      agent: 'Lead',
      message: formatQaMessage(qa),
    })
  }

  for (const m of state.mockup_events || []) {
    events.push({
      __kind: 'mockup',
      timestamp: m.timestamp,
      agent: 'Lead',
      message: `Lead đã tạo mockup: ${m.title}`,
    })
  }

  return events
    .filter(e => e.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp)
}
```

- [ ] **Step 8: Chạy test để xác nhận pass**

Run: `npx vitest run src/components/mission/PresentationTimeline.qa-mockup.test.jsx`
Expected: PASS — cả 3 test.

- [ ] **Step 9: Chạy toàn bộ test suite để xác nhận không có regression**

Run: `npx vitest run`
Expected: PASS — toàn bộ test hiện có vẫn pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/mission/PresentationTimeline.jsx src/components/mission/PresentationTimeline.qa-mockup.test.jsx
git commit -m "feat: render Q&A and mockup cards in presentation timeline"
```

---

### Task 3: Kiểm thử thủ công end-to-end trên recording thật

**Files:**
- Không tạo/sửa file code. Chỉ thao tác thủ công qua UI đã build.

**Interfaces:**
- Consumes: toàn bộ thay đổi từ Task 1 và Task 2.
- Produces: xác nhận bằng mắt — không có artifact code.

- [ ] **Step 1: Build electron app**

Run: `npm run electron:dev`
Expected: App mở lên không lỗi console.

- [ ] **Step 2: Bắt đầu ghi 1 mission có bước AskUserQuestion và Mockup**

Trong app: bắt đầu 1 mission mới, bật Record trước khi bắt đầu (hoặc theo đúng flow Record hiện có trong `MissionLauncher.jsx`), đảm bảo mission đó sẽ hỏi ít nhất 1 câu hỏi và tạo ít nhất 1 mockup trong quá trình chạy. Trả lời câu hỏi và phản hồi mockup (approve hoặc revise) khi được hỏi. Dừng ghi sau khi mission qua khỏi 2 bước đó.

- [ ] **Step 3: Mở Presentation Mode với recording vừa tạo**

Vào trang Recordings (`RecordingsPage.jsx`), chọn recording vừa ghi, mở Presentation Mode.

- [ ] **Step 4: Xác nhận card Q&A xuất hiện đúng vị trí**

Quan sát timeline: xác nhận có 1 card với icon `HelpCircle` màu tím, nội dung `"Lead hỏi: {câu hỏi thật}\n→ User trả lời: {câu trả lời thật}"`, xuất hiện đúng thứ tự thời gian (ngay sau các log event trước lúc hỏi, trước các event sau khi trả lời).

- [ ] **Step 5: Xác nhận card Mockup xuất hiện đúng vị trí**

Quan sát timeline: xác nhận có 1 card với icon `LayoutTemplate` màu hồng/rose, nội dung `"Lead đã tạo mockup: {title thật}"`.

- [ ] **Step 6: Test tua nhanh (seek) qua card mới**

Dùng thanh tua trong `ReplayControls` để tua tới trước và sau vị trí của 2 card mới — xác nhận card xuất hiện/biến mất đúng theo `currentMs` giống các card khác (không bị treo, không bị duplicate).

- [ ] **Step 7: Test với recording cũ (ghi trước khi có thay đổi này, nếu có sẵn)**

Nếu có ít nhất 1 recording cũ trong danh sách (ghi từ trước khi bắt đầu công việc này) đã từng đi qua bước AskUserQuestion, mở Presentation Mode với recording đó — xác nhận card Q&A cũng xuất hiện (xác nhận claim "không cần migrate" trong spec là đúng, vì dữ liệu payload gốc đã đủ).
