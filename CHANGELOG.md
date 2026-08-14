# Changelog

Tất cả thay đổi đáng chú ý của dự án Agent Teams Guide được ghi nhận tại đây.

Format dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [0.15.0] — 2026-08-12

### Sửa lỗi — 8 vấn đề nghiêm trọng (Critical Issues Review)

- **#1 Retry timer không bị huỷ khi dừng mission**: timer chờ retry (dangling-question, transient-error) ở cả 4 điểm launch/deploy tiếp tục chạy ngầm sau khi user bấm Stop hoặc Reset, có thể resume nhầm 1 mission đã bị dừng. Giờ mọi timer được track và huỷ đúng lúc `stop_mission`/`reset_mission`; thêm xác nhận trước khi dừng 1 mission đang có retry chờ xử lý.
- **#2 Command injection trong `launch_in_terminal`** (Critical): tham số đường dẫn dự án/mission được nội suy thẳng vào lệnh `cmd.exe` mà không escape, cho phép chèn lệnh tuỳ ý qua tên thư mục dự án. Đã tách `buildLaunchTerminalPlan` để dựng lệnh an toàn, bổ sung lớp caret-escaping 2 tầng cho `cmd.exe`.
- **#3 QC/QA verdict parser đọc nhầm text**: verdict PASS/FAIL được trích từ toàn bộ stream-json thay vì chỉ từ message assistant đã hoàn chỉnh, có thể match nhầm placeholder/text tạm thời giữa chừng. Giờ chỉ trích xuất từ assistant message hoàn chỉnh, dùng đúng `parseLine` của adapter.
- **#4 QC/QA spawn thiếu error listener**: process con của QC/QA không có listener cho event `error` — 1 lỗi spawn (vd. binary không tồn tại) làm crash toàn bộ tiến trình chính thay vì được xử lý gọn.
- **#5 Export & Plan Version History gọi nhầm API không tồn tại**: `ExportDropdown`, `PlanVersionHistory`, và thao tác lưu version thủ công trong `PlanDocument` gọi `window.electron.*` (API không tồn tại trong Electron thật) thay vì `invoke()` — 3 tính năng này im lặng không hoạt động. Đã nối đúng lại qua `invoke()`.
- **#6 Rò rỉ sự kiện IPC giữa Replay và mission đang chạy**: khi xem lại (replay) 1 recording trong lúc có mission khác đang chạy thật, cả 2 luồng event `mission:*` bị trộn lẫn do dùng chung channel — có thể khiến dashboard live hiển thị nhầm dữ liệu từ recording. Giờ replay phát qua namespace riêng `replay:mission:*`, tách biệt hoàn toàn khỏi luồng live.
- **Bonus**: dashboard replay không hiển thị `projectPath` cho tới khi seek lần đầu — đã fix để hiển thị ngay khi bắt đầu phát lại.
- **#8 (không phải bug của dự án)**: điều tra lỗi vitest runner thất bại ngẫu nhiên trong CI, xác định là race condition thượng nguồn của Vite — đóng issue, không cần fix code.

### Thêm mới — CI Pipeline (Issue #7)

- **GitHub Actions workflow**: tự động chạy lint, unit test, build-check, và e2e test trên mỗi PR/push — chặn merge nếu có lỗi.
- **ESLint flat config**: thêm `eslint.config.js`, dọn sạch toàn bộ vi phạm hiện có (`no-unused-vars`, `no-useless-assignment`, `preserve-caught-error`, `no-control-regex`, `no-useless-escape`, `react/no-unescaped-entities`).
- **Ổn định hoá e2e test trong CI**: sửa nhiều race condition chỉ xảy ra trên máy CI (timing fake-claude/Playwright, reset renderer state mỗi lần seek, đồng bộ QC/QA bằng tín hiệu thật thay vì delay đoán mò), loại Playwright specs khỏi glob mặc định của Vitest.

### 🛠️ Build

- **Giảm ~40% dung lượng installer** (259 MB → 150 MB): `onnxruntime-web` (WASM backend, không bao giờ được dùng vì `@huggingface/transformers` chỉ chạy trong Electron main process/Node) và model cache bị lỡ tay cuốn vào `node_modules` lúc dev đã bị loại khỏi build qua `build.files` trong `package.json`. `app.asar` giảm từ 278 MB xuống còn 63 MB.

---

## [0.14.0] — 2026-08-05

### Thêm mới

- **Tab "Ask" — hỏi đáp trực tiếp trong lúc mission đang chạy**: side-channel chỉ đọc, cho phép hỏi mission đang chạy 1 câu hỏi bất kỳ mà không can thiệp vào luồng chính (`ask_mission_live`).
- **Tab "Chat" trong màn hình lịch sử**: mở lại 1 mission đã hoàn tất và trò chuyện để ôn lại bối cảnh, dựa trên toàn bộ log/task/message đã lưu (`askMissionChat`).
- **Tự động sinh bản tóm tắt debrief** (`goal`, `agents_involved`, `key_files`, `issues_encountered`, `outcome`) ngay khi mission chuyển `Completed`, lưu kèm mission trong lịch sử.

### Sửa lỗi

- **Bug Critical — stdin không được ghi**: `askMissionLive`, `generateDebriefSummary` (mission.cjs) và `askMissionChat` (history.cjs) đều build prompt, spawn process con và gắn listener đọc stdout, nhưng chưa từng gọi `proc.stdin.write(prompt)` — process con luôn nhận input rỗng nên câu trả lời/tóm tắt luôn trống. Mọi unit test (dùng mock process) vẫn pass vì không phụ thuộc vào việc stdin có được ghi hay không. Đã bổ sung `proc.stdin.write(prompt); proc.stdin.end()` ở cả 3 nơi gọi, và thêm test E2E chạy với process thật (`mission-companion-real-usage.spec.ts`) để lỗi này không thể tái diễn âm thầm.
- **`TaskCompleted` có thể tạo task trùng lặp trong vòng retry QC/QA**: khi 1 dòng "Completed:" từ vòng retry đến trước khi task kịp chuyển lại từ `failed_qc`/`failed_qa` về `in_progress` (do độ trễ hiển thị `QC_QA_FAILURE_VISIBILITY_DELAY_MS`), hệ thống match nhầm là task mới thay vì nhận ra đây là cùng 1 task — giờ khớp theo bất kỳ trạng thái nào chưa phải `completed`.

---

## [0.13.3] — 2026-08-04

### Sửa lỗi

- **Race condition giữa per-task QC/QA và Final QA sweep**: khi process exit, `runFinalQaSweep` chạy ngay trong khi per-task QC/QA checks (async, subprocess riêng) chưa kịp hoàn tất — task còn ở `pending_qc`/`pending_qa` nên sweep bỏ qua hoàn toàn. Giờ sweep đợi mọi pending QC/QA settle trước khi quyết định (poll 500ms, timeout 120s).
- **Stuck retry tasks không emit TaskCompleted**: khi auto-resumed Lead fix xong và exit mà không emit `<<<TASK_COMPLETED>>>` marker (vì respond system nudge chứ không đi qua flow bình thường), task kẹt ở `in_progress` vĩnh viễn, khiến `runFinalQaSweep` skip và đốt hết 3 lần auto-resume. Giờ tự động promote task có `qcRound > 0` (đã qua QC/QA trước đó) sang `pending_qc` để re-verify trước khi chạy final sweep.

---

## [0.13.1] — 2026-08-01

### Thêm mới

- **Auto-resume mission sau khi Final QA sweep fail**: khi vòng quét QA cuối cùng (final QA sweep) phát hiện lỗi và lên lịch retry, nhưng process `claude` đã thoát — hệ thống giờ tự động spawn lại process mới (resume session nếu có `session_id`, fresh launch nếu không) để tiếp tục sửa task bị đánh dấu lỗi, thay vì dừng lại chờ user bấm Retry thủ công.
- **Giới hạn auto-resume 3 lần liên tiếp**: nếu mission vẫn không đạt `Completed` sau 3 lần tự resume, dừng lại và yêu cầu can thiệp thủ công — tránh loop vô hạn đốt API credit.
- **Reset counter auto-resume**: `autoResumeCount` tự reset về 0 khi mission đạt `Completed` hoặc khi user bấm Retry thủ công — mỗi lần retry thủ công được cấp budget mới.

---

## [0.13.0] — 2026-07-31

### Thêm mới

- **Vòng lặp kiểm tra QC/QA cho từng task**: mỗi task giờ đi qua 1 vòng kiểm tra chất lượng độc lập trước khi được tính là hoàn tất — sau khi agent báo "Completed", task chuyển sang `pending_qc` (QC-Agent kiểm tra), nếu đạt thì sang `pending_qa` (QA-Agent kiểm tra), chỉ khi cả 2 đều PASS task mới thành `completed`. Nếu FAIL, task quay lại `in_progress` để agent sửa, có leo thang mức độ (escalation tier) nếu fail nhiều lần liên tiếp.
- **Vòng quét QA toàn cục trước khi Mission "Completed"**: dù các task đều xanh, mission chỉ chuyển sang trạng thái `Completed` sau khi vượt qua 1 lượt quét QA tổng thể (`runFinalQaSweep`) — áp dụng cho cả luồng thoát theo exit-code lẫn luồng Agent Teams (trước đây luồng Agent Teams có thể tự đánh dấu "Completed" sau 90s không hoạt động, bỏ qua hoàn toàn QC/QA).
- **Trạng thái "Needs Attention" và khả năng phục hồi**: nếu 1 task fail QC/QA quá nhiều lần, mission chuyển sang "Needs Attention" thay vì treo vô thời hạn — nút Retry trên agent card giờ nhận diện được trạng thái này, cho phép người dùng chủ động resume.
- **Hiển thị trạng thái QC/QA rõ ràng trên giao diện**: `TaskList` và `StatusBadge` giờ hiện đúng nhãn cho từng trạng thái trung gian (`Đang chờ QC`, `QC Failed`, `Đang chờ QA`, `QA Failed`, ...) thay vì chỉ 1 icon chung chung.

### Sửa lỗi

- **Mission có thể báo "Failed" sai** khi vòng quét QA cuối cùng fail và lên lịch retry ngay sau khi process chính đã thoát — giờ trường hợp này được nhận diện đúng là "đang chờ retry", không báo Failed nhầm.
- **`replay-real-ui-fidelity.spec.ts` không còn đạt trạng thái Completed** sau khi thêm cổng QC/QA — đã cập nhật kịch bản test để phát đúng các verdict QC/QA PASS cần thiết.
- **Test E2E `qcqa-verification-loop.spec.ts` bị flaky ngẫu nhiên** (~50% khi chạy song song với test khác) do cửa sổ hiển thị trạng thái fail quá ngắn (400ms) — tăng lên 900ms để ổn định.
- **Tiến trình `claude` trên Windows không bị kill hoàn toàn**: `proc.kill()` trước đây chỉ kill được tiến trình `cmd.exe` bao ngoài (do cách Windows resolve file `.cmd`), để lại tiến trình Node thật chạy ngầm — giờ dùng `taskkill /T /F` để kill cả cây tiến trình trên Windows.
- **Một số sự kiện cập nhật trạng thái task từ QC/QA thiếu `task_id`**, có thể khiến giao diện match nhầm task trong vài trường hợp hiếm — đã bổ sung đầy đủ.
- **Hàm dựng prompt `fillTemplate` có thể thay thế nhầm placeholder** nếu nội dung 1 biến chứa chuỗi giống `{{placeholder}}` của biến khác — đã đổi sang thay thế 1 lượt duy nhất (single-pass) để tránh việc này.

---

## [0.12.1] — 2026-07-30

### Sửa lỗi

- **"Phát trên UI thật" không chuyển đúng màn hình theo từng giai đoạn**: khi replay 1 recording ở chế độ "Phát trên UI thật" (`/mission?replay=<id>`), giao diện bị đứng nguyên ở Mission Dashboard suốt cả buổi thay vì chuyển màn hình theo đúng giai đoạn đã ghi (Planning → ReviewPlan → Executing → Done) như lúc chạy thật.
- **Fix**: `useReplay.js` giờ theo dõi `phase` (dựng lại từ các sự kiện `mission:*` được replay) và `MissionControlPage.jsx` chuyển màn hình tương ứng — Planning hiện `PlanningStream`, ReviewPlan hiện `PlanReview` trong lớp phủ chỉ-xem (read-only overlay, nút Deploy bị vô hiệu hoá), Executing/Done hiện `MissionDashboard`.

---

## [0.12.0] — 2026-07-28

### Thêm mới

- **Card Q&A và Mockup trên timeline Presentation Mode replay**: khi xem lại (replay) 1 recording, timeline giờ hiển thị thêm 2 loại card mới xen kẽ đúng vị trí thời gian: card "câu hỏi" (Lead hỏi → user trả lời) và card "Lead đã tạo mockup: `<title>`". Dữ liệu này vốn đã được ghi trong mọi recording (kể cả recording cũ) — chỉ là trước đây `useReplay.js` không lắng nghe 2 channel `mission:question`/`mission:mockup` nên bị bỏ sót khi replay, không cần migrate dữ liệu cũ.

---

## [0.11.4] — 2026-07-27

### Sửa lỗi

- **Mission bị đánh dấu "Completed" ngay sau khi trả lời câu hỏi, dù Lead vẫn đang chạy tiếp**: khi user trả lời câu hỏi, hệ thống `kill` process cũ và spawn process mới để resume session ngay lập tức. Nhưng signal kill là bất đồng bộ — event "process đã đóng" của process cũ có thể đến **trễ**, sau khi process mới đã chạy và đang set status là "Running". Vì không có cơ chế phân biệt "process cũ đã bị thay thế" với "process hiện tại", event trễ này bị hiểu nhầm thành mission đã hoàn tất, đánh dấu toàn bộ mission và agents là "Done" ngay giữa lúc Lead vẫn đang thực thi các bước tiếp theo (đọc file, tạo plan, ...).
- **Fix**: thêm kiểm tra tại thời điểm process đóng — nếu process đó không còn là process đang được theo dõi hiện tại (đã bị thay thế bởi lần resume mới hơn), bỏ qua event đó hoàn toàn thay vì cập nhật trạng thái mission.

---

## [0.11.3] — 2026-07-27

### Sửa lỗi

- **Mission báo "Completed — no plan structure found" dù Lead đã hỏi câu hỏi hợp lệ**: Lead đôi khi kết thúc turn ngay sau khi ghi `<<<QUESTION>>>{...json...}` mà không ghi tiếp 2 marker đóng bắt buộc (`<<<END_QUESTION>>>`, `<<<QUESTIONS_END>>>`). Vì cơ chế nhận diện cũ yêu cầu đủ cả 3 marker mới coi là có câu hỏi, câu hỏi hợp lệ này bị bỏ sót hoàn toàn và mission rơi vào nhánh fallback "không tìm thấy plan" — dù thực chất Lead đang chờ người dùng trả lời.
- **Parser nới lỏng (lenient)**: thêm bước khôi phục cuối cùng, chấp nhận block `<<<QUESTION>>>{...}` kể cả khi thiếu marker đóng — miễn JSON trích ra hợp lệ và có field `question`. Áp dụng cho cả 2 luồng: Planning (lập kế hoạch) và Execution (thực thi/deploy/continue).
- **Retry dự phòng (safety-net)**: khi phát hiện marker `<<<QUESTION>>>` nhưng JSON theo sau bị cắt/hỏng (parser nới lỏng cũng không khôi phục được), hệ thống tự động thử lại (respawn) theo đúng lịch retry sẵn có (tối đa 3 lần, chờ 30s/60s/120s) thay vì báo "no plan found" ngay lập tức.

---

## [0.11.2] — 2026-07-27

### Sửa lỗi

- **Mockup vẫn timeout sau khi tăng lên 120s ở bản 0.11.1**: đo thực tế cho thấy mockup nhiều màn hình/chi tiết (vd. 3 màn hình UI) có thể mất tới 141 giây, sát hoặc vượt mốc 120s. Tăng tiếp timeout lên **180 giây** để có đủ margin an toàn, chỉnh lại mốc cảnh báo tiến độ (90s/150s).

---

## [0.11.1] — 2026-07-27

### Sửa lỗi

- **Business Summary panel biến mất khỏi Mission Plan**: 4 điểm trong code từng vô tình xóa `mission_context` (thông tin nghiệp vụ) khỏi state mỗi khi: bấm "Apply changes" trong tab Tài liệu, rollback về version cũ, mở lại app trong lúc đang review plan, hoặc replan — khiến panel "Nghiệp vụ" biến mất kể cả với mission mới tạo. Giờ `mission_context` được giữ nguyên xuyên suốt các thao tác này.
- **Mockup generation retry luôn thất bại**: timeout cứng 60 giây quá ngắn so với thời gian model `haiku` cần để tạo xong 1 mockup HTML hoàn chỉnh, khiến cả 3 lần retry đều fail giống hệt nhau. Tăng timeout lên 120 giây, đồng thời chỉnh lại mốc cảnh báo tiến độ trong log (60s/100s thay vì 30s/50s).

---

## [0.11.0] — 2026-07-23

### Thêm mới — Light Theme (giao diện sáng)

- **Chuyển đổi Dark/Light**: nút chuyển giao diện ở footer Sidebar, lưu lựa chọn vào `localStorage`, áp dụng lại ngay khi mở app (không bị chớp giao diện tối trước khi chuyển sáng)
- Toàn bộ giao diện (Sidebar, Docs, Playground, Dashboard, Mission Control, các trang mission) đã được chuyển sang hệ màu theo biến CSS (`--vs-*`), tự động đổi màu đúng theo theme đang chọn
- Khối code (syntax highlighting) và các phần tử có nền tối cố định (status bar, toast thông báo) vẫn giữ đúng độ tương phản ở cả hai theme, không bị chữ chìm vào nền

### Cải tiến — Playground

- Toàn bộ nhãn giao diện còn sót tiếng Anh đã được dịch sang tiếng Việt
- Thay hộp thoại `alert()` báo thiếu thư mục dự án bằng dòng cảnh báo hiển thị ngay trong trang, dễ đọc hơn
- Thêm dòng giải thích luôn hiển thị về hành vi nút Launch, giúp người dùng hiểu rõ trước khi bấm

### Kỹ thuật

- `src/index.css`, `tailwind.config.js`: 20 biến màu `--vs-*` định nghĩa dưới `:root` (dark) và `.light`, Tailwind resolve qua `rgb(var(--vs-*) / <alpha-value>)`
- `useTheme.js`: hook áp dụng class `.light` lên `documentElement`, đọc/ghi `localStorage`
- Migrate toàn bộ `text-white`/`bg-white`/`bg-black` sang token theme trong tất cả components, sections và pages (trừ các ngoại lệ nền cố định đã kiểm tra kỹ: toggle-knob trắng, status bar/toast, khối Prism)

---

## [0.10.1] — 2026-07-22

### Cải tiến — Tự động thử lại khi gặp lỗi API tạm thời (rate limit)

- **Retry xuyên suốt mọi phase của mission**: brainstorm/lập kế hoạch, thực thi, trả lời câu hỏi giữa chừng, replan, và các subagent (Agent Teams) — tất cả 6 điểm gọi Claude CLI giờ đều tự động thử lại khi gặp lỗi tạm thời (429/rate limit, lỗi 5xx, overloaded, network reset)
- **Lịch thử lại cố định**: tối đa 3 lần, chờ 30s/60s/120s giữa các lần, log tiến trình thử lại vào mission log bằng tiếng Việt
- Lỗi không thuộc loại tạm thời (sai prompt, lỗi auth, parse failure...) vẫn fail ngay lập tức như trước — không lãng phí thời gian chờ vô ích
- Các phiên resume (`restartLeadAfterMockup`, `answer_question`) thử lại bằng đúng session đang dùng; các phiên spawn mới (`launch_mission`, `deploy_mission`, `continue_mission`) tự capture session id riêng cho từng lần thử để resume đúng lần bị lỗi; `replan_mission` thử lại toàn bộ từ đầu
- Nếu hết cả 3 lần vẫn lỗi, mission chuyển sang trạng thái `Failed` như cũ, kèm thêm 1 dòng log báo đã thử lại hết số lần cho phép

### Kỹ thuật

- `electron/ipc/mission.cjs`: thêm `isTransientApiError()` (nhận diện lỗi tạm thời qua regex) và `retryTransientSpawn()` (helper retry thuần, dependency-injected, tách biệt hoàn toàn với `retryMockupGeneration` đã có)
- `attemptCtx` — object theo dõi stdout/stderr/session_id tích luỹ riêng cho từng lần thử, truyền vào các reader dùng chung (`readProcessStderr`, `readProcessStdout_launch`, `readProcessStdout_deploy`)
- `retryInfo` — truyền vào `watchProcessExit_launch`/`watchProcessExit_deploy` để quyết định thử lại hay chuyển `Failed`

---

## [0.10.0] — 2026-07-21

### Thêm mới — Business Summary

- **Panel BusinessSummary**: tóm tắt kế hoạch bằng ngôn ngữ dễ hiểu, phi kỹ thuật, hiện ngay đầu tab Document trong PlanReview
- Lead agent phát sinh field `mission_context.business` trong lúc lập kế hoạch (Phase 2)
- **BusinessFlowDiagram**: component sơ đồ luồng agent dạng SVG, màu theo từng agent — click vào tag agent để nhảy tới đúng section

### Sửa lỗi (Business Summary)

- Chuẩn hoá tiền tố `Agent:` để tag agent trong business flow nhảy đúng section
- Sửa nhãn tiếng Việt cho badge Input/Output trong BusinessFlowDiagram

### Cải tiến — Mockup Generation & QA Standards

- **Tự động thử lại khi generate mockup**: tối đa 3 lần (60s/lần, không delay giữa các lần) trước khi rơi về hành vi bỏ qua (skip) cũ; log tiến trình từng lần thử vào mission log
- **Chuẩn QA/testing trong prompt lập kế hoạch**: nhúng thẳng thứ tự ưu tiên locator, assertion web-first, cấu trúc Page Object Model, kịch bản Given/When/Then, hướng dẫn test pyramid, và yêu cầu chống flaky vào mandate của agent `qa-tester` — mọi plan sinh ra đều bao gồm các chuẩn này

### Kỹ thuật

- `electron/ipc/mission.cjs`: tách `retryMockupGeneration` thành hàm thuần, dependency-injected, có unit test riêng
- `electron/prompts/planning.md`: thêm block QA/TESTING STANDARDS sau mandate qa-tester hiện có

---

## [0.9.0] — 2026-07-10

### Thêm mới — Kiểm tra bản cập nhật từ GitHub Releases

- **Tự động kiểm tra khi khởi động**: App gọi GitHub Releases API (`/repos/ChupsAlliance/multiAIAgentsClaude/releases/latest`), so sánh với version thật (`app.getVersion()`) qua `compareSemver`
- **Banner cập nhật** trong modal "What's New": nếu có bản mới, hiện banner + nút "Tải về ngay" mở trực tiếp link `.exe` trên GitHub Releases (fallback về trang release nếu không có asset `.exe`)
- **Trạng thái "Đang dùng bản mới nhất"** ở footer modal khi đã là bản mới nhất
- Lỗi mạng/rate-limit/timeout (5s) đều bị bỏ qua âm thầm — không chặn hay làm chậm app khởi động
- **Dọn dẹp**: xoá hằng số `APP_VERSION` bị lệch version (`src/data/changelog.js`) — version hiện lấy trực tiếp từ `app.getVersion()` qua `get_system_info` IPC

### Kỹ thuật (Update Check)

- `electron/lib/compareSemver.cjs` — so sánh semver `x.y.z`, không thêm dependency
- `electron/ipc/system.cjs`: `check_for_updates` IPC handler + field `app_version` trong `get_system_info`
- `src/components/ChangelogModal.jsx`: `useChangelog()` nhận `currentVersion` làm tham số, trả thêm `updateInfo`

### Thêm mới — Mission UX + Power Features

#### Keyboard Shortcuts
- **Unified shortcut registry**: `useAppHotkeys` hook + `SHORTCUT_GROUPS` — một nguồn duy nhất cho tất cả phím tắt
- **Help overlay** (`?`): Nhấn `?` ở bất kỳ đâu → hiện danh sách đầy đủ phím tắt, nhóm theo context
- **Phím tắt mới**:
  - `Ctrl+Enter` — Launch mission (MissionLauncher, chỉ khi đủ điều kiện)
  - `Ctrl+S` — Áp dụng chỉnh sửa plan (PlanDocument, kể cả khi focus trong textarea)
  - `Ctrl+E` — Mở menu xuất file (PlanDocument)
  - `Ctrl+D` — Deploy plan (PlanReview, khi plan ready)
  - `1` / `2` / `3` — Chuyển tab trong PlanReview (Document / Visual / Graph)
  - `r` — Replan (PlanReview, khi không focus input)
  - `Escape` — Đóng modal đang mở (toàn cục)

#### Plan Versioning
- **Version history tự động**: Plan được lưu version mỗi khi parse lần đầu (`initial`), replan (`replan`), chỉnh sửa thủ công (`manual_edit`)
- **Panel "Lịch sử"** trong PlanDocument: Timeline các version, xem diff (added/removed/modified agents & tasks), rollback về version cũ
- **Rollback** tạo version mới (trigger `rollback`) — không bao giờ xóa lịch sử. Tối đa 50 versions/mission
- IPC: `save_plan_version`, `get_plan_versions`

#### Export Nhiều Format
- **Dropdown "Xuất"** thay thế nút "Xuất MD" — 4 format:
  - **Markdown** (`.md`) — xuất qua IPC như cũ
  - **JSON** (`.json`) — toàn bộ mission state (agents, tasks, log, file_changes, plan_versions...)
  - **HTML** (`.html`) — self-contained, inline CSS, dark theme, readable offline
  - **PDF** (`.pdf`) — Electron `printToPDF`, native save dialog
- HTML/PDF XSS-safe: tất cả fields được escape trước khi render

#### Dependency Graph
- **`PlanDependencyGraph`** component: dagre layout + SVG render với `foreignObject` nodes
  - `mode="plan"`: màu theo priority (high=đỏ / medium=vàng / low=xanh)
  - `mode="live"`: màu theo status (in_progress=accent+pulse / completed=xanh / pending=mờ), hiển thị tên agent
  - `depends_on` (array of title strings) được resolve sang task IDs để vẽ edges có mũi tên
- **Tab "Graph"** trong **PlanReview**: static graph, kéo-thả vẫn hoạt động khi switch về tab khác
- **Tab "Graph"** trong **MissionDashboard**: live graph, click node → chuyển sang tab Tasks

### Kỹ thuật

- `src/hooks/useAppHotkeys.js` — `SHORTCUT_GROUPS` registry + `useAppHotkeys({ scope, handlers })` (react-hotkeys-hook v4)
- `src/components/common/ShortcutsHelpModal.jsx` — help overlay đọc từ registry
- `src/utils/exportPlan.js` — `generateSlug`, `generateFilename`, `generateHTML`, `downloadBlob`, `downloadJSON`, `downloadHTML`
- `src/components/mission/ExportDropdown.jsx` — dropdown 4 format với loading state cho PDF
- `src/components/mission/PlanVersionHistory.jsx` — timeline + diff viewer + rollback confirm
- `src/components/mission/PlanDependencyGraph.jsx` — dagre + SVG, ResizeObserver, Bezier edges
- `electron/ipc/mission.cjs`: thêm `save_plan_version`, `get_plan_versions`, `export_plan_pdf`; `dialog` + `BrowserWindow` được import; auto-save `initial` version khi parse plan, `replan` version sau replan
- 6 tests mới cho `exportPlan.js` (generateSlug ×4, generateFilename ×1, generateHTML ×1)

### Phụ thuộc mới

- `react-hotkeys-hook` v4 — keyboard shortcut management
- `@dagrejs/dagre` — graph layout algorithm

---

## [0.8.0] — 2026-07-07

### Thêm mới — Reliability & Feedback

- **Toast notification system**: `ToastProvider` + `useToast` hook — thông báo lỗi, cảnh báo, thành công xuất hiện góc trên phải. Tối đa 5 toast cùng lúc, tự đóng theo loại (error 6s, warn 5s, success 3s, info 4s), có nút × để đóng thủ công. Không dùng thư viện ngoài.
- **IPC error toasts**: 7 IPC call sites trong `useMission.js` giờ hiển thị toast lỗi thay vì im lặng — `launch_mission`, `deploy_mission`, `continue_mission`, `replan_mission`, `stop_mission`, `answer_question`, `mockup_respond`
- **Planning progress timer**: Đồng hồ đếm thời gian hiển thị trong header PlanningStream khi đang planning. Toast cảnh báo tự động: sau 3 phút (`toast.info`) và 8 phút (`toast.warn`)
- **Mockup timeout warnings**: Backend emit log entries sau 30s và 50s khi generate mockup. Sau 50s: toast.warn xuất hiện để người dùng biết mockup có thể hết thời gian
- **Agent Retry button**: Nút "Retry" xuất hiện trên AgentCard khi agent có status Error. Click → IPC `retry_agent` → agent reset về Idle, task về pending, Lead nhận tín hiệu để re-spawn

### Kỹ thuật

- `src/components/ui/ToastProvider.jsx` + `src/hooks/useToast.js` — hệ thống toast độc lập, portal-rendered (React Portal)
- `electron/ipc/mission.cjs`: handler `retry_agent` mới — reset agent/task state và ghi stdin cho Lead process
- Preload whitelist: thêm `retry_agent` vào `ALLOWED_COMMANDS`, `mission:mockup` và `mockup_respond` đã có từ v0.7.1

---

## [0.5.0] — 2026-06-03

### Đã sửa — Bugs & Cleanup
- **Fix bug nghiêm trọng**: `useAgentTeams` undefined trong `continue_mission` — file watcher không bao giờ start ở Agent Teams mode khi dùng Continue. Fix: dùng `execMode === 'agent_teams'`
- **Xóa debug code khỏi production**: Bỏ `openDevTools()` trên main window và webview, xóa toàn bộ `[DEBUG]` console logs trong `main.cjs`

### Refactor
- **`buildMissionSummary()`**: Extract helper function thay thế 3 đoạn code trùng lặp (trong `launch_mission`, `continue_mission` fork path, `continue_mission` normal path)
- **`collectFiles()` tái sử dụng**: Thay inline `scanDir` function trong `readProcessStdout_deploy` bằng `collectFiles` có sẵn

### Tài liệu
- Cập nhật toàn bộ CHANGELOG, README, USER_GUIDE theo version
- Tạo git tags cho tất cả các version milestone (v0.1.0 – v0.5.0)

---

## [0.4.0] — 2026-05-30

### Thêm mới — Virtual Office (Pixel Agents)
- **Pixel Agents Webview**: Thay thế hoàn toàn CSS canvas bằng `<webview>` nhúng pixel-art animation — agent characters di chuyển real-time trên office floor theo mission state
- **`pixelAgentsProtocol.js`**: Translation layer giữa `missionState` (Electron) và định dạng native của pixel-agents; có test coverage
- **`useAgentSync` hook**: Bridge state từ mission events sang pixel-agents protocol — agent di chuyển, ngồi vào desk, nói chuyện bubble khi tool đang chạy
- **TileEditor**: Chỉnh sửa office layout tương tác — thêm/bớt/đổi tile, Undo/Redo, export JSON
- **IPC handlers mới**: `pa:save-layout`, `pa:save-seats`, `load_office_layout` (pixel-agents native format)
- **Webview preload**: Mock `acquireVsCodeApi` + inject asset paths để pixel-agents webview hoạt động trong Electron sandbox
- **Default layout**: Bundle sẵn `default-layout-1.json` làm fallback khi chưa có layout lưu

### Đã sửa
- Fix pixel-agents không render agent characters — gửi đúng native layout format
- Fix webview reload khi mission start để `webviewReady` event re-fire
- Fix webview-preload không hoạt động trong sandbox mode
- Fix global CSP hook làm vỡ main renderer
- Fix canvas blank — dynamic tileSize và correct ResizeObserver
- Disable `AGENT_TEAMS` env trong planning phase (Lead phải output JSON plan thay vì spawn agents ngay)
- Enable `AGENT_TEAMS` trong deploy/continue phases để Lead có Agent tool

### Kỹ thuật
- Pixel-agents webview-ui dist bundled tại `src/assets/pixel-agents-webview/`
- Build script: `node scripts/build-pixel-agents.cjs` để rebuild webview từ nguồn
- Vitest test runner thay thế custom test runner; 48 tests (4 test files)

---

## [0.3.0] — 2026-04-17

### Thêm mới — Deep Plan Mode
- **Deep Plan** (chế độ permission thứ 4): Thêm Phase 0 brainstorming trước khi lên plan — Lead chạy superpowers brainstorming skill, tự động đặt câu hỏi làm rõ yêu cầu trước khi ra kế hoạch chi tiết
- **`read_superpowers_skill` IPC handler**: Tự động tìm và đọc SKILL.md từ thư mục plugins cache, hỗ trợ semver sort để lấy version mới nhất
- **Phase 0 self-contained**: Phase 0 block Phase 1 hoàn toàn cho đến khi Q&A xong; deep_plan mode luôn bắt buộc Q&A

### Thêm mới — Prompt Preview Verbatim
- **PromptPreview verbatim path**: Khi user đã xem preview và chỉnh sửa prompt, `deploy_mission` dùng đúng prompt đó (verbatim) thay vì rebuild từ task list
- **`buildAgentPrompt()`**: Helper function tại `src/data/planMarkdown.js` build full agent prompt từ template, task list, skill file, và custom instructions
- **agentPrompts map**: Frontend truyền `agentPrompts` riêng qua IPC để backend không cần rebuild

### Thêm mới — Crash-safe Persistence
- **Auto-save snapshot**: Mission state được lưu mỗi 10 giây vào `~/.claude/agent-teams-snapshots/`
- **Crash recovery**: `get_incomplete_missions` scan snapshots tìm missions chưa hoàn thành (< 7 ngày tuổi)
- **Resizable agent sidebar**: Panel tỷ lệ được lưu vào localStorage

### Đã sửa
- Fix stale closure trong PlanReview agent sync useEffect
- Fix Q&A resume — file watcher restart sau khi answer question trong agent_teams mode
- Fix Phase 0 không block Phase 1: planning process bị kill ngay khi plan JSON được phát hiện

---

## [0.2.0] — 2026-03-20

### Added — Agent Question Protocol
- **Permission Mode selector**: 3 modes — Auto-pilot (default), Interactive, Plan Only
- **Interactive mode**: Lead agent can pause and ask questions when lacking critical info
  - Marker-based protocol: `<<<QUESTION>>>...<<<END_QUESTION>>>...<<<QUESTIONS_END>>>`
  - Backend parses markers from assistant text blocks in stream-json output
  - Stdin kept open for interactive mode (closed for auto mode)
- **QuestionCard UI**: Multi-question support with tabs, option buttons, free text, skip, submit
  - Browser notification when questions arrive while tab is unfocused
  - Amber-themed card matches VS Code dark theme
  - Shows answered count badge on question tabs
- **Auto mode**: Questions auto-resolved with `__AUTO__` answer, Lead continues autonomously
- **answer_question IPC handler**: Writes user answers back to Claude stdin via `<<<ANSWER>>>` markers
- **Question history**: All Q&A pairs stored in `missionState.question_history` for history replay
- **Prompt injection**: `{{PERMISSION_MODE}}` placeholder in all 4 deploy/continue prompt templates
  - Auto mode: "AUTONOMOUS MODE" — make all decisions independently
  - Interactive mode: Full question protocol instructions with JSON format spec
- **Permission mode persistence**: localStorage saves last-used permission mode

### Changed
- Continue from History giờ đi qua full lifecycle (Planning → ReviewPlan → Deploy) thay vì skip thẳng vào execution
- `continue_mission` chỉ còn dùng cho intervention trên mission đang chạy (không còn xử lý fork)
- Prompt continue chia thành 2 template riêng: `continue_agent_teams.md` và `continue_standard.md`
- InterventionPanel disabled khi có pending questions (tránh conflict)
- `deploy_mission` và `continue_mission` giữ stdin open khi interactive mode
- `launch_mission` nhận thêm `permissionMode` argument
- `missionState` thêm `permission_mode`, `question_history`, `pendingQuestions`
- Preload whitelist thêm `answer_question` command và `mission:question`, `mission:answer-sent` events

---

## [0.1.0] — 2026-03-14

### Added — Core Mission Engine
- **Mission lifecycle đầy đủ**: Planning → ReviewPlan → PromptPreview → Deploy → Execution → Done
- **2 execution modes**: `agent_teams` (Claude Agent Teams với TeamCreate/SendMessage) và `standard` (Agent tool trực tiếp)
- **Planning phase**: Lead agent phân tích requirement, output JSON plan với agents + tasks
- **PlanReview UI**: User chỉnh sửa agents (thêm/bớt/đổi tên/đổi model), chỉnh sửa tasks (thêm/bớt/sửa detail), drag-and-drop thứ tự
- **PromptPreview**: Xem và chỉnh raw prompt cho từng agent trước khi deploy
- **Deploy phase**: Spawn Claude CLI process với đúng execution mode + project-specific prompts
- **Replan**: Yêu cầu Lead lên plan lại nếu plan đầu không ổn
- **Intervention Panel**: Chat với Lead khi mission đang chạy, gửi hướng dẫn mới
- **Stop Mission**: Dừng mission bất cứ lúc nào, kill tất cả child processes

### Added — Agent Management
- **Agent model sync**: Model user chọn ở PlanReview được truyền chính xác qua deploy → agent-spawned events → Dashboard
- **Model choices**: sonnet (default), opus (complex reasoning), haiku (simple tasks)
- **AgentCard**: Hiển thị tên, role, model, status, current task cho từng agent
- **Auto-detect agent roles**: Tự suy luận role từ tên agent (e.g., "backend-api" → Backend Developer)

### Added — Continue from History (Fork)
- **Full lifecycle fork**: Chọn mission cũ trong History → nhập yêu cầu mới → Lead lên plan mới dựa trên context cũ → user review → deploy
- **Previous Work injection**: Tự động tóm tắt tasks (completed/in-progress/pending), recent logs, file changes từ mission cũ và inject vào planning prompt
- **`forked_from` tracking**: Mission mới ghi nhận ID + description của mission gốc
- **Forked badge**: History panel hiển thị badge "↳ từ: <parent>" cho missions được fork
- **History view mode**: Xem read-only (`view`) hoặc xem + continue (`continue`)

### Added — Project Intelligence
- **Auto-detect project type**: Nhận diện Node.js/Vite, Next.js, Python, Rust, Go, Java từ filesystem (package.json, requirements.txt, Cargo.toml, etc.)
- **Project-specific build gates**: Deploy prompt tự inject hướng dẫn build/verify phù hợp (e.g., `npm run build` cho Vite, `cargo build` cho Rust)
- **Vietnamese detection**: Tự detect requirement tiếng Việt → inject LANGUAGE REQUIREMENT rule buộc agents viết UI text tiếng Việt, dùng Unicode font cho PDF
- **`--dangerously-skip-permissions`**: Launch phase luôn set flag này để Claude CLI không bị block ở non-interactive mode

### Added — Prompt System
- **External prompt templates**: Tất cả prompts là `.md` files trong `electron/prompts/`, dễ chỉnh sửa mà không cần rebuild
  - `planning.md` — Phase 1: Lead phân tích + output plan JSON
  - `deploy_agent_teams.md` — Phase 3 (agent_teams mode): spawn team với TeamCreate
  - `deploy_standard.md` — Phase 3 (standard mode): spawn agents với Agent tool
  - `continue_agent_teams.md` — Continue intervention (agent_teams mode)
  - `continue_standard.md` — Continue intervention (standard mode)
  - `replan.md` — Replan request
- **`buildMissionPrompt()`**: Frontend wrapper thêm language hint, reference materials, team hint vào planning template
- **Reference materials**: User có thể drag-drop files/folders/images vào launcher, nội dung được inline vào prompt
- **@mention**: Gõ `@` trong requirement textarea để tìm và attach files từ project

### Added — Mission Dashboard
- **Real-time log stream**: Parse Claude CLI stream-json output, hiển thị logs theo agent
- **File changes tracking**: Detect file writes/edits từ agent output, hiển thị danh sách files changed
- **Agent status board**: Hiển thị tất cả agents với status (Spawning/Working/Idle/Done/Error)
- **Elapsed timer**: Đếm thời gian mission đang chạy
- **Raw output panel**: Xem raw stdout/stderr từ Claude CLI process
- **Task tracking**: Hiển thị tasks với status (pending/in_progress/completed) và assigned agent

### Added — History & Persistence
- **Mission history**: Tự động lưu completed/stopped/failed missions vào `~/.agent-teams-guide/history/`
- **Full state snapshot**: Lưu toàn bộ agents, tasks, logs, file_changes, raw_output
- **View history**: Click vào history entry để xem full dashboard read-only
- **Delete history**: Xóa entries không cần thiết
- **Reuse from history**: Click entry cũ để pre-fill launcher form

### Added — UI/UX
- **VS Code dark theme**: Toàn bộ UI dùng VS Code color palette
- **Sidebar navigation**: Mission Control, Dashboard, Playground, Docs, Settings
- **Onboarding page**: Hướng dẫn setup Claude CLI + API key lần đầu
- **Docs page**: Nhúng ARCHITECTURE.md, USER_GUIDE.md, FUNCTION_REFERENCE.md trực tiếp trong app
- **Playground page**: Test Claude CLI commands trực tiếp
- **Responsive layout**: Sidebar collapse trên mobile
- **Drag region**: Custom title bar với drag support

### Added — Build & Distribution
- **Electron + Vite**: Frontend React/Vite + Electron main process
- **Windows build**: `npm run electron:build` → NSIS installer + portable unpacked
- **Patch system**: `node scripts/build-patch.cjs` → zip chỉ chứa `app.asar` + prompts + apply/rollback `.bat`
- **Auto-update prompts**: Patch zip include latest prompt templates

### Added — Testing & QA
- **123 static analysis tests**: `node tests/run_all.cjs` kiểm tra source code structure, data flow, edge cases
- **CDP QC scripts**: Test live app qua Chrome DevTools Protocol (port 9222)
- **Filter support**: `node tests/run_all.cjs --filter=fork` để chạy subset tests

### Added — Documentation
- **USER_GUIDE.md** (tiếng Việt): Hướng dẫn sử dụng đầy đủ với screenshots flow
- **FUNCTION_REFERENCE.md** (English): Technical reference cho 20 IPC commands, events, data structures
- **ARCHITECTURE.md**: Kiến trúc hệ thống, data flow diagrams, state management

### Fixed
- **ReviewPlan stuck bug**: Mission kết thúc khi đang ở ReviewPlan phase → UI bị stuck. Fixed: auto-transition to Done
- **Agent Teams env flag not set in continue_mission**: Continue luôn hardcode `false` → Claude không có TeamCreate tools. Fixed: check `execution_mode`
- **Planning phase blocked**: `launch_mission` thiếu `--dangerously-skip-permissions` → Claude CLI bị block. Fixed
- **Hydration race condition**: Mission state hydration on mount có thể skip ReviewPlan states. Fixed: detect completed+ReviewPlan → auto-fix to Done

### Technical Details
- **Runtime**: Electron 33 + Node.js 22 + React 19 + Vite 7
- **State management**: React hooks (`useMission`) + batched event system (120ms flush interval, ~8 re-renders/s thay vì ~20/s)
- **IPC**: Electron `ipcMain.handle` / `ipcRenderer.invoke` (bridged via preload.cjs)
- **Process management**: `child_process.spawn` cho Claude CLI, với graceful kill (SIGTERM → 3s timeout → SIGKILL)
- **File watcher**: `setInterval` poll `.claude-agent-team/` directory cho agent_teams mode coordination files
