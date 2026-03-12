---
phase: "05"
title: "Polish, Responsive Design & Final Touches"
status: pending
effort: 1h
created: 2026-03-04
---

# Phase 05 — Polish, Responsive Design & Final Touches

## Context Links
- Parent plan: [plan.md](plan.md)
- All previous phases must be complete before this one

## Overview
| Field | Value |
|-------|-------|
| Date | 2026-03-04 |
| Description | Responsive breakpoints, animations, scroll-to-top button, meta tags, production build verification |
| Priority | P2 |
| Status | pending |

## Key Insights
- Only `transform` in animations — avoids layout shifts
- Sidebar overlay backdrop: `bg-black/60`, click-to-close
- Custom scrollbar (webkit) matches VS Code dark theme
- Emoji favicon via inline SVG data URI — no extra file needed
- Production build target: < 500KB main JS bundle

## Requirements
- Responsive at 320px, 768px, 1024px, 1440px
- Sections fade-in on scroll entry (IntersectionObserver, once)
- ScrollToTop button: appears after 400px scroll, smooth scroll to top
- Custom scrollbar matching VS Code dark
- `<meta>` tags: description, og:title, og:description
- `npm run build` → zero errors, clean dist/

## Changes Per File

### index.html — add meta tags + favicon
```html
<meta name="description" content="Hướng dẫn sử dụng Claude Code Agent Teams cho đội ngũ phát triển" />
<meta property="og:title" content="Claude Code — Agent Teams Guide" />
<meta property="og:description" content="Internal guide: Làm chủ Agent Teams trong Claude Code" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" />
```

### src/index.css — animations + scrollbar
```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
  animation: fadeInUp 0.4s ease-out forwards;
}

::-webkit-scrollbar       { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #1e1e1e; }
::-webkit-scrollbar-thumb { background: #3e3e42; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #007acc; }
```

### src/components/ScrollToTop.jsx — new file
```jsx
import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-6 right-6 z-50 p-3 rounded-full bg-vscode-accent hover:bg-blue-500
                 text-white shadow-lg transition-all duration-200 hover:scale-110"
      aria-label="Scroll to top"
    >
      <ArrowUp size={18} />
    </button>
  );
}
```

### src/App.jsx — add fade-in animation + ScrollToTop
```jsx
// Add data-animate attribute to each <section> element
// Add second useEffect for animation observer:
useEffect(() => {
  const els = document.querySelectorAll('[data-animate]');
  const obs = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('animate-fade-in-up');
        obs.unobserve(e.target);
      }
    }),
    { threshold: 0.1 }
  );
  els.forEach((el) => obs.observe(el));
  return () => obs.disconnect();
}, []);

// Add <ScrollToTop /> to JSX
```

### src/components/Sidebar.jsx — mobile overlay
```jsx
// Add backdrop when mobile sidebar open:
{mobileOpen && (
  <div
    className="fixed inset-0 bg-black/60 z-30 md:hidden"
    onClick={() => setMobileOpen(false)}
  />
)}
```

## Production Build Verification
```bash
npm run build
# Expected: dist/ created, no errors

npm run preview
# Smoke test at http://localhost:4173:
# ✓ All 8 sections visible
# ✓ Sidebar nav works + scroll-spy active
# ✓ Copy buttons work
# ✓ Mobile view at 375px: hamburger + overlay
# ✓ ScrollToTop button appears after scroll
```

## Todo
- [ ] Update `index.html` with meta tags, Inter font link, emoji favicon
- [ ] Add `fadeInUp` CSS + custom scrollbar to `index.css`
- [ ] Create `src/components/ScrollToTop.jsx`
- [ ] Add `data-animate` attrs to sections in `App.jsx`
- [ ] Add animation IntersectionObserver in `App.jsx`
- [ ] Import + render `<ScrollToTop />` in `App.jsx`
- [ ] Add mobile overlay backdrop in `Sidebar.jsx`
- [ ] Test responsive: 320px, 768px, 1024px
- [ ] Test keyboard nav (Tab through all nav items)
- [ ] Run `npm run build` — verify zero errors
- [ ] Run `npm run preview` — smoke test all features

## Success Criteria
- App works on mobile (320px+)
- All interactive elements reachable by keyboard
- Sections fade in on scroll (once, not on every scroll)
- ScrollToTop button visible after scrolling down 400px
- `npm run build` completes with zero errors
- Bundle size: main JS < 500KB

## Risk Assessment
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Google Fonts unavailable (offline/internal) | Medium | Inter/JetBrains Mono system-font fallbacks in CSS |
| Prism.js adds large bundle | Medium | Only import used grammars — ~6 languages |
| Animation causes layout shift | Low | Only `transform` + `opacity` used |
| Vite build fails: missing Prism grammar path | Low | Verify all import paths before build |
