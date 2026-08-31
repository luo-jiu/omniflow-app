import { describe, expect, it, vi } from 'vitest'
import { ProcessingTaskRegistry } from './task-registry'

describe('ProcessingTaskRegistry', () => {
  it('task.registry-recovery-cancel', async () => {
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

  it('task.registry-dispose-idempotent', async () => {
    const registry = new ProcessingTaskRegistry()
    const settled = Promise.resolve()
    registry.register({ cancel: vi.fn(), kind: 'ffmpeg', settled })
    await registry.dispose()
    await registry.dispose()
    expect(() => registry.register({ cancel: vi.fn(), kind: 'ffmpeg', settled }))
      .toThrow('processing task registry 已释放')
  })

  it('task.renderer-unmount-recovery', async () => {
    const registry = new ProcessingTaskRegistry()
    const cancel = vi.fn()
    let settleTask: (() => void) | undefined
    const settled = new Promise<void>((resolve) => {
      settleTask = resolve
    })
    const registration = registry.register({
      cancel,
      kind: 'hls-task',
      settled,
      tabId: 'tab-unmounted',
    })

    const cancellation = registry.cancel({ tabId: 'tab-unmounted' })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledOnce()
    settleTask?.()
    await cancellation
    expect(registry.size).toBe(1)
    registration.release()
    expect(registry.size).toBe(0)
  })

  it('runs an abortable operation through the same registration lifecycle', async () => {
    const registry = new ProcessingTaskRegistry()
    let observedSignal: AbortSignal | undefined
    const operation = registry.run({
      kind: 'streaming-transfer',
      tabId: 'tab-streaming',
    }, async (signal, taskId) => {
      observedSignal = signal
      expect(taskId).toBe(registry.getSnapshot()[0]?.id)
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    })

    expect(registry.getSnapshot()).toMatchObject([{
      kind: 'streaming-transfer',
      tabId: 'tab-streaming',
    }])
    await expect(registry.cancel({ tabId: 'tab-streaming' })).resolves.toBe(1)
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(observedSignal?.aborted).toBe(true)
    expect(registry.size).toBe(0)
  })
})
