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
    expect(coordinator.getSnapshot().map((item) => item.download.downloadId)).toEqual(['first', 'second']);
    expect(remountedListener).toHaveBeenCalled();
    expect(coordinator.dismiss('first')).toBe(true);
    expect(coordinator.getSnapshot().map((item) => item.download.downloadId)).toEqual(['second']);
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

  it('keeps an upload delivery visible across remounts until the batch settles', async () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    let resolveDelivery: ((completed: boolean) => void) | undefined;
    const coordinator = new CapturedOutputWorkflowCoordinator({
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    const removeListener = coordinator.subscribe(vi.fn());
    const delivery = new Promise<boolean>((resolve) => {
      resolveDelivery = resolve;
    });
    emit?.(completedDownload('upload'));

    const running = coordinator.runDelivery('upload', 'importing', () => delivery);
    expect(coordinator.getSnapshot()[0]?.status).toBe('importing');
    const remounted = vi.fn();
    const removeRemounted = coordinator.subscribe(remounted);
    expect(coordinator.getSnapshot()[0]?.status).toBe('importing');

    resolveDelivery?.(true);
    await expect(running).resolves.toBe(true);
    expect(coordinator.getSnapshot()).toEqual([]);
    expect(remounted).toHaveBeenCalled();
    removeRemounted();
    removeListener();
  });

  it('returns a cancelled or failed delivery to pending without deleting its file', async () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const cleanupDownload = vi.fn(async () => true);
    const coordinator = new CapturedOutputWorkflowCoordinator({
      cleanupDownload,
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    const removeListener = coordinator.subscribe(vi.fn());
    emit?.(completedDownload('retry'));

    await expect(coordinator.runDelivery('retry', 'saving', async () => false)).resolves.toBe(false);
    expect(coordinator.getSnapshot()[0]?.status).toBe('pending');
    expect(cleanupDownload).not.toHaveBeenCalled();

    await expect(coordinator.runDelivery('retry', 'importing', async () => {
      throw new Error('upload failed');
    })).rejects.toThrow('upload failed');
    expect(coordinator.getSnapshot()[0]?.status).toBe('pending');
    expect(cleanupDownload).not.toHaveBeenCalled();
    removeListener();
  });
});
