---
title: "Claude Code Agent Teams Guide App"
description: "Internal React+Vite SPA hướng dẫn dùng Claude Code Agent Teams cho dev team"
status: pending
priority: P2
effort: 6h
branch: main
tags: [react, vite, internal-tool, documentation, dark-mode]
created: 2026-03-04
---

# Claude Code Agent Teams Guide App

## Overview
Internal single-page application guiding developers on using Claude Code Agent Teams.
Built with React + Vite, dark VS Code/GitHub aesthetic, bilingual Vi/En content.

## Target Directory
`d:/multiAIAgentsClaude/agent-teams-guide/`

## Tech Stack
- React 18 + Vite 5
- Tailwind CSS v3 (darkMode: 'class', forced dark)
- Prism.js (syntax highlighting, VS Code theme)
- lucide-react (icons)
- No backend — static SPA

## Phases

| # | Phase | Effort | Status | File |
|---|-------|--------|--------|------|
| 01 | Project Setup | 30m | pending | [phase-01](phase-01-project-setup.md) |
| 02 | Layout & Sidebar | 1h | pending | [phase-02](phase-02-layout-sidebar.md) |
| 03 | Content Sections (×8) | 2.5h | pending | [phase-03](phase-03-content-sections.md) |
| 04 | Code Blocks & Clipboard | 1h | pending | [phase-04](phase-04-code-blocks.md) |
| 05 | Polish & Responsive | 1h | pending | [phase-05](phase-05-polish.md) |

## Key Architecture Decisions
- All section content lives in `src/data/sections.js` (structured JS objects)
- Scroll-spy via `IntersectionObserver` API — no external lib
- Copy-to-clipboard via `navigator.clipboard` with `execCommand` fallback
- Vietnamese prose text; English for all code, commands, technical terms
- Prism.js languages imported upfront in `main.jsx` for tree-shaking
