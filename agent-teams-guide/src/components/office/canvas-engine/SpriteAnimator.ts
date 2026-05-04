/**
 * SpriteAnimator.ts
 *
 * Character animation state machine for the office canvas.
 * Ported and adapted from pixel-agents (MIT license, pablodelucca/pixel-agents).
 *
 * Adaptations:
 *  - Removed VS Code API calls (vscode.postMessage / acquireVsCodeApi)
 *  - PNG sprites loaded via Vite `new URL(...)` instead of webview URIs
 *  - State machine mapped to our AgentAnimationState (vs pixel-agents CharacterState)
 *  - characterIndex 0-5 maps to char_0.png … char_5.png
 */

import type { AgentAnimationState, OfficeAgent } from '../types'

// Sprite data: 2D array of hex color strings ('' = transparent)
export type SpriteData = string[][]

// ── Constants ───────────────────────────────────────────────────

const CHAR_SPRITE_ROWS = 7  // rows in sprite sheet per character
const CHAR_SPRITE_COLS = 4  // animation frames per row (approx)
const TILE_SIZE = 16        // sprite pixel size (native, before zoom)

const WALK_FRAME_DURATION_SEC = 0.15
const TYPE_FRAME_DURATION_SEC = 0.4

// ── Direction ───────────────────────────────────────────────────

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const
export type Direction = (typeof Direction)[keyof typeof Direction]

// ── CharacterSprites ────────────────────────────────────────────

export interface CharacterSprites {
  walk: Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>
  typing: Record<Direction, [SpriteData, SpriteData]>
  reading: Record<Direction, [SpriteData, SpriteData]>
}

// ── Runtime animation state for one agent ──────────────────────

export interface AnimationState {
  frame: number
  frameTimer: number
  dir: Direction
}

// ── Sprite sheet loader ─────────────────────────────────────────

// Cache of loaded sprite sheets: characterIndex -> ImageBitmap
const imageCache = new Map<number, ImageBitmap>()

// Cache of extracted SpriteData: `${index}-${row}-${col}` -> SpriteData
const spriteDataCache = new Map<string, SpriteData>()

// Cache of fully-built CharacterSprites per character index
const characterSpritesCache = new Map<number, CharacterSprites>()

/** Build a Vite asset URL for char_N.png */
function getSpriteUrl(index: number): string {
  // Map index to specific sprite URLs using import.meta.url pattern
  const urls: Record<number, string> = {
    0: new URL('../assets/sprites/char_0.png', import.meta.url).href,
    1: new URL('../assets/sprites/char_1.png', import.meta.url).href,
    2: new URL('../assets/sprites/char_2.png', import.meta.url).href,
    3: new URL('../assets/sprites/char_3.png', import.meta.url).href,
    4: new URL('../assets/sprites/char_4.png', import.meta.url).href,
    5: new URL('../assets/sprites/char_5.png', import.meta.url).href,
  }
  return urls[index] ?? urls[0]
}

/** Load an ImageBitmap from the char_N.png sprite sheet */
async function loadCharacterImage(index: number): Promise<ImageBitmap> {
  const cached = imageCache.get(index)
  if (cached) return cached

  const url = getSpriteUrl(index)
  const resp = await fetch(url)
  const blob = await resp.blob()
  const bitmap = await createImageBitmap(blob)
  imageCache.set(index, bitmap)
  return bitmap
}

/**
 * Extract a SpriteData (2D hex array) from an ImageBitmap.
 * Each character sheet has rows of 16px-wide animation frames.
 * Row layout (matching pixel-agents char PNG format):
 *   Row 0: walk down  frames 0,1,2
 *   Row 1: walk up    frames 0,1,2
 *   Row 2: walk right frames 0,1,2
 *   Row 3: typing down/up frames
 *   Row 4: typing right frames
 *   Row 5: reading down/up frames
 *   Row 6: reading right frames
 */
function extractSprite(
  bitmap: ImageBitmap,
  srcX: number,
  srcY: number,
  w: number,
  h: number,
): SpriteData {
  const key = `${bitmap.width}-${bitmap.height}-${srcX}-${srcY}-${w}-${h}`
  const cached = spriteDataCache.get(key)
  if (cached) return cached

  const offscreen = new OffscreenCanvas(w, h)
  const ctx = offscreen.getContext('2d')!
  ctx.drawImage(bitmap, srcX, srcY, w, h, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data

  const rows: string[][] = []
  for (let y = 0; y < h; y++) {
    const row: string[] = []
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      if (a < 10) {
        row.push('')
      } else {
        const r = data[i].toString(16).padStart(2, '0')
        const g = data[i + 1].toString(16).padStart(2, '0')
        const b = data[i + 2].toString(16).padStart(2, '0')
        row.push(`#${r}${g}${b}`)
      }
    }
    rows.push(row)
  }

  spriteDataCache.set(key, rows)
  return rows
}

/** Flip a SpriteData horizontally */
function flipHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse())
}

/**
 * Build CharacterSprites from the loaded bitmap.
 * Assumes a sprite sheet with 7 rows x 3+ frames at TILE_SIZE (16px) per cell.
 * Row mapping:
 *   0 = walk-down  (3 frames)
 *   1 = walk-up    (3 frames)
 *   2 = walk-right (3 frames)
 *   3 = typing-down (2 frames)
 *   4 = typing-right (2 frames)
 *   5 = reading-down (2 frames)
 *   6 = reading-right (2 frames)
 *
 * Left variants are generated by flipping Right.
 * Up variants of typing/reading reuse down frames (simplified).
 */
function buildCharacterSprites(bitmap: ImageBitmap): CharacterSprites {
  const S = TILE_SIZE
  const H = S * 2 // sprites are 16x32 (2 tiles tall)

  // Helper to get frame from sheet
  const frame = (row: number, col: number): SpriteData =>
    extractSprite(bitmap, col * S, row * H, S, H)

  // Walk frames: rows 0-2, 3 walk frames each (looped as 0,1,2,1)
  const wd = [frame(0, 0), frame(0, 1), frame(0, 2), frame(0, 1)] as [
    SpriteData,
    SpriteData,
    SpriteData,
    SpriteData,
  ]
  const wu = [frame(1, 0), frame(1, 1), frame(1, 2), frame(1, 1)] as [
    SpriteData,
    SpriteData,
    SpriteData,
    SpriteData,
  ]
  const wr = [frame(2, 0), frame(2, 1), frame(2, 2), frame(2, 1)] as [
    SpriteData,
    SpriteData,
    SpriteData,
    SpriteData,
  ]
  const wl = [flipHorizontal(wr[0]), flipHorizontal(wr[1]), flipHorizontal(wr[2]), flipHorizontal(wr[1])] as [
    SpriteData,
    SpriteData,
    SpriteData,
    SpriteData,
  ]

  // Typing frames: rows 3 (down), 4 (right)
  const td = [frame(3, 0), frame(3, 1)] as [SpriteData, SpriteData]
  const tr = [frame(4, 0), frame(4, 1)] as [SpriteData, SpriteData]
  const tl = [flipHorizontal(tr[0]), flipHorizontal(tr[1])] as [SpriteData, SpriteData]
  const tu = td // reuse down frames for up (simplified)

  // Reading frames: rows 5 (down), 6 (right)
  const rd = [frame(5, 0), frame(5, 1)] as [SpriteData, SpriteData]
  const rr = [frame(6, 0), frame(6, 1)] as [SpriteData, SpriteData]
  const rl = [flipHorizontal(rr[0]), flipHorizontal(rr[1])] as [SpriteData, SpriteData]
  const ru = rd

  return {
    walk: {
      [Direction.DOWN]: wd,
      [Direction.UP]: wu,
      [Direction.RIGHT]: wr,
      [Direction.LEFT]: wl,
    } as Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>,
    typing: {
      [Direction.DOWN]: td,
      [Direction.UP]: tu,
      [Direction.RIGHT]: tr,
      [Direction.LEFT]: tl,
    } as Record<Direction, [SpriteData, SpriteData]>,
    reading: {
      [Direction.DOWN]: rd,
      [Direction.UP]: ru,
      [Direction.RIGHT]: rr,
      [Direction.LEFT]: rl,
    } as Record<Direction, [SpriteData, SpriteData]>,
  }
}

/** Async init: load a character's sprite sheet and cache it */
export async function loadCharacterSprites(index: number): Promise<CharacterSprites> {
  const cached = characterSpritesCache.get(index)
  if (cached) return cached

  const bitmap = await loadCharacterImage(index)
  const sprites = buildCharacterSprites(bitmap)
  characterSpritesCache.set(index, sprites)
  return sprites
}

/** Get cached CharacterSprites (returns placeholder if not yet loaded) */
export function getCharacterSprites(index: number): CharacterSprites | null {
  return characterSpritesCache.get(index) ?? null
}

// ── AgentAnimationState → engine state mapping ──────────────────

function isReadingState(state: AgentAnimationState): boolean {
  return state === 'reading'
}

function isWalkingState(state: AgentAnimationState): boolean {
  return state === 'spawning'
}

/** Select sprite frame based on agent state and animation frame index */
export function selectSprite(
  sprites: CharacterSprites,
  state: AgentAnimationState,
  animState: AnimationState,
): SpriteData {
  const { frame, dir } = animState

  if (isWalkingState(state)) {
    return sprites.walk[dir][frame % 4]
  }

  if (isReadingState(state)) {
    return sprites.reading[dir][frame % 2]
  }

  // All other states (coding, working, waiting, managing, celebrating, idle) → typing anim
  return sprites.typing[dir][frame % 2]
}

// ── Animation tick ──────────────────────────────────────────────

/** Advance animation timer for an agent, updating frame index */
export function tickAnimation(animState: AnimationState, dt: number, agentState: AgentAnimationState): void {
  const duration = isWalkingState(agentState) ? WALK_FRAME_DURATION_SEC : TYPE_FRAME_DURATION_SEC
  animState.frameTimer += dt
  if (animState.frameTimer >= duration) {
    animState.frameTimer -= duration
    animState.frame = (animState.frame + 1) % (isWalkingState(agentState) ? 4 : 2)
  }
}

/** Create a fresh AnimationState for a new agent */
export function createAnimationState(): AnimationState {
  return { frame: 0, frameTimer: 0, dir: Direction.DOWN }
}

// ── Sprite pixel renderer (for zoom) ───────────────────────────

const zoomCaches = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>()

/**
 * Render a SpriteData to an HTMLCanvasElement at a given zoom level.
 * Caches the result to avoid re-rasterizing on every frame.
 */
export function getCachedSpriteCanvas(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  let cache = zoomCaches.get(zoom)
  if (!cache) {
    cache = new WeakMap()
    zoomCaches.set(zoom, cache)
  }

  const cached = cache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = rows > 0 ? sprite[0].length : 0
  const canvas = document.createElement('canvas')
  canvas.width = cols * zoom
  canvas.height = rows * zoom
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = sprite[r][c]
      if (color === '') continue
      ctx.fillStyle = color
      ctx.fillRect(c * zoom, r * zoom, zoom, zoom)
    }
  }

  cache.set(sprite, canvas)
  return canvas
}

/** Render a SpriteData directly to a canvas context at given position/zoom */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  x: number,
  y: number,
  zoom: number,
): void {
  const cached = getCachedSpriteCanvas(sprite, zoom)
  ctx.drawImage(cached, x, y)
}
