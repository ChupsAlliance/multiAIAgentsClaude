#!/usr/bin/env node
'use strict';

// ─── fake-claude/claude.cjs ─────────────────────────────────────
// Drop-in replacement for the real `claude` CLI binary, used ONLY by
// Playwright E2E tests so that a "mission" can be run end-to-end
// without ever invoking the real Claude Code CLI or spending real
// API tokens / making real network calls.
//
// electron/ipc/mission.cjs's spawnClaude() does:
//   spawn('claude', args, { cwd, env, stdio: ['pipe','pipe','pipe'] })
// and then parses stdout line-by-line with OutputParser, matching:
//   AGENT_MSG_RE   = /^\[([^\]]+)\]\s*(.+)$/         → "[AgentName] message"
//   SPAWN_RE       = /spawn(?:ing|ed)?\s+(?:teammate\s+)?'([^']+)'/i
//   STARTING_RE    = /^Starting:\s*(.+)$/i            (inside an agent message)
//   COMPLETED_RE   = /^Completed:\s*(.+)$/i            (inside an agent message)
//
// This fixture is put first on PATH by tests/support/electronApp.ts
// (as a shim named `claude` / `claude.cmd` on Windows) so that any
// `spawn('claude', ...)` call in the app under test resolves here
// instead of the real CLI. It prints a short, deterministic, valid
// Vietnamese-friendly mission transcript, then exits 0.
//
// Control via env vars (set by the test that launches Electron):
//   FAKE_CLAUDE_SCRIPT   optional path to a JSON file describing custom
//                        lines to emit instead of the default script
//                        (array of strings, each written as one stdout line)
//   FAKE_CLAUDE_DELAY_MS optional per-line delay in ms (default 20ms) —
//                        keeps the fake mission fast (<1s total) while still
//                        exercising the real async stdout readline pipeline.

const fs = require('fs');

// electron/ipc/system.cjs's check_claude_available/get_system_info run
// `claude --version` synchronously (execSync) to decide whether to show
// the onboarding/setup screen. Answer that here so E2E runs never depend
// on whether the real Claude CLI happens to be installed on the test
// machine.
if (process.argv.includes('--version')) {
  process.stdout.write('1.0.0 (fake-claude test fixture)\n');
  process.exit(0);
}

const DEFAULT_SCRIPT = [
  "[Lead] Đang khởi tạo nhóm agent cho nhiệm vụ demo ghi hình.",
  "[Lead] Starting: Phân tích yêu cầu",
  "[Lead] Đang spawning teammate 'Dev'",
  "[Dev] Đã sẵn sàng, bắt đầu triển khai.",
  "[Dev] Starting: Tạo file cấu hình mẫu",
  "[Dev] Completed: Tạo file cấu hình mẫu",
  "[Lead] Completed: Phân tích yêu cầu",
  "[Lead] Nhiệm vụ demo đã hoàn thành thành công.",
];

function loadScript() {
  const scriptPath = process.env.FAKE_CLAUDE_SCRIPT;
  if (scriptPath) {
    try {
      const raw = fs.readFileSync(scriptPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to default script on any read/parse error
    }
  }
  return DEFAULT_SCRIPT;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const lines = loadScript();
  const delayMs = Number(process.env.FAKE_CLAUDE_DELAY_MS || 20);

  for (const line of lines) {
    process.stdout.write(line + '\n');
    // Small delay so the app's async readline-based stdout parsing has
    // discrete ticks to process, keeping ordering deterministic without
    // making the overall mission run slow (whole script finishes in well
    // under 1s with the default 8-line script at 20ms/line).
    if (delayMs > 0) await sleep(delayMs);
  }

  process.exit(0);
}

main();
