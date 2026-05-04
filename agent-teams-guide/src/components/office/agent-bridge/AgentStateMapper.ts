import type { AgentAnimationState, MissionLogEntry } from '../types'

export const TOOL_TO_STATE: Record<string, AgentAnimationState> = {
  Write: 'coding',
  Edit: 'coding',
  MultiEdit: 'coding',
  Read: 'reading',
  Glob: 'reading',
  Grep: 'reading',
  Bash: 'working',
  WebFetch: 'working',
  WebSearch: 'working',
  Agent: 'managing',
}

export function mapLogEntryToState(entry: MissionLogEntry): AgentAnimationState {
  if (entry.log_type !== 'tool' || !entry.tool_name) return 'idle'
  return TOOL_TO_STATE[entry.tool_name] ?? 'idle'
}

export function formatSpeechBubble(entry: MissionLogEntry): string | null {
  if (entry.log_type !== 'tool' || !entry.tool_name) return null
  const tool = entry.tool_name.toLowerCase()
  const msg = entry.message || ''
  const filename = msg.split('/').pop() || msg
  const short = filename.length > 20 ? filename.slice(0, 20) + '…' : filename
  return `${tool}: ${short}`
}
