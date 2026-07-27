# Hiển thị AskUserQuestion & Mockup trong Presentation Mode replay

## Bối cảnh

Record/Replay hoạt động tốt cho luồng chính (agent spawn, log, file change, task update), nhưng khi mission có bước hỏi user (`AskUserQuestion`) hoặc tạo mockup UI, xem lại recording không thấy 2 sự kiện này xuất hiện trên timeline.

### Root cause (đã xác nhận qua điều tra code)

Ban đầu nghi ngờ có 2 lỗ hổng: (a) recording không ghi được data, (b) UI replay không render. Sau khi đọc kỹ 2 IPC handler thật (`answer_question`, `mockup_respond` trong `electron/ipc/mission.cjs`), xác nhận:

- **Data-capture: KHÔNG có lỗ hổng.** Dữ liệu cần thiết đã được ghi đầy đủ trong mọi recording (cũ lẫn mới):
  - `mission:question` (chứa `questions`) được `sendToWindow` gửi và ghi khi Lead hỏi.
  - `answer_question` handler gọi `sendToWindow('mission:answer-sent', { answers })` — payload này đã chứa toàn bộ câu trả lời của user.
  - `mockup_respond` handler không emit event quyết định riêng, nhưng ghi 1 dòng `mission:log` mô tả quyết định ("Mockup approved — resuming planning" / "Mockup feedback sent: ...") — dòng log này cũng đi qua `sendToWindow` và đã được ghi.
- **Rendering: CÓ lỗ hổng — đây là root cause thật sự.** `src/hooks/useReplay.js` có danh sách channel lắng nghe cố định (dòng 203-206):
  ```js
  const channels = [
    'mission:status', 'mission:agent-spawned', 'mission:log', 'mission:file-change',
    'mission:task-update', 'mission:raw-line', 'mission:agent-message', 'mission:agent-stuck',
  ]
  ```
  `mission:question` và `mission:mockup` hoàn toàn không có trong danh sách này, và `applyEvent()` không có `case` xử lý 2 channel đó. `replayEngine.cjs` (`emitEvent()`) đã channel-agnostic — chỉ phát lại đúng channel gốc — nên không phải sửa ở tầng engine.

## Quyết định thiết kế

1. **Kiểu hiển thị:** Presentation Mode dùng `PresentationTimeline.jsx` — dạng story feed, mỗi sự kiện là 1 card xuất hiện tuần tự với hiệu ứng typewriter, KHÔNG dùng popup dialog thật như lúc mission chạy live. Vì vậy AskUserQuestion khi replay sẽ hiển thị dưới dạng **timeline card kể lại**: "Lead hỏi: ... → User trả lời: ...", không dựng lại modal thật.
2. **Mockup khi replay:** Nội dung HTML/visual thật của mockup nằm ngoài pipeline recording (phục vụ qua HTTP server riêng, thường đã tắt khi xem lại). Chỉ hiển thị **card thông báo**: "Lead đã tạo mockup: `<title>`" — không lưu snapshot HTML, không cố mở lại mockup thật.
3. **Scope:** Chỉ sửa 2 file frontend. Không đụng backend, không đụng `recordingSchema.cjs`/`replayEngine.cjs`/`mission.cjs`. Áp dụng được ngay cả với các recording đã lưu từ trước (không cần migrate).

## Thiết kế chi tiết

### `src/hooks/useReplay.js`

- Thêm `'mission:question'`, `'mission:answer-sent'`, `'mission:mockup'` vào mảng `channels`.
- Thêm state mới trong `EMPTY_STATE()`: `qa_events: []`, `mockup_events: []`.
- Thêm 3 `case` trong `applyEvent()`:
  - `case 'mission:question'`: lưu tạm vào field nội bộ `_pendingQuestion = { questions, timestamp }` trên state (không phải mảng hiển thị trực tiếp — chỉ là điểm neo chờ ghép với answer).
  - `case 'mission:answer-sent'`: lấy `_pendingQuestion` hiện có (nếu có), ghép thành 1 entry hoàn chỉnh `{ timestamp, questions, answers }`, đẩy vào `qa_events`, xoá `_pendingQuestion`. Nếu không có `_pendingQuestion` (trường hợp hiếm — recording thiếu event question do lỗi cũ), vẫn tạo entry chỉ với `answers`, `questions: []`.
  - `case 'mission:mockup'`: đẩy `{ timestamp, title: payload.title }` vào `mockup_events`.

### `src/components/mission/PresentationTimeline.jsx`

- `buildTimelineEvents()`: thêm 2 vòng lặp:
  - Qua `state.qa_events` → tạo event `{ __kind: 'qa', timestamp, message }`. `message` ghép các câu hỏi/trả lời: nếu 1 câu hỏi → `"Lead hỏi: {question}\n→ User trả lời: {answer}"`; nếu nhiều câu hỏi → nối các cặp Q/A bằng `\n\n`.
  - Qua `state.mockup_events` → `{ __kind: 'mockup', timestamp, message: "Lead đã tạo mockup: {title}" }`.
- `EVENT_CONFIG`: thêm 2 entry mới:
  - `'qa'`: icon `HelpCircle` (hoặc `MessageSquare` nếu muốn tái dùng), màu tím/violet để phân biệt với message thường.
  - `'mockup'`: icon `Layout` hoặc `Sparkles`, màu riêng (ví dụ pink/rose).
- `classifyEvent()`: thêm 2 nhánh đầu hàm — `if (entry.__kind === 'qa') return 'qa'`, `if (entry.__kind === 'mockup') return 'mockup'`.

## Không thay đổi

- `electron/lib/replayEngine.cjs` — đã channel-agnostic, không cần sửa.
- `electron/ipc/mission.cjs`, `electron/lib/recordingSchema.cjs`, `electron/lib/recordingStore.cjs` — data đã đủ, không cần ghi thêm gì.
- `src/hooks/useMission.js`, `src/components/mission/MissionDashboard.jsx`, `PlanningStream.jsx` — không dùng trong Presentation Mode, ngoài phạm vi.

## Testing

- Unit test cho `useReplay.js`: giả lập phát 1 cặp `mission:question` + `mission:answer-sent`, xác nhận `qa_events` có đúng 1 entry ghép đúng câu hỏi/trả lời. Giả lập `mission:mockup`, xác nhận `mockup_events` có đúng entry.
- Test case `mission:answer-sent` đến mà không có `mission:question` trước đó (recording cũ/thiếu) — không được throw, tạo entry với `questions: []`.
- Test `PresentationTimeline` render đúng card cho `__kind: 'qa'` và `__kind: 'mockup'` với icon/màu tương ứng.
- Kiểm thử thủ công: ghi 1 recording thật có bước AskUserQuestion + Mockup, mở Presentation Mode, xác nhận card xuất hiện đúng vị trí thời gian trên timeline.
