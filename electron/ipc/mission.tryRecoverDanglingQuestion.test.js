import { describe, it, expect } from 'vitest'
import { tryRecoverDanglingQuestion } from './mission.cjs'

describe('tryRecoverDanglingQuestion', () => {
  it('recovers a question block missing both closing markers (real-world log)', () => {
    const buffer = `This feature involves a Record button and likely a playback/demo UI, but let me first ask clarifying questions before deciding on mockups, per the mandatory Q&A gate.

<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"Khi ấn 'Record' và Mission Control chạy xong, hệ thống sẽ tạo ra 1 file kịch bản (recording). Khi 'replay' file đó để demo cho khách hàng, bạn muốn nó chạy như thế nào?","options":["A","B","C"],"context":"Điều này quyết định kiến trúc."}`

    const result = tryRecoverDanglingQuestion(buffer)

    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe('Lead')
    expect(result[0].question).toMatch(/Record/)
  })

  it('recovers a question block that has END_QUESTION but is missing the batch-terminal marker', () => {
    const buffer = `<<<QUESTION>>>\n{"from":"Lead","type":"clarification","question":"Which approach?"}\n<<<END_QUESTION>>>`

    const result = tryRecoverDanglingQuestion(buffer)

    expect(result).not.toBeNull()
    expect(result[0].question).toBe('Which approach?')
  })

  it('returns null when there is no QUESTION marker at all', () => {
    expect(tryRecoverDanglingQuestion('just some plain text, no markers here')).toBeNull()
  })

  it('returns null when the JSON after the marker is truncated/malformed', () => {
    const buffer = `<<<QUESTION>>>\n{"from":"Lead","type":"clarification","question":"Which appro`

    expect(tryRecoverDanglingQuestion(buffer)).toBeNull()
  })

  it('returns null when the parsed JSON has no "question" field', () => {
    const buffer = `<<<QUESTION>>>\n{"from":"Lead","type":"clarification"}`

    expect(tryRecoverDanglingQuestion(buffer)).toBeNull()
  })

  it('uses the last QUESTION marker when multiple are present', () => {
    const buffer = `<<<QUESTION>>>{"from":"Lead","question":"first?"}<<<END_QUESTION>>><<<QUESTION>>>{"from":"Lead","question":"second?"}`

    const result = tryRecoverDanglingQuestion(buffer)

    expect(result[0].question).toBe('second?')
  })
})
