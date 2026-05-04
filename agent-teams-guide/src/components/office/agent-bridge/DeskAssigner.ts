import type { Tile, DeskSlot } from '../types'

export class DeskAssigner {
  private slots: DeskSlot[]

  constructor(deskTiles: Tile[]) {
    this.slots = deskTiles.map(tile => ({ tile, agentName: null }))
  }

  assign(agentName: string): DeskSlot | null {
    const free = this.slots.find(s => s.agentName === null)
    if (!free) return null
    free.agentName = agentName
    return free
  }

  release(agentName: string): void {
    const slot = this.slots.find(s => s.agentName === agentName)
    if (slot) slot.agentName = null
  }

  getSlot(agentName: string): DeskSlot | null {
    return this.slots.find(s => s.agentName === agentName) ?? null
  }

  reset(): void {
    this.slots.forEach(s => { s.agentName = null })
  }

  updateLayout(deskTiles: Tile[]): void {
    this.slots = deskTiles.map(tile => ({ tile, agentName: null }))
  }
}
