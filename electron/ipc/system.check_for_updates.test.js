import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkForUpdates } from './system.cjs'

const REPO_URL = 'https://api.github.com/repos/ChupsAlliance/multiAIAgentsClaude/releases/latest'

describe('checkForUpdates', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('reports an update when the latest release tag is newer', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.9.0',
        html_url: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0',
        assets: [{ name: 'Claude.Agent.Teams.Setup.0.9.0.exe', browser_download_url: 'https://example.com/setup.exe' }],
      }),
    })

    const result = await checkForUpdates('0.7.1')

    expect(global.fetch).toHaveBeenCalledWith(REPO_URL, expect.objectContaining({ signal: expect.anything() }))
    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.7.1',
      latestVersion: '0.9.0',
      downloadUrl: 'https://example.com/setup.exe',
      releaseNotesUrl: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0',
    })
  })

  it('reports no update when already on the latest version', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.7.1',
        html_url: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.7.1',
        assets: [{ name: 'Claude.Agent.Teams.Setup.0.7.1.exe', browser_download_url: 'https://example.com/setup.exe' }],
      }),
    })

    const result = await checkForUpdates('0.7.1')
    expect(result.hasUpdate).toBe(false)
  })

  it('falls back to release.html_url when no .exe asset exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.9.0',
        html_url: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0',
        assets: [],
      }),
    })

    const result = await checkForUpdates('0.7.1')
    expect(result.downloadUrl).toBe('https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/v0.9.0')
  })

  it('swallows a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const result = await checkForUpdates('0.7.1')
    expect(result).toEqual({ hasUpdate: false })
  })

  it('swallows a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await checkForUpdates('0.7.1')
    expect(result).toEqual({ hasUpdate: false, error: true })
  })

  it('swallows a timeout', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    const result = await checkForUpdates('0.7.1')
    expect(result).toEqual({ hasUpdate: false, error: true })
  })

  it('returns no update when tag_name is missing or malformed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html_url: 'https://github.com/ChupsAlliance/multiAIAgentsClaude/releases/tag/latest',
        assets: [],
      }),
    })

    const result = await checkForUpdates('0.7.1')
    expect(result).toEqual({ hasUpdate: false })
  })
})
