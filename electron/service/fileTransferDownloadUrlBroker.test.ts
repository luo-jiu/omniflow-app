import http from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { FileTransferDownloadUrlBroker } from './fileTransferDownloadUrlBroker'

const brokers: FileTransferDownloadUrlBroker[] = []
const sourceServers: http.Server[] = []

async function createSourceServer(body: string): Promise<string> {
  const server = http.createServer((request, response) => {
    if (request.url !== '/source') {
      response.writeHead(404).end()
      return
    }
    const rangeMatch = String(request.headers.range || '').match(/^bytes=(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Math.min(Number(rangeMatch[2]), Buffer.byteLength(body) - 1)
      const partial = Buffer.from(body).subarray(start, end + 1)
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Length': partial.byteLength,
        'Content-Range': `bytes ${start}-${end}/${Buffer.byteLength(body)}`,
        'Content-Type': 'text/plain; charset=utf-8',
      })
      response.end(partial)
      return
    }
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'text/plain; charset=utf-8',
      ETag: 'fixture-etag',
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

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()))
  await Promise.all(sourceServers.splice(0).map(closeServer))
})

describe('FileTransferDownloadUrlBroker', () => {
  it('waits for a signed source URL and streams it through a loopback claim', async () => {
    const sourceUrl = await createSourceServer('download-url-fixture')
    const broker = new FileTransferDownloadUrlBroker({
      runtimeTokenFactory: () => 'runtime-token',
      sourceWaitMs: 1_000,
    })
    brokers.push(broker)
    await broker.start()
    const environment = broker.getEnvironment()
    const claimId = '12345678-1234-1234-1234-123456789abc'
    const downloadUrl = `${environment.origin}/file-transfer-download/${environment.runtimeToken}/${claimId}/sample.txt`

    const responsePromise = fetch(downloadUrl)
    await new Promise(resolve => setTimeout(resolve, 10))
    broker.resolveClaim({
      claimId,
      fileName: '测试 sample.txt',
      mimeType: 'text/plain',
      sourceUrl,
    })
    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''")
    expect(response.headers.get('etag')).toBe('fixture-etag')
    expect(await response.text()).toBe('download-url-fixture')
  })

  it('keeps the runtime token private and reports rejected claims', async () => {
    const broker = new FileTransferDownloadUrlBroker({
      runtimeTokenFactory: () => 'runtime-token',
      sourceWaitMs: 1_000,
    })
    brokers.push(broker)
    await broker.start()
    const environment = broker.getEnvironment()
    const claimId = '12345678-1234-1234-1234-123456789abc'

    const invalidResponse = await fetch(
      `${environment.origin}/file-transfer-download/wrong-token/${claimId}/sample.txt`,
    )
    expect(invalidResponse.status).toBe(404)

    const rejectedUrl = `${environment.origin}/file-transfer-download/${environment.runtimeToken}/${claimId}/sample.txt`
    const responsePromise = fetch(rejectedUrl)
    broker.rejectClaim({ claimId, error: 'signed link failed', fileName: 'sample.txt' })
    const rejectedResponse = await responsePromise
    expect(rejectedResponse.status).toBe(502)
    expect(await rejectedResponse.text()).toContain('signed link failed')
  })

  it('forwards range requests used by desktop download clients', async () => {
    const sourceUrl = await createSourceServer('0123456789')
    const broker = new FileTransferDownloadUrlBroker({ runtimeTokenFactory: () => 'runtime-token' })
    brokers.push(broker)
    await broker.start()
    const environment = broker.getEnvironment()
    const claimId = '12345678-1234-1234-1234-123456789abc'
    broker.resolveClaim({ claimId, fileName: 'range.txt', sourceUrl })

    const response = await fetch(
      `${environment.origin}/file-transfer-download/${environment.runtimeToken}/${claimId}/range.txt`,
      { headers: { Range: 'bytes=2-5' } },
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await response.text()).toBe('2345')
  })

  it('creates and releases a main-only loopback source without exposing the upstream URL', async () => {
    const sourceUrl = await createSourceServer('agent-inspect-source')
    const broker = new FileTransferDownloadUrlBroker({ runtimeTokenFactory: () => 'runtime-token' })
    brokers.push(broker)
    await broker.start()

    const source = broker.createResolvedLoopbackSource({ fileName: 'movie.mp4', sourceUrl })
    expect(source.url).not.toContain(sourceUrl)
    expect(await (await fetch(source.url)).text()).toBe('agent-inspect-source')
    expect(broker.releaseClaim(source.claimId)).toBe(true)
    expect(broker.releaseClaim(source.claimId)).toBe(false)
  })

  it('keeps a long-running main-only source alive for its explicit bounded TTL', async () => {
    let now = 1_000
    const sourceUrl = await createSourceServer('long-running-agent-source')
    const broker = new FileTransferDownloadUrlBroker({
      claimTtlMs: 100,
      now: () => now,
      runtimeTokenFactory: () => 'runtime-token',
    })
    brokers.push(broker)
    await broker.start()

    const source = broker.createResolvedLoopbackSource(
      { fileName: 'movie.mp4', sourceUrl },
      { ttlMs: 6 * 60 * 60 * 1_000 },
    )
    now += 101
    expect(broker.sweepExpired()).toBe(0)
    expect(await (await fetch(source.url)).text()).toBe('long-running-agent-source')

    now += 6 * 60 * 60 * 1_000
    expect(broker.sweepExpired()).toBe(1)
  })

  it('waits for a renderer claim before exposing its source to an internal consumer', async () => {
    const sourceUrl = await createSourceServer('internal-consumer')
    const broker = new FileTransferDownloadUrlBroker({ sourceWaitMs: 1_000 })
    brokers.push(broker)
    await broker.start()
    const claimId = '12345678-1234-1234-1234-123456789abc'

    broker.registerInternalDropClaim(claimId, 'song.mp3')
    const resolvedPromise = broker.waitForResolvedClaim(claimId, 'song.mp3')
    await new Promise(resolve => setTimeout(resolve, 10))
    broker.resolveClaim({
      claimId,
      fileName: 'song.mp3',
      mimeType: 'audio/mpeg',
      sourceUrl,
    })

    await expect(resolvedPromise).resolves.toEqual({
      claimId,
      fileName: 'song.mp3',
      mimeType: 'audio/mpeg',
      sourceUrl,
    })
  })

  it('cancels an internal claim wait and prevents replaying the consumed claim', async () => {
    const sourceUrl = await createSourceServer('still-available')
    const broker = new FileTransferDownloadUrlBroker({ sourceWaitMs: 1_000 })
    brokers.push(broker)
    await broker.start()
    const claimId = '12345678-1234-1234-1234-123456789abc'
    const controller = new AbortController()

    broker.registerInternalDropClaim(claimId, 'song.mp3')
    const cancelled = broker.waitForResolvedClaim(claimId, 'song.mp3', controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })

    broker.resolveClaim({ claimId, fileName: 'song.mp3', sourceUrl })
    await expect(broker.waitForResolvedClaim(claimId, 'song.mp3')).rejects.toThrow('已被使用')
  })

  it('rejects unregistered internal claims', async () => {
    const broker = new FileTransferDownloadUrlBroker({ sourceWaitMs: 1_000 })
    brokers.push(broker)
    await broker.start()

    await expect(broker.waitForResolvedClaim(
      '12345678-1234-1234-1234-123456789abc',
      'song.mp3',
    )).rejects.toThrow('未授权')
  })
})
