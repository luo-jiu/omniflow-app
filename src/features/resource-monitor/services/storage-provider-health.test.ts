import { describe, expect, it, vi } from 'vitest';
import type { ResourceMonitorSnapshot } from './resource-monitor.api';
import {
  ensureStorageProviderAvailable,
  findStorageProviderProbe,
  getStorageProviderProbeStatus,
  isStorageProviderProbeFresh,
  selectPreferredStorageProvider,
} from './storage-provider-health';

const NOW = Date.parse('2026-08-26T04:00:00.000Z');

function snapshot(status: 'ok' | 'error' | 'unknown', checkedAt: string): ResourceMonitorSnapshot {
  return {
    generatedAt: checkedAt,
    summary: {
      providerCount: 0,
      bucketCount: 0,
      objectCount: 0,
      fileRefCount: 0,
      physicalBytes: 0,
      visibleObjectCount: 0,
      visibleFileRefCount: 0,
      visibleBytes: 0,
      recycleObjectCount: 0,
      recycleFileRefCount: 0,
      recycleBytes: 0,
      orphanObjectCount: 0,
      orphanBytes: 0,
      unmatchedCount: 0,
      legacyProviderCount: 0,
    },
    storage: [],
    probeSummary: { total: 1, ok: status === 'ok' ? 1 : 0, error: status === 'error' ? 1 : 0, unknown: status === 'unknown' ? 1 : 0 },
    probes: [{
      key: 'object-storage:win-minio',
      kind: 'object_storage',
      label: 'Windows MinIO',
      provider: 'win-minio',
      status,
      latencyMs: 3,
      checkedAt,
    }],
  };
}

describe('storage provider health', () => {
  it('matches provider aliases case-insensitively', () => {
    const current = snapshot('ok', '2026-08-26T04:00:00.000Z');

    expect(findStorageProviderProbe(current, ' WIN-MINIO ')?.provider).toBe('win-minio');
    expect(getStorageProviderProbeStatus(current, 'WIN-MINIO')).toBe('ok');
  });

  it('recognizes only recent probe results as fresh', () => {
    const recent = findStorageProviderProbe(snapshot('ok', '2026-08-26T03:59:30.000Z'), 'win-minio');
    const stale = findStorageProviderProbe(snapshot('ok', '2026-08-26T03:58:00.000Z'), 'win-minio');

    expect(isStorageProviderProbeFresh(recent, NOW, 60_000)).toBe(true);
    expect(isStorageProviderProbeFresh(stale, NOW, 60_000)).toBe(false);
  });

  it('prefers a healthy provider over an unavailable default provider', () => {
    const current = snapshot('error', '2026-08-26T04:00:00.000Z');
    current.probes.push({
      key: 'object-storage:local-minio',
      kind: 'object_storage',
      label: 'Local MinIO',
      provider: 'local-minio',
      status: 'ok',
      latencyMs: 2,
      checkedAt: '2026-08-26T04:00:00.000Z',
    });

    expect(selectPreferredStorageProvider(
      [{ alias: 'win-minio' }, { alias: 'local-minio' }],
      'win-minio',
      current,
    )).toBe('local-minio');
  });

  it('prefers the default provider when it is one of several healthy providers', () => {
    const current = snapshot('ok', '2026-08-26T04:00:00.000Z');
    current.probes.push({
      key: 'object-storage:local-minio',
      kind: 'object_storage',
      label: 'Local MinIO',
      provider: 'local-minio',
      status: 'ok',
      latencyMs: 2,
      checkedAt: '2026-08-26T04:00:00.000Z',
    });

    expect(selectPreferredStorageProvider(
      [{ alias: 'local-minio' }, { alias: 'win-minio' }],
      'win-minio',
      current,
    )).toBe('win-minio');
  });

  it('falls back to the default provider when no provider is healthy', () => {
    const current = snapshot('error', '2026-08-26T04:00:00.000Z');

    expect(selectPreferredStorageProvider(
      [{ alias: 'local-minio' }, { alias: 'win-minio' }],
      'win-minio',
      current,
    )).toBe('win-minio');
  });

  it('reuses a fresh successful probe without refreshing', async () => {
    const state = { snapshot: snapshot('ok', '2026-08-26T03:59:30.000Z') };
    const runtime = {
      getState: () => state,
      refresh: vi.fn(async () => undefined),
      start: vi.fn(),
    };

    await expect(ensureStorageProviderAvailable('win-minio', {
      now: () => NOW,
      runtime: runtime as any,
    })).resolves.toMatchObject({ available: true, status: 'ok' });
    expect(runtime.refresh).not.toHaveBeenCalled();
  });

  it('refreshes a stale probe once and blocks an unavailable provider', async () => {
    const state = { snapshot: snapshot('ok', '2026-08-26T03:55:00.000Z') };
    const runtime = {
      getState: () => state,
      refresh: vi.fn(async () => {
        state.snapshot = snapshot('error', '2026-08-26T04:00:00.000Z');
      }),
      start: vi.fn(),
    };

    await expect(ensureStorageProviderAvailable('win-minio', {
      now: () => NOW,
      runtime: runtime as any,
    })).resolves.toMatchObject({ available: false, status: 'error' });
    expect(runtime.refresh).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a required refresh cannot complete', async () => {
    const runtime = {
      getState: () => ({ snapshot: null }),
      refresh: vi.fn(async () => { throw new Error('offline'); }),
      start: vi.fn(),
    };

    await expect(ensureStorageProviderAvailable('win-minio', {
      now: () => NOW,
      runtime: runtime as any,
    })).resolves.toMatchObject({ available: false, status: 'unknown' });
  });

  it('does not reuse a stale successful probe when a shared silent refresh yields no new result', async () => {
    const state = { snapshot: snapshot('ok', '2026-08-26T03:55:00.000Z') };
    const runtime = {
      getState: () => state,
      refresh: vi.fn(async () => undefined),
      start: vi.fn(),
    };

    await expect(ensureStorageProviderAvailable('win-minio', {
      now: () => NOW,
      runtime: runtime as any,
    })).resolves.toMatchObject({ available: false, status: 'unknown' });
  });
});
