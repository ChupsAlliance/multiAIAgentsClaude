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
  const msg = entry.message?.trim()
  if (!msg) return null
  const tool = entry.tool_name.toLowerCase()
  const filename = msg.split('/').filter(Boolean).pop() || msg
  const maxFilename = 30 - tool.length - 2  // 2 = ': '
  const short = filename.length > maxFilename
    ? filename.slice(0, maxFilename) + '…'
    : filename
  return `${tool}: ${short}`
}
