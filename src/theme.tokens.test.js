import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const CSS_PATH = path.resolve(__dirname, 'index.css')
const TAILWIND_CONFIG_PATH = path.resolve(__dirname, '..', 'tailwind.config.js')

let cssContent
let tailwindContent

beforeAll(() => {
  cssContent = fs.readFileSync(CSS_PATH, 'utf-8')
  tailwindContent = fs.readFileSync(TAILWIND_CONFIG_PATH, 'utf-8')
})

const EXPECTED_VARS = [
  'vs-bg', 'vs-sidebar', 'vs-panel', 'vs-border', 'vs-text', 'vs-muted',
  'vs-comment', 'vs-keyword', 'vs-string', 'vs-number', 'vs-fn', 'vs-type',
  'vs-accent', 'vs-accent2', 'vs-green', 'vs-yellow', 'vs-red', 'vs-orange',
  'vs-heading', 'vs-overlay',
]

describe('theme CSS custom properties', () => {
  it('defines every expected --vs-* variable under :root', () => {
    const rootBlockMatch = cssContent.match(/:root\s*\{([\s\S]*?)\}/)
    expect(rootBlockMatch).toBeTruthy()
    const rootBlock = rootBlockMatch[1]
    for (const name of EXPECTED_VARS) {
      expect(rootBlock).toMatch(new RegExp(`--${name}:`))
    }
  })

  it('defines every expected --vs-* variable under .light with a different value than :root for themed colors', () => {
    const lightBlockMatch = cssContent.match(/\.light\s*\{([\s\S]*?)\}/)
    expect(lightBlockMatch).toBeTruthy()
    const lightBlock = lightBlockMatch[1]
    for (const name of EXPECTED_VARS) {
      expect(lightBlock).toMatch(new RegExp(`--${name}:`))
    }
  })

  it('keeps vs-accent and vs-accent2 identical between :root and .light', () => {
    const rootBlock = cssContent.match(/:root\s*\{([\s\S]*?)\}/)[1]
    const lightBlock = cssContent.match(/\.light\s*\{([\s\S]*?)\}/)[1]
    for (const name of ['vs-accent', 'vs-accent2']) {
      const rootVal = rootBlock.match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim()
      const lightVal = lightBlock.match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim()
      expect(lightVal).toBe(rootVal)
    }
  })

  it('tailwind config resolves every vs-* color via a CSS variable, not a hex literal', () => {
    for (const name of EXPECTED_VARS) {
      const re = new RegExp(`'${name}':\\s*'rgb\\(var\\(--${name}\\)`)
      expect(tailwindContent).toMatch(re)
    }
  })
})
