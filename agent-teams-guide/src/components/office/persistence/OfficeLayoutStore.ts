import type { OfficeLayout } from '../types'

function buildDefaultTiles(): OfficeLayout['tiles'] {
  const t: OfficeLayout['tiles'] = []
  for (let x = 0; x < 32; x++) { t.push({x, y: 0, type:'wall'}); t.push({x, y: 23, type:'wall'}) }
  for (let y = 1; y < 23; y++) { t.push({x: 0, y, type:'wall'}); t.push({x: 31, y, type:'wall'}) }
  for (let y = 1; y < 23; y++) for (let x = 1; x < 31; x++) t.push({x, y, type:'floor'})
  for (let i = 0; i < 6; i++) t.push({x: 4 + i*4, y: 5, type:'desk'})
  for (let i = 0; i < 6; i++) t.push({x: 4 + i*4, y: 10, type:'desk'})
  t.push({x:2,y:2,type:'plant'},{x:29,y:2,type:'plant'},{x:2,y:21,type:'plant'},{x:29,y:21,type:'plant'})
  t.push({x:16,y:23,type:'door'})
  return t
}

export const DEFAULT_LAYOUT: OfficeLayout = Object.freeze({
  version: 1 as const,
  width: 32,
  height: 24,
  tiles: Object.freeze(buildDefaultTiles()) as OfficeLayout['tiles'],
})

export async function loadLayout(): Promise<OfficeLayout> {
  try {
    const json = await (window as any).electronAPI.invoke('load_office_layout')
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
