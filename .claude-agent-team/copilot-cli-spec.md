# GitHub Copilot CLI — Đặc tả cú pháp thực tế (đã dò trên máy)

> Tài liệu này ghi lại giao diện dòng lệnh THỰC TẾ của GitHub Copilot CLI cài trên
> máy phát triển, dùng làm nguồn tham chiếu cho `CopilotAdapter`. Mọi mục đều đã
> được xác minh bằng cách chạy lệnh thật — không có mục nào để "TBD".

## 1. Tên binary thật

- **Binary:** `copilot`
- **Đường dẫn:** `C:\Users\USER\AppData\Roaming\npm\copilot` (shim npm trên Windows;
  giống `claude` — cross-spawn sẽ chạy qua `copilot.cmd` → cần tree-kill khi kill).
- **Phiên bản đã dò:** `GitHub Copilot CLI 1.0.77`
- Đây KHÔNG phải `gh copilot` (extension của `gh`) và KHÔNG phải
  `github-copilot-cli` (gói cũ). `gh` không được cài trên máy này (`gh: command not
  found`). Binary chuẩn hiện tại là lệnh độc lập `copilot`.

Xác minh:
```
$ copilot --version
GitHub Copilot CLI 1.0.77.
```

## 2. Cách truyền prompt non-interactive / headless

- Flag: `-p, --prompt <text>` — "Execute a prompt in non-interactive mode (exits
  after completion)". Tiến trình tự thoát sau khi hoàn tất (khác với `-i` là chạy
  prompt rồi ở lại interactive).
- **Bắt buộc kèm** một flag cho phép công cụ, nếu không tiến trình sẽ treo chờ xác
  nhận. Help ghi rõ: `--allow-all-tools` … "required for non-interactive mode".

Cú pháp non-interactive tối thiểu:
```
copilot -p "<prompt>" --allow-all-tools
```

## 3. Flag chọn model + danh sách model id hợp lệ

- Flag: `--model <model>` — "Set the AI model to use (use 'auto' to let Copilot pick
  automatically)".
- Copilot **có** hỗ trợ chọn model (khác Claude ở chỗ dùng tên model đầy đủ của
  Copilot, không dùng short id `sonnet/opus/haiku`).
- Không có lệnh liệt kê model chính thức trong CLI; truyền model sai chỉ báo lỗi
  chung, không in danh sách:
  ```
  $ copilot -p "hi" --model __invalid__ --allow-all-tools
  Error: Model "__invalid__" from --model flag is not available.
  ```
- **Model id đã quan sát được là hợp lệ / có thật:**
  - `auto` — để Copilot tự chọn (an toàn nhất, luôn hợp lệ). Đây là giá trị mặc
    định adapter dùng khi không map được.
  - `claude-sonnet-4.6` — model MẶC ĐỊNH thực tế của session (xác nhận qua trường
    `data.model` trong JSON output khi không truyền `--model`).
  - `gpt-5.4` — nêu trong ví dụ của `copilot --help` (`copilot --model gpt-5.4`).
- **Ánh xạ short id → Copilot** dùng trong `CopilotAdapter.mapModel` (giữ khả năng
  chạy được là ưu tiên; tên model Copilot thay đổi theo thời gian nên fallback về
  `auto`):
  - `sonnet` → `claude-sonnet-4.6`
  - `opus`   → `auto`  (Copilot chưa expose id Opus ổn định qua CLI trên máy này)
  - `haiku`  → `auto`
  - không rõ / null → `auto`
  - Nếu người dùng đặt model rỗng hoặc muốn bỏ hẳn: adapter cho phép trả `null` →
    `buildLaunchArgs` sẽ BỎ hẳn cặp `--model`, để Copilot tự chọn.

> Ghi chú: Copilot vẫn nhận `--model`, nên `supportsModelFlag = true`. Nếu về sau
> muốn tắt hẳn việc chọn model, chỉ cần cho `mapModel` trả `null`.

## 4. Định dạng output có thể parse

Flag: `--output-format <format>` — choices: `text` (mặc định) hoặc `json`.
- `text` (mặc định): văn bản người đọc, có stats ở cuối. Thêm `-s, --silent` để in
  **chỉ** câu trả lời của agent (không stats) — hợp cho scripting.
- `json`: **JSONL** — mỗi dòng là một object JSON độc lập (một object / dòng). Đây
  là định dạng adapter parse được đáng tin cậy nhất.

### 4a. Cấu trúc các event JSON quan trọng (đã xác minh)

Chạy: `copilot -p "..." --allow-all-tools --output-format json --no-color`

Các `type` gặp trong stream (nhiều event có `"ephemeral":true` — nhiễu, có thể bỏ):
- `session.warning`, `session.mcp_server_status_changed`, `mcp.tools.list_changed`,
  `session.skills_loaded`, `session.custom_agents_updated` — nhiễu khởi tạo.
- `session.tools_updated` → `data.model` chứa model đang dùng (vd `claude-sonnet-4.6`).
- `user.message` — echo prompt người dùng.
- `assistant.turn_start` / `assistant.turn_end` — mốc lượt.
- `assistant.reasoning_delta` / `assistant.reasoning` — suy luận (ephemeral, bỏ).
- `assistant.message_start` — bắt đầu message.
- **`assistant.message_delta`** → `data.deltaContent` = **text stream từng phần**
  (dùng cho hiển thị realtime). Có `ephemeral:true`.
- **`assistant.message`** → `data.content` = **text đầy đủ của message** (không
  ephemeral) + `data.model`. Đây là nguồn text chính xác nhất khi không stream.
- `assistant.idle` — agent rảnh (ephemeral).
- `session.usage_checkpoint` — thống kê token.
- **`result`** → event KẾT THÚC: có `sessionId`, `exitCode`, `usage`. Không có
  `type`-lồng nào khác; đây là marker kết thúc tiến trình.

### 4b. Mẫu output JSON THẬT (đã chạy được)

Prompt: `Print exactly this sentence and nothing else: Xin chào từ Copilot CLI.`

Các dòng cốt lõi (rút gọn từ stream thật):
```json
{"type":"session.tools_updated","data":{"model":"claude-sonnet-4.6"},"ephemeral":true,"id":"940a065c-...","timestamp":"2026-07-31T07:16:42.563Z"}
{"type":"assistant.message_delta","data":{"messageId":"e5ba2219-...","deltaContent":"Xin chào từ Copilot CLI."},"ephemeral":true,"id":"e7358b36-...","timestamp":"2026-07-31T07:16:46.112Z"}
{"type":"assistant.message","data":{"messageId":"e5ba2219-...","model":"claude-sonnet-4.6","content":"Xin chào từ Copilot CLI.","toolRequests":[],"turnId":"0","outputTokens":34},"id":"5f8f1a8c-...","timestamp":"2026-07-31T07:16:46.181Z"}
{"type":"result","timestamp":"2026-07-31T07:16:46.223Z","sessionId":"d60f7463-5d66-44b2-b8c4-60a0c0c36289","exitCode":0,"usage":{"premiumRequests":1,"totalApiDurationMs":2833,"sessionDurationMs":8931,"codeChanges":{"linesAdded":0,"linesRemoved":0,"filesModified":[]}}}
```

### 4c. Mẫu output TEXT (plain) THẬT

Prompt: `Print exactly: Xin chào plain text.`  (chạy với `--allow-all-tools -s`)
```
Xin chào plain text.
```
Exit code: `0`. Ở chế độ `-s` (silent) chỉ còn đúng câu trả lời, không stats —
mỗi dòng non-empty coi là text; không có marker kết thúc rõ ràng nên adapter dựa
vào sự kiện `close` của tiến trình để phát `{ kind: 'result' }`.

## 5. Flag bỏ qua xác nhận / permission

- `--allow-all-tools` — cho mọi tool chạy tự động, KHÔNG hỏi (env: `COPILOT_ALLOW_ALL`).
  **Bắt buộc cho non-interactive.** (Tương đương `--dangerously-skip-permissions`
  của Claude về mặt ngữ nghĩa "không hỏi tool".)
- `--allow-all-paths` — bỏ kiểm tra path, cho truy cập mọi đường dẫn file.
- `--allow-all-urls` — cho mọi URL không hỏi.
- `--allow-all` = `--yolo` — bật cả ba ở trên trong một flag.
- Adapter dùng `--allow-all-tools` (đủ cho non-interactive; nếu cần ghi file mọi
  nơi có thể nâng lên `--allow-all`). Có thể thêm `--no-ask-user` để agent không
  dừng hỏi câu hỏi giữa chừng khi chạy headless.

## 6. Cách kết thúc / kill tiến trình

- Giống `claude`: trên Windows `copilot` là shim `.cmd` → cross-spawn chạy qua
  `cmd.exe /c`, nên `proc.kill()` chỉ giết wrapper, để lại tiến trình node thật.
- **Dùng lại logic `killClaudeProcess`**: trên Windows chạy
  `taskkill /pid <pid> /T /F` (tree-kill toàn bộ cây tiến trình); trên nền tảng
  khác dùng `proc.kill(signal)`.
- Ở chế độ `-p`, tiến trình tự thoát sau khi in `result` (exitCode 0), nên trong
  luồng bình thường không cần kill; kill chỉ dùng khi hủy/timeout.

## 7. Resume / session

- `-r, --resume[=value]` — resume session theo id / task id / prefix / name.
- `--continue` — resume session gần nhất.
- `--session-id <id>` — đặt/nối UUID session.
- `sessionId` lấy từ event `result` (trường `sessionId`) hoặc có thể đặt trước qua
  `--session-id`. Vì luồng `-p` là one-shot và event chứa session id chỉ đến ở
  `result` (cuối), CopilotAdapter đặt `supportsResume = false` theo mặc định an
  toàn: tầng trên (mission.cjs) sẽ KHÔNG dùng `--resume` cho Copilot mà spawn mới,
  tránh phụ thuộc vào hành vi resume chưa được kiểm chứng đầy đủ trong pipeline này.
  (Cờ này có thể bật lại sau khi kiểm chứng resume một cách hệ thống.)

## 8. Không hỗ trợ (feature flags cho adapter)

- `supportsStreamJson`: **true** — có `--output-format json` (JSONL). Lưu ý: schema
  event KHÁC Claude stream-json (không có `type:"assistant"` với `message.content`
  mảng; thay vào đó là `assistant.message` / `assistant.message_delta`).
- `supportsResume`: **false** (mặc định an toàn — xem mục 7).
- `supportsAgentTeams`: **false** — Copilot không có cơ chế agent-teams kiểu Claude
  (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`). Adapter bỏ qua `useAgentTeams`.

## 9. Cú pháp launch đầy đủ CopilotAdapter dùng

Launch mới (có chọn model):
```
copilot -p "<prompt>" --allow-all-tools --no-ask-user --output-format json --no-color --model <copilotModel>
```
Nếu `mapModel` trả `null` (bỏ chọn model):
```
copilot -p "<prompt>" --allow-all-tools --no-ask-user --output-format json --no-color
```
Nếu có `maxTurns` → thêm `--max-autopilot-continues <n>` (giới hạn số lượt tiếp
diễn tự động — flag gần nghĩa nhất với `--max-turns` của Claude). Resume bị bỏ qua
vì `supportsResume=false`.
