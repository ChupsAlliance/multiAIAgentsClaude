import { describe, it, expect } from 'vitest'
import { compareSemver } from './compareSemver.cjs'

describe('compareSemver', () => {
  it('returns 1 when a has a greater major version', () => {
    expect(compareSemver('1.0.0', '0.9.0')).toBe(1)
  })
  it('returns 1 when a has a greater minor version', () => {
    expect(compareSemver('0.9.0', '0.8.5')).toBe(1)
  })
  it('returns 1 when a has a greater patch version', () => {
    expect(compareSemver('0.7.2', '0.7.1')).toBe(1)
  })
  it('returns -1 when a is less than b', () => {
    expect(compareSemver('0.7.0', '0.7.1')).toBe(-1)
  })
  it('returns 0 when versions are equal', () => {
    expect(compareSemver('0.7.1', '0.7.1')).toBe(0)
  })
  it('returns 0 for unparseable input', () => {
    expect(compareSemver('not-a-version', '0.7.1')).toBe(0)
    expect(compareSemver('0.7.1', 'also-bad')).toBe(0)
  })
})
