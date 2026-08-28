import { describe, expect, it } from 'vitest'

import {
  EmbeddedBrowserHlsLiveRecorder,
} from '../../embeddedBrowserHlsLiveRecorder'
import {
  downloadEmbeddedBrowserHlsToLocalWorkDirectory,
} from '../../embeddedBrowserHlsLocalDownloaderService'
import { HlsLiveTask } from './hls-live-task'
import {
  defaultHlsTaskExecutor,
  downloadHlsToLocalWorkDirectory,
  HlsTaskExecutor,
} from './hls-task'

describe('HLS processing owner boundary', () => {
  it('hls.processing-owner-boundary', () => {
    expect(defaultHlsTaskExecutor).toBeInstanceOf(HlsTaskExecutor)
    expect(downloadEmbeddedBrowserHlsToLocalWorkDirectory).toBe(downloadHlsToLocalWorkDirectory)
    expect(EmbeddedBrowserHlsLiveRecorder).toBe(HlsLiveTask)
  })
})
