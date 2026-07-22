import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isTransientApiError, retryTransientSpawn } from './mission.cjs'

describe('isTransientApiError', () => {
  it('matches a 429 rate-limit message', () => {
    expect(isTransientApiError('API Error: Request rejected (429) · rate limit exceeded')).toBe(true)
  })

  it('matches a bare "rate limit" phrase', () => {
    expect(isTransientApiError('This request would exceed your account\'s rate limit.')).toBe(true)
  })

  it('matches "overloaded"', () => {
    expect(isTransientApiError('The server is currently overloaded, please retry.')).toBe(true)
  })

  it('matches a 5xx status code', () => {
    expect(isTransientApiError('Upstream error: 503 Service Unavailable')).toBe(true)
  })

  it('matches ECONNRESET', () => {
    expect(isTransientApiError('Error: connect ECONNRESET')).toBe(true)
  })

  it('matches ETIMEDOUT', () => {
    expect(isTransientApiError('Error: ETIMEDOUT while calling api.anthropic.com')).toBe(true)
  })

  it('matches "network error"', () => {
    expect(isTransientApiError('Fetch failed: network error')).toBe(true)
  })

  it('does not match an unrelated parse error', () => {
    expect(isTransientApiError('SyntaxError: Unexpected token in JSON at position 4')).toBe(false)
  })

  it('does not match a permission/auth error', () => {
    expect(isTransientApiError('Error: invalid API key provided')).toBe(false)
  })

  it('returns false for empty/undefined text', () => {
    expect(isTransientApiError('')).toBe(false)
    expect(isTransientApiError(undefined)).toBe(false)
  })
})

describe('retryTransientSpawn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when the first attempt succeeds', async () => {
    const runFn = vi.fn().mockResolvedValue('ok')
    const onRetry = vi.fn()

    const result = await retryTransientSpawn(runFn, onRetry, 3)

    expect(result).toBe('ok')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(runFn).toHaveBeenCalledWith(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('retries a transient error and resolves on the second attempt', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('API Error: Request rejected (429)'))
      .mockResolvedValueOnce('ok on retry')
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 3, [30000, 60000, 120000])
    await vi.advanceTimersByTimeAsync(30000)
    const result = await promise

    expect(result).toBe('ok on retry')
    expect(runFn).toHaveBeenCalledTimes(2)
    expect(runFn).toHaveBeenNthCalledWith(2, 2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, 3, expect.any(Error), 30000)
  })

  it('uses the correct backoff delay for each retry', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockRejectedValueOnce(new Error('503 overloaded'))
      .mockResolvedValueOnce('ok on third')
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 3, [30000, 60000, 120000])
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(60000)
    const result = await promise

    expect(result).toBe('ok on third')
    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3, expect.any(Error), 30000)
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3, expect.any(Error), 60000)
  })

  it('throws immediately on a non-transient error without retrying', async () => {
    const err = new Error('SyntaxError: Unexpected token')
    const runFn = vi.fn().mockRejectedValue(err)
    const onRetry = vi.fn()

    await expect(retryTransientSpawn(runFn, onRetry, 3)).rejects.toThrow('Unexpected token')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('throws the final error after exhausting all attempts on a transient error', async () => {
    const finalErr = new Error('429 rate limit — final')
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit — 1'))
      .mockRejectedValueOnce(new Error('429 rate limit — 2'))
      .mockRejectedValueOnce(finalErr)
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 3, [30000, 60000, 120000])
    const assertion = expect(promise).rejects.toThrow('429 rate limit — final')
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(60000)
    await assertion

    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('falls back to the last backoffMs entry when maxAttempts exceeds the schedule length', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce('ok on fourth')
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 4, [30000, 60000, 120000])
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(60000)
    await vi.advanceTimersByTimeAsync(120000)
    const result = await promise

    expect(result).toBe('ok on fourth')
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, 4, expect.any(Error), 120000)
  })
})
