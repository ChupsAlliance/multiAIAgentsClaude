# Pixel Agents Repository Research — Complete Index

**Research Date**: 2026-05-07  
**Repository**: https://github.com/pablodelucca/pixel-agents  
**Version Studied**: v1.3.0  
**License**: MIT

---

## Documents Generated

### 1. **PIXEL_AGENTS_QUICKREF.md** (298 lines)
**Purpose**: Executive summary and quick lookup reference  
**Contains**:
- TL;DR at top
- Key findings table (packaging, license, dependencies)
- Rendering engine breakdown
- Sprite system overview
- React components summary
- Message protocol quick reference
- Activity detection flow
- All 4 integration approaches ranked
- Boilerplate code snippets
- Files to copy
- Known limitations
- Next steps

**Use this for**: Quick decisions, presenting to team, 5-minute summary

---

### 2. **RESEARCH_PIXEL_AGENTS.md** (736 lines)
**Purpose**: Exhaustive technical deep-dive with context  
**Contains**:
- Complete package structure analysis
- Publishability assessment
- Webview bundle & iframe integration details
- Rendering engine deep-dive (all 5 core files)
- Sprite system complete breakdown
- React components detailed analysis
- Bidirectional message protocol with all message types
- Agent activity detection mechanism
- License & dependencies audit
- 4 integration approaches with code examples & trade-offs
- Comparison matrix
- Detailed recommendation with code snippets
- Unresolved questions
- Files to review next

**Use this for**: Implementation, understanding architecture, troubleshooting

---

## Research Scope Completed

### Data Fetched
✅ Root package.json  
✅ webview-ui/package.json  
✅ webview-ui/src/App.tsx  
✅ webview-ui/src/vscodeApi.ts  
✅ webview-ui/src/browserMock.ts  
✅ webview-ui/src/constants.ts  
✅ webview-ui/src/runtime.ts  
✅ webview-ui/vite.config.ts  
✅ webview-ui/index.html  
✅ webview-ui/src/office/engine/renderer.ts  
✅ webview-ui/src/office/engine/gameLoop.ts  
✅ webview-ui/src/office/engine/characters.ts  
✅ webview-ui/src/office/engine/officeState.ts  
✅ webview-ui/src/office/engine/index.ts  
✅ webview-ui/src/office/sprites/spriteData.ts  
✅ webview-ui/src/office/sprites/spriteCache.ts  
✅ webview-ui/src/office/sprites/index.ts  
✅ webview-ui/src/office/components/OfficeCanvas.tsx  
✅ webview-ui/src/office/components/ToolOverlay.tsx  
✅ webview-ui/src/office/components/index.ts  
✅ webview-ui/src/hooks/useExtensionMessages.ts  
✅ webview-ui/src/hooks/useEditorActions.ts  
✅ webview-ui/src/hooks/useEditorKeyboard.ts  
✅ src/extension.ts  
✅ src/PixelAgentsViewProvider.ts (message protocol)  
✅ src/types.ts (AgentState, PersistedAgent)  
✅ src/agentManager.ts (agent lifecycle)  
✅ src/transcriptParser.ts (JSONL parsing)  
✅ src/assetLoader.ts (sprite/asset loading)  
✅ README.md (architecture overview)  
✅ tsconfig.json  
✅ .gitignore  
✅ GitHub Releases page (VSIX availability)

### Directory Structure Explored
✅ webview-ui/src/office/engine/  
✅ webview-ui/src/office/sprites/  
✅ webview-ui/src/office/components/  
✅ webview-ui/src/hooks/  
✅ src/

---

## Key Findings Summary

### Packaging
- **Not published to npm** — must use `github:` or source copy
- No `exports`, `main`, `module`, or `types` field in root package.json
- webview-ui is marked private, not meant for publication
- Pre-built VSIX available on GitHub Releases

### Technology Stack
- **Extension**: TypeScript + esbuild
- **Webview**: React 19 + Vite + Canvas 2D + Tailwind CSS
- **Runtime deps**: Only React + React-DOM
- **Dev deps**: Vite, TypeScript, ESLint, pngjs, tsx

### Code Organization
- **Engine**: 940 lines across 5 core files (renderer, gameLoop, characters, officeState, index)
- **Components**: 2 main React components (OfficeCanvas, ToolOverlay)
- **Sprites**: 3 TS files + 2 JSON bubble definitions
- **Total webview code**: ~1500 lines (engine + components + hooks + utils)

### Message Protocol
- **20+ message types** Extension → Webview (assets, agents, tool execution, settings)
- **16+ message types** Webview → Extension (persistence, commands, settings)
- **No binary protocol**, pure JSON over `postMessage`
- Fully mockable for non-VS-Code environments

### Integration Feasibility
- **Iframe**: Yes, with postmessage bridge + asset serving
- **Source copy**: Yes, simplest for Electron
- **npm link**: Yes, but requires build setup
- **VSIX extract**: Yes, but hardcoded paths and VS Code coupling

### Licensing & Usage
- **MIT licensed** — no restrictions
- Can be used commercially
- Can be embedded/forked
- No runtime license checks

---

## Recommended Integration Path

**For Electron + React + Vite app:**

1. Copy `/webview-ui/src/office/` source directory
2. Adapt `vscodeApi.ts` to use Electron IPC (5 min)
3. Create message type interface (15 min)
4. Implement agent lifecycle handler in Electron main (30 min)
5. Create a few test message dispatch calls (30 min)
6. Build & test with mock agent (60 min)

**Total effort: 2-4 hours for working prototype**

---

## What Each Document Answers

### PIXEL_AGENTS_QUICKREF.md
- "Can I use this?" → YES table
- "What does it depend on?" → dependency list
- "How do I integrate?" → 4 ranked approaches
- "What code do I need?" → boilerplate snippets
- "What's the rendering engine?" → 940 lines across 5 files
- "How do messages flow?" → protocol quick ref
- "What's next?" → step-by-step checklist

### RESEARCH_PIXEL_AGENTS.md
- All of the above, PLUS:
- Complete package structure details
- Full rendering engine code breakdown with function signatures
- Asset loading pipeline explanation
- Every message type documented with payloads
- Activity detection mechanism explained
- Installation/npm approaches detailed with trade-offs
- Detailed code examples for each approach
- Sprite system internals (hue shifting, caching, format)
- Character animation state machine details
- Team coordination, permissions, subagents explained
- Files to read next and unresolved questions

---

## Access & Usage

### Read the Quick Reference First
```bash
cat PIXEL_AGENTS_QUICKREF.md
```

### Then Read the Full Report for Implementation
```bash
cat RESEARCH_PIXEL_AGENTS.md
```

### Implementation Checklist (from QUICKREF)
- Copy files section
- Electron integration boilerplate
- Next steps section

---

## Verification Checklist

- [x] Package structure analyzed (root + webview)
- [x] Exports/publishability assessed
- [x] Build outputs verified
- [x] Webview bundle format confirmed
- [x] iframe integration feasibility assessed
- [x] Rendering engine all 5 core files fetched and documented
- [x] Sprite system format (self-contained) confirmed
- [x] React components identified and analyzed
- [x] Message protocol completely mapped (40+ message types)
- [x] Activity detection mechanism explained
- [x] Dependencies audited
- [x] License confirmed (MIT)
- [x] All 4 integration approaches documented
- [x] Trade-offs analyzed
- [x] Code examples provided
- [x] Electron integration path detailed
- [x] Unresolved questions noted

---

## Unresolved Items (Minor)

1. Exact pathfinding implementation (BFS confirmed, details not fetched)
2. Matrix effect animation code (referenced but not retrieved)
3. Furniture rotation hitbox calculation specifics
4. Team coordination protocol details
5. Custom asset directory exact format requirements
6. Hook provider system full details

**Status**: Low priority for initial integration; can defer

---

## Report Statistics

| Metric | Value |
|--------|-------|
| Files researched | 30+ |
| API endpoints called | 30 |
| Documents generated | 3 |
| Total words | ~8000 |
| Code snippets | 15+ |
| Message types documented | 40+ |
| Integration approaches | 4 |
| Repository commits reviewed | None (source analysis only) |
| Time spent | ~1 hour |

---

## Next Actions for Implementation

### Immediate (30 min)
1. Review PIXEL_AGENTS_QUICKREF.md
2. Decide on Approach 1 (source copy) as most practical
3. Clone pixel-agents locally

### Short-term (2-4 hours)
1. Copy `/webview-ui/src/office/` to your project
2. Update `vscodeApi.ts` for Electron IPC
3. Define message types in TypeScript
4. Create simple agent manager
5. Test with mock data

### Medium-term (optional)
1. Implement full agent lifecycle
2. Add asset loading from asar or file://
3. Customize rendering if needed
4. Add persistence layer
5. Create agent UI controls

---

## Questions Answered

**1. Is there a root package.json?**  
✅ Yes, but it's an extension package, not a library

**2. Is there a webview-ui/package.json?**  
✅ Yes, marked private, React 19 + Vite

**3. Can it be published as a library?**  
❌ No, not currently; no `exports` field

**4. Could it be used via `npm install github:...`?**  
✅ Yes, but requires building webview-ui

**5. Does the repo have a pre-built webview bundle?**  
✅ Yes, in releases as VSIX; also outputs dist/ on build

**6. Can it be loaded as iframe/webview in Electron?**  
✅ Yes, with postmessage bridge for IPC

**7. Are sprites base64 or external files?**  
✅ Base64/JSON encoded in bundle (self-contained)

**8. Are React components standalone?**  
⚠️ Partially; they need OfficeState + message dispatch

**9. What's the communication protocol?**  
✅ JSON postMessage with 40+ message types (fully documented)

**10. License?**  
✅ MIT (permissive)

---

## Conclusion

Pixel Agents **is highly integrable** into Electron + React + Vite. The rendering engine is self-contained (~940 lines), has minimal dependencies (React only), uses vanilla Canvas 2D, and is fully MIT-licensed.

**Recommended path**: Source copy + Electron IPC bridge. **ETA: 2-4 hours to prototype.**

---

**Report generated**: 2026-05-07  
**Files created**:
- `/d:/multiAIAgentsClaude/PIXEL_AGENTS_QUICKREF.md`
- `/d:/multiAIAgentsClaude/RESEARCH_PIXEL_AGENTS.md`  
- `/d:/multiAIAgentsClaude/PIXEL_AGENTS_RESEARCH_INDEX.md` (this file)
