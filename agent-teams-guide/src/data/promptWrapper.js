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
    _cachedTemplate = await invoke('read_planning_template')
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

export async function buildMissionPrompt(requirement, options = {}) {
  const { projectPath, teamHint, references = [] } = options
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

  // Apply template replacements
  return planningTemplate
    .replace('{{REQUIREMENT}}', requirement)
    .replace('{{PROJECT_PATH}}', projectPath || '(current directory)')
    .replace('{{LANG_HINT}}', langSection)
    .replace('{{REFERENCES_SECTION}}', referencesSection)
    .replace('{{TEAM_HINT}}', teamHint || 'Use 3-4 teammates for this task')
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
