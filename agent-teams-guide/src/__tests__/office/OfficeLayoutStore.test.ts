import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadLayout, saveLayout, DEFAULT_LAYOUT } from '../../components/office/persistence/OfficeLayoutStore'
import type { OfficeLayout } from '../../components/office/types'

const mockInvoke = vi.fn()
beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: { invoke: mockInvoke } })
  mockInvoke.mockReset()
})

describe('loadLayout', () => {
  it('returns parsed layout from IPC', async () => {
    const layout: OfficeLayout = { version: 1, width: 32, height: 24, tiles: [{ x: 1, y: 1, type: 'desk' }] }
    mockInvoke.mockResolvedValue(JSON.stringify(layout))
    const result = await loadLayout()
    expect(result).toEqual(layout)
    expect(mockInvoke).toHaveBeenCalledWith('load_office_layout')
  })

  it('returns DEFAULT_LAYOUT when IPC returns invalid JSON', async () => {
    mockInvoke.mockResolvedValue('not-json')
    const result = await loadLayout()
    expect(result).toEqual(DEFAULT_LAYOUT)
  })

  it('returns DEFAULT_LAYOUT when IPC throws', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'))
    const result = await loadLayout()
    expect(result).toEqual(DEFAULT_LAYOUT)
  })

  it('returns DEFAULT_LAYOUT when layout has empty tiles array', async () => {
    const layout: OfficeLayout = { version: 1, width: 32, height: 24, tiles: [] }
    mockInvoke.mockResolvedValue(JSON.stringify(layout))
    const result = await loadLayout()
    expect(result).toEqual(DEFAULT_LAYOUT)
  })
})

describe('saveLayout', () => {
  it('calls IPC with serialized layout', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const layout: OfficeLayout = { version: 1, width: 32, height: 24, tiles: [] }
    await saveLayout(layout)
    expect(mockInvoke).toHaveBeenCalledWith('save_office_layout', { json: JSON.stringify(layout) })
  })

  it('rejects when IPC throws', async () => {
    mockInvoke.mockRejectedValue(new Error('disk full'))
    await expect(saveLayout({ version: 1, width: 32, height: 24, tiles: [] })).rejects.toThrow('disk full')
  })
})

describe('DEFAULT_LAYOUT', () => {
  it('has correct structure and non-empty tiles', () => {
    expect(DEFAULT_LAYOUT.version).toBe(1)
    expect(DEFAULT_LAYOUT.width).toBe(32)
    expect(DEFAULT_LAYOUT.height).toBe(24)
    expect(Array.isArray(DEFAULT_LAYOUT.tiles)).toBe(true)
    expect(DEFAULT_LAYOUT.tiles.length).toBeGreaterThan(0)
  })
})
