import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC_DIR = path.resolve(__dirname)

// The one deliberate exception: a toggle-switch knob that must stay literally white in both themes.
const ALLOWED_BG_WHITE = new Set([
  path.join(SRC_DIR, 'components', 'mission', 'MissionLauncher.jsx'),
])

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue // third-party vendored assets, not app source
      walk(full, files)
    } else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
      if (!entry.name.includes('.test.')) files.push(full)
    }
  }
  return files
}

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf-8')
  const violations = []
  if (/\btext-white\b/.test(content)) violations.push('text-white')
  if (/\bbg-black\/\d+/.test(content)) violations.push('bg-black/N')
  const bgWhiteOverlay = content.match(/\bbg-white\/\d+/)
  if (bgWhiteOverlay) violations.push('bg-white/N')
  const bgWhiteSolid = /(?<!\/)\bbg-white\b(?!\/)/.test(content)
  if (bgWhiteSolid && !ALLOWED_BG_WHITE.has(file)) violations.push('bg-white (solid)')
  return violations
}

describe('light-theme class migration (whole src tree)', () => {
  const files = walk(SRC_DIR)

  it('found a non-trivial number of files to check', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it('has no text-white, bg-white/N, or bg-black/N outside the documented exception, anywhere in src', () => {
    const allViolations = files
      .map(f => ({ file: path.relative(SRC_DIR, f), violations: checkFile(f) }))
      .filter(r => r.violations.length > 0)
    expect(allViolations).toEqual([])
  })
})
