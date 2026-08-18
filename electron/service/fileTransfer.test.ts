import http from 'node:http'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { downloadUrlToFile } from './fileTransfer'

const sourceServers: http.Server[] = []
const tempDirectories: string[] = []

async function createSourceServer(options: {
  body?: string
  contentLength?: number
  waitForAbort?: boolean
}): Promise<string> {
  const server = http.createServer((request, response) => {
    if (options.waitForAbort) {
      request.once('close', () => response.destroy())
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write('pending')
      return
    }
    const body = options.body || ''
    response.writeHead(200, {
      'Content-Length': options.contentLength ?? Buffer.byteLength(body),
      'Content-Type': 'application/octet-stream',
    })
    response.end(body)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  sourceServers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('source server missing port')
  return `http://127.0.0.1:${address.port}/source`
}

async function createTargetPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-file-transfer-test-'))
  tempDirectories.push(directory)
  return path.join(directory, 'result.bin')
}

afterEach(async () => {
  await Promise.all(sourceServers.splice(0).map(server => (
    new Promise<void>(resolve => server.close(() => resolve()))
  )))
  await Promise.all(tempDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )))
})

describe('downloadUrlToFile', () => {
  it('removes a partial file when streamed content exceeds the limit', async () => {
    const sourceUrl = await createSourceServer({ body: 'too-large' })
    const targetPath = await createTargetPath()

    await expect(downloadUrlToFile(sourceUrl, targetPath, {}, 0, 4)).rejects.toThrow(
      '文件超过允许的 4B 大小上限',
    )
    await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a declared oversized response before creating a file', async () => {
    const sourceUrl = await createSourceServer({ body: 'small', contentLength: 100 })
    const targetPath = await createTargetPath()

    await expect(downloadUrlToFile(sourceUrl, targetPath, {}, 0, 4)).rejects.toThrow(
      '文件超过允许的 4B 大小上限',
    )
    await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('aborts an active download and removes the partial file', async () => {
    const sourceUrl = await createSourceServer({ waitForAbort: true })
    const targetPath = await createTargetPath()
    const controller = new AbortController()
    const download = downloadUrlToFile(
      sourceUrl,
      targetPath,
      {},
      0,
      Number.POSITIVE_INFINITY,
      controller.signal,
    )
    setTimeout(() => controller.abort(), 10)

    await expect(download).rejects.toBeInstanceOf(Error)
    await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes an in-limit response unchanged', async () => {
    const sourceUrl = await createSourceServer({ body: 'complete' })
    const targetPath = await createTargetPath()

    await downloadUrlToFile(sourceUrl, targetPath, {}, 0, 16)

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('complete')
  })
})
