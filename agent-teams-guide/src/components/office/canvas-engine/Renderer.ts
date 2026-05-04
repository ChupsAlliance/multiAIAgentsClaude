/**
 * Renderer.ts
 *
 * Main Canvas 2D draw loop and public interface for the Virtual Office.
 * Ported and adapted from pixel-agents (MIT license, pablodelucca/pixel-agents).
 *
 * Adaptations:
 *  - Removed VS Code API calls (vscode.postMessage / acquireVsCodeApi)
 *  - PNG sprites loaded via Vite `new URL('../assets/sprites/…', import.meta.url).href`
 *  - Grid resized to 32×24 tiles (from pixel-agents' 64×64)
 *  - Types use our Tile[] / OfficeAgent[] from types.ts
 *  - Removed editor overlays, seat indicators, ghost preview (VS Code editor features)
 */

import type { OfficeAgent, Tile } from '../types'
import {
  createAnimationState,
  drawSprite,
  getCharacterSprites,
  loadCharacterSprites,
  selectSprite,
  tickAnimation,
  type AnimationState,
} from './SpriteAnimator'
import {
  buildTileGrid,
  renderBackground,
  renderGridLines,
  renderSpeechBubble,
  renderTiles,
} from './TileMap'

// ── Public interface ────────────────────────────────────────────

export interface RendererConfig {
  /** The HTMLCanvasElement to draw into */
  canvas: HTMLCanvasElement
  /** Width in tiles (default 32) */
  width?: number
  /** Height in tiles (default 24) */
  height?: number
  /** Display pixels per tile (default 32) */
  tileSize?: number
}

// ── Internal per-agent state ────────────────────────────────────

interface AgentRenderState {
  agent: OfficeAgent
  anim: AnimationState
}

// ── Renderer class ──────────────────────────────────────────────

export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cols: number
  private rows: number
  private tileSize: number

  private tiles: Tile[] = []
  private agents: OfficeAgent[] = []

  /** Per-agent animation state keyed by agent name */
  private agentStates = new Map<string, AgentRenderState>()

  private rafId = 0
  private lastTime = 0
  private running = false

  /** Preload promises tracked to avoid duplicate fetches */
  private loadingCharacters = new Set<number>()

  constructor(config: RendererConfig) {
    this.canvas = config.canvas
    this.cols = config.width ?? 32
    this.rows = config.height ?? 24
    this.tileSize = config.tileSize ?? 32

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Renderer: could not get 2D context from canvas')
    this.ctx = ctx
    this.ctx.imageSmoothingEnabled = false
  }

  // ── Public API ────────────────────────────────────────────────

  /** Begin the requestAnimationFrame loop */
  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = 0
    this.rafId = requestAnimationFrame(this._frame)
  }

  /** Cancel the animation frame loop */
  stop(): void {
    this.running = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  /** Replace the tile map used for rendering */
  setTileMap(tiles: Tile[]): void {
    this.tiles = tiles
  }

  /** Replace the agent list. Preserves existing animation state for agents that persist. */
  setAgents(agents: OfficeAgent[]): void {
    this.agents = agents

    // Prune removed agents from state map
    const names = new Set(agents.map((a) => a.name))
    for (const name of this.agentStates.keys()) {
      if (!names.has(name)) this.agentStates.delete(name)
    }

    // Add new agents and kick off sprite loading
    for (const agent of agents) {
      if (!this.agentStates.has(agent.name)) {
        this.agentStates.set(agent.name, {
          agent,
          anim: createAnimationState(),
        })
      } else {
        // Update agent reference but preserve animation state
        this.agentStates.get(agent.name)!.agent = agent
      }

      // Preload the character sprite if not already loading
      this._ensureCharacterLoaded(agent.characterIndex)
    }
  }

  // ── Private frame loop ────────────────────────────────────────

  private _frame = (time: number): void => {
    if (!this.running) return

    const dt = this.lastTime === 0 ? 0 : Math.min((time - this.lastTime) / 1000, 0.1)
    this.lastTime = time

    this._update(dt)
    this._render()

    this.rafId = requestAnimationFrame(this._frame)
  }

  private _update(dt: number): void {
    for (const state of this.agentStates.values()) {
      tickAnimation(state.anim, dt, state.agent.state)
    }
  }

  private _render(): void {
    const { ctx, canvas, cols, rows, tileSize } = this

    // Center the grid in the canvas viewport
    const mapW = cols * tileSize
    const mapH = rows * tileSize
    const offsetX = Math.floor((canvas.width - mapW) / 2)
    const offsetY = Math.floor((canvas.height - mapH) / 2)

    // Background
    renderBackground(ctx, canvas.width, canvas.height)

    // Tile floor / walls / furniture
    renderTiles(ctx, this.tiles, offsetX, offsetY, tileSize)

    // Characters (z-sorted by Y position)
    const sortedAgents = [...this.agentStates.values()].sort((a, b) => {
      const ay = a.agent.deskSlot?.tile.y ?? 0
      const by = b.agent.deskSlot?.tile.y ?? 0
      return ay - by
    })

    for (const state of sortedAgents) {
      this._renderAgent(ctx, state, offsetX, offsetY)
    }
  }

  private _renderAgent(
    ctx: CanvasRenderingContext2D,
    state: AgentRenderState,
    offsetX: number,
    offsetY: number,
  ): void {
    const { agent, anim } = state
    const { tileSize } = this

    // Determine pixel position — use desk tile if assigned, otherwise center of map
    let tileX: number
    let tileY: number

    if (agent.deskSlot?.tile) {
      tileX = agent.deskSlot.tile.x
      tileY = agent.deskSlot.tile.y
    } else {
      // No desk: place in a row based on agent order from agents array
      const idx = this.agents.indexOf(agent)
      tileX = 2 + (idx % 4) * 3
      tileY = 2 + Math.floor(idx / 4) * 4
    }

    const px = offsetX + tileX * tileSize
    const py = offsetY + tileY * tileSize

    const sprites = getCharacterSprites(agent.characterIndex)
    if (sprites) {
      const sprite = selectSprite(sprites, agent.state, anim)
      // Draw sprite centered on tile horizontally, anchored at top of tile
      const spriteW = sprite[0]?.length ?? 0
      const spriteH = sprite.length
      const drawX = Math.round(px + tileSize / 2 - (spriteW * (tileSize / 16)) / 2)
      const drawY = Math.round(py - spriteH * (tileSize / 16) + tileSize)
      drawSprite(ctx, sprite, drawX, drawY, tileSize / 16)
    } else {
      // Fallback: draw a colored circle while sprites load
      this._renderFallbackAgent(ctx, agent, px, py)
    }

    // Speech bubble
    if (agent.speechBubble) {
      const now = Date.now()
      if (!agent.speechBubbleExpiry || now < agent.speechBubbleExpiry) {
        const cx = px + tileSize / 2
        const topY = py
        renderSpeechBubble(ctx, agent.speechBubble, cx, topY)
      }
    }

    // Agent name label
    this._renderNameLabel(ctx, agent.name, px + tileSize / 2, py + tileSize + 2)
  }

  private _renderFallbackAgent(
    ctx: CanvasRenderingContext2D,
    agent: OfficeAgent,
    px: number,
    py: number,
  ): void {
    const { tileSize } = this
    const PALETTE = [
      '#e05252', '#52a0e0', '#52c872', '#e0a052',
      '#a052e0', '#52e0d8',
    ]
    const color = PALETTE[agent.characterIndex % PALETTE.length]
    const cx = px + tileSize / 2
    const cy = py + tileSize / 2
    const r = tileSize * 0.35

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()

    // State indicator dot
    const stateColors: Record<string, string> = {
      coding: '#52ff52',
      reading: '#52d8ff',
      working: '#ffcc52',
      waiting: '#ff8c52',
      managing: '#d852ff',
      celebrating: '#ffff52',
      spawning: '#ffffff',
      idle: '#888888',
    }
    const dotColor = stateColors[agent.state] ?? '#aaaaaa'
    ctx.beginPath()
    ctx.arc(cx + r * 0.6, cy - r * 0.6, r * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = dotColor
    ctx.fill()
  }

  private _renderNameLabel(
    ctx: CanvasRenderingContext2D,
    name: string,
    cx: number,
    y: number,
  ): void {
    const shortName = name.length > 10 ? name.slice(0, 9) + '…' : name
    ctx.font = '9px monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillText(shortName, cx, y + 9)
    ctx.textAlign = 'left' // reset
  }

  // ── Sprite preloading ─────────────────────────────────────────

  private _ensureCharacterLoaded(index: number): void {
    if (this.loadingCharacters.has(index)) return
    if (getCharacterSprites(index)) return

    this.loadingCharacters.add(index)
    loadCharacterSprites(index).catch((err) => {
      console.warn(`[Renderer] Failed to load character sprite ${index}:`, err)
    })
  }
}
