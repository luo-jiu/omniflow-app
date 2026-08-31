import { describe, expect, it, vi } from 'vitest'

import { TransferEngine } from './transfer-engine'

describe('TransferEngine', () => {
  it('transfer.concurrent-retry-abort-order', async () => {
    const attemptsByIndex = new Map<number, number>()
    const fetchImpl = vi.fn(async (input: string, _init?: RequestInit) => {
      void _init
      const index = Number(input.split('/').pop())
      const attempt = (attemptsByIndex.get(index) || 0) + 1
      attemptsByIndex.set(index, attempt)
      if (index === 0) {
        await new Promise(resolve => setTimeout(resolve, 15))
      }
      if (index === 1 && attempt === 1) {
        return new Response('temporary failure', { status: 503 })
      }
      return new Response(Uint8Array.from([index]).buffer)
    })
    const pushed: number[] = []
    const engine = new TransferEngine({
      fetch: fetchImpl,
      fragments: [0, 1, 2].map(index => ({
        byteRange: { length: 2, offset: index * 2 },
        index,
        url: `https://media.example/${index}`,
      })),
      maxRetries: 1,
      thread: 3,
    })
    const completed = new Promise<void>((resolve, reject) => {
      engine.on('sequentialPush', buffer => pushed.push(new Uint8Array(buffer)[0]))
      engine.on('allCompleted', () => resolve())
      engine.on('failed', (_fragments, errors) => reject(new Error(`unexpected failures: ${errors.size}`)))
    })

    engine.start()
    await completed

    expect(pushed).toEqual([0, 1, 2])
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('range')).toBe('bytes=0-1')
    expect(new Headers(fetchImpl.mock.calls.find(([input]) => input.endsWith('/1'))?.[1]?.headers).get('range'))
      .toBe('bytes=2-3')
    engine.destroy()
  })

  it('transfer.range-terminal-race', async () => {
    const fetchImpl = vi.fn(async (input: string) => (
      new Response(Uint8Array.from([Number(input.split('/').pop())]).buffer)
    ))
    const engine = new TransferEngine({
      fetch: fetchImpl,
      fragments: [0, 1, 2, 3].map(index => ({
        index,
        url: `https://media.example/${index}`,
      })),
      thread: 4,
    })
    let allCompleted = 0
    const completed = new Promise<void>((resolve, reject) => {
      engine.on('allCompleted', () => {
        allCompleted += 1
        resolve()
      })
      engine.on('failed', (_fragments, errors) => reject(new Error(`unexpected failures: ${errors.size}`)))
    })

    engine.start()
    await completed
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(allCompleted).toBe(1)
    expect(engine.state).toBe('done')
    expect(engine.running).toBe(0)
    engine.destroy()
  })

  it('transfer.protocol-buffer-sink-backpressure', async () => {
    const thread = 3
    const fragmentCount = 18
    let activeSinks = 0
    let maxActiveSinks = 0
    const written = new Map<number, number>()
    const engine = new TransferEngine({
      bufferSink: async (buffer, fragment) => {
        activeSinks += 1
        maxActiveSinks = Math.max(maxActiveSinks, activeSinks)
        await new Promise(resolve => setTimeout(resolve, 4))
        written.set(Number(fragment.index), new Uint8Array(buffer)[0] || 0)
        activeSinks -= 1
      },
      fetch: async (input) => {
        const index = Number(input.split('/').pop())
        return new Response(Uint8Array.from([index]))
      },
      fragments: Array.from({ length: fragmentCount }, (_item, index) => ({
        url: `https://media.example/${index}`,
      })),
      thread,
    })
    const completed = new Promise<void>((resolve, reject) => {
      engine.on('allCompleted', () => resolve())
      engine.on('failed', (_fragments, errors) => reject(new Error(`unexpected failures: ${errors.size}`)))
    })

    engine.start()
    await completed

    expect(maxActiveSinks).toBeLessThanOrEqual(thread)
    expect(written.size).toBe(fragmentCount)
    expect(Array.from(written.entries()).sort(([left], [right]) => left - right).map(([, value]) => value))
      .toEqual(Array.from({ length: fragmentCount }, (_item, index) => index))
    expect(engine.buffer.every(buffer => buffer === null)).toBe(true)
    engine.destroy()
  })

  it('transfer.buffer-sink-failure-no-network-retry', async () => {
    const attempts = new Map<number, number>()
    const sinkErrors: Array<{ index: number; message: string }> = []
    const engine = new TransferEngine({
      bufferSink: async (_buffer, fragment) => {
        if (fragment.index === 0) throw new Error('disk full')
      },
      fetch: async (input) => {
        const index = Number(input.split('/').pop())
        attempts.set(index, (attempts.get(index) || 0) + 1)
        return new Response(Uint8Array.from([index]))
      },
      fragments: [0, 1].map(index => ({ url: `https://media.example/${index}` })),
      maxRetries: 4,
      thread: 2,
    })
    const failed = new Promise<Set<{ index?: number; url: string }>>((resolve, reject) => {
      engine.on('bufferSinkError', (fragment, error) => {
        sinkErrors.push({ index: Number(fragment.index), message: error.message })
      })
      engine.on('allCompleted', () => reject(new Error('expected sink failure')))
      engine.on('failed', (_fragments, errors) => resolve(errors))
    })

    engine.start()
    const errors = await failed

    expect(attempts).toEqual(new Map([[0, 1], [1, 1]]))
    expect(sinkErrors).toEqual([{ index: 0, message: 'disk full' }])
    expect(Array.from(errors).map(fragment => fragment.index)).toEqual([0])
    expect(engine.success).toBe(1)
    engine.destroy()

    const noRetryFetch = vi.fn(async () => new Response('failed', { status: 503 }))
    const noRetryEngine = new TransferEngine({
      fetch: noRetryFetch,
      fragments: [{ url: 'https://media.example/no-retry' }],
      maxRetries: 0,
      thread: 1,
    })
    const networkFailed = new Promise<void>((resolve, reject) => {
      noRetryEngine.on('allCompleted', () => reject(new Error('expected network failure')))
      noRetryEngine.on('failed', () => resolve())
    })
    noRetryEngine.start()
    await networkFailed
    expect(noRetryFetch).toHaveBeenCalledTimes(1)
    noRetryEngine.destroy()
  })
})
