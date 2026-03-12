---
phase: "04"
title: "Code Blocks & Copy-to-Clipboard"
status: pending
effort: 1h
created: 2026-03-04
---

# Phase 04 — Code Blocks & Copy-to-Clipboard

## Context Links
- Parent plan: [plan.md](plan.md)
- Prev: [phase-03](phase-03-content-sections.md) (consumes CodeBlock)
- Prism.js docs: https://prismjs.com/

## Overview
| Field | Value |
|-------|-------|
| Date | 2026-03-04 |
| Description | Syntax-highlighted code blocks with copy button, VS Code color theme, macOS window chrome |
| Priority | P2 |
| Status | pending |

## Key Insights
- `Prism.highlightElement()` must run in `useEffect` (after DOM mount)
- `navigator.clipboard` is async — show "Copied!" state, revert after 2s
- `execCommand('copy')` fallback for non-HTTPS or older browsers
- macOS-style traffic lights in header = visual polish at low cost
- Languages needed: `bash`, `json`, `yaml`, `jsx`, `javascript`, `text`

## Requirements
- `CodeBlock` props: `code` (string), `language` (string, default 'bash'), `filename?` (string)
- Syntax highlighting via Prism.js with VS Code colors
- Copy button top-right: "Copy" → "Copied!" (2s) → "Copy"
- Language badge in header
- Optional filename in header
- Horizontal scroll for long lines (no wrap)
- macOS window chrome (3 colored dots)

## File Structure
```
src/
  main.jsx                   ← Prism language imports
  index.css                  ← Prism VS Code theme override
  components/
    CodeBlock.jsx            ← Main component
    CopyButton.jsx           ← Isolated button with feedback
```

## Implementation Steps

### 1. Prism imports in main.jsx
```js
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
```

### 2. CopyButton.jsx
```jsx
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy}
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono transition-all
        ${copied ? 'text-vscode-comment bg-vscode-comment/20' : 'text-vscode-comment hover:text-white hover:bg-white/10'}`}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
```

### 3. CodeBlock.jsx
```jsx
import { useEffect, useRef } from 'react';
import Prism from 'prismjs';
import { CopyButton } from './CopyButton';

export function CodeBlock({ code, language = 'bash', filename }) {
  const codeRef = useRef(null);
  useEffect(() => {
    if (codeRef.current) Prism.highlightElement(codeRef.current);
  }, [code, language]);

  return (
    <div className="my-4 rounded-md overflow-hidden border border-vscode-border bg-[#1a1a1a]">
      {/* Window chrome header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-vscode-border">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
          {filename && <span className="ml-3 text-xs text-vscode-comment font-mono">{filename}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-vscode-comment font-mono uppercase tracking-wide">{language}</span>
          <CopyButton text={code} />
        </div>
      </div>
      {/* Code area */}
      <div className="overflow-x-auto">
        <pre className="p-4 m-0 text-sm leading-relaxed">
          <code ref={codeRef} className={`language-${language}`}>{code}</code>
        </pre>
      </div>
    </div>
  );
}
```

### 4. Prism VS Code theme in index.css
```css
/* Prism.js VS Code Dark theme */
code[class*="language-"], pre[class*="language-"] {
  background: transparent;
  color: #d4d4d4;
}
.token.comment, .token.block-comment { color: #6a9955; }
.token.keyword, .token.operator      { color: #569cd6; }
.token.string                        { color: #ce9178; }
.token.number                        { color: #b5cea8; }
.token.function                      { color: #dcdcaa; }
.token.class-name                    { color: #4ec9b0; }
.token.punctuation                   { color: #d4d4d4; }
.token.property                      { color: #9cdcfe; }
.token.boolean                       { color: #569cd6; }
.token.constant                      { color: #4fc1ff; }
```

## Todo
- [ ] Add Prism language imports to `src/main.jsx`
- [ ] Create `src/components/CopyButton.jsx`
- [ ] Create `src/components/CodeBlock.jsx`
- [ ] Add VS Code Prism theme to `src/index.css`
- [ ] Test copy button (verify clipboard content)
- [ ] Test "Copied!" feedback reverts after 2s
- [ ] Test syntax highlighting: bash, json, jsx, text
- [ ] Test horizontal scroll on long code lines

## Success Criteria
- Syntax highlighting matches VS Code Dark+ colors
- Copy button works and reverts after 2 seconds
- Language badge shows correct label
- Long lines scroll horizontally without wrapping
- macOS traffic lights render in header

## Risk Assessment
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Prism not highlighting after re-render | Medium | `useEffect` deps: `[code, language]` |
| `navigator.clipboard` blocked on HTTP | Low | `execCommand` fallback included |
| Missing Prism grammar for a language | Low | All grammars imported in main.jsx |
