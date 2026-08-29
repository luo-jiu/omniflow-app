import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  NativeDownloadSession,
  type NativeDownloadItem,
  type NativeDownloadSessionPayload,
} from './native-download-session'

class FakeDownloadItem extends EventEmitter implements NativeDownloadItem {
  cancel = vi.fn(() => {
    this.emit('done', {}, 'cancelled')
  })

  getFilename = vi.fn(() => 'video.mp4')

  getMimeType = vi.fn(() => 'video/mp4')

  getReceivedBytes = vi.fn(() => 12)

  getTotalBytes = vi.fn(() => 12)

  getURL = vi.fn(() => 'https://media.example/video.mp4')

  setSavePath = vi.fn()
}

function createSession(item = new FakeDownloadItem()) {
  const events: NativeDownloadSessionPayload[] = []
  const cleanup = vi.fn(async () => undefined)
  const onSettled = vi.fn()
  const session = new NativeDownloadSession({
    cleanup,
    downloadId: 'download-1',
    emit: (payload) => events.push(payload),
    fileName: 'video.mp4',
    item,
    onSettled,
    pageUrl: 'https://media.example/page',
    tabId: 'tab-1',
    tempPath: '/tmp/embedded-browser-downloads/video.mp4',
    url: 'https://media.example/video.mp4',
  })
  return { cleanup, events, item, onSettled, session }
}

describe('NativeDownloadSession', () => {
  it('owns save path, progress, and one completed terminal event', async () => {
    const harness = createSession()
    harness.session.start()
    harness.item.emit('updated', {}, 'progressing')
    harness.item.emit('done', {}, 'completed')
    await harness.session.settled

    expect(harness.item.setSavePath).toHaveBeenCalledWith('/tmp/embedded-browser-downloads/video.mp4')
    expect(harness.events.map(event => event.state)).toEqual(['started', 'progress', 'completed'])
    expect(harness.cleanup).not.toHaveBeenCalled()
    expect(harness.onSettled).toHaveBeenCalledTimes(1)
  })

  it('cancels the item, cleans staging, and emits a single cancelled terminal event', async () => {
    const harness = createSession()
    harness.session.start()
    harness.session.cancel()
    await harness.session.settled

    expect(harness.item.cancel).toHaveBeenCalledTimes(1)
    expect(harness.cleanup).toHaveBeenCalledWith('/tmp/embedded-browser-downloads/video.mp4')
    expect(harness.events.map(event => event.state)).toEqual(['started', 'cancelled'])
    expect(harness.events.at(-1)?.error).toBe('下载已取消')
    expect(harness.onSettled).toHaveBeenCalledTimes(1)
  })

  it('converts a save-path failure into a failed terminal event and releases the session', async () => {
    const harness = createSession()
    harness.item.setSavePath.mockImplementationOnce(() => {
      throw new Error('cannot stage download')
    })
    harness.session.start()
    await harness.session.settled

    expect(harness.cleanup).toHaveBeenCalledWith('/tmp/embedded-browser-downloads/video.mp4')
    expect(harness.events.map(event => event.state)).toEqual(['failed'])
    expect(harness.events.at(-1)?.error).toBe('cannot stage download')
    expect(harness.onSettled).toHaveBeenCalledTimes(1)
  })
})
