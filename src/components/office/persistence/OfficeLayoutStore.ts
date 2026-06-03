import type { OfficeLayout } from '../types'

function buildDefaultTiles(): OfficeLayout['tiles'] {
  const map = new Map<string, { x: number; y: number; type: string }>()
  const put = (x: number, y: number, type: string) => map.set(`${x},${y}`, { x, y, type })

  // Walls
  for (let x = 0; x < 32; x++) { put(x, 0, 'wall'); put(x, 23, 'wall') }
  for (let y = 1; y < 23; y++) { put(0, y, 'wall'); put(31, y, 'wall') }

  // Floor (interior)
  for (let y = 1; y < 23; y++) for (let x = 1; x < 31; x++) put(x, y, 'floor')

  // Furniture — overwrites floor at those positions
  for (let i = 0; i < 6; i++) put(4 + i * 4, 5, 'desk')
  for (let i = 0; i < 6; i++) put(4 + i * 4, 10, 'desk')
  put(2, 2, 'plant'); put(29, 2, 'plant'); put(2, 21, 'plant'); put(29, 21, 'plant')
  put(16, 23, 'door')

  return Array.from(map.values())
}

export const DEFAULT_LAYOUT: OfficeLayout = Object.freeze({
  version: 1 as const,
  width: 32,
  height: 24,
  tiles: Object.freeze(buildDefaultTiles()) as OfficeLayout['tiles'],
})

export async function loadLayout(): Promise<OfficeLayout> {
  try {
    const json = await window.electronAPI.invoke('load_office_layout')
    const layout = JSON.parse(json) as OfficeLayout
    if (!Array.isArray(layout.tiles) || layout.tiles.length === 0) {
      return structuredClone(DEFAULT_LAYOUT) as OfficeLayout
    }
    return layout
  } catch {
    return structuredClone(DEFAULT_LAYOUT) as OfficeLayout
  }
}

export async function saveLayout(layout: OfficeLayout): Promise<void> {
  await window.electronAPI.invoke('save_office_layout', { json: JSON.stringify(layout) })
}
