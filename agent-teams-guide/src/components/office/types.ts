// Tile types that can appear in the office grid
export type TileType =
  | 'floor'
  | 'wall'
  | 'desk'      // special: workstation slot for agents
  | 'plant'
  | 'box'
  | 'door'
  | 'empty'     // transparent / no tile

// A single tile placed in the grid
export interface Tile {
  x: number   // column (0-indexed)
  y: number   // row (0-indexed)
  type: TileType
}

// The full office layout stored to disk
export interface OfficeLayout {
  version: 1
  width: number   // default 32
  height: number  // default 24
  tiles: Tile[]
}

// Animation state for a character in the office
export type AgentAnimationState =
  | 'spawning'
  | 'coding'       // Write, Edit, MultiEdit
  | 'reading'      // Read, Glob, Grep
  | 'working'      // Bash, WebFetch, WebSearch
  | 'waiting'      // agent waiting for user input
  | 'managing'     // Agent tool (spawning sub-agent)
  | 'celebrating'  // task/mission complete
  | 'idle'

// A desk slot in the office with optional occupant
export interface DeskSlot {
  tile: Tile
  agentName: string | null
}

// Runtime representation of an agent in the office
export interface OfficeAgent {
  name: string
  characterIndex: number   // 0-5, which of the 6 sprites
  state: AgentAnimationState
  deskSlot: DeskSlot | null
  speechBubble: string | null
  speechBubbleExpiry: number | null  // Date.now() + 3000
}

// A log entry from useMission that drives animation
export interface MissionLogEntry {
  agent: string
  message: string
  log_type: 'tool' | 'result' | 'error' | 'message' | string
  tool_name?: string
  timestamp?: number
}
