import { describe, expect, it, vi } from 'vitest';

import type { EmbeddedBrowserDownloadEvent } from '../types';
import { CapturedOutputWorkflowCoordinator } from '../../workflows/captured-output-workflow-coordinator';
import { DownloadHandoff } from './download-handoff';

function completedDownload(downloadId: string): EmbeddedBrowserDownloadEvent {
  return {
    downloadId,
    fileName: `${downloadId}.mp4`,
    receivedBytes: 4,
    state: 'completed',
    tempPath: `/tmp/${downloadId}.mp4`,
    totalBytes: 4,
    url: `https://example.test/${downloadId}.mp4`,
  };
}

describe('DownloadHandoff', () => {
  it('exposes the application queue and delivers a completed download once', async () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const coordinator = new CapturedOutputWorkflowCoordinator({
      cleanupDownload: vi.fn(async () => true),
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    const handoff = new DownloadHandoff(coordinator);
    const unsubscribe = handoff.subscribe(vi.fn());

    emit?.(completedDownload('handoff'));
    expect(handoff.getSnapshot()).toHaveLength(1);
    await expect(handoff.runDelivery('handoff', 'saving', async () => true)).resolves.toBe(true);
    expect(handoff.getSnapshot()).toEqual([]);
    unsubscribe();
  });

  it('keeps a failed handoff pending for retry', async () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const coordinator = new CapturedOutputWorkflowCoordinator({
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    const handoff = new DownloadHandoff(coordinator);
    handoff.subscribe(vi.fn());
    emit?.(completedDownload('retry'));

    await expect(handoff.runDelivery('retry', 'importing', async () => false)).resolves.toBe(false);
    expect(handoff.getSnapshot()[0]?.status).toBe('pending');
  });
});
