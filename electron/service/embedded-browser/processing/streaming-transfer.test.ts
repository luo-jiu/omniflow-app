import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { StreamingTransfer, streamResponseToFile } from './streaming-transfer'

const temporaryDirectories: string[] = []

async function createTargetPath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-streaming-transfer-test-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'output.bin')
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )))
})

describe('StreamingTransfer', () => {
  it('streams a response without materializing the complete body', async () => {
    const outputPath = await createTargetPath()
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first-'))
        controller.enqueue(new TextEncoder().encode('second'))
        controller.close()
      },
    }), { status: 200 })

    const result = await streamResponseToFile(response, outputPath)

    expect(result.bytesReceived).toBe(12)
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('first-second')
  })

  it('rejects oversized streamed content and keeps an existing destination', async () => {
    const outputPath = await createTargetPath()
    await writeFile(outputPath, 'old-content')
    const response = new Response('too-large')

    await expect(streamResponseToFile(response, outputPath, { maxBytes: 4 })).rejects.toThrow(
      '文件超过允许的 4B 大小上限',
    )
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('old-content')
    await expect(readdir(path.dirname(outputPath))).resolves.toEqual(['output.bin'])
  })

  it('cancels an active stream and removes the staged partial file', async () => {
    const outputPath = await createTargetPath()
    const controller = new AbortController()
    const response = new Response(new ReadableStream({
      pull() {
        return new Promise<void>(() => undefined)
      },
    }), { status: 200 })
    const transfer = new StreamingTransfer()
    const pending = transfer.writeResponse(response, outputPath, { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toBeDefined()
    await expect(access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(path.join(path.dirname(outputPath), '.omniflow-stream-missing'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
