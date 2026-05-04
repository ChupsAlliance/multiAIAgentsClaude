/**
 * TileMap.ts
 *
 * Floor, wall, and furniture tile rendering for the office canvas.
 * Ported and adapted from pixel-agents (MIT license, pablodelucca/pixel-agents).
 *
 * Adaptations:
 *  - Removed VS Code API / webview URI calls
 *  - TileType mapping adapted from our types.ts ('floor','wall','desk','plant','box','door','empty')
 *  - No external color system — uses flat color fills for simplicity
 *  - Grid size uses RendererConfig width/height (32×24) instead of pixel-agents layout
 */

import type { Tile, TileType } from '../types'
import type { SpriteData } from './SpriteAnimator'

// ── Tile colors ─────────────────────────────────────────────────

const TILE_COLORS: Record<TileType, string | null> = {
  floor: '#c8b89a',   // warm beige
  wall: '#5a4a3a',    // dark brown
  desk: '#8b6914',    // golden wood
  plant: '#2d7a2d',   // green
  box: '#b8860b',     // dark goldenrod
  door: '#7a5c3a',    // medium brown
  empty: null,        // transparent (skip)
}

const GRID_LINE_COLOR = 'rgba(0,0,0,0.08)'
const FALLBACK_FLOOR_COLOR = '#c8b89a'
const WALL_COLOR = '#5a4a3a'

// ── Tile drawer ─────────────────────────────────────────────────

/**
 * Build a 2D lookup grid from a flat Tile[] array.
 * Returns a Map keyed by `"x,y"` for O(1) tile lookup.
 */
export function buildTileGrid(tiles: Tile[]): Map<string, TileType> {
  const grid = new Map<string, TileType>()
  for (const t of tiles) {
    grid.set(`${t.x},${t.y}`, t.type)
  }
  return grid
}

/**
 * Render all tiles onto the canvas context.
 *
 * @param ctx - Canvas 2D context
 * @param tiles - Flat Tile array
 * @param offsetX - Pixel X offset of the grid origin (for centering)
 * @param offsetY - Pixel Y offset of the grid origin (for centering)
 * @param tileSize - Display pixels per tile
 */
export function renderTiles(
  ctx: CanvasRenderingContext2D,
  tiles: Tile[],
  offsetX: number,
  offsetY: number,
  tileSize: number,
): void {
  for (const tile of tiles) {
    if (tile.type === 'empty') continue

    const px = offsetX + tile.x * tileSize
    const py = offsetY + tile.y * tileSize

    const color = TILE_COLORS[tile.type]
    if (!color) continue

    ctx.fillStyle = color
    ctx.fillRect(px, py, tileSize, tileSize)

    // Draw wall border highlights
    if (tile.type === 'wall') {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'
      ctx.lineWidth = 1
      ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1)
    }

    // Draw desk surface accent
    if (tile.type === 'desk') {
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.fillRect(px + 2, py + 2, tileSize - 4, tileSize / 2 - 2)
    }

    // Draw plant stem accent
    if (tile.type === 'plant') {
      ctx.fillStyle = '#1a5c1a'
      ctx.fillRect(px + tileSize / 2 - 1, py + tileSize / 2, 2, tileSize / 2 - 2)
    }

    // Door gap accent
    if (tile.type === 'door') {
      ctx.fillStyle = 'rgba(0,0,0,0.2)'
      ctx.fillRect(px + tileSize * 0.2, py + tileSize * 0.1, tileSize * 0.6, tileSize * 0.8)
    }
  }
}

/**
 * Render grid lines over the tile grid.
 * Useful for debugging layout during development.
 */
export function renderGridLines(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  tileSize: number,
): void {
  ctx.strokeStyle = GRID_LINE_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()

  for (let c = 0; c <= cols; c++) {
    const x = offsetX + c * tileSize + 0.5
    ctx.moveTo(x, offsetY)
    ctx.lineTo(x, offsetY + rows * tileSize)
  }
  for (let r = 0; r <= rows; r++) {
    const y = offsetY + r * tileSize + 0.5
    ctx.moveTo(offsetX, y)
    ctx.lineTo(offsetX + cols * tileSize, y)
  }

  ctx.stroke()
}

/**
 * Fill the background behind all tiles with a void/background color.
 * Represents the "outside the office" region.
 */
export function renderBackground(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.fillStyle = '#1e1e2e'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
}

// ── Speech bubble ───────────────────────────────────────────────

/**
 * Draw a simple speech bubble above a character.
 *
 * @param ctx - Canvas 2D context
 * @param text - Text to display (truncated if needed)
 * @param cx - Center X of the character in canvas pixels
 * @param topY - Top Y of the character in canvas pixels
 */
export function renderSpeechBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  topY: number,
): void {
  const fontSize = 10
  const padding = 4
  const maxChars = 24
  const label = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text

  ctx.font = `${fontSize}px monospace`
  const textW = ctx.measureText(label).width
  const bubbleW = textW + padding * 2
  const bubbleH = fontSize + padding * 2
  const bubbleX = cx - bubbleW / 2
  const bubbleY = topY - bubbleH - 6
  const radius = 4

  // Background
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.beginPath()
  ctx.moveTo(bubbleX + radius, bubbleY)
  ctx.lineTo(bubbleX + bubbleW - radius, bubbleY)
  ctx.arcTo(bubbleX + bubbleW, bubbleY, bubbleX + bubbleW, bubbleY + bubbleH, radius)
  ctx.lineTo(bubbleX + bubbleW, bubbleY + bubbleH)
  ctx.lineTo(cx + 4, bubbleY + bubbleH)
  ctx.lineTo(cx, topY - 2)
  ctx.lineTo(cx - 4, bubbleY + bubbleH)
  ctx.lineTo(bubbleX, bubbleY + bubbleH)
  ctx.arcTo(bubbleX, bubbleY, bubbleX + radius, bubbleY, radius)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = 'rgba(0,0,0,0.15)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Text
  ctx.fillStyle = '#222'
  ctx.fillText(label, bubbleX + padding, bubbleY + padding + fontSize - 2)
}
