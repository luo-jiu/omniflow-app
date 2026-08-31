import { describe, expect, it } from 'vitest'

import {
  createOutputDeliveryTerminal,
  createProcessingTaskTerminal,
} from './processing-task'

describe('processing output terminal contract', () => {
  it('output.staged-terminal', () => {
    const terminal = createProcessingTaskTerminal({
      stagedOutput: {
        fileName: 'episode.mp4',
        leaseId: 'output-lease-1',
        mimeType: 'video/mp4',
        sizeBytes: 128,
      },
      status: 'success',
      taskId: 'processing-task-1',
    })

    expect(terminal).toEqual({
      kind: 'processing',
      stagedOutput: {
        fileName: 'episode.mp4',
        leaseId: 'output-lease-1',
        mimeType: 'video/mp4',
        sizeBytes: 128,
      },
      status: 'success',
      taskId: 'processing-task-1',
    })
    expect('path' in terminal).toBe(false)
  })

  it('output.delivery-not-processing-success', () => {
    const processing = createProcessingTaskTerminal({
      stagedOutput: {
        fileName: 'episode.mp4',
        leaseId: 'output-lease-1',
      },
      status: 'success',
      taskId: 'processing-task-1',
    })
    const delivery = createOutputDeliveryTerminal({
      error: 'UploadManager commit failed',
      processing,
      status: 'error',
    })

    expect(processing.status).toBe('success')
    expect(delivery).toEqual({
      error: 'UploadManager commit failed',
      kind: 'delivery',
      leaseId: 'output-lease-1',
      status: 'error',
      taskId: 'processing-task-1',
    })
  })
})
