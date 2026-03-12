---
phase: "02"
title: "Layout & Sidebar Navigation"
status: pending
effort: 1h
created: 2026-03-04
---

# Phase 02 — Layout & Sidebar Navigation

## Context Links
- Parent plan: [plan.md](plan.md)
- Prev: [phase-01](phase-01-project-setup.md)
- Next: [phase-03](phase-03-content-sections.md)

## Overview
| Field | Value |
|-------|-------|
| Date | 2026-03-04 |
| Description | App shell with fixed sidebar, scroll-spy active highlight, reading progress bar, mobile hamburger |
| Priority | P2 |
| Status | pending |

## Key Insights
- `IntersectionObserver` for scroll-spy — zero dependencies
- `rootMargin: '-20% 0px -70% 0px'` triggers active state when section is near top of viewport
- Mobile sidebar: CSS `translate-x` toggle, backdrop overlay on top
- Progress bar tracks `window.scrollY` not a container

## Requirements
- Fixed sidebar 280px on `md+`, full-width drawer on mobile
- 8 nav items with `00.` numbering prefix + lucide icon + Vietnamese title
- Active item: left blue border + blue tint bg + white text
- Top progress bar in sidebar showing reading progress
- Smooth scroll on nav click

## File Structure
```
src/
  App.jsx                  ← layout root + scroll-spy observer
  data/
    sections.js            ← section registry (id, titleVi, titleEn, icon)
  components/
    Sidebar.jsx            ← fixed nav + mobile toggle
    ProgressBar.jsx        ← horizontal reading progress
```

## Implementation Steps

### 1. src/data/sections.js
```js
import {
  BookOpen, Settings, Users, Keyboard,
  Layout, Star, Code2, AlertTriangle
} from 'lucide-react';

export const sections = [
  { id: 'introduction',     titleVi: 'Giới thiệu',           titleEn: 'Introduction',        icon: BookOpen },
  { id: 'setup',            titleVi: 'Cài đặt & Kích hoạt',  titleEn: 'Setup & Enable',       icon: Settings },
  { id: 'create-team',      titleVi: 'Tạo Agent Team',        titleEn: 'Create a Team',        icon: Users },
  { id: 'interaction',      titleVi: 'Tương tác với Team',    titleEn: 'Team Interaction',     icon: Keyboard },
  { id: 'display-modes',    titleVi: 'Chế độ hiển thị',      titleEn: 'Display Modes',        icon: Layout },
  { id: 'best-practices',   titleVi: 'Best Practices',        titleEn: 'Best Practices',       icon: Star },
  { id: 'examples',         titleVi: 'Ví dụ thực tế',         titleEn: 'Real-world Examples',  icon: Code2 },
  { id: 'limitations',      titleVi: 'Hạn chế & Lưu ý',      titleEn: 'Limitations & Notes',  icon: AlertTriangle },
];
```

### 2. ProgressBar component
```jsx
// src/components/ProgressBar.jsx
import { useState, useEffect } from 'react';
export function ProgressBar() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      setProgress(scrollHeight - clientHeight > 0
        ? (scrollTop / (scrollHeight - clientHeight)) * 100 : 0);
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className="h-0.5 w-full bg-vscode-border">
      <div className="h-full bg-vscode-accent transition-all duration-150"
           style={{ width: `${progress}%` }} />
    </div>
  );
}
```

### 3. Sidebar component (key structure)
- Header: "Claude Code" title + "Agent Teams Guide" subtitle
- ProgressBar below header
- Nav list: sections.map → button with number, icon, Vietnamese title
- Active: `border-vscode-accent text-white bg-vscode-accent/10`
- Inactive: `border-transparent text-vscode-text hover:bg-white/5`
- Footer: "v1.0 — Internal Docs"
- Mobile: hamburger button (fixed top-left), backdrop overlay

### 4. App.jsx scroll-spy
```jsx
useEffect(() => {
  const observers = sections.map((s) => {
    const el = document.getElementById(s.id);
    if (!el) return null;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setActiveSection(s.id); },
      { rootMargin: '-20% 0px -70% 0px' }
    );
    obs.observe(el);
    return obs;
  });
  return () => observers.forEach((o) => o?.disconnect());
}, []);
```

### 5. App.jsx layout
```jsx
<div className="min-h-screen bg-vscode-bg text-vscode-text font-sans">
  <Sidebar activeSection={activeSection} />
  <main className="md:ml-[280px]">
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-24">
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-8">
          <SectionComponent />
        </section>
      ))}
    </div>
  </main>
</div>
```

## Todo
- [ ] Create `src/data/sections.js`
- [ ] Create `src/components/ProgressBar.jsx`
- [ ] Create `src/components/Sidebar.jsx`
- [ ] Update `src/App.jsx` with layout + IntersectionObserver
- [ ] Test: active highlight updates on scroll
- [ ] Test: mobile hamburger toggles sidebar
- [ ] Test: clicking nav item scrolls smoothly

## Success Criteria
- Sidebar renders all 8 nav items with correct Vietnamese titles
- Active item updates as user scrolls
- Mobile hamburger works (< 768px)
- Progress bar fills on scroll

## Risk Assessment
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Observer rootMargin needs tuning | Medium | Adjust after visual test |
| Mobile sidebar z-index conflict | Low | Layer: sidebar z-40, overlay z-30, toggle z-50 |
