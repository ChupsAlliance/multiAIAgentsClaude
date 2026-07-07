/**
 * Build the mission prompt that gets sent to Claude CLI.
 *
 * Flow:
 *   1. User types requirement → buildMissionPrompt() wraps it
 *   2. Claude CLI receives this prompt in -p (print) mode
 *   3. Lead agent analyzes, outputs JSON plan between === markers
 *   4. App parses plan → shows PlanReview UI
 *   5. User approves → backend builds deploy prompt from .md template
 *   6. New Claude CLI process spawns teammates via Agent tool
 *
 * Template: electron/prompts/planning.md (editable at runtime after install)
 * Fallback: src/data/prompts/planning.md (bundled, for Tauri mode)
 */

import bundledTemplate from './prompts/planning.md?raw'
import { invoke } from '@tauri-apps/api/core'

// Cache: load once from disk, reuse until app restart
let _cachedTemplate = null

/**
 * Load planning template from disk (Electron) or use bundled (Tauri).
 * Users can edit the .md file in the install directory and changes
 * take effect on next app launch.
 */
async function loadPlanningTemplate() {
  if (_cachedTemplate) return _cachedTemplate
  try {
    const result = await invoke('read_planning_template')
    _cachedTemplate = result || bundledTemplate
  } catch {
    // Fallback: Tauri mode or handler not available → use bundled
    _cachedTemplate = bundledTemplate
  }
  return _cachedTemplate
}

/**
 * Detect if text contains Vietnamese characters.
 * Returns a language hint string to inject into prompts.
 */
function detectLanguageHint(text) {
  // Vietnamese-specific characters (tones + special letters)
  const viPattern = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐ]/
  if (viPattern.test(text)) {
    return `LANGUAGE RULE: The requirement is written in Vietnamese. Therefore:
- All UI text, labels, buttons, placeholders, and user-facing strings in the app MUST be in Vietnamese
- For any PDF generation: you MUST embed a Unicode font that supports Vietnamese (e.g. use jsPDF with a custom font, or use @fontsource packages). Do NOT use default Latin-only fonts — they will display □□□ boxes for Vietnamese characters
- Test that Vietnamese characters render correctly before marking any task done`
  }
  return null
}

/**
 * Build the Phase 0 wrapper that prepends brainstorming skill to planning prompt.
 * @param {string} skillContent - Raw content of brainstorming/SKILL.md
 * @returns {string} Phase 0 section to prepend to the planning template
 */
function buildPhase0Wrapper(skillContent) {
  const skillSection = skillContent
    ? `\n### Brainstorming Framework\nThe following skill provides structure for your questions:\n\n${skillContent}\n=== END BRAINSTORMING FRAMEWORK ===\n`
    : ''

  return `## ⚠ PHASE 0: MANDATORY Q&A — Read This BEFORE "Phase 1"

**STOP. Do NOT proceed to "Phase 1: Analyze & Plan" yet.**

You are in Deep Plan mode. Before doing ANY analysis or planning, you MUST ask the user clarifying questions. Minimum 3 questions, maximum 5.

### How to ask a question (use EXACT format, ONE question per turn, then STOP):

<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"Your specific question here","options":["Option A","Option B","Option C"],"context":"Why this matters for correct planning"}
<<<END_QUESTION>>>
<<<QUESTIONS_END>>>

After writing \`<<<QUESTIONS_END>>>\`, STOP IMMEDIATELY — do not write another word. You will be resumed with the user's answer. Then ask your next question (or proceed after 3–5 total).

### After receiving answers to 3–5 questions:

1. Write a \`## MISSION UNDERSTANDING\` section (2–3 paragraphs summarising key decisions)
2. Then proceed to Phase 1 below — read the codebase and output the MISSION PLAN JSON

**HARD RULES:**
- Do NOT output \`=== MISSION PLAN ===\` until you have asked and received answers to at least 3 questions.
- After outputting \`=== END PLAN ===\`, STOP IMMEDIATELY. Do NOT spawn any agents or tools. The user must review and approve the plan first.
${skillSection}
---

`
}

export async function buildMissionPrompt(requirement, options = {}) {
  const { projectPath, teamHint, references = [], permissionMode = 'auto' } = options
  const langHint = detectLanguageHint(requirement)
  const planningTemplate = await loadPlanningTemplate()

  // Build reference materials section
  let referencesSection = ''
  if (references.length > 0) {
    const parts = []

    // Document contents (inline)
    const docs = references.filter(r => r.type === 'file' && r.content)
    if (docs.length > 0) {
      for (const doc of docs) {
        // Truncate very large docs to avoid prompt overflow
        const content = doc.content.length > 50000
          ? doc.content.slice(0, 50000) + '\n\n... (truncated, read the full file at: ' + (doc.path || doc.name) + ')'
          : doc.content
        parts.push(`### Document: ${doc.name}${doc.path ? ` (${doc.path})` : ''}
\`\`\`
${content}
\`\`\``)
      }
    }

    // Folder references
    const folders = references.filter(r => r.type === 'folder')
    if (folders.length > 0) {
      parts.push(`### Reference Folders (read these before planning)
${folders.map(f => `- ${f.path || f.name} (folder — explore its contents to understand existing code/docs)`).join('\n')}`)
    }

    // Image references
    const images = references.filter(r => r.type === 'image')
    if (images.length > 0) {
      parts.push(`### Reference Images/Mockups
${images.map(img => `- ${img.path || img.name} (image — ${img.path ? 'read this file to see the design mockup' : 'uploaded image, check project dir for _mission_ref_* files'})`).join('\n')}`)
    }

    // File references without content (too large to inline, just path)
    const pathOnly = references.filter(r => r.type === 'file' && !r.content && r.path)
    if (pathOnly.length > 0) {
      parts.push(`### Reference Files (read these before planning)
${pathOnly.map(f => `- ${f.path} (${(f.size / 1024).toFixed(1)} KB — read this file for context)`).join('\n')}`)
    }

    if (parts.length > 0) {
      referencesSection = `
## REFERENCE MATERIALS
The user provided the following reference materials. Read and understand them thoroughly before planning.

${parts.join('\n\n')}
`
    }
  }

  // Build language hint section
  const langSection = langHint ? `\n## LANGUAGE REQUIREMENT\n${langHint}\n` : ''

  // Shared interactive question protocol text (used by both 'interactive' and deep_plan fallback)
  const INTERACTIVE_PERMISSION_TEXT = `Use the <<<QUESTION>>> protocol below. The app will show your questions to the user and resume the session with their answers.

1. Output this EXACT format (one block per question):
<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"Your specific question here","options":["Option A","Option B"],"context":"Why you need this answered"}
<<<END_QUESTION>>>

2. You may output multiple <<<QUESTION>>> blocks if you have several questions.

3. After ALL questions, output the terminal marker:
<<<QUESTIONS_END>>>

4. Then STOP. End your turn immediately after <<<QUESTIONS_END>>>.
   The user will answer your questions and a new turn will begin with their answers.
   After receiving answers, continue with Phase 1 analysis and output the plan.

RULES:
- Only ask when you truly lack critical information that would lead to wrong decisions.
- Prefer making informed decisions autonomously when possible.
- ALWAYS end your question batch with <<<QUESTIONS_END>>> marker.`

  // Build permission mode section for planning phase
  let permissionSection = ''
  let phase0Section = ''

  if (permissionMode === 'deep_plan') {
    // Read brainstorming skill from superpowers installation
    let skillContent = null
    try {
      skillContent = await invoke('read_superpowers_skill', { skillName: 'brainstorming' })
    } catch {
      // IPC not available (Tauri mode or handler missing) — fall back gracefully
    }

    // Always build Phase 0 — it's the hard gate that blocks Phase 1 until Q&A is done.
    // Skill content adds brainstorming structure but Phase 0 works without it.
    phase0Section = buildPhase0Wrapper(skillContent)
    if (!skillContent) {
      console.warn('[deep_plan] superpowers brainstorming skill not found — Phase 0 running without it')
    }

    // Minimal reminder at the bottom ({{PERMISSION_MODE}} slot).
    // The full protocol is already in Phase 0 above; repeating it here would cause confusion.
    permissionSection = `See Phase 0 instructions at the top of this prompt — Q&A is mandatory before planning. Use the <<<QUESTION>>> protocol defined there.`
  } else if (permissionMode === 'interactive') {
    permissionSection = INTERACTIVE_PERMISSION_TEXT
  } else {
    permissionSection = `Make all decisions independently. Choose the most optimal approach.
Do NOT output <<<QUESTION>>> markers. Proceed directly to Phase 1 analysis.`
  }

  // Apply template replacements
  const filledTemplate = planningTemplate
    .replace('{{REQUIREMENT}}', requirement)
    .replace('{{PROJECT_PATH}}', projectPath || '(current directory)')
    .replace('{{LANG_HINT}}', langSection)
    .replace('{{REFERENCES_SECTION}}', referencesSection)
    .replace('{{TEAM_HINT}}', teamHint || 'Use 3-4 teammates for this task')
    .replace('{{PERMISSION_MODE}}', permissionSection)

  // Prepend Phase 0 (Deep Plan mode only) — empty string otherwise
  return phase0Section + filledTemplate
}

/**
 * Metadata about how the system works — used by UI to explain the flow.
 */
export const SYSTEM_INFO = {
  flowSteps: [
    {
      step: 1,
      title: 'User nhập requirement',
      detail: 'Mô tả bằng ngôn ngữ tự nhiên những gì cần làm',
    },
    {
      step: 2,
      title: 'App build System Prompt',
      detail: 'buildMissionPrompt() wrap requirement + instructions vào prompt template',
    },
    {
      step: 3,
      title: 'Gửi cho Claude CLI',
      detail: 'claude -p --output-format stream-json --verbose',
    },
    {
      step: 4,
      title: 'Lead Agent phân tích',
      detail: 'Claude (model bạn chọn) đọc codebase, chia tasks, output JSON plan',
    },
    {
      step: 5,
      title: 'User review plan',
      detail: 'Chọn model cho từng agent, edit tasks, thêm custom prompt',
    },
    {
      step: 6,
      title: 'Deploy execution',
      detail: 'Claude mới được spawn, dùng Agent tool để tạo subagents',
    },
    {
      step: 7,
      title: 'Subagents thực thi',
      detail: 'Mỗi subagent = 1 Claude instance riêng, có tools: Read, Write, Edit, Bash, Glob, Grep',
    },
  ],

  agentTools: [
    'Read — Đọc files',
    'Write — Tạo file mới',
    'Edit — Sửa file (find & replace)',
    'Bash — Chạy terminal commands',
    'Glob — Tìm files theo pattern',
    'Grep — Tìm kiếm trong file contents',
  ],

  modelInfo: {
    sonnet: { label: 'Sonnet 4.6', speed: 'Nhanh', cost: 'Trung bình', best: 'Code thông thường, API, UI' },
    opus:   { label: 'Opus 4.6', speed: 'Chậm hơn', cost: 'Cao', best: 'Kiến trúc phức tạp, multi-step reasoning' },
    haiku:  { label: 'Haiku 4.5', speed: 'Rất nhanh', cost: 'Rẻ', best: 'Docs, formatting, tasks đơn giản' },
  },
}
