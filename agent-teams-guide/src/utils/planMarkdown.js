/**
 * planMarkdown.js — Convert between plan data ↔ structured Markdown
 *
 * Functions:
 *   planToMarkdown(agents, tasks, meta)  →  markdown string
 *   parseMissionPlan(markdown)           →  { agents, tasks, meta, warnings }
 *   diffPlanChanges(original, edited)    →  diff summary object
 */

const VALID_MODELS = ['sonnet', 'opus', 'haiku']
const VALID_PRIORITIES = ['high', 'medium', 'low']

// ─── planToMarkdown ────────────────────────────────────────────────────────

/**
 * Convert structured plan data into a human-readable, machine-parseable Markdown
 *
 * @param {Array} agents - [{ name, role, model, reason }]
 * @param {Array} tasks  - [{ id, title, detail, priority, assigned_agent }]
 * @param {Object} meta  - { projectPath, requirement, coordination }
 * @returns {string} formatted markdown
 */
export function planToMarkdown(agents = [], tasks = [], meta = {}) {
  const lines = []

  // ── Header ──
  const agentCount = agents.length
  const taskCount = tasks.length
  const techHint = extractTechStack(tasks)
  const statsLine = [
    `${agentCount} agent${agentCount !== 1 ? 's' : ''}`,
    `${taskCount} task${taskCount !== 1 ? 's' : ''}`,
    techHint,
  ].filter(Boolean).join(' \u2022 ')

  lines.push(`# \uD83C\uDFAF Mission Plan`)
  lines.push('')
  lines.push(`> ${statsLine}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // ── Tổng quan ──
  lines.push(`## \uD83D\uDCCB T\u1ED5ng quan`)
  lines.push('')
  if (meta.requirement) {
    lines.push(`- **M\u1EE5c ti\u00EAu**: ${meta.requirement}`)
  }
  if (techHint) {
    lines.push(`- **Tech Stack**: ${techHint}`)
  }
  if (meta.projectPath) {
    lines.push(`- **Project Path**: ${meta.projectPath.replace(/\\/g, '/')}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  // ── Agent sections ──
  for (const agent of agents) {
    const agentTasks = tasks.filter(t =>
      (t.assigned_agent || t.agent) === agent.name
    )

    lines.push(`## \uD83E\uDD16 Agent: ${agent.name}`)
    lines.push('')
    lines.push(`| Thu\u1ED9c t\u00EDnh | Gi\u00E1 tr\u1ECB |`)
    lines.push('|---|---|')
    lines.push(`| Vai tr\u00F2 | ${agent.role || ''} |`)
    lines.push(`| Model | ${agent.model || 'sonnet'} |`)
    if (agent.reason) {
      lines.push(`| L\u00FD do | ${agent.reason} |`)
    }
    lines.push('')

    if (agentTasks.length > 0) {
      lines.push('### Tasks')
      lines.push('')

      agentTasks.forEach((task, idx) => {
        const pri = (task.priority || 'medium').toUpperCase()
        lines.push(`#### ${idx + 1}. [${pri}] ${task.title}`)

        // Detail text (may be multiline)
        const detail = (task.detail || '').trim()
        if (detail) {
          lines.push(detail)
        }

        // Extract files from detail if not already explicit
        const filesFromDetail = extractFilesFromDetail(detail)
        if (filesFromDetail.length > 0) {
          lines.push('')
          lines.push(`**Files**: ${filesFromDetail.map(f => '`' + f + '`').join(', ')}`)
        }

        lines.push('')
      })
    } else {
      lines.push('### Tasks')
      lines.push('')
      lines.push('*(Ch\u01B0a c\u00F3 task n\u00E0o)*')
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  // ── Unassigned tasks ──
  const unassigned = tasks.filter(t => !(t.assigned_agent || t.agent))
  if (unassigned.length > 0) {
    lines.push(`## \u2753 Ch\u01B0a ph\u00E2n c\u00F4ng`)
    lines.push('')
    unassigned.forEach((task, idx) => {
      const pri = (task.priority || 'medium').toUpperCase()
      lines.push(`#### ${idx + 1}. [${pri}] ${task.title}`)
      const detail = (task.detail || '').trim()
      if (detail) lines.push(detail)
      lines.push('')
    })
    lines.push('---')
    lines.push('')
  }

  // ── Coordination ──
  const coord = meta.coordination || []
  if (coord.length > 0) {
    lines.push(`## \uD83D\uDD17 Ph\u1ED1i h\u1EE3p gi\u1EEFa c\u00E1c Agent`)
    lines.push('')
    for (const item of coord) {
      lines.push(`- ${item}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ─── parseMissionPlan ──────────────────────────────────────────────────────

/**
 * Parse a structured markdown plan back into agents + tasks
 *
 * @param {string} markdown - raw markdown string
 * @returns {{ agents: Array, tasks: Array, meta: Object, warnings: string[] }}
 */
export function parseMissionPlan(markdown) {
  const warnings = []
  const agents = []
  const tasks = []
  const meta = {}

  if (!markdown || typeof markdown !== 'string') {
    return { agents, tasks, meta, warnings: ['Empty markdown input'] }
  }

  // Split into top-level sections by ## headers
  const sections = splitBySections(markdown)

  for (const section of sections) {
    const header = section.header || ''
    const body = section.body || ''

    // ── Tổng quan section ──
    if (/T\u1ED5ng quan/.test(header) || /\uD83D\uDCCB/.test(header)) {
      meta.requirement = extractBulletValue(body, 'M\u1EE5c ti\u00EAu')
      meta.projectPath = extractBulletValue(body, 'Project Path')
      continue
    }

    // ── Agent section ──
    const agentMatch = header.match(/Agent:\s*(.+)$/i)
    if (agentMatch) {
      const agentName = agentMatch[1].trim()

      // Parse table
      const role = extractTableValue(body, 'Vai tr\u00F2')
      const modelRaw = extractTableValue(body, 'Model')
      const reason = extractTableValue(body, 'L\u00FD do')
      const model = VALID_MODELS.includes(modelRaw) ? modelRaw : null

      if (modelRaw && !model) {
        warnings.push(`Agent "${agentName}": model "${modelRaw}" kh\u00F4ng h\u1EE3p l\u1EC7. S\u1EED d\u1EE5ng: ${VALID_MODELS.join(', ')}`)
      }

      agents.push({
        name: agentName,
        role: role || agentName,
        model: model || 'sonnet',
        reason: reason || null,
      })

      // Parse tasks within this agent section
      const agentTasks = parseTasksFromBody(body, agentName)
      tasks.push(...agentTasks)
      continue
    }

    // ── Unassigned section ──
    if (/Ch\u01B0a ph\u00E2n c\u00F4ng/.test(header) || /\u2753/.test(header)) {
      const unassignedTasks = parseTasksFromBody(body, null)
      tasks.push(...unassignedTasks)
      continue
    }

    // ── Coordination section ──
    if (/Ph\u1ED1i h\u1EE3p/.test(header) || /\uD83D\uDD17/.test(header)) {
      const bullets = body.match(/^- .+$/gm)
      if (bullets) {
        meta.coordination = bullets.map(b => b.slice(2).trim())
      }
      continue
    }
  }

  // ── Validation ──
  if (agents.length === 0) {
    warnings.push('Kh\u00F4ng t\u00ECm th\u1EA5y agent n\u00E0o trong k\u1EBF ho\u1EA1ch')
  }
  if (tasks.length === 0) {
    warnings.push('Kh\u00F4ng t\u00ECm th\u1EA5y task n\u00E0o trong k\u1EBF ho\u1EA1ch')
  }

  // Check for agents without tasks
  const agentNames = new Set(agents.map(a => a.name))
  for (const agent of agents) {
    const hasTasks = tasks.some(t => t.assigned_agent === agent.name)
    if (!hasTasks) {
      warnings.push(`Agent "${agent.name}" kh\u00F4ng c\u00F3 task n\u00E0o`)
    }
  }

  // Check for tasks assigned to non-existent agents
  for (const task of tasks) {
    if (task.assigned_agent && !agentNames.has(task.assigned_agent)) {
      warnings.push(`Task "${task.title}" \u0111\u01B0\u1EE3c g\u00E1n cho agent "${task.assigned_agent}" kh\u00F4ng t\u1ED3n t\u1EA1i`)
    }
  }

  return { agents, tasks, meta, warnings }
}

// ─── diffPlanChanges ───────────────────────────────────────────────────────

/**
 * Compare original parsed plan vs edited parsed plan
 *
 * @param {{ agents, tasks }} original - from planToMarkdown source data
 * @param {{ agents, tasks }} edited   - from parseMissionPlan(edited md)
 * @returns {Object} diff summary
 */
export function diffPlanChanges(original, edited) {
  const origAgentNames = new Set((original.agents || []).map(a => a.name))
  const editAgentNames = new Set((edited.agents || []).map(a => a.name))

  const addedAgents = (edited.agents || []).filter(a => !origAgentNames.has(a.name))
  const removedAgents = (original.agents || []).filter(a => !editAgentNames.has(a.name))
  const modifiedAgents = (edited.agents || []).filter(a => {
    if (!origAgentNames.has(a.name)) return false
    const orig = original.agents.find(o => o.name === a.name)
    return orig && (orig.model !== a.model || orig.role !== a.role)
  })

  // Tasks: compare by title (since IDs may not survive MD editing)
  const origTaskTitles = new Set((original.tasks || []).map(t => t.title))
  const editTaskTitles = new Set((edited.tasks || []).map(t => t.title))

  const addedTasks = (edited.tasks || []).filter(t => !origTaskTitles.has(t.title))
  const removedTasks = (original.tasks || []).filter(t => !editTaskTitles.has(t.title))
  const modifiedTasks = (edited.tasks || []).filter(t => {
    if (!origTaskTitles.has(t.title)) return false
    const orig = original.tasks.find(o => o.title === t.title)
    if (!orig) return false
    return (
      orig.detail !== t.detail ||
      orig.priority !== t.priority ||
      orig.assigned_agent !== t.assigned_agent
    )
  })

  // Build summary string
  const parts = []
  if (addedAgents.length)   parts.push(`+${addedAgents.length} agent m\u1EDBi`)
  if (removedAgents.length) parts.push(`-${removedAgents.length} agent x\u00F3a`)
  if (modifiedAgents.length) parts.push(`${modifiedAgents.length} agent s\u1EEDa`)
  if (addedTasks.length)    parts.push(`+${addedTasks.length} task m\u1EDBi`)
  if (removedTasks.length)  parts.push(`-${removedTasks.length} task x\u00F3a`)
  if (modifiedTasks.length) parts.push(`${modifiedTasks.length} task s\u1EEDa`)

  return {
    addedAgents,
    removedAgents,
    modifiedAgents,
    addedTasks,
    removedTasks,
    modifiedTasks,
    hasChanges: parts.length > 0,
    summary: parts.length > 0 ? parts.join(', ') : 'Kh\u00F4ng c\u00F3 thay \u0111\u1ED5i',
  }
}

// ─── extractOutline ────────────────────────────────────────────────────────

/**
 * Extract heading outline for sidebar navigation
 *
 * @param {string} markdown
 * @returns {Array<{ level, text, line, type }>}
 */
export function extractOutline(markdown) {
  if (!markdown) return []
  const outline = []
  const mdLines = markdown.split('\n')

  for (let i = 0; i < mdLines.length; i++) {
    const line = mdLines[i]

    // ## headers
    const h2 = line.match(/^## (.+)$/)
    if (h2) {
      const text = h2[1].replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|\u2753|\uD83D[\uDD17\uDCCB]/g, '').trim()
      const isAgent = /Agent:/i.test(h2[1])
      outline.push({
        level: 2,
        text: text,
        line: i,
        type: isAgent ? 'agent' : 'section',
      })
      continue
    }

    // #### task headers
    const h4 = line.match(/^#### \d+\.\s+\[(\w+)\]\s+(.+)$/)
    if (h4) {
      outline.push({
        level: 4,
        text: h4[2],
        line: i,
        type: 'task',
        priority: h4[1].toLowerCase(),
      })
    }
  }

  return outline
}

// ─── Template generators ───────────────────────────────────────────────────

export function agentTemplate(name = 'new-agent') {
  return `
---

## \uD83E\uDD16 Agent: ${name}

| Thu\u1ED9c t\u00EDnh | Gi\u00E1 tr\u1ECB |
|---|---|
| Vai tr\u00F2 | [\u0110i\u1EC1n vai tr\u00F2] |
| Model | sonnet |

### Tasks

#### 1. [MEDIUM] [\u0110i\u1EC1n t\u00EAn task]
[M\u00F4 t\u1EA3 chi ti\u1EBFt task \u1EDF \u0111\u00E2y]

**Files**: \`[file paths]\`
`
}

export function taskTemplate(num = 1) {
  return `
#### ${num}. [MEDIUM] [\u0110i\u1EC1n t\u00EAn task]
[M\u00F4 t\u1EA3 chi ti\u1EBFt task \u1EDF \u0111\u00E2y]

**Files**: \`[file paths]\`
`
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Split markdown into sections by ## headers
 */
function splitBySections(md) {
  const sections = []
  const lines = md.split('\n')
  let current = null

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/)
    if (h2Match) {
      if (current) sections.push(current)
      current = { header: h2Match[1], body: '' }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
}

/**
 * Extract value from markdown table row: | Key | Value |
 */
function extractTableValue(body, key) {
  const regex = new RegExp(`\\|\\s*${escapeRegex(key)}\\s*\\|\\s*(.+?)\\s*\\|`, 'i')
  const match = body.match(regex)
  return match ? match[1].trim() : ''
}

/**
 * Extract value from bullet: - **Key**: Value
 */
function extractBulletValue(body, key) {
  const regex = new RegExp(`-\\s*\\*\\*${escapeRegex(key)}\\*\\*:\\s*(.+)$`, 'mi')
  const match = body.match(regex)
  return match ? match[1].trim() : ''
}

/**
 * Parse #### task blocks from an agent/section body
 */
function parseTasksFromBody(body, agentName) {
  const tasks = []
  // Split by #### headers
  const taskBlocks = body.split(/^(?=#### )/m).filter(b => b.trim())

  for (const block of taskBlocks) {
    const headerMatch = block.match(/^####\s+\d+\.\s+\[(\w+)\]\s+(.+)$/)
    if (!headerMatch) continue

    const priority = headerMatch[1].toLowerCase()
    const title = headerMatch[2].trim()

    // Everything after the header line is detail
    const bodyLines = block.split('\n').slice(1)

    // Separate detail from **Files** line
    let detail = ''
    const detailLines = []
    for (const line of bodyLines) {
      if (line.startsWith('**Files**:') || line.startsWith('---')) break
      detailLines.push(line)
    }
    detail = detailLines.join('\n').trim()

    tasks.push({
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      detail,
      priority: VALID_PRIORITIES.includes(priority) ? priority : 'medium',
      assigned_agent: agentName,
    })
  }

  return tasks
}

/**
 * Try to extract tech stack keywords from task details
 */
function extractTechStack(tasks) {
  const allText = tasks.map(t => `${t.title} ${t.detail || ''}`).join(' ')
  const keywords = [
    'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt',
    'Express', 'Fastify', 'NestJS', 'Django', 'Flask', 'FastAPI',
    'TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'Java',
    'MongoDB', 'PostgreSQL', 'MySQL', 'SQLite', 'Redis', 'Prisma',
    'Tailwind', 'Vite', 'Webpack', 'Docker',
  ]
  const found = keywords.filter(kw =>
    new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(allText)
  )
  return found.slice(0, 5).join(', ')
}

/**
 * Extract file paths from task detail text (backtick-wrapped paths)
 */
function extractFilesFromDetail(detail) {
  if (!detail) return []
  // Match backtick-wrapped file paths
  const matches = detail.match(/`([^`]+\.[a-zA-Z]{1,5})`/g)
  if (!matches) return []
  return [...new Set(matches.map(m => m.replace(/`/g, '')))]
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── buildAgentPrompt ─────────────────────────────────────────────────────

/**
 * Build a complete, verbatim sub-agent prompt from plan data.
 * This is the single source of truth for what each sub-agent receives.
 *
 * @param {Object} agent      - { name, role, customPrompt, skillFile }
 * @param {Array}  agentTasks - [{ title, detail, priority }] — only this agent's tasks
 * @param {Object} meta       - { projectPath }
 * @returns {string} full prompt string
 */
export function buildAgentPrompt(agent, agentTasks, meta = {}) {
  const name = agent.name || 'agent'
  const role = agent.role || 'Developer'
  const proj = (meta.projectPath || '').replace(/\\/g, '/')

  // Separate skill content (loaded from skillFile) from short custom instructions
  const hasSkill = !!(agent.skillFile && agent.customPrompt)
  const skillContent = hasSkill ? agent.customPrompt : ''
  const customInstructions = (!hasSkill && agent.customPrompt) ? agent.customPrompt : ''

  const lines = []

  // ── Identity ──
  lines.push(`You are '${name}', a ${role} in team 'mission'.`)
  lines.push(`Working directory: ${proj}`)

  // ── Skill injection (verbatim, before tasks) ──
  if (skillContent) {
    lines.push('')
    lines.push(skillContent)
  }

  // ── Tasks ──
  lines.push('')
  lines.push('## Tasks')
  lines.push('')
  if (agentTasks.length === 0) {
    lines.push('(No tasks assigned)')
    lines.push('')
  } else {
    agentTasks.forEach((task, i) => {
      const pri = (task.priority || 'medium').toUpperCase()
      lines.push(`### ${i + 1}. [${pri}] ${task.title}`)
      if (task.detail && task.detail.trim()) {
        lines.push(task.detail.trim())
      }
      lines.push('')
    })
  }

  // ── Execution Protocol ──
  lines.push('## Execution Protocol')
  lines.push('')
  lines.push(`A) SETUP      — cd into ${proj}. Read existing files before writing anything.`)
  lines.push( 'B) IMPLEMENT  — Write ALL files completely. No stubs, no TODOs, no placeholder functions.')
  lines.push( 'C) BUILD      — Run the project\'s build/verify command (npm run build, cargo build, pytest…).')
  lines.push( '                Read ENTIRE output. Fix errors and retry until 0 errors.')
  lines.push( 'D) EVIDENCE   — Print these exact lines when done:')
  lines.push(`                [${name}] BUILD_RESULT: PASS  (or FAIL: <error summary>)`)
  lines.push(`                [${name}] FILES_WRITTEN: <comma-separated list>`)
  lines.push(`                [${name}] Completed: <task>  (one line per task)`)
  lines.push( 'E) COMMUNICATE — Use SendMessage to ask Lead BEFORE guessing on anything unclear.')
  lines.push( '                 Report completion to Lead via SendMessage when all tasks are done.')

  // ── Additional instructions (short, user-supplied, no skill file) ──
  if (customInstructions) {
    lines.push('')
    lines.push('## Additional Instructions')
    lines.push(customInstructions)
  }

  // ── Critical Rules ──
  lines.push('')
  lines.push('## Critical Rules')
  lines.push('- Do NOT report done if build fails. Fix it first.')
  lines.push('- Do NOT write empty files or stub functions.')
  lines.push('- If unsure about ANYTHING, ask Lead via SendMessage first.')

  return lines.join('\n')
}
