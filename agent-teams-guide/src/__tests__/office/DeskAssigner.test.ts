import { describe, it, expect, beforeEach } from 'vitest'
import { DeskAssigner } from '../../components/office/agent-bridge/DeskAssigner'
import type { Tile } from '../../components/office/types'

const desk = (x: number, y: number): Tile => ({ x, y, type: 'desk' })

describe('DeskAssigner', () => {
  let assigner: DeskAssigner

  beforeEach(() => {
    assigner = new DeskAssigner([desk(0, 0), desk(1, 0), desk(2, 0)])
  })

  it('assigns first available desk on spawn', () => {
    const slot = assigner.assign('agent-1')
    expect(slot).not.toBeNull()
    expect(slot!.tile).toEqual(desk(0, 0))
    expect(slot!.agentName).toBe('agent-1')
  })

  it('assigns second desk to second agent', () => {
    assigner.assign('agent-1')
    const slot = assigner.assign('agent-2')
    expect(slot!.tile).toEqual(desk(1, 0))
  })

  it('returns null when all desks are occupied', () => {
    assigner.assign('agent-1')
    assigner.assign('agent-2')
    assigner.assign('agent-3')
    expect(assigner.assign('agent-4')).toBeNull()
  })

  it('releases desk and makes it available again', () => {
    assigner.assign('agent-1')
    assigner.release('agent-1')
    const slot = assigner.assign('agent-2')
    expect(slot!.tile).toEqual(desk(0, 0))
  })

  it('getSlot returns assigned slot for agent', () => {
    assigner.assign('agent-1')
    const slot = assigner.getSlot('agent-1')
    expect(slot).not.toBeNull()
    expect(slot!.agentName).toBe('agent-1')
  })

  it('getSlot returns null for unassigned agent', () => {
    expect(assigner.getSlot('ghost')).toBeNull()
  })

  it('reset clears all assignments', () => {
    assigner.assign('agent-1')
    assigner.assign('agent-2')
    assigner.reset()
    const slot = assigner.assign('agent-3')
    expect(slot!.tile).toEqual(desk(0, 0))
  })

  it('updateLayout replaces desk slots', () => {
    assigner.assign('agent-1')
    assigner.updateLayout([desk(9, 9)])
    assigner.reset()
    const slot = assigner.assign('agent-2')
    expect(slot!.tile).toEqual(desk(9, 9))
  })
})
