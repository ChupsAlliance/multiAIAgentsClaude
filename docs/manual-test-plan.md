# Manual Test Plan — Claude Agent Teams v0.9.0

## Chuẩn bị

- App đang chạy (`npm run electron:dev`)
- Có một thư mục project thật trên máy để chọn (bất kỳ folder nào có code)
- Claude CLI đã config API key (`claude config get api_key`)

---

## SECTION 1 — Core Pipeline (Happy Path)

### TC-01: Launch Mission cơ bản

1. Mở app → vào Mission Control
2. Nhập requirement (ví dụ: *"Tạo một file README.md đơn giản"*)
3. Chọn project folder
4. Giữ nguyên mọi setting mặc định (Auto-pilot, Standard)
5. Nhấn **Launch**

**Kỳ vọng:** Chuyển sang màn hình Planning, thấy log stream xuất hiện, đồng hồ đếm thời gian chạy

---

### TC-02: Planning → Plan Review

1. Tiếp tục TC-01, chờ planning xong
2. App tự chuyển sang **PlanReview**

**Kỳ vọng:**
- Hiển thị danh sách agents và tasks
- Có 3 tab: Tasks / Flow / Graph
- Nút "Lịch sử" xuất hiện trong toolbar

---

### TC-03: Chỉnh sửa plan trong PlanDocument

1. Trong PlanReview → tab **Tasks** (mặc định)
2. Chỉnh sửa nội dung (thêm một dòng vào task description)
3. Nhấn **Ctrl+S**

**Kỳ vọng:**
- Plan được apply
- Panel "Lịch sử" (nếu mở) hiển thị version mới với trigger `manual_edit`
- Không có lỗi

---

### TC-04: Deploy và Monitor

1. Sau khi review plan → nhấn **Deploy** (hoặc **Ctrl+D**)
2. Quan sát MissionDashboard

**Kỳ vọng:**
- Tab Activity Log hiển thị logs real-time
- Tab Agents hiển thị agent cards với status
- Tab Tasks cập nhật status (pending → in_progress → completed)
- Elapsed timer chạy

---

## SECTION 2 — Plan Review Tabs

### TC-05: Tab Flow

1. Trong PlanReview → nhấn tab **Flow** (hoặc nhấn `2`)

**Kỳ vọng:** Hiển thị visual flow của plan, không bị lỗi trắng

---

### TC-06: Tab Graph

1. Trong PlanReview → nhấn tab **Graph** (hoặc nhấn `3`)

**Kỳ vọng:**
- Hiện dependency graph với các nodes và edges
- Nodes màu theo priority (đỏ=high, vàng=medium, xanh=low)
- Nếu tasks không có `depends_on` → banner "Không có dependencies"
- Click node → chuyển về tab Tasks

---

### TC-07: DnD vẫn hoạt động sau khi switch tab

1. Vào tab **Graph** → xem graph
2. Quay lại tab **Tasks** (nhấn `1`)
3. Thử kéo thả task để đổi thứ tự

**Kỳ vọng:** Kéo thả vẫn hoạt động bình thường (không bị mất state)

---

## SECTION 3 — Keyboard Shortcuts

### TC-08: Help overlay

1. Ở bất kỳ màn hình nào → nhấn `?`

**Kỳ vọng:** Modal hiện ra với danh sách phím tắt nhóm theo context, nhấn `Escape` đóng lại

---

### TC-09: Ctrl+Enter launch

1. Vào MissionLauncher, nhập đủ requirement và chọn folder
2. Nhấn **Ctrl+Enter** (không click nút Launch)

**Kỳ vọng:** Mission bắt đầu, giống như click nút Launch

---

### TC-10: Ctrl+Enter bị disable khi chưa đủ điều kiện

1. Vào MissionLauncher, **chưa** nhập requirement
2. Nhấn **Ctrl+Enter**

**Kỳ vọng:** Không có gì xảy ra (nút disable)

---

### TC-11: Phím số chuyển tab PlanReview

1. Đang ở PlanReview
2. Nhấn `1`, `2`, `3` lần lượt

**Kỳ vọng:** Chuyển tab Tasks / Flow / Graph tương ứng

---

### TC-12: Ctrl+E mở export dropdown

1. Đang ở PlanReview (tab Tasks)
2. Nhấn **Ctrl+E**

**Kỳ vọng:** Dropdown "Xuất" mở ra với 4 options (Markdown, JSON, HTML, PDF)

---

### TC-13: Escape đóng modal

1. Mở help overlay (`?`)
2. Nhấn `Escape`

**Kỳ vọng:** Modal đóng lại

---

## SECTION 4 — Plan Versioning

### TC-14: Version `initial` tự động tạo

1. Hoàn thành planning → vào PlanReview
2. Click nút **"Lịch sử"** trong toolbar

**Kỳ vọng:**
- Panel mở ra bên phải
- Có ít nhất 1 version với label "Plan khởi tạo" (trigger `initial`)
- Version đầu có badge "hiện tại"

---

### TC-15: Version `manual_edit` sau khi chỉnh sửa

1. Chỉnh sửa nội dung plan → **Ctrl+S**
2. Mở lại panel "Lịch sử"

**Kỳ vọng:** Version mới xuất hiện với trigger `manual_edit`, timestamp đúng giờ vừa save

---

### TC-16: Xem Diff

1. Trong panel Lịch sử (đã có ≥2 versions)
2. Click **Diff** trên một version cũ

**Kỳ vọng:**
- Hiện diff view với summary
- Màu xanh = thêm mới, đỏ = đã xóa, vàng = thay đổi
- Nút ← quay lại timeline

---

### TC-17: Rollback

1. Trong panel Lịch sử → click icon rollback (↺) trên một version cũ
2. Confirm trong dialog

**Kỳ vọng:**
- Plan được khôi phục về nội dung version đó
- Version mới được tạo với trigger `rollback`
- Panel tự reload với version mới nhất ở đầu

---

### TC-18: Rollback error handling

1. Thử rollback khi không có kết nối IPC (hoặc mock lỗi)

**Kỳ vọng:** Hiển thị thông báo lỗi tiếng Việt trong confirm view, không bị treo loading

---

## SECTION 5 — Export Formats

### TC-19: Export Markdown

1. PlanDocument → click **"Xuất"** → chọn **Markdown**

**Kỳ vọng:** File `.md` được lưu vào project folder, nội dung đúng format

---

### TC-20: Export JSON

1. PlanDocument → **"Xuất"** → **JSON**

**Kỳ vọng:**
- File download về máy
- Mở file: có các field `agents`, `tasks`, `plan_versions`, `log`, v.v.
- Không có `undefined` hay field bị thiếu

---

### TC-21: Export HTML

1. PlanDocument → **"Xuất"** → **HTML**

**Kỳ vọng:**
- File `.html` download về máy
- Mở bằng browser: hiển thị đúng dark theme, đọc được offline
- Kiểm tra: title, agents list, tasks list đều có nội dung

---

### TC-22: Export HTML — XSS safety

1. Trước khi export, chỉnh sửa plan để thêm text có ký tự đặc biệt: `<script>alert(1)</script>` trong tên task
2. Export HTML → mở file trong browser

**Kỳ vọng:** Text hiển thị nguyên văn `<script>alert(1)</script>`, **không** chạy JS, **không** có alert

---

### TC-23: Export PDF

1. PlanDocument → **"Xuất"** → **PDF**
2. Chờ loading (có spinner)

**Kỳ vọng:**
- Native save dialog xuất hiện để chọn nơi lưu
- File `.pdf` được tạo
- Mở PDF: nội dung đọc được, layout A4

---

### TC-24: Export PDF — Cancel

1. Click **"Xuất"** → **PDF**
2. Trong save dialog → nhấn Cancel

**Kỳ vọng:** Không có toast lỗi, spinner biến mất, dropdown đóng bình thường

---

## SECTION 6 — Dependency Graph (MissionDashboard)

### TC-25: Graph tab trong Dashboard

1. Mission đang chạy → MissionDashboard → click tab **Graph**

**Kỳ vọng:**
- Graph hiển thị các tasks
- Màu theo status: in_progress = accent + pulse animation, completed = xanh, pending = mờ
- Tên agent được gán hiển thị dưới task node

---

### TC-26: Click node chuyển tab

1. Trong Dashboard Graph → click vào một task node

**Kỳ vọng:** Chuyển sang tab **Tasks**

---

## SECTION 7 — Permission Modes

### TC-27: Interactive Mode — Q&A flow

1. MissionLauncher → chọn **Interactive Mode**
2. Nhập requirement mơ hồ (ví dụ: *"Cải thiện app của tôi"*)
3. Launch → chờ Lead hỏi

**Kỳ vọng:**
- Xuất hiện QuestionCard với câu hỏi từ Lead
- Nhập câu trả lời → Submit → Lead tiếp tục

---

### TC-28: Plan Only Mode

1. Chọn **Plan Only** → Launch → chờ planning xong

**Kỳ vọng:** App dừng ở PlanReview, không có nút Deploy, không tự deploy

---

## SECTION 8 — Reliability

### TC-29: Toast notification khi lỗi IPC

1. Disconnect internet hoặc kill backend process
2. Thực hiện một action (launch/deploy)

**Kỳ vọng:** Toast lỗi xuất hiện góc trên phải, tự đóng sau ~6 giây

---

### TC-30: Planning timer warning

1. Launch mission với requirement phức tạp
2. Chờ >3 phút ở Planning phase

**Kỳ vọng:** Toast info xuất hiện sau 3 phút, toast warn sau 8 phút

---

### TC-31: Agent Retry

1. Mission đang chạy, có agent ở trạng thái Error
2. Click nút **Retry** trên AgentCard

**Kỳ vọng:** Agent reset về Idle, task về pending, Lead re-spawn agent

---

## SECTION 9 — Mission History

### TC-32: Xem history

1. Hoàn thành một mission (hoặc dừng giữa chừng)
2. Mở **Mission History**

**Kỳ vọng:** Mission xuất hiện trong danh sách với description, status, timestamp

---

### TC-33: Continue from History (Fork)

1. History → chọn mission cũ → **"Continue mission"**
2. Nhập yêu cầu mới → Launch

**Kỳ vọng:**
- Mission mới được tạo
- Plan có context từ mission gốc
- History hiển thị badge `↳ từ: <tên mission gốc>`

---

## SECTION 10 — Edge Cases

### TC-34: Stop mission giữa chừng

1. Mission đang chạy → click **Stop**

**Kỳ vọng:** Mission dừng, status = Stopped, không có zombie process

---

### TC-35: Replan

1. Đang ở PlanReview → nhấn **r** (hoặc click nút Replan)
2. Confirm

**Kỳ vọng:**
- App quay lại Planning phase
- Sau khi xong: version mới với trigger `replan` xuất hiện trong Lịch sử
- Plan mới thay thế plan cũ

---

### TC-36: App restart — state recovery

1. Launch mission → để đến Planning phase
2. Đóng app hoàn toàn
3. Mở lại app

**Kỳ vọng:** Mission cũ xuất hiện trong History, có thể continue

---

## Checklist

```
[x] TC-01  Launch cơ bản
[ ] TC-02  Planning → PlanReview
[ ] TC-03  Ctrl+S apply plan
[ ] TC-04  Deploy + Monitor
[ ] TC-05  Tab Flow
[ ] TC-06  Tab Graph (PlanReview)
[ ] TC-07  DnD sau khi switch tab
[ ] TC-08  Help overlay (?)
[ ] TC-09  Ctrl+Enter launch
[ ] TC-10  Ctrl+Enter disable khi chưa đủ
[ ] TC-11  Phím 1/2/3 chuyển tab
[ ] TC-12  Ctrl+E mở export
[ ] TC-13  Escape đóng modal
[ ] TC-14  Version initial
[ ] TC-15  Version manual_edit
[ ] TC-16  Xem Diff
[ ] TC-17  Rollback
[ ] TC-18  Rollback error handling
[ ] TC-19  Export Markdown
[ ] TC-20  Export JSON
[ ] TC-21  Export HTML
[ ] TC-22  Export HTML XSS
[ ] TC-23  Export PDF
[ ] TC-24  Export PDF cancel
[ ] TC-25  Graph tab Dashboard
[ ] TC-26  Click node chuyển tab
[ ] TC-27  Interactive Mode Q&A
[ ] TC-28  Plan Only Mode
[ ] TC-29  Toast lỗi IPC
[ ] TC-30  Planning timer warning
[ ] TC-31  Agent Retry
[ ] TC-32  Mission History
[ ] TC-33  Continue from History
[ ] TC-34  Stop mission
[ ] TC-35  Replan
[ ] TC-36  App restart recovery
```

---

> **Ưu tiên nếu thời gian giới hạn:** TC-01→04 (core pipeline) + TC-06, TC-08→13 (shortcuts + graph) + TC-14→17 (versioning) + TC-19→23 (export) là coverage quan trọng nhất.
