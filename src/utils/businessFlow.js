/**
 * businessFlow.js — Build a render model for the read-only "Nghiệp vụ" panel.
 * Pure functions only; no React, no DOM.
 */

// Fixed palette (VS Code dark friendly). Index chosen by a stable hash of the name.
const PALETTE = ['#569cd6', '#4ec9b0', '#c586c0', '#dcdcaa', '#ce9178', '#9cdcfe', '#d7ba7d']
const DEFAULT_COLOR = '#6b7280' // neutral gray for input/output and unknown agents

/**
 * Deterministic color from an agent name.
 * @param {string} name
 * @returns {string} hex color
 */
export function agentColor(name) {
  if (!name || typeof name !== 'string') return DEFAULT_COLOR
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Build the flow render model from mission_context.business.
 *
 * @param {Object|null|undefined} business
 * @param {Array<{name:string}>} agents
 * @returns {{ visible:boolean, hasFlow:boolean, summary:Object, nodes:Array, edges:Array }}
 */
export function buildFlowModel(business, agents = []) {
  const empty = { visible: false, hasFlow: false, summary: { whatItDoes: '', whatYouGet: '', howItWorks: '' }, nodes: [], edges: [] }
  if (!business || typeof business !== 'object') return empty

  const summary = {
    whatItDoes: str(business.what_it_does),
    whatYouGet: str(business.what_you_get),
    howItWorks: str(business.how_it_works),
  }

  const flow = business.flow && typeof business.flow === 'object' ? business.flow : null
  const input = flow ? str(flow.input) : ''
  const output = flow ? str(flow.output) : ''
  const steps = flow && Array.isArray(flow.steps) ? flow.steps : []

  const hasAnySummary = summary.whatItDoes || summary.whatYouGet || summary.howItWorks
  const hasAnyFlow = !!(input || output || steps.some(s => str(s && s.label)))

  const visible = !!(hasAnySummary || hasAnyFlow)
  if (!visible) return empty

  const agentNames = new Set((agents || []).map(a => a && a.name).filter(Boolean))

  const nodes = []
  if (input) nodes.push({ kind: 'input', label: input, agentName: null, color: DEFAULT_COLOR })
  for (const s of steps) {
    const label = str(s && s.label)
    if (!label) continue
    const by = str(s && s.by)
    const agentName = by || null
    const color = by ? (agentNames.has(by) ? agentColor(by) : DEFAULT_COLOR) : DEFAULT_COLOR
    nodes.push({ kind: 'step', label, agentName, color })
  }
  if (output) nodes.push({ kind: 'output', label: output, agentName: null, color: DEFAULT_COLOR })

  const edges = []
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: i, to: i + 1 })

  return { visible, hasFlow: nodes.length > 0, summary, nodes, edges }
}
