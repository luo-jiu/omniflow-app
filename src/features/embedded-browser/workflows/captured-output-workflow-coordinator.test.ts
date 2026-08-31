import { describe, expect, it, vi } from 'vitest';

import type { EmbeddedBrowserDownloadEvent } from '../downloads/types';
import {
  CapturedOutputWorkflowCoordinator,
  type CapturedOutputWorkflowStorage,
} from './captured-output-workflow-coordinator';

function createStorage(initial?: string): CapturedOutputWorkflowStorage & { value: string | null } {
  let value = initial ?? null;
  return {
    get value() {
      return value;
    },
    getItem: () => value,
    removeItem: () => {
      value = null;
    },
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
  };
}

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
  it('replays main-owned handoff outputs and acknowledges successful delivery', async () => {
    const acknowledgeDownload = vi.fn(async () => true);
    const listPendingDownloads = vi.fn(async () => [completedDownload('replayed')]);
    const coordinator = new CapturedOutputWorkflowCoordinator({
      acknowledgeDownload,
      listPendingDownloads,
      subscribeDownloads: () => vi.fn(),
    });
    coordinator.subscribe(vi.fn());

    await Promise.resolve();
    await Promise.resolve();
    expect(listPendingDownloads).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot().map((item) => item.download.downloadId)).toEqual(['replayed']);

    await expect(coordinator.runDelivery('replayed', 'saving', async () => true)).resolves.toBe(true);
    expect(acknowledgeDownload).toHaveBeenCalledWith('replayed');
    expect(coordinator.getSnapshot()).toEqual([]);
  });

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

  it('links upload completion to the queued output after the view unmounts', async () => {
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
    emit?.(completedDownload('linked'));

    let resolveBatch: ((result: ReadonlyArray<{ taskStatus: string }>) => void) | undefined;
    const batch = {
      done: new Promise<ReadonlyArray<{ taskStatus: string }>>((resolve) => {
        resolveBatch = resolve;
      }),
    };
    const linked = coordinator.linkUploadTask('linked', batch);
    expect(coordinator.getSnapshot()[0]?.status).toBe('importing');

    removeListener();
    resolveBatch?.([{ taskStatus: 'success' }]);
    await expect(linked).resolves.toBe(true);
    expect(cleanupDownload).toHaveBeenCalledWith('/tmp/linked.mp4');
    expect(coordinator.getSnapshot()).toEqual([]);
  });

  it('keeps the output pending when a linked upload batch has no successful task', async () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const cleanupDownload = vi.fn(async () => true);
    const coordinator = new CapturedOutputWorkflowCoordinator({
      cleanupDownload,
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    coordinator.subscribe(vi.fn());
    emit?.(completedDownload('failed-upload'));

    const linked = coordinator.linkUploadTask('failed-upload', {
      done: Promise.resolve([{ taskStatus: 'failed' }]),
    });
    await expect(linked).resolves.toBe(false);
    expect(coordinator.getSnapshot()[0]?.status).toBe('pending');
    expect(cleanupDownload).not.toHaveBeenCalled();
  });

  it('persists completed outputs and rehydrates them as pending after restart', () => {
    const storage = createStorage();
    let now = 10_000;
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const first = new CapturedOutputWorkflowCoordinator({
      now: () => now,
      storage,
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    first.subscribe(vi.fn());
    emit?.(completedDownload('persisted'));
    expect(storage.value).toContain('persisted');

    const restarted = new CapturedOutputWorkflowCoordinator({
      now: () => now + 1,
      storage,
      subscribeDownloads: () => vi.fn(),
    });
    expect(restarted.getSnapshot()).toEqual([{
      download: completedDownload('persisted'),
      status: 'pending',
    }]);

    now += 100_000;
    const expired = new CapturedOutputWorkflowCoordinator({
      now: () => now,
      persistedOutputMaxAgeMs: 1_000,
      storage,
      subscribeDownloads: () => vi.fn(),
    });
    expect(expired.getSnapshot()).toEqual([]);
    expect(storage.value).toBeNull();
  });

  it('reconciles stale renderer entries after main handoff acknowledgement', async () => {
    const storage = createStorage(JSON.stringify({
      items: [{
        download: completedDownload('stale'),
        queuedAt: 10_000,
        status: 'pending',
      }],
      version: 1,
    }));
    const cleanupDownload = vi.fn(async () => true);
    const coordinator = new CapturedOutputWorkflowCoordinator({
      cleanupDownload,
      listPendingDownloads: async () => [],
      now: () => 10_001,
      storage,
      subscribeDownloads: () => vi.fn(),
    });

    coordinator.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.getSnapshot()).toEqual([]);
    expect(storage.value).toBeNull();
    expect(cleanupDownload).toHaveBeenCalledWith('/tmp/stale.mp4');
  });

  it('rejects a second delivery while the first delivery is in flight', async () => {
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const coordinator = new CapturedOutputWorkflowCoordinator({
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    coordinator.subscribe(vi.fn());
    emit?.(completedDownload('single-flight'));

    let resolveDelivery: (() => void) | undefined;
    const delivery = new Promise<boolean>((resolve) => {
      resolveDelivery = () => resolve(true);
    });
    const first = coordinator.runDelivery('single-flight', 'saving', () => delivery);
    await expect(coordinator.runDelivery('single-flight', 'importing', async () => true)).resolves.toBe(false);
    resolveDelivery?.();
    await expect(first).resolves.toBe(true);
  });

  it('clears the journal at auth-session end and ignores late old-session completions', async () => {
    const storage = createStorage();
    const cleanupDownload = vi.fn(async () => true);
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const coordinator = new CapturedOutputWorkflowCoordinator({
      cleanupDownload,
      storage,
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    coordinator.subscribe(vi.fn());
    emit?.(completedDownload('old-session'));
    await coordinator.clearForAuthSession();
    emit?.(completedDownload('late-old-session'));
    expect(coordinator.getSnapshot()).toEqual([]);
    expect(storage.value).toBeNull();
    expect(cleanupDownload).toHaveBeenCalledWith('/tmp/old-session.mp4');

    coordinator.subscribe(vi.fn());
    emit?.(completedDownload('new-session'));
    expect(coordinator.getSnapshot().map(item => item.download.downloadId)).toEqual(['new-session']);
  });

  it('cleans an active delivery when auth clears before its terminal result', async () => {
    const acknowledgeDownload = vi.fn(async () => true);
    const cleanupDownload = vi.fn(async () => true);
    let emit: ((payload: EmbeddedBrowserDownloadEvent) => void) | undefined;
    const coordinator = new CapturedOutputWorkflowCoordinator({
      acknowledgeDownload,
      cleanupDownload,
      subscribeDownloads: (listener) => {
        emit = listener;
        return vi.fn();
      },
    });
    coordinator.subscribe(vi.fn());
    emit?.(completedDownload('active-auth-clear'));

    let resolveDelivery: ((completed: boolean) => void) | undefined;
    const delivery = new Promise<boolean>((resolve) => {
      resolveDelivery = resolve;
    });
    const running = coordinator.runDelivery('active-auth-clear', 'importing', () => delivery);

    await coordinator.clearForAuthSession();
    resolveDelivery?.(false);

    await expect(running).resolves.toBe(false);
    expect(cleanupDownload).toHaveBeenCalledWith('/tmp/active-auth-clear.mp4');
    expect(acknowledgeDownload).toHaveBeenCalledWith('active-auth-clear');
    expect(coordinator.getSnapshot()).toEqual([]);
  });
});
