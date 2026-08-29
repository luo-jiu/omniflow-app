import { describe, expect, it, vi } from 'vitest';

import type { EmbeddedBrowserDownloadEvent } from '../downloads/types';
import { CapturedOutputWorkflowCoordinator } from './captured-output-workflow-coordinator';

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

describe('CapturedOutputWorkflowCoordinator', () => {
  it('retains completed outputs when the workspace listener unmounts', () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const subscribeDownloads = vi.fn((listener: (payload: EmbeddedBrowserDownloadEvent) => void) => {
      emit = listener;
      return vi.fn();
    });
    const coordinator = new CapturedOutputWorkflowCoordinator({ subscribeDownloads });
    const firstListener = vi.fn();
    const unsubscribe = coordinator.subscribe(firstListener);

    expect(subscribeDownloads).toHaveBeenCalledTimes(1);
    emit?.(completedDownload('first'));
    unsubscribe();
    emit?.(completedDownload('second'));

    const remountedListener = vi.fn();
    const removeRemountedListener = coordinator.subscribe(remountedListener);
    expect(coordinator.getSnapshot().map((item) => item.downloadId)).toEqual(['first', 'second']);
    expect(remountedListener).toHaveBeenCalled();
    expect(coordinator.dismiss('first')).toBe(true);
    expect(coordinator.getSnapshot().map((item) => item.downloadId)).toEqual(['second']);
    removeRemountedListener();
  });

  it('deduplicates completion events and cleans failed outputs without a mounted view', async () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const cleanupDownload = vi.fn(async () => true);
    const coordinator = new CapturedOutputWorkflowCoordinator({
      cleanupDownload,
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    const unsubscribe = coordinator.subscribe(vi.fn());

    const completed = completedDownload('same');
    emit?.(completed);
    emit?.(completed);
    emit?.({ ...completed, state: 'failed', error: 'network', downloadId: 'failed' });
    await Promise.resolve();

    expect(coordinator.getSnapshot()).toHaveLength(1);
    expect(cleanupDownload).toHaveBeenCalledWith(completed.tempPath);
    unsubscribe();
  });
});
