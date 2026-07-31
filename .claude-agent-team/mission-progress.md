# Mission Progress — cli-adapter-core

Agent: **cli-adapter-core** (Kiến trúc sư lớp trừu tượng CLI)

## Task 1 — Dò cú pháp Copilot CLI thực tế — ✅ DONE
- Binary thật: `copilot` v1.0.77 (standalone @github/copilot-cli). KHÔNG phải
  `gh copilot` / `github-copilot-cli`. `gh` không cài trên máy.
- Đã dò đầy đủ: prompt non-interactive (`-p` + `--allow-all-tools`), chọn model
  (`--model`, `auto`/`claude-sonnet-4.6`/`gpt-5.4`), output (`--output-format json`
  = JSONL; hoặc plain text `-s`), skip-permission (`--allow-all-tools`/`--yolo`),
  kill (taskkill tree-kill trên Windows).
- Đã chạy prompt THẬT và lưu mẫu output JSON + plain text (có tiếng Việt).
- Tài liệu: `.claude-agent-team/copilot-cli-spec.md` (không còn mục TBD).

## Task 2 — Thiết kế interface adapter CLI — ✅ DONE
- `electron/lib/cliAdapters/index.cjs` — registry `getAdapter(id)`, mặc định claude.
- `electron/lib/cliAdapters/types.md` — interface + shape sự kiện chuẩn hóa (tiếng Việt).

## Task 3 — Viết ClaudeAdapter & CopilotAdapter — ✅ DONE
- `electron/lib/cliAdapters/claudeAdapter.cjs` — refactor nguyên trạng
  (spawnClaude/killClaudeProcess/argv/parseLine), argv byte-identical.
- `electron/lib/cliAdapters/copilotAdapter.cjs` — theo spec Copilot.
- `electron/lib/cliAdapters/cliAdapters.test.cjs` — 28 test, tất cả PASS.

## Build / Verify
- `npx vitest run` → 259 unit tests PASS (gồm 28 test adapter mới).
- 2 file "fail" là Playwright `.spec.ts` bị vitest thu nhầm — lỗi cấu hình có
  sẵn, độc lập với thay đổi này (thuộc `playwright test`).
