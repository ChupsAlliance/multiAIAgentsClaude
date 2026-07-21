import { describe, it, expect, vi } from 'vitest'
import { retryMockupGeneration } from './mission.cjs'

describe('retryMockupGeneration', () => {
  it('resolves immediately when the first attempt succeeds', async () => {
    const runFn = vi.fn().mockResolvedValue('<html>ok</html>')
    const onRetry = vi.fn()

    const result = await retryMockupGeneration(runFn, onRetry, 3)

    expect(result).toBe('<html>ok</html>')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('retries after a failure and resolves on the second attempt', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValueOnce('<html>second try</html>')
    const onRetry = vi.fn()

    const result = await retryMockupGeneration(runFn, onRetry, 3)

    expect(result).toBe('<html>second try</html>')
    expect(runFn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, 3, expect.any(Error))
  })

  it('retries twice and resolves on the third attempt', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockRejectedValueOnce(new Error('timed out again'))
      .mockResolvedValueOnce('<html>third try</html>')
    const onRetry = vi.fn()

    const result = await retryMockupGeneration(runFn, onRetry, 3)

    expect(result).toBe('<html>third try</html>')
    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3, expect.any(Error))
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3, expect.any(Error))
  })

  it('throws the final error after all attempts fail, without calling onRetry after the last attempt', async () => {
    const finalError = new Error('final failure')
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(finalError)
    const onRetry = vi.fn()

    await expect(retryMockupGeneration(runFn, onRetry, 3)).rejects.toThrow('final failure')
    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('defaults to 3 max attempts when not specified', async () => {
    const runFn = vi.fn().mockRejectedValue(new Error('always fails'))
    const onRetry = vi.fn()

    await expect(retryMockupGeneration(runFn, onRetry)).rejects.toThrow('always fails')
    expect(runFn).toHaveBeenCalledTimes(3)
  })
})
