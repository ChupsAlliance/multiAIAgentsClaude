---
phase: "03"
title: "Content Sections (All 8)"
status: pending
effort: 2.5h
created: 2026-03-04
---

# Phase 03 — Content Sections

## Context Links
- Parent plan: [plan.md](plan.md)
- Prev: [phase-02](phase-02-layout-sidebar.md)
- Next: [phase-04](phase-04-code-blocks.md) — CodeBlock used throughout

## Overview
| Field | Value |
|-------|-------|
| Date | 2026-03-04 |
| Description | All 8 guide sections with Vietnamese prose + English code blocks |
| Priority | P2 |
| Status | pending |

## Key Insights
- Shared `SectionHeader` (number + Vi title + En subtitle) for consistency
- Shared `InfoBox` for tip/warning/info callouts
- Vietnamese text for all explanations; English for all code, commands, CLI flags
- CodeBlock from Phase 04 used throughout — create placeholder first if needed

## Shared Components

### SectionHeader
```jsx
// src/components/SectionHeader.jsx
export function SectionHeader({ number, titleVi, titleEn, description }) {
  return (
    <div className="mb-8 pb-4 border-b border-vscode-border">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-vscode-comment font-mono text-sm">
          {String(number).padStart(2, '0')}.
        </span>
        <h2 className="text-2xl font-bold text-white">{titleVi}</h2>
      </div>
      {titleEn && <p className="text-vscode-keyword font-mono text-sm ml-8">{titleEn}</p>}
      {description && <p className="mt-3 text-vscode-text text-sm leading-relaxed ml-8">{description}</p>}
    </div>
  );
}
```

### InfoBox
```jsx
// src/components/InfoBox.jsx
const variants = {
  tip:     { border: 'border-vscode-comment', icon: '💡', label: 'Tip' },
  warning: { border: 'border-yellow-500',      icon: '⚠️', label: 'Lưu ý' },
  info:    { border: 'border-vscode-accent',   icon: 'ℹ️', label: 'Info' },
};
export function InfoBox({ type = 'tip', children }) {
  const v = variants[type];
  return (
    <div className={`border-l-4 ${v.border} bg-white/5 rounded-r px-4 py-3 my-4`}>
      <span className="text-xs font-bold uppercase tracking-wider text-vscode-comment">
        {v.icon} {v.label}
      </span>
      <div className="mt-1 text-sm text-vscode-text">{children}</div>
    </div>
  );
}
```

## Section Content Outline

### Section 1: Introduction
- Giới thiệu Agent Teams là gì
- ASCII architecture diagram: Orchestrator → Subagent A, B, C
- 4 lợi ích chính (bulleted list)
- InfoBox(info): "Tính năng experimental — cần enable trong settings"

### Section 2: Setup & Enable
- Bước 1: Tìm settings.json (`~/.claude/settings.json` hoặc `.claude/settings.json`)
- Bước 2: Thêm `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` vào `env`
- Bước 3: Restart Claude Code
- settings.json snippet (json code block)
- InfoBox(warning): "Windows users: chỉ in-process mode, không hỗ trợ split-pane"

### Section 3: Tạo Agent Team
- Prompt bằng ngôn ngữ tự nhiên
- Ví dụ prompt cơ bản (text code block)
- Ví dụ prompt với role assignment (text code block)
- Ví dụ prompt yêu cầu plan approval trước khi code
- InfoBox(tip): "Bắt đầu với 3-5 teammates là lý tưởng"

### Section 4: Tương tác với Team
- Bảng keyboard shortcuts (keys + action Vietnamese/English)
- Commands: `/agent`, `/broadcast`, `/status`, `/stop`
- Cách message trực tiếp một teammate (Shift+Down)
- Cách xem shared task list (Ctrl+T)

**Keyboard shortcuts table:**
| Phím | Chức năng |
|------|-----------|
| Shift+Down | Chuyển sang teammate tiếp theo |
| Ctrl+T | Toggle shared task list |
| Escape | Interrupt turn hiện tại |

### Section 5: Chế độ hiển thị
- So sánh in-process vs split-pane (table)
- ASCII mockup của mỗi chế độ
- Cách configure `teammateMode` trong settings.json
- Yêu cầu: split-pane cần tmux hoặc iTerm2
- InfoBox(warning): "VS Code integrated terminal, Windows Terminal không hỗ trợ split-pane"

### Section 6: Best Practices
- Team size: 3-5 teammates, mỗi người 5-6 tasks
- Task sizing: đủ lớn để có ý nghĩa, đủ nhỏ để check-in thường xuyên
- Tránh conflict: mỗi teammate sở hữu directory riêng
- Ví dụ prompt tốt vs xấu (2 code blocks cạnh nhau)
- Chi phí token: tuyến tính theo số teammates

### Section 7: Ví dụ thực tế
**3 ví dụ với prompt đầy đủ:**
1. **Code Review Team** — 3 reviewers: security, performance, test coverage
2. **Parallel Feature Development** — backend + frontend + docs cùng lúc
3. **Debugging với competing hypotheses** — 5 teammates test 5 giả thuyết khác nhau

### Section 8: Hạn chế & Lưu ý
- Không hỗ trợ `/resume` cho teammates (in-process mode)
- Task status có thể lag
- Chỉ 1 team per session
- Không có nested teams
- Split-pane không hỗ trợ trên Windows (VS Code, Windows Terminal, Ghostty)
- Chi phí token cao hơn đáng kể
- Khi nào KHÔNG nên dùng Agent Teams

## File Structure
```
src/
  components/
    SectionHeader.jsx
    InfoBox.jsx
  sections/
    Introduction.jsx
    Setup.jsx
    CreateTeam.jsx
    TeamInteraction.jsx
    DisplayModes.jsx
    BestPractices.jsx
    RealWorldExamples.jsx
    LimitationsNotes.jsx
```

## Todo
- [ ] Create `src/components/SectionHeader.jsx`
- [ ] Create `src/components/InfoBox.jsx`
- [ ] Create all 8 section files in `src/sections/`
- [ ] Verify all section imports resolve in `App.jsx`
- [ ] Review Vietnamese text accuracy
- [ ] Verify all code examples are syntactically correct

## Success Criteria
- All 8 sections render without errors
- Vietnamese content displays correctly (UTF-8)
- Code blocks use English
- InfoBox variants (tip/warning/info) render correctly

## Risk Assessment
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| CodeBlock not available (Phase 04 dep) | Medium | Create simple `<pre>` placeholder first |
| Vietnamese encoding issues | Low | Vite handles UTF-8 natively |
