import { useMemo } from 'react'
import { AgentSprite } from './AgentSprite'

// Tile fill colors — matches existing TileMap.ts palette
const TILE_COLORS = {
  floor: '#c8b89a',
  wall: '#5a4a3a',
  desk: '#8b6914',
  plant: '#2d7a2d',
  box: '#b8860b',
  door: '#7a5c3a',
}

// Accent overlays drawn on top of tile base color
function TileAccent({ tile, ts }) {
  const { type, x, y } = tile
  const base = {
    position: 'absolute',
    left: x * ts,
    top: y * ts,
    width: ts,
    height: ts,
    pointerEvents: 'none',
  }

  if (type === 'wall') {
    return (
      <div style={{ ...base, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.3)' }} />
    )
  }
  if (type === 'desk') {
    return (
      <div style={{
        position: 'absolute',
        left: x * ts + 2,
        top: y * ts + 2,
        width: ts - 4,
        height: Math.max(1, ts / 2 - 2),
        background: 'rgba(255,255,255,0.15)',
        pointerEvents: 'none',
      }} />
    )
  }
  if (type === 'plant') {
    return (
      <div style={{
        position: 'absolute',
        left: x * ts + ts / 2 - 1,
        top: y * ts + ts / 2,
        width: 2,
        height: Math.max(1, ts / 2 - 2),
        background: '#1a5c1a',
        pointerEvents: 'none',
      }} />
    )
  }
  if (type === 'door') {
    return (
      <div style={{
        position: 'absolute',
        left: x * ts + ts * 0.2,
        top: y * ts + ts * 0.1,
        width: ts * 0.6,
        height: ts * 0.8,
        background: 'rgba(0,0,0,0.2)',
        pointerEvents: 'none',
      }} />
    )
  }
  return null
}

/**
 * OfficeTileGrid — renders the office as CSS positioned divs.
 *
 * Props:
 *   tiles      — Tile[] from OfficeLayout
 *   tileSize   — display pixels per tile
 *   cols       — grid width in tiles (layout.width, default 32)
 *   rows       — grid height in tiles (layout.height, default 24)
 *   agents     — OfficeAgent[] with animFrame + animDir added
 */
export function OfficeTileGrid({ tiles, tileSize, cols = 32, rows = 24, agents = [] }) {
  if (!tileSize) return null

  const ts = tileSize
  const nonFloorTiles = useMemo(() => tiles.filter(t => t.type !== 'floor'), [tiles])

  return (
    <div style={{
      position: 'relative',
      width: cols * ts,
      height: rows * ts,
      backgroundColor: TILE_COLORS.floor,
      // Outer void / background
      outline: '2px solid #1e1e2e',
      flexShrink: 0,
    }}>
      {/* Non-floor tiles */}
      {nonFloorTiles.map(tile => (
        <div key={`${tile.x},${tile.y}`} style={{
          position: 'absolute',
          left: tile.x * ts,
          top: tile.y * ts,
          width: ts,
          height: ts,
          backgroundColor: TILE_COLORS[tile.type] ?? TILE_COLORS.floor,
        }} />
      ))}

      {/* Tile accents (shadows, highlights) */}
      {nonFloorTiles.map(tile => (
        <TileAccent key={`acc-${tile.x},${tile.y}`} tile={tile} ts={ts} />
      ))}

      {/* Agent sprites */}
      {agents.map(agent => (
        <AgentSprite
          key={agent.name}
          agent={agent}
          tileSize={ts}
          animFrame={agent.animFrame ?? 0}
          animDir={agent.animDir ?? 0}
        />
      ))}
    </div>
  )
}
