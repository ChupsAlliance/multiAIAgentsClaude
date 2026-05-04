import type { OfficeLayout } from '../types'

export const DEFAULT_LAYOUT: OfficeLayout = Object.freeze({
  version: 1 as const,
  width: 32,
  height: 24,
  tiles: Object.freeze([]) as OfficeLayout['tiles'],
})

export async function loadLayout(): Promise<OfficeLayout> {
  try {
    const json = await window.electronAPI.invoke('load_office_layout', {})
    return JSON.parse(json) as OfficeLayout
  } catch {
    return { ...DEFAULT_LAYOUT, tiles: [] }
  }
}

export async function saveLayout(layout: OfficeLayout): Promise<void> {
  await window.electronAPI.invoke('save_office_layout', { json: JSON.stringify(layout) })
}
