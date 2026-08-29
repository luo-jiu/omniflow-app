import { describe, expect, it, vi } from 'vitest'
import { ProcessingTaskRegistry } from './task-registry'

describe('ProcessingTaskRegistry', () => {
  it('cancels matching tasks and waits for their settled promises', async () => {
    const registry = new ProcessingTaskRegistry()
    const cancel = vi.fn()
    let settleTask: (() => void) | undefined
    const settled = new Promise<void>((resolve) => {
      settleTask = resolve
    })
    const registration = registry.register({
      cancel,
      kind: 'ffmpeg',
      requestId: 'request-1',
      settled,
      tabId: 'tab-1',
    })

    expect(registry.getSnapshot()).toEqual([{
      id: registration.id,
      kind: 'ffmpeg',
      requestId: 'request-1',
      tabId: 'tab-1',
    }])
    let cancelSettled = false
    const cancellation = registry.cancel({ tabId: 'tab-1' }).then(() => {
      cancelSettled = true
    })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancelSettled).toBe(false)
    settleTask?.()
    await cancellation
    expect(cancelSettled).toBe(true)
    registration.release()
    expect(registry.size).toBe(0)
  })

  it('rejects new tasks after dispose and remains idempotent', async () => {
    const registry = new ProcessingTaskRegistry()
    const settled = Promise.resolve()
    registry.register({ cancel: vi.fn(), kind: 'ffmpeg', settled })
    await registry.dispose()
    await registry.dispose()
    expect(() => registry.register({ cancel: vi.fn(), kind: 'ffmpeg', settled }))
      .toThrow('processing task registry 已释放')
  })
})
