# CLI Adapter Interface

Một **CLI adapter** trừu tượng hóa một backend CLI AI-coding (Claude Code,
GitHub Copilot CLI, …) sau MỘT interface chung, để `mission.cjs` / `qcqa.cjs`
không phụ thuộc vào argv, schema output, hay cách kill tiến trình riêng của từng
backend. Module thuần CommonJS (`.cjs`), khớp phong cách repo.

Lấy adapter qua registry:

```js
const { getAdapter } = require('../lib/cliAdapters/index.cjs');
const adapter = getAdapter(backendId); // 'claude' | 'copilot' | undefined→claude
```

## Interface (mỗi adapter phải cung cấp)

| Thành viên | Kiểu | Mô tả |
|---|---|---|
| `id` | `'claude' \| 'copilot'` | Định danh backend. |
| `displayName` | `string` | Tên hiển thị cho UI. |
| `binaryName()` | `() => string` | Tên lệnh để spawn (`'claude'` / `'copilot'`). |
| `mapModel(shortId)` | `(string) => string \| null` | Ánh xạ `'sonnet'\|'opus'\|'haiku'` → model id thật của backend. Claude: pass-through (nhận cả short id lẫn id đầy đủ). Copilot: `sonnet`→`claude-sonnet-4.6`, `opus`/`haiku`→`auto`; trả `null` để BỎ hẳn `--model`. |
| `buildLaunchArgs(spec)` | `(spec) => string[]` | Sinh mảng args cho spawn. **Không** gồm binary name. Xem "Prompt delivery". |
| `spawn(args, cwd, opts)` | `(string[], string, {useAgentTeams?}) => ChildProcess` | Gói cross-spawn: `windowsHide:true`, `shell:false`, xử lý env. |
| `parseLine(rawLine)` | `(string) => NormalizedEvent` | Chuẩn hóa một dòng stdout thành sự kiện chung. |
| `kill(proc, signal)` | `(ChildProcess, signal?) => void` | Kill tiến trình. Windows: `taskkill /pid <pid> /T /F` (tree-kill). |
| `promptViaStdin` | `boolean` | `true`→prompt ghi vào `proc.stdin` (Claude). `false`→prompt nằm trong args của `-p` (Copilot). |
| `supportsResume` | `boolean` | Có hỗ trợ `--resume`. Claude `true`, Copilot `false`. |
| `supportsStreamJson` | `boolean` | Có output JSON parse được. Cả hai `true`. |
| `supportsAgentTeams` | `boolean` | Có cơ chế agent-teams. Claude `true`, Copilot `false`. |

### `spec` truyền vào `buildLaunchArgs`

```ts
{
  prompt?: string,            // Copilot: nhét vào -p. Claude: bỏ qua (đi stdin).
  model?: string,             // short id ('sonnet'…) hoặc id đầy đủ
  resumeSessionId?: string|null, // Claude dùng; Copilot bỏ qua (supportsResume=false)
  maxTurns?: number|null,     // Claude→--max-turns; Copilot→--max-autopilot-continues
  useAgentTeams?: boolean
}
```

## Shape sự kiện chuẩn hóa (`NormalizedEvent`)

`parseLine` LUÔN trả về object có `kind`. Các trường khác tùy `kind`. Trường
`raw` (khi có) là object JSON đã parse, để caller cần field riêng backend vẫn
lấy được.

```ts
type NormalizedEvent =
  | { kind: 'text',    text: string, sessionId?: string, hasMarker?: boolean, raw?: any }
  | { kind: 'session', sessionId: string, raw?: any }
  | { kind: 'result',  resultText?: string, sessionId?: string, raw?: any }
  | { kind: 'tool_use',tool: string, input: any, sessionId?: string, raw?: any } // Claude
  | { kind: 'system',  subtype?: string, text?: string, sessionId?: string, raw?: any }
  | { kind: 'error',   text: string, raw?: any }
  | { kind: 'none',    raw?: any };
```

Ý nghĩa `kind`:

- **`text`** — nội dung do trợ lý sinh ra. `text` là chuỗi (delta hoặc trọn
  message). `hasMarker` (Copilot) = `true` nếu chứa marker giao thức của app
  (`<<<QUESTION>>>`, `<<<MOCKUP_REQUEST>>>`, `<<<MOCKUP_PAUSE>>>`,
  `<<<QUESTIONS_END>>>`, `=== MISSION PLAN ===`). Marker được giữ NGUYÊN trong
  `text` để caller tự chạy logic phát hiện marker giống Claude.
- **`session`** — chỉ mang `sessionId` (khung không có text). Với Claude,
  `session_id` cũng đính kèm trên nhiều event `text`/`system`.
- **`result`** — tiến trình kết thúc một lượt/one-shot. `resultText` (Claude) có
  thể chứa text plan cuối; `sessionId` = id để resume (Claude) / id session
  (Copilot `result.sessionId`).
- **`tool_use`** (Claude) — một block `tool_use` trên assistant message:
  `tool` (tên), `input` (tham số). Dùng để log hoạt động tool / theo dõi thay
  đổi file (Write/Edit).
- **`system`** — sự kiện hệ thống (init, cập nhật model, mốc lượt). Claude
  `subtype:'init'` mang `sessionId`.
- **`error`** — lỗi từ CLI; `text` là thông điệp.
- **`none`** — dòng nhiễu / không parse được / không đáng quan tâm → bỏ qua.

## Ghi chú tích hợp cho mission.cjs

- **Prompt**: kiểm `adapter.promptViaStdin`. `true` → sau spawn:
  `proc.stdin.write(prompt); proc.stdin.end()` (bỏ qua khi resume). `false` →
  prompt đã nằm trong args, KHÔNG ghi stdin (vẫn nên `proc.stdin.end()`).
- **Resume**: nếu `!adapter.supportsResume`, KHÔNG truyền `resumeSessionId` và
  spawn mới thay vì resume.
- **Agent teams**: chỉ set khi `adapter.supportsAgentTeams && useAgentTeams`.
- **Marker giao thức** độc lập backend — luôn quét trên `event.text` bất kể
  adapter, vì chúng nằm trong nội dung do model sinh ra.

## Backend đã hiện thực

- **claude** (`claudeAdapter.cjs`) — refactor nguyên trạng logic mission.cjs
  hiện tại; `buildLaunchArgs` tạo argv byte-identical với các mảng đang dùng.
- **copilot** (`copilotAdapter.cjs`) — theo `.claude-agent-team/copilot-cli-spec.md`.
