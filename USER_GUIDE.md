# Hướng dẫn Sử dụng Agent Teams Guide

## Mục lục
1. [Tổng quan ứng dụng](#tổng-quan-ứng-dụng)
2. [Cài đặt và khởi động](#cài-đặt-và-khởi-động)
3. [Giao diện chính](#giao-diện-chính)
4. [Hai chế độ thực thi](#hai-chế-độ-thực-thi)
5. [Standard Mode (Mặc định)](#standard-mode-mặc-định)
6. [Agent Teams Mode (Thử nghiệm)](#agent-teams-mode-thử-nghiệm)
7. [Quy trình Mission chi tiết](#quy-trình-mission-chi-tiết)
8. [Tính năng nâng cao](#tính-năng-nâng-cao)
9. [Permission Modes — 4 chế độ quyền hạn](#permission-modes--4-chế-độ-quyền-hạn)
10. [Deep Plan Mode](#deep-plan-mode)
11. [Virtual Office (Pixel Agents)](#virtual-office-pixel-agents)
12. [Mẹo & Thủ thuật](#mẹo--thủ-thuật)
13. [Khắc phục sự cố](#khắc-phục-sự-cố)

---

## Tổng quan ứng dụng

**Agent Teams Guide** là ứng dụng desktop xây dựng bằng Electron, giúp bạn điều phối đội ngũ AI agents để thực hiện các dự án phần mềm phức tạp.

### Điểm nổi bật

- **Lập kế hoạch tự động**: AI phân tích yêu cầu, tạo danh sách agents + tasks phù hợp
- **Xem xét trước khi chạy**: Review kế hoạch, đổi model, sắp xếp tasks, thêm chỉ dẫn
- **Giám sát real-time**: Dashboard hiển thị logs, agents, file changes, messages theo thời gian thực
- **Can thiệp mid-run**: Gửi lệnh bổ sung khi mission đang chạy
- **Verification tự động**: Agents tự verify build, Lead kiểm tra lại integration — đảm bảo code chạy được

### Hai chế độ thực thi

| | Standard Mode | Agent Teams Mode |
|---|---|---|
| **Trạng thái** | **Ổn định — Mặc định** | Thử nghiệm (Experimental) |
| **Cách hoạt động** | Lead spawn agents, chờ kết quả, tự verify | Lead tạo Team, spawn teammates, giao tiếp real-time |
| **Giao tiếp** | Agents chạy độc lập, Lead review kết quả cuối | Agents gửi tin nhắn DM cho nhau qua SendMessage |
| **Phù hợp cho** | Hầu hết mọi task | Tasks cần agents phối hợp chặt chẽ |
| **Chọn ở đâu** | Launcher → Execution Mode = Standard | Launcher → Execution Mode = Agent Teams |

---

## Cài đặt và khởi động

### Yêu cầu hệ thống

- **Windows 10/11** (64-bit)
- **Claude CLI** đã cài (`claude --version` để kiểm tra)
- **Node.js** (nếu project là Node.js/Vite/React)
- **Node.js >= 18** (chỉ khi build từ source)

### Khởi động

1. Mở ứng dụng Agent Teams Guide
2. Ứng dụng tự kiểm tra Claude CLI và cấu hình
3. Nếu có vấn đề → vào **Dashboard** → **Setup** để xem chi tiết

### PATH lưu ý (Windows)

Nếu gặp lỗi `cargo not found` khi build từ source:
```cmd
:: Thêm vĩnh viễn vào PATH (chạy 1 lần trong CMD)
setx PATH "%USERPROFILE%\.cargo\bin;%PATH%"
:: Mở CMD mới để có hiệu lực
```

---

## Giao diện chính

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo] Agent Teams Guide     Playground  Docs  Dashboard   │
└─────────────────────────────────────────────────────────────┘
```

- **Playground**: Launcher — tạo mission mới
- **Docs**: Tài liệu hướng dẫn
- **Dashboard**: Quản lý mission đang chạy + lịch sử

### Mission Flow (4 Phases)

```
 Launcher → Plan Review → Prompt Preview → Dashboard
 (Nhập)     (Xem kế hoạch)  (Xác nhận)     (Chạy & Giám sát)
```

---

## Hai chế độ thực thi

Khi tạo mission mới ở **Launcher**, bạn chọn **Execution Mode**:

```
┌────────────────────────────────────────┐
│ Execution Mode:                        │
│                                        │
│  [● Standard]   [○ Agent Teams]        │
│  Ổn định          Thử nghiệm          │
└────────────────────────────────────────┘
```

---

## Standard Mode (Mặc định)

> **Khuyến nghị cho hầu hết mọi task.** Đây là chế độ ổn định, đã được test kỹ.

### Cách hoạt động

```
Lead (orchestrator)
  │
  ├─ Phase 1: Spawn ALL agents song song
  │   ├─ Agent A ──→ thực thi tasks ──→ BUILD_RESULT: PASS
  │   ├─ Agent B ──→ thực thi tasks ──→ BUILD_RESULT: PASS
  │   └─ Agent C ──→ thực thi tasks ──→ BUILD_RESULT: FAIL
  │
  ├─ Phase 2: Review Agent Results
  │   ├─ Agent A: PASS ✓
  │   ├─ Agent B: PASS ✓
  │   └─ Agent C: FAIL ✗ → Spawn fixer agent
  │
  ├─ Phase 3: Integration Verification
  │   ├─ Lead chạy build toàn project
  │   ├─ Nếu fail → fix trực tiếp hoặc spawn fix agent
  │   └─ Lặp lại cho đến khi build PASS
  │
  └─ Phase 4: Documentation & Finish
      ├─ Write README.md
      └─ Print summary
```

### Điểm mạnh

1. **Đơn giản, dễ hiểu**: Agents chạy song song → Lead review kết quả → verify
2. **Evidence-based**: Mỗi agent PHẢI print `BUILD_RESULT: PASS` hoặc `FAIL` — Lead dùng evidence này để verify
3. **Retry loop**: Nếu agent fail → spawn fixer. Nếu integration fail → fix trực tiếp. Không báo "done" khi build chưa pass
4. **Lead tự verify**: Sau khi agents xong, Lead THỰC SỰ chạy build để kiểm tra, không tin tưởng 100% vào agents

### Agent Execution Phases (bên trong mỗi agent)

Mỗi agent khi được spawn sẽ theo protocol:

```
A) SETUP    → cd vào project, đọc code hiện có
B) IMPLEMENT → Viết code HOÀN CHỈNH (không stubs, không TODOs)
C) INSTALL  → Cài dependencies
D) BUILD    → Chạy build, đọc output, fix nếu lỗi, lặp lại
E) EVIDENCE → Print BUILD_RESULT + FILES_WRITTEN
```

### Ví dụ log output (Standard Mode)

```
[Lead] Spawning scaffolder for Project Setup
[Lead] Spawning ui-builder for UI Components
[Lead] Spawning api-dev for Backend API

[scaffolder] Starting: Initialize Vite + React project
[scaffolder] Starting: Setup TypeScript config
[scaffolder] BUILD_RESULT: PASS
[scaffolder] FILES_WRITTEN: package.json, vite.config.ts, tsconfig.json
[scaffolder] Completed: Project scaffolding

[ui-builder] Starting: Create login form component
[ui-builder] BUILD_RESULT: FAIL: Cannot find module './types/user'
[ui-builder] Fixing: Add missing type definitions...
[ui-builder] BUILD_RESULT: PASS
[ui-builder] FILES_WRITTEN: src/components/LoginForm.tsx, src/types/user.ts
[ui-builder] Completed: UI components

[Lead] Agent results: 3/3 PASS, 0 FAIL
[Lead] Running integration verification...
[Lead] INTEGRATION_VERIFIED: PASS
[Lead] Mission complete
```

### Khi nào dùng Standard Mode?

- Mọi task thông thường: build feature, refactor, debug, documentation
- Khi bạn muốn kết quả ổn định và đáng tin cậy
- Khi agents không cần giao tiếp với nhau trong quá trình chạy

---

## Agent Teams Mode (Thử nghiệm)

> **⚠ Experimental** — Tính năng đang phát triển. Sử dụng khi agents cần phối hợp chặt chẽ.

### Cách hoạt động

```
Lead (orchestrator)
  │
  ├─ Phase 1: TeamCreate("mission")
  │
  ├─ Phase 2: Spawn ALL teammates (parallel)
  │   ├─ Agent A (team: "mission") ──→ thực thi
  │   ├─ Agent B (team: "mission") ──→ thực thi
  │   └─ Agent C (team: "mission") ──→ thực thi
  │
  ├─ Phase 3: Active Monitoring (real-time)
  │   ├─ Agent A → Lead: "Scaffolding done, types at src/types/"
  │   ├─ Lead → Agent B: "Types ready at src/types/, bạn có thể bắt đầu"
  │   ├─ Agent C → Lead: "BUILD_RESULT: FAIL — missing dependency"
  │   ├─ Lead → Agent C: "Run npm install @types/react first"
  │   ├─ Agent C → Lead: "Fixed, BUILD_RESULT: PASS"
  │   └─ Lead tracks: "Progress: 2/3 agents completed"
  │
  ├─ Phase 4: Integration Verification
  │   ├─ Lead chạy build toàn project
  │   ├─ Nếu fail → gửi DM cho agent chịu trách nhiệm
  │   └─ Đợi fix → rebuild → lặp lại
  │
  └─ Phase 5: Documentation & Cleanup
      ├─ Write README.md
      ├─ SendMessage(shutdown_request) → all teammates
      └─ TeamDelete
```

### Khác biệt so với Standard Mode

| Aspect | Standard | Agent Teams |
|---|---|---|
| **Giao tiếp** | Không — agents chạy độc lập | DM giữa agents qua SendMessage |
| **Monitoring** | Lead chờ kết quả cuối | Lead active monitor, can thiệp real-time |
| **Coordination** | Không — mỗi agent tự lo | Lead làm cầu nối giữa agents |
| **Error recovery** | Spawn fixer agent riêng | Gửi DM yêu cầu agent fix, reassign nếu cần |
| **UI tab "Messages"** | Không hiện | Hiện tab Messages với DMs/broadcasts |

### Tab Messages (chỉ Agent Teams Mode)

Khi dùng Agent Teams Mode, Dashboard sẽ hiện thêm tab **Messages**:

```
┌──────────────────────────────────────┐
│ [Activity] [Agents] [Files] [Messages] │
├──────────────────────────────────────┤
│                                      │
│ 💬 3 DMs  📢 1 Broadcast  ⛔ 0      │
│──────────────────────────────────────│
│                                      │
│ 14:05:22  [DM]                       │
│ scaffolder → Lead                    │
│ "Setup done, all types exported"     │
│                                      │
│ 14:05:25  [DM]                       │
│ Lead → ui-builder                    │
│ "Types ready at src/types/quiz.ts"   │
│                                      │
│ 14:06:10  [DM]                       │
│ ui-builder → Lead                    │
│ "BUILD_RESULT: PASS, all done"       │
│                                      │
│ 14:07:01  [Broadcast]                │
│ Lead → Everyone                      │
│ "All agents completed, verifying..." │
│                                      │
└──────────────────────────────────────┘
```

### Khi nào dùng Agent Teams Mode?

- Khi agents cần chia sẻ output/context real-time (VD: Agent A tạo types, Agent B cần dùng)
- Khi bạn muốn Lead can thiệp giữa chừng (gửi fix instructions)
- Khi task phức tạp có nhiều dependencies giữa agents

### Lưu ý quan trọng

- **Agent Teams là experimental** — có thể gặp lỗi không mong muốn
- Nếu Agent Teams mode gặp vấn đề, thử lại với Standard Mode
- Standard Mode đủ mạnh cho 90% use cases

---

## Quy trình Mission chi tiết

### Bước 1: Tạo Mission (Launcher)

```
┌─────────────────────────────────────┐
│ 🚀 Agent Teams Guide                │
├─────────────────────────────────────┤
│                                     │
│ Thư mục Project:                    │
│ [D:\projects\my-app    ] [Browse]   │
│                                     │
│ Yêu cầu của bạn:                   │
│ ┌─────────────────────────────────┐ │
│ │ Build a quiz app with React...  │ │
│ │ Support single choice A,B,C,D   │ │
│ │ @src/types/quiz.ts              │ │
│ └─────────────────────────────────┘ │
│ 💡 Gõ @ để mention file             │
│                                     │
│ 📎 Tài liệu tham khảo (2)          │
│   [📄 quiz.ts] [🖼 mockup.png] [+] │
│                                     │
│ Model:                              │
│ [● Sonnet 4.6] [○ Opus 4.6] [○ Haiku] │
│                                     │
│ Execution Mode:                     │
│ [● Standard] [○ Agent Teams]        │
│                                     │
│        [👁 Preview Prompt] [Launch] │
└─────────────────────────────────────┘
```

**Tính năng Launcher:**
- **@mention**: Gõ `@` trong textarea để tìm và đính kèm file từ project
- **Drag & Drop**: Kéo file/folder vào để đính kèm làm tài liệu tham khảo
- **Ctrl+V**: Dán ảnh từ clipboard (screenshot, mockup)
- **Preview Prompt**: Xem trước prompt sẽ gửi cho Claude

### Bước 2: Review Plan

Sau khi Claude phân tích, bạn thấy kế hoạch:

```
┌──────────────────────────────────────────┐
│ 📋 Xem xét kế hoạch                     │
├──────────────────────────────────────────┤
│                                          │
│ Agents:                                  │
│ ┌──────────────────────────────────────┐ │
│ │ scaffolder — Project Setup           │ │
│ │   Model: sonnet [Đổi ∨]             │ │
│ │                                      │ │
│ │ ui-builder — UI Components           │ │
│ │   Model: sonnet [Đổi ∨]             │ │
│ │                                      │ │
│ │ api-dev — Backend API                │ │
│ │   Model: sonnet [Đổi ∨]             │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ Tasks (kéo để sắp xếp):                 │
│ ┌──────────────────────────────────────┐ │
│ │ ≡ 1. Initialize project structure    │ │
│ │   → scaffolder                       │ │
│ │ ≡ 2. Create quiz form component      │ │
│ │   → ui-builder                       │ │
│ │ ≡ 3. Build REST API endpoints        │ │
│ │   → api-dev                          │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [← Quay lại]  [Thêm chỉ dẫn]  [Tiếp →] │
└──────────────────────────────────────────┘
```

**Bạn có thể:**
- Đổi model cho từng agent (VD: upgrade agent phức tạp lên Opus)
- Kéo thả tasks để sắp xếp lại thứ tự
- Thêm chỉ dẫn tùy chỉnh (skill content, coding conventions)

### Bước 3: Prompt Preview

Xem lệnh cuối cùng trước khi chạy. Lệnh bao gồm:
- Project context (path, type)
- Danh sách agents + tasks
- Execution protocol (phased)
- Quality gates

### Bước 4: Dashboard (Giám sát)

```
┌──────────────────────────────────────────────┐
│ 🎯 Mission Dashboard                        │
│ Status: Running ▓▓▓▓▓▓░░░░ 60%              │
├──────────────────────────────────────────────┤
│ [Activity] [Agents] [Files] [Messages*]      │
├──────────────────────────────────────────────┤
│                                              │
│ ⚡ Lead          💬 scaffolder → Lead         │
│ 📋 scaffolder    "Setup done, PASS"          │
│ 🔧 ui-builder    ─────────────────           │
│ 📋 api-dev       💬 Lead → ui-builder        │
│                  "Types ready, proceed"      │
│                  ─────────────────           │
│                  🔧 ui-builder               │
│                  Writing LoginForm.tsx...     │
│                                              │
├──────────────────────────────────────────────┤
│ [📝 Gửi thêm lệnh]  [⏸ Dừng]  [🔄 Reset]  │
└──────────────────────────────────────────────┘

* Tab Messages chỉ hiện ở Agent Teams Mode
```

**Các Tab:**
- **Activity**: Log stream real-time từ tất cả agents
- **Agents**: Card hiển thị status, role, current task cho mỗi agent. Click "Log" để filter logs theo agent
- **Files**: Danh sách files được tạo/sửa/xóa
- **Messages**: (Agent Teams only) Tin nhắn DM giữa agents

**Can thiệp giữa chừng:**
- Click "Gửi thêm lệnh" → nhập hướng dẫn bổ sung → agents nhận và điều chỉnh
- Click "Dừng" → dừng mission hiện tại
- Click "Reset" → xóa sạch và bắt đầu lại

---

## Tính năng nâng cao

### @mention file trong Launcher

Gõ `@` trong textarea để tìm kiếm file trong project:

```
Yêu cầu: Fix bug in @src/utils/parser.ts that causes...
                      ↑
                      Dropdown hiện ra với kết quả tìm kiếm
```

File được mention sẽ tự động đính kèm làm tài liệu tham khảo — agent sẽ đọc nội dung file khi thực thi.

### Đính kèm tài liệu tham khảo

Có 3 cách đính kèm:
1. **@mention** — gõ `@` trong textarea
2. **Drag & Drop** — kéo file/folder từ Explorer vào Launcher
3. **Clipboard** — Ctrl+V khi có ảnh trong clipboard (screenshot, mockup)

Hỗ trợ: code files, images (PNG/JPG), folders, documents

### Chọn Model cho từng agent

Ở Plan Review, mỗi agent có thể dùng model khác nhau:

| Model | Khi nào dùng |
|---|---|
| **Sonnet 4.6** | Task thông thường — nhanh, tiết kiệm |
| **Opus 4.6** | Task phức tạp — architecture, security audit |
| **Haiku 4.5** | Draft/prototype — siêu nhanh, rẻ |

**Mẹo**: Dùng Sonnet cho scaffolder/utility agents, Opus cho core logic agents.

Model bạn chọn được đồng bộ chính xác: backend gửi đúng model tới Claude CLI, và dashboard hiển thị đúng model đã chọn cho từng agent.

### History & Re-run

Launcher lưu 50 mission gần nhất:
- Click lịch sử để re-run với cùng params
- Xóa từng entry hoặc xóa hết

### Continue từ History (Fork)

Bạn có thể tiếp tục công việc từ bất kỳ mission cũ nào:

1. Mở **Mission History** ở cuối trang Launcher
2. Expand mission muốn tiếp tục → click **"Continue mission"**
3. App hiển thị dashboard của mission cũ (read-only) kèm banner xanh:
   > 🔀 Tiếp tục từ mission cũ — nhập yêu cầu mới ở ô bên dưới rồi gửi
4. Nhập yêu cầu mới vào ô Intervention (ví dụ: "Add dark mode support")
5. Gửi → hệ thống tạo **mission MỚI** (fork), liên kết với mission gốc

**Lưu ý quan trọng:**
- Mission mới có ID riêng, **không ghi đè** mission cũ
- Trong History, mission fork hiện badge: `↳ từ: {tên mission gốc}`
- Context từ mission gốc (tasks, logs, files) được truyền vào prompt mới
- Model của Lead agent được kế thừa từ mission gốc

---

## Permission Modes — 4 chế độ quyền hạn

Chọn ở Launcher → **Permission Mode** trước khi launch mission.

### Auto-pilot (mặc định)
Lead agent tự quyết mọi thứ — không hỏi, không dừng lại. Phù hợp với đa số task có yêu cầu rõ ràng.

### Interactive
Lead agent có thể **dừng lại và hỏi bạn** khi thiếu thông tin quan trọng. Sử dụng giao thức:
```
<<<QUESTION>>>
{"question": "...", "options": [...]}
<<<END_QUESTION>>>
<<<QUESTIONS_END>>>
```
Khi có câu hỏi, một **QuestionCard** xuất hiện trong dashboard — chọn option hoặc gõ free text → Submit. Lead tiếp tục từ chỗ đã dừng.

**Khi nào dùng:** Yêu cầu có nhiều cách tiếp cận khác nhau, hoặc bạn muốn Lead xác nhận trước khi đưa ra quyết định quan trọng (chọn tech stack, architecture, etc.).

### Plan Only
Lead chỉ lên kế hoạch và dừng lại — không deploy agents. Dùng để xem plan trước khi quyết định.

### Deep Plan
Xem phần [Deep Plan Mode](#deep-plan-mode) bên dưới.

---

## Deep Plan Mode

*(Có từ v0.3.0)*

Deep Plan là chế độ permission mode thứ 4, thêm **Phase 0 brainstorming** trước khi lên kế hoạch chính thức.

### Cách hoạt động

```
Phase 0: Brainstorming (Deep Plan)
  └─ Lead chạy superpowers brainstorming skill
  └─ Lead đặt câu hỏi làm rõ yêu cầu
  └─ Bạn trả lời → Lead tổng hợp insights
  └─ [Phase 0 hoàn thành]
         ↓
Phase 1: Planning (bình thường)
  └─ Lead lên kế hoạch chi tiết dựa trên answers từ Phase 0
  └─ Output: JSON plan (agents + tasks)
         ↓
Phase 2: Review → Deploy (bình thường)
```

Phase 0 là **bắt buộc** và **tự hoàn thành** — Lead không chuyển sang Phase 1 cho đến khi Q&A hoàn tất.

### Yêu cầu

- Cần có **superpowers plugin** cài trong Claude CLI:
  ```bash
  # Kiểm tra
  ls ~/.claude/plugins/cache/claude-plugins-official/superpowers/
  ```
  Nếu chưa có → cài từ [claude-plugins-official](https://github.com/anthropics/claude-plugins-official)

### Khi nào nên dùng Deep Plan

| Tình huống | Dùng Deep Plan? |
|-----------|----------------|
| Yêu cầu rõ ràng, cụ thể | ❌ Không cần (dùng Auto-pilot) |
| Yêu cầu có nhiều cách tiếp cận, chưa biết tech stack | ✅ Nên dùng |
| Project phức tạp, nhiều components liên quan | ✅ Nên dùng |
| Muốn AI hỏi để hiểu ý định sâu hơn | ✅ Nên dùng |

### Ví dụ

**Yêu cầu**: "Xây dựng hệ thống quản lý đơn hàng"

**Không có Deep Plan** → Lead sẽ tự đưa ra các quyết định (tech stack, database, auth...).

**Có Deep Plan** → Lead hỏi trước:
- "Backend framework nào? Node.js/Django/Laravel?"
- "Database quan hệ hay NoSQL?"
- "Cần authentication không? Nếu có, dùng JWT hay session?"
- "Có tích hợp payment gateway không?"

Sau khi bạn trả lời, plan sẽ chính xác và phù hợp với context của bạn hơn.

---

## Virtual Office (Pixel Agents)

*(Có từ v0.4.0)*

Virtual Office là panel hiển thị trong **MissionDashboard** khi mission đang chạy. Các agent characters pixel-art di chuyển, ngồi vào desk, nói chuyện qua speech bubble theo real-time.

### Giao diện

```
┌─────────────────────────────────────────────┐
│  [Activity Log]  [Virtual Office]  [Tasks]   │
├─────────────────────────────────────────────┤
│                                             │
│   🖥️  [Lead]──────────────[Backend]  🖥️    │
│   💬 "Planning..."       💬 "Writing..."    │
│                                             │
│   🖥️  [Frontend]                            │
│   💬 "Building..."                          │
│                                             │
│                          [⚙️ Edit Layout]   │
└─────────────────────────────────────────────┘
```

### Đọc trạng thái agents

| Hiển thị | Ý nghĩa |
|----------|---------|
| Character đang đi | Agent đang di chuyển đến desk |
| Character ngồi tại desk | Agent đang làm việc |
| Speech bubble xuất hiện | Agent đang dùng tool (Read, Write, Bash...) |
| Character đứng yên | Agent Idle hoặc Done |

### Chỉnh sửa layout với TileEditor

1. Click nút **⚙️** (góc dưới phải Virtual Office)
2. TileEditor mở ra với grid hiển thị layout hiện tại
3. **Thêm tile**: Click loại tile muốn thêm (Desk, Plant, Bookshelf...) → Click vào ô trống
4. **Xóa tile**: Click tile → Delete hoặc chọn "Empty"
5. **Undo/Redo**: Ctrl+Z / Ctrl+Y
6. **Lưu**: Click "Save Layout" — layout được lưu vào userData, tự dùng cho các mission sau

### Lưu ý kỹ thuật

- Agent characters được assign vào desk slots theo thứ tự spawn
- Nếu nhiều agents hơn số desk, agents thừa sẽ đứng ở floor
- Layout mặc định (`default-layout-1.json`) được dùng nếu chưa có layout tùy chỉnh

---

## Reliability & Feedback *(Có từ v0.8.0)*

### Toast Notifications

Ứng dụng hiển thị thông báo dạng toast ở góc trên bên phải màn hình. Toast xuất hiện tự động khi:

| Loại | Khi nào |
|------|---------|
| 🔴 **Error** | IPC command thất bại (launch, deploy, stop, answer...) |
| 🟡 **Warning** | Planning quá 8 phút, mockup sắp timeout |
| 🔵 **Info** | Planning vượt 3 phút, retry agent thành công |
| 🟢 **Success** | (dùng nội bộ) |

**Giới hạn**: Tối đa 5 toast cùng lúc. Toast cũ nhất tự biến mất khi toast thứ 6 xuất hiện. Nhấn **×** để đóng thủ công.

**Tự động đóng theo loại:**
- Error: 6 giây
- Warning: 5 giây
- Info: 4 giây
- Success: 3 giây

---

### Planning Progress Timer

Trong khi Lead đang lên kế hoạch (PlanningStream), header hiển thị đồng hồ đếm thời gian nhỏ (format `M:SS`) ở góc phải. Mục đích: biết Lead đã plan được bao lâu.

**Toast cảnh báo tự động:**
- Sau **3 phút**: Toast xanh (info) — "Planning đang tiếp tục..."
- Sau **8 phút**: Toast vàng (warn) — "Planning mất khá nhiều thời gian"

Khi plan hoàn thành hoặc bạn click Stop, đồng hồ tự reset.

---

### Agent Retry

Khi một agent gặp lỗi (status **Error**), nút **Retry** xuất hiện trên agent card:

```
┌─────────────────────────┐
│ backend-api             │
│ Status: Error       ❌  │
│ Current task: Build API │
│                         │
│ [Retry]                 │
└─────────────────────────┘
```

**Click Retry:**
1. Agent reset về trạng thái Idle
2. Task của agent reset về pending
3. Lead nhận tín hiệu để re-spawn agent đó
4. Toast thông báo kết quả (thành công hoặc lỗi)

**Lưu ý**: Retry chỉ hiện khi agent có status Error. Nếu agent Idle hoặc Done thì không có nút Retry.

---

### Mockup Timeout Warnings

Khi Lead đang generate mockup (trong Deep Plan hoặc planning phase):

- **Sau 30 giây**: Log entry "Mockup đang generate (30s)..." xuất hiện trong PlanningStream
- **Sau 50 giây**: Log entry và toast vàng xuất hiện — "Mockup sắp timeout"

Nếu mockup timeout, planning tự động tiếp tục mà không có mockup.

---

## Mẹo & Thủ thuật

### 1. Viết Prompt hiệu quả

**Tốt:**
```
Build a quiz app with React + TypeScript + Vite.
Features:
- Create quiz with multiple choice questions (A,B,C,D)
- Timer for each question
- Score calculation at the end
- Responsive UI with Tailwind CSS

All UI text must be in Vietnamese.
```

**Không tốt:**
```
Tạo app quiz cho tôi
```

### 2. Chia mission lớn thành nhiều mission nhỏ

Thay vì 1 mission "Build full e-commerce site", tạo:
1. Mission 1: Product catalog + listing page
2. Mission 2: Shopping cart + checkout
3. Mission 3: User auth + account management
4. Mission 4: Integration tests

### 3. Dùng tài liệu tham khảo

Đính kèm mockup, API docs, hoặc existing code để agent hiểu context tốt hơn:
- Screenshot mockup → Ctrl+V paste
- API spec file → drag & drop hoặc @mention
- Existing types → @mention file

### 4. Kiểm tra Quality Gates

Sau khi mission hoàn tất, kiểm tra:
- [ ] Build passes (`npm run build` / `cargo build`)
- [ ] App starts without crash
- [ ] All files exist (check Files tab)
- [ ] No TODO/placeholder trong code
- [ ] README.md có install + run instructions

Nếu bất kỳ gate nào fail → dùng "Gửi thêm lệnh" để yêu cầu fix.

---

## Khắc phục sự cố

### "Claude CLI not found"

**Nguyên nhân**: Claude CLI chưa cài hoặc không trong PATH

**Fix**:
```bash
# Kiểm tra
claude --version

# Cài đặt: https://docs.anthropic.com/claude-code
npm install -g @anthropic-ai/claude-code
```

### Mission chạy chậm

1. Chia task nhỏ hơn
2. Upgrade model (Sonnet → Opus cho task core)
3. Kiểm tra đường dẫn project đúng
4. Xem logs — agent có thể đang loop sửa lỗi build

### Mission bị dừng đột ngột (STOPPED / FAILED)

1. Xem tab **Activity** để tìm lý do
2. Nếu lỗi code → fix trong project, rồi click "Tiếp tục"
3. Nếu hết token/rate limit → đợi rồi thử lại
4. Click "Reset" để bắt đầu lại nếu cần

### Build fail sau mission

Có thể do conflict giữa agents:
1. Chạy build manually: `npm run build`
2. Đọc error messages
3. Dùng "Gửi thêm lệnh" với error message cụ thể

### UI stuck ở "Reviewing Plan"

Nếu mission kết thúc mà UI vẫn hiện Plan Review:
- Refresh trang (Ctrl+R)
- App tự detect trạng thái và chuyển về Done

### Agent Teams không tạo team

Nếu dùng Agent Teams mode mà không thấy messages:
- Kiểm tra log xem Lead có gọi TeamCreate không
- Thử lại với Standard Mode (ổn định hơn)

### Files tab trống dù agent đã viết files

1. Xem logs để tìm đường dẫn file agent đã viết
2. Mở folder project bằng Explorer
3. File có thể được viết ở subfolder khác

---

## FAQ

**Q: Standard hay Agent Teams?**
A: Dùng **Standard Mode** cho hầu hết mọi task. Chỉ thử Agent Teams khi cần agents giao tiếp real-time với nhau.

**Q: Có thể chạy 2 mission cùng lúc không?**
A: Không — 1 mission tại một thời điểm. Dừng mission hiện tại trước khi bắt đầu mới.

**Q: Agent có thể làm gì?**
A: Đọc/viết file, chạy lệnh shell, phân tích code, cài packages, build project, viết tests — tùy vào prompt.

**Q: Mission có timeout không?**
A: Không có timeout cố định. Mission chạy đến khi hoàn tất hoặc bạn dừng.

**Q: Lịch sử lưu ở đâu?**
A: `~/.claude/agent-teams-history.json` — lưu tối đa 50 mission gần nhất.

**Q: Tôi chọn Opus cho agent nhưng dashboard hiển thị Sonnet?**
A: Bug này đã được fix. Model bạn chọn ở PlanReview giờ được đồng bộ chính xác vào cả backend lẫn frontend. Dashboard hiển thị đúng model bạn đã chọn.

**Q: "Continue mission" từ history có ghi đè mission cũ không?**
A: Không. Hệ thống tạo mission **hoàn toàn mới** (fork) với ID riêng. Mission cũ giữ nguyên. Mission mới hiện badge `↳ từ: ...` trong history.

**Q: Làm sao biết mission thực sự thành công?**
A: Kiểm tra log có `[Lead] INTEGRATION_VERIFIED: PASS` và `[Lead] Mission complete`. Nếu không có → mission có thể kết thúc sớm.

---

---

## Mục lục cập nhật

- [Reliability & Feedback](#reliability--feedback-có-từ-v080) — Toast, Planning Timer, Agent Retry, Mockup Timeout *(v0.8.0)*
- [Virtual Office](#virtual-office-pixel-agents) — Pixel Agents *(v0.4.0)*
- [Deep Plan Mode](#deep-plan-mode) — Brainstorming phase *(v0.3.0)*
- [Permission Modes](#permission-modes--4-chế-độ-quyền-hạn) — Auto/Interactive/Plan Only/Deep Plan
- [Continue từ History](#continue-từ-history-fork) — Fork mission cũ

---

**Phiên bản tài liệu**: 2.2
**Cập nhật lần cuối**: 2026-07-07
**Ngôn ngữ**: Tiếng Việt
