import { describe, it, expect } from 'vitest'

// These two pure functions will be extracted in Task 2.
// Import them once they exist — for now this file defines what they must do.

// extractHtml(stdout: string): string | null
//   Returns the content between <<<HTML>>> and <<<END_HTML>>> markers, trimmed.
//   Returns null if markers are absent.
function extractHtml(stdout) {
  const match = /<<<HTML>>>([\s\S]*?)<<<END_HTML>>>/.exec(stdout)
  return match ? match[1].trim() : null
}

// extractMockupRequest(buf: string): { title: string, spec: string } | null
//   Parses <<<MOCKUP_REQUEST>>>JSON<<<END_MOCKUP_REQUEST>>> from a text buffer.
//   Returns null if absent or JSON is invalid.
function extractMockupRequest(buf) {
  const match = /<<<MOCKUP_REQUEST>>>([\s\S]*?)<<<END_MOCKUP_REQUEST>>>/.exec(buf)
  if (!match) return null
  try { return JSON.parse(match[1].trim()) } catch { return null }
}

describe('extractHtml', () => {
  it('extracts HTML between markers', () => {
    const stdout = 'some preamble\n<<<HTML>>>\n<html>hello</html>\n<<<END_HTML>>>\ntrailing'
    expect(extractHtml(stdout)).toBe('<html>hello</html>')
  })

  it('returns null when markers absent', () => {
    expect(extractHtml('no markers here')).toBeNull()
  })

  it('handles multi-line HTML', () => {
    const html = '<html>\n  <body>hi</body>\n</html>'
    expect(extractHtml(`<<<HTML>>>\n${html}\n<<<END_HTML>>>`)).toBe(html)
  })
})

describe('extractMockupRequest', () => {
  it('parses valid JSON spec', () => {
    const buf = '<<<MOCKUP_REQUEST>>>\n{"title":"Login","spec":"email + password form"}\n<<<END_MOCKUP_REQUEST>>>'
    expect(extractMockupRequest(buf)).toEqual({ title: 'Login', spec: 'email + password form' })
  })

  it('returns null when no markers', () => {
    expect(extractMockupRequest('nothing here')).toBeNull()
  })

  it('returns null on invalid JSON', () => {
    const buf = '<<<MOCKUP_REQUEST>>>not json<<<END_MOCKUP_REQUEST>>>'
    expect(extractMockupRequest(buf)).toBeNull()
  })
})
