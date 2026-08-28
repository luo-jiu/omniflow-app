import { describe, expect, it, vi } from 'vitest';

import {
  createAgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaOwner,
  type AgentLocalStorageQuotaPersistedRecord,
} from './agent-local-storage-quota-manager';

const OWNER: AgentLocalStorageQuotaOwner = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};

const OTHER_OWNER: AgentLocalStorageQuotaOwner = {
  accountScope: 'user:8',
  backendScope: 'https://example.com/api',
};

function createManager(
  options: Parameters<typeof createAgentLocalStorageQuotaManager>[0] = {},
) {
  return createAgentLocalStorageQuotaManager({
    adapters: {
      artifact: { remove: async () => undefined },
      ...options.adapters,
    },
    ...options,
  });
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('Agent local storage quota manager', () => {
  it('reserves, binds and commits using the measured byte count', async () => {
    const manager = createManager({
      maxTotalBytes: 100,
      createId: () => 'reservation-1',
    });

    const reservationId = await manager.reserve(OWNER, 'artifact', 'run-1', 80, 10_000, 'artifact');
    expect(manager.getUsage()).toMatchObject({
      resourceCount: 1,
      totalBytes: 80,
    });
    await expect(manager.bindResource(reservationId, 'resource-1', OWNER)).resolves.toMatchObject({
      id: reservationId,
      expectedBytes: 80,
      resourceRef: 'resource-1',
      state: 'bound',
    });
    await expect(manager.commit(reservationId, 'resource-1', 35, OWNER)).resolves.toMatchObject({
      actualBytes: 35,
      expectedBytes: 35,
      state: 'committed',
    });
    expect(manager.getUsage()).toMatchObject({
      resourceCount: 1,
      totalBytes: 35,
      byCategory: { artifact: 35 },
      byRun: { 'run-1': 35 },
    });
  });

  it('enforces global, category and Run limits atomically', async () => {
    const manager = createManager({
      maxTotalBytes: 10,
      maxCategoryBytes: { workspace: 10 },
      maxRunBytes: { 'run-1': 6 },
    });
    const attempts = await Promise.allSettled([
      manager.reserve(OWNER, 'workspace', 'run-1', 6, 10_000, 'artifact'),
      manager.reserve(OWNER, 'workspace', 'run-1', 6, 10_000, 'artifact'),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(manager.getUsage().totalBytes).toBe(6);
  });

  it('checks the low-disk safety water mark before growing a reservation', async () => {
    let availableBytes = 500;
    const manager = createManager({
      maxTotalBytes: 1_000,
      minFreeBytes: 100,
      getAvailableDiskBytes: () => availableBytes,
    });

    await expect(manager.reserve(OWNER, 'workspace', 'run-1', 400, 10_000, 'artifact'))
      .resolves.toBeTypeOf('string');
    availableBytes = 100;
    await expect(manager.reserve(OWNER, 'workspace', 'run-2', 1, 10_000, 'artifact'))
      .rejects.toThrow('安全水位');
  });

  it('checks the low-disk safety water mark before a zero-byte reservation', async () => {
    const manager = createManager({
      getAvailableDiskBytes: () => 99,
      minFreeBytes: 100,
    });

    await expect(manager.reserve(OWNER, 'workspace', 'run-1', 0, 10_000, 'artifact'))
      .rejects.toThrow('安全水位');
    expect(manager.getUsage()).toMatchObject({ resourceCount: 0, totalBytes: 0 });
  });

  it('deducts pending reservation headroom from subsequent disk checks', async () => {
    let nextId = 0;
    const manager = createManager({
      createId: () => `disk-headroom-${nextId++}`,
      getAvailableDiskBytes: () => 500,
      maxTotalBytes: 1_000,
      minFreeBytes: 100,
    });

    await expect(manager.reserve(OWNER, 'workspace', 'run-1', 250, 10_000, 'artifact'))
      .resolves.toBe('disk-headroom-0');
    await expect(manager.reserve(OWNER, 'workspace', 'run-2', 151, 10_000, 'artifact'))
      .rejects.toThrow('安全水位');
    expect(manager.getUsage()).toMatchObject({ resourceCount: 1, totalBytes: 250 });
  });

  it('does not deduct already-written bytes twice when reconciling observed usage', async () => {
    let nextId = 0;
    const manager = createManager({
      createId: () => `observed-usage-${nextId++}`,
      getAvailableDiskBytes: () => 120,
      maxTotalBytes: 100,
      minFreeBytes: 100,
    });
    await manager.reserve(OWNER, 'workspace', 'run-1', 0, 10_000, 'artifact');
    await manager.bindResource('observed-usage-0', 'observed-resource', OWNER);

    await expect(manager.adjust('observed-resource', 30, OWNER)).resolves.toMatchObject({
      actualBytes: 30,
      expectedBytes: 30,
    });
    await expect(manager.reserve(OWNER, 'workspace', 'run-2', 0, 10_000, 'artifact'))
      .resolves.toBe('observed-usage-1');
  });

  it('bounds zero-byte resources independently from byte quotas', async () => {
    let nextId = 0;
    const manager = createManager({
      createId: () => `counted-resource-${nextId++}`,
      maxResourceCount: 1,
      maxTotalBytes: 100,
    });

    await expect(manager.reserve(OWNER, 'workspace', 'run-1', 0, 10_000, 'artifact'))
      .resolves.toBe('counted-resource-0');
    await expect(manager.reserve(OWNER, 'workspace', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('资源数量已达到上限');
  });

  it('keeps a deleting resource accounted when its adapter cannot remove it', async () => {
    let shouldFail = true;
    const removed: string[] = [];
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async (resourceRef) => {
            if (shouldFail) throw new Error('simulated failure');
            removed.push(resourceRef);
          },
        },
      },
      now: () => 10_000,
    });
    const reservationId = await manager.reserve(OWNER, 'artifact', 'run-1', 20, 1_000, 'artifact');
    await manager.bindResource(reservationId, 'resource-failure', OWNER);

    await expect(manager.requestRelease('resource-failure', OWNER)).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    expect(manager.getUsage().totalBytes).toBe(20);
    expect(manager.getResource('resource-failure', OWNER)).toMatchObject({ state: 'deleting' });

    shouldFail = false;
    await expect(manager.sweep('retry-after-failure')).resolves.toMatchObject({
      attempted: 1,
      failed: 0,
      released: 1,
    });
    expect(removed).toEqual(['resource-failure']);
    expect(manager.getUsage().totalBytes).toBe(0);
  });

  it('persists observed over-limit bytes while a deleting resource awaits cleanup', async () => {
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    let durableBytesWhenRemovalStarted: number | null | undefined;
    const persistence = {
      load: async () => snapshot,
      replace: async (records: typeof snapshot) => {
        snapshot = structuredClone(records);
      },
    };
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async () => {
            durableBytesWhenRemovalStarted = snapshot[0]?.actualBytes;
            throw new Error('simulated failure');
          },
        },
      },
      createId: () => 'reservation-observed',
      maxSingleResourceBytes: 4,
      maxTotalBytes: 4,
      persistence,
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 0, 10_000, 'artifact');
    await manager.bindResource('reservation-observed', 'resource-observed', OWNER);
    await manager.commit('reservation-observed', 'resource-observed', 0, OWNER);

    await expect(manager.requestRelease('resource-observed', OWNER, 8)).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    expect(manager.getUsage().totalBytes).toBe(8);
    expect(durableBytesWhenRemovalStarted).toBe(8);
    expect(manager.getResource('resource-observed', OWNER)).toMatchObject({
      actualBytes: 8,
      expectedBytes: 8,
      state: 'deleting',
    });

    const restored = createManager({
      adapters: {
        artifact: { remove: async () => { throw new Error('still failing'); } },
      },
      maxSingleResourceBytes: 4,
      maxTotalBytes: 4,
      persistence,
    });
    await expect(restored.ready).resolves.toBeUndefined();
    expect(restored.getUsage().totalBytes).toBe(8);
    await expect(restored.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('总量已达到上限');
    await expect(restored.reserve(OWNER, 'artifact', 'run-2', 1, 10_000, 'artifact'))
      .rejects.toThrow('总量已达到上限');
  });

  it('persists a global conservative debt when physical occupancy is unknown', async () => {
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const persistence = {
      load: async () => snapshot,
      replace: async (records: typeof snapshot) => {
        snapshot = structuredClone(records);
      },
    };
    const manager = createManager({
      adapters: {
        artifact: { remove: async () => { throw new Error('simulated failure'); } },
      },
      createId: () => 'reservation-unknown',
      maxSingleResourceBytes: 4,
      maxTotalBytes: 10,
      persistence,
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 0, 10_000, 'artifact');
    await manager.bindResource('reservation-unknown', 'resource-unknown', OWNER);
    await manager.commit('reservation-unknown', 'resource-unknown', 0, OWNER);

    await expect(manager.requestRelease('resource-unknown', OWNER, 'unknown')).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    expect(snapshot[0]).toMatchObject({
      actualBytes: 10,
      expectedBytes: 10,
      occupancyUnknown: true,
      state: 'deleting',
    });
    expect(manager.getUsage().totalBytes).toBe(10);
    await expect(manager.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('物理占用未知');

    const restored = createManager({
      adapters: {
        artifact: { remove: async () => { throw new Error('still failing'); } },
      },
      maxSingleResourceBytes: 4,
      maxTotalBytes: 20,
      persistence,
    });
    await expect(restored.ready).resolves.toBeUndefined();
    expect(restored.getUsage().totalBytes).toBe(10);
    await expect(restored.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('物理占用未知');
  });

  it('blocks new admission when a deleting fact cannot be persisted', async () => {
    let failPersistence = false;
    let nextId = 0;
    const remove = vi.fn(async () => undefined);
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => `deletion-intent-${nextId++}`,
      persistence: {
        load: async () => [],
        replace: async () => {
          if (failPersistence) throw new Error('simulated persistence failure');
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 0, 10_000, 'artifact');
    await manager.bindResource('deletion-intent-0', 'resource-intent', OWNER);
    await manager.commit('deletion-intent-0', 'resource-intent', 0, OWNER);

    failPersistence = true;
    await expect(manager.requestRelease('resource-intent', OWNER, 8))
      .rejects.toThrow('simulated persistence failure');
    expect(remove).not.toHaveBeenCalled();
    expect(manager.getResource('resource-intent', OWNER)).toMatchObject({
      actualBytes: 0,
      state: 'committed',
    });
    await expect(manager.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('尚未持久化的清理事实');
    await expect(manager.growReservation('resource-intent', 1, OWNER))
      .rejects.toThrow('尚未持久化的清理事实');
    await expect(manager.acquireLease('resource-intent', 1_000, OWNER))
      .rejects.toThrow('尚未持久化的清理事实');

    failPersistence = false;
    await expect(manager.requestRelease('resource-intent', OWNER, 8)).resolves.toEqual({
      released: true,
      state: 'released',
    });
    expect(remove).toHaveBeenCalledOnce();
    await expect(manager.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .resolves.toBe('deletion-intent-1');
  });

  it('lets a Store hold global admission closed while unmanaged occupancy is reconciled', async () => {
    const manager = createManager({ createId: () => 'after-reconcile' });

    await manager.setAdmissionBlock('media-residue', true);
    await expect(manager.reserve(OWNER, 'artifact', 'run-1', 0, 10_000, 'artifact'))
      .rejects.toThrow('正在核对未登记的物理占用');
    await expect(manager.setAdmissionBlock('media-residue', false)).resolves.toBeUndefined();
    await expect(manager.reserve(OWNER, 'artifact', 'run-1', 0, 10_000, 'artifact'))
      .resolves.toBe('after-reconcile');
  });

  it('blocks positive adjustments while a Store reconciles unmanaged occupancy', async () => {
    const manager = createManager({ createId: () => 'blocked-adjustment' });
    await manager.reserve(OWNER, 'artifact', 'run-1', 5, 10_000, 'artifact');
    await manager.bindResource('blocked-adjustment', 'blocked-adjustment-resource', OWNER);
    await manager.commit('blocked-adjustment', 'blocked-adjustment-resource', 5, OWNER);

    await manager.setAdmissionBlock('media-residue', true);
    await expect(manager.adjust('blocked-adjustment-resource', 6, OWNER))
      .rejects.toThrow('正在核对未登记的物理占用');
    await expect(manager.adjust('blocked-adjustment-resource', 4, OWNER)).resolves.toMatchObject({
      actualBytes: 4,
      expectedBytes: 4,
    });
  });

  it('blocks positive adjustments while unknown physical occupancy remains', async () => {
    let nextId = 0;
    const manager = createManager({
      adapters: {
        artifact: { remove: async () => { throw new Error('simulated failure'); } },
      },
      createId: () => `unknown-adjustment-${nextId++}`,
      maxTotalBytes: 100,
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 5, 10_000, 'artifact');
    await manager.bindResource(
      'unknown-adjustment-0',
      'unknown-adjustment-resource',
      OWNER,
    );
    await manager.commit(
      'unknown-adjustment-0',
      'unknown-adjustment-resource',
      5,
      OWNER,
    );
    await manager.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact');
    await manager.bindResource('unknown-adjustment-1', 'unknown-occupancy-resource', OWNER);
    await manager.commit('unknown-adjustment-1', 'unknown-occupancy-resource', 0, OWNER);
    await expect(manager.requestRelease('unknown-occupancy-resource', OWNER, 'unknown'))
      .resolves.toEqual({ released: false, state: 'deleting' });

    await expect(manager.adjust('unknown-adjustment-resource', 6, OWNER))
      .rejects.toThrow('物理占用未知');
    await expect(manager.adjust('unknown-adjustment-resource', 4, OWNER)).resolves.toMatchObject({
      actualBytes: 4,
      expectedBytes: 4,
    });
  });

  it('flushes an unreconciled deletion intent before closing persistence', async () => {
    let failPersistence = false;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const close = vi.fn(async () => undefined);
    const manager = createManager({
      createId: () => 'close-flush-reservation',
      persistence: {
        close,
        load: async () => snapshot,
        replace: async (records) => {
          if (failPersistence) throw new Error('simulated persistence failure');
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('close-flush-reservation', 'close-flush-resource', OWNER);

    failPersistence = true;
    await expect(manager.markDeleting('close-flush-resource', OWNER, 'unknown'))
      .rejects.toThrow('simulated persistence failure');
    failPersistence = false;

    await expect(manager.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(snapshot[0]).toMatchObject({
      occupancyUnknown: true,
      state: 'deleting',
    });
  });

  it('reports an unreconciled deletion intent when close cannot persist it', async () => {
    let failPersistence = false;
    const close = vi.fn(async () => undefined);
    const manager = createManager({
      createId: () => 'close-failure-reservation',
      persistence: {
        close,
        load: async () => [],
        replace: async () => {
          if (failPersistence) throw new Error('simulated persistence failure');
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('close-failure-reservation', 'close-failure-resource', OWNER);

    failPersistence = true;
    await expect(manager.markDeleting('close-failure-resource', OWNER, 3))
      .rejects.toThrow('simulated persistence failure');
    await expect(manager.close()).rejects.toThrow('simulated persistence failure');
    expect(close).toHaveBeenCalledOnce();
  });

  it('overlays an unreconciled deletion intent onto every later durable snapshot', async () => {
    let failPersistence = false;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const persistence = {
      load: async () => snapshot,
      replace: async (records: AgentLocalStorageQuotaPersistedRecord[]) => {
        if (failPersistence) throw new Error('simulated persistence failure');
        snapshot = structuredClone(records);
      },
    };
    const manager = createManager({
      createId: () => 'overlay-intent-reservation',
      maxSingleResourceBytes: 4,
      maxTotalBytes: 10,
      persistence,
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('overlay-intent-reservation', 'overlay-intent-resource', OWNER);

    failPersistence = true;
    await expect(manager.markDeleting('overlay-intent-resource', OWNER, 'unknown'))
      .rejects.toThrow('simulated persistence failure');
    await expect(manager.touch('overlay-intent-resource', 1_000, OWNER))
      .rejects.toThrow('simulated persistence failure');

    failPersistence = false;
    await expect(manager.touch('overlay-intent-resource', 1_000, OWNER)).resolves.toBe(false);
    expect(snapshot[0]).toMatchObject({
      actualBytes: 10,
      expectedBytes: 10,
      occupancyUnknown: true,
      state: 'deleting',
    });

    const restored = createManager({
      adapters: {
        artifact: { remove: async () => { throw new Error('still failing'); } },
      },
      maxSingleResourceBytes: 4,
      maxTotalBytes: 20,
      persistence,
    });
    await expect(restored.ready).resolves.toBeUndefined();
    expect(restored.getResource('overlay-intent-resource', OWNER)).toMatchObject({
      actualBytes: 10,
      state: 'deleting',
    });
    await expect(restored.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('物理占用未知');
  });

  it('lets an admitted release finish both phases before close shuts persistence', async () => {
    let blockNextReplace = false;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const firstPhaseEntered = createDeferred();
    const continueFirstPhase = createDeferred();
    const events: string[] = [];
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async () => {
            events.push('remove');
          },
        },
      },
      createId: () => 'close-release-reservation',
      persistence: {
        close: async () => {
          events.push('close');
        },
        load: async () => snapshot,
        replace: async (records) => {
          snapshot = structuredClone(records);
          if (blockNextReplace) {
            blockNextReplace = false;
            firstPhaseEntered.resolve();
            await continueFirstPhase.promise;
          }
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('close-release-reservation', 'close-release-resource', OWNER);

    blockNextReplace = true;
    const release = manager.requestRelease('close-release-resource', OWNER);
    await firstPhaseEntered.promise;
    const closing = manager.close();
    continueFirstPhase.resolve();

    await expect(release).resolves.toEqual({ released: true, state: 'released' });
    await expect(closing).resolves.toBeUndefined();
    expect(events).toEqual(['remove', 'close']);
    expect(snapshot).toEqual([]);
  });

  it('lets an admitted deletion mark persist before close shuts persistence', async () => {
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const manager = createManager({
      createId: () => 'close-mark-reservation',
      persistence: {
        load: async () => snapshot,
        replace: async (records) => {
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('close-mark-reservation', 'close-mark-resource', OWNER);

    const marking = manager.markDeleting('close-mark-resource', OWNER, 7);
    const closing = manager.close();

    await expect(marking).resolves.toBe(true);
    await expect(closing).resolves.toBeUndefined();
    expect(snapshot).toEqual([
      expect.objectContaining({
        actualBytes: 7,
        expectedBytes: 7,
        resourceRef: 'close-mark-resource',
        state: 'deleting',
      }),
    ]);
  });

  it('lets an admitted bound cancellation continue into release during close', async () => {
    let blockNextReplace = false;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const firstPhaseEntered = createDeferred();
    const continueFirstPhase = createDeferred();
    const events: string[] = [];
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async () => {
            events.push('remove');
          },
        },
      },
      createId: () => 'close-cancel-reservation',
      persistence: {
        close: async () => {
          events.push('close');
        },
        load: async () => snapshot,
        replace: async (records) => {
          snapshot = structuredClone(records);
          if (blockNextReplace) {
            blockNextReplace = false;
            firstPhaseEntered.resolve();
            await continueFirstPhase.promise;
          }
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('close-cancel-reservation', 'close-cancel-resource', OWNER);

    blockNextReplace = true;
    const cancellation = manager.cancelReservation('close-cancel-reservation', OWNER);
    await firstPhaseEntered.promise;
    const closing = manager.close();
    continueFirstPhase.resolve();

    await expect(cancellation).resolves.toEqual({ released: true, state: 'released' });
    await expect(closing).resolves.toBeUndefined();
    expect(events).toEqual(['remove', 'close']);
    expect(snapshot).toEqual([]);
  });

  it('lets an admitted sweep remove persisted candidates before close', async () => {
    let blockNextReplace = false;
    let currentTime = 1_000;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const firstPhaseEntered = createDeferred();
    const continueFirstPhase = createDeferred();
    const events: string[] = [];
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async () => {
            events.push('remove');
          },
        },
      },
      createId: () => 'close-sweep-reservation',
      now: () => currentTime,
      persistence: {
        close: async () => {
          events.push('close');
        },
        load: async () => snapshot,
        replace: async (records) => {
          snapshot = structuredClone(records);
          if (blockNextReplace) {
            blockNextReplace = false;
            firstPhaseEntered.resolve();
            await continueFirstPhase.promise;
          }
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10, 'artifact');
    await manager.bindResource('close-sweep-reservation', 'close-sweep-resource', OWNER);
    currentTime += 11;

    blockNextReplace = true;
    const sweeping = manager.sweep('close-race');
    await firstPhaseEntered.promise;
    const closing = manager.close();
    continueFirstPhase.resolve();

    await expect(sweeping).resolves.toMatchObject({ attempted: 1, released: 1 });
    await expect(closing).resolves.toBeUndefined();
    expect(events).toEqual(['remove', 'close']);
    expect(snapshot).toEqual([]);
  });

  it('rejects new operations after close starts and shares one close promise', async () => {
    const manager = createManager();

    const closing = manager.close();
    expect(manager.close()).toBe(closing);
    await expect(manager.reserve(OWNER, 'artifact', 'run-1', 0, 10_000, 'artifact'))
      .rejects.toThrow('正在关闭');
    await expect(manager.requestRelease('late-resource', OWNER)).rejects.toThrow('正在关闭');
    await expect(manager.cancelReservation('late-reservation', OWNER)).rejects.toThrow('正在关闭');
    await expect(manager.sweep('late-sweep')).rejects.toThrow('正在关闭');
    expect(() => manager.registerAdapter('late-adapter', { remove: async () => undefined }))
      .toThrow('正在关闭');
    await expect(closing).resolves.toBeUndefined();
  });

  it('treats concurrent duplicate releases as idempotent success', async () => {
    const remove = vi.fn(async () => undefined);
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => 'concurrent-release-reservation',
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource(
      'concurrent-release-reservation',
      'concurrent-release-resource',
      OWNER,
    );

    await expect(Promise.all([
      manager.requestRelease('concurrent-release-resource', OWNER),
      manager.requestRelease('concurrent-release-resource', OWNER),
    ])).resolves.toEqual([
      { released: true, state: 'released' },
      { released: true, state: 'released' },
    ]);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('coalesces a duplicate release that starts while adapter removal is pending', async () => {
    let nextId = 0;
    const removalStarted = createDeferred();
    const continueRemoval = createDeferred();
    const remove = vi.fn(async () => {
      removalStarted.resolve();
      await continueRemoval.promise;
    });
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => `slow-release-${nextId++}`,
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('slow-release-0', 'slow-release-resource', OWNER);

    const first = manager.requestRelease('slow-release-resource', OWNER, 1);
    await removalStarted.promise;
    const duplicate = manager.requestRelease('slow-release-resource', OWNER, 'unknown');
    await expect(manager.requestRelease('slow-release-resource', OTHER_OWNER))
      .rejects.toThrow('无权');
    continueRemoval.resolve();

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { released: true, state: 'released' },
      { released: true, state: 'released' },
    ]);
    expect(remove).toHaveBeenCalledOnce();

    await manager.reserve(OWNER, 'artifact', 'run-2', 1, 10_000, 'artifact');
    await manager.bindResource('slow-release-1', 'slow-release-resource', OWNER);
    await expect(manager.requestRelease('slow-release-resource', OWNER)).resolves.toEqual({
      released: true,
      state: 'released',
    });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not let a late duplicate release cross into a rebound resource ref', async () => {
    let nextId = 0;
    let blockFinalDeletion = false;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const finalDeletionStarted = createDeferred();
    const continueFinalDeletion = createDeferred();
    const remove = vi.fn(async () => undefined);
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => `release-aba-${nextId++}`,
      persistence: {
        load: async () => snapshot,
        replace: async (records) => {
          if (
            blockFinalDeletion
            && !records.some(record => record.id === 'release-aba-0')
          ) {
            finalDeletionStarted.resolve();
            await continueFinalDeletion.promise;
          }
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-old', 1, 10_000, 'artifact');
    await manager.bindResource('release-aba-0', 'release-aba-resource', OWNER);
    await manager.reserve(OWNER, 'artifact', 'run-new', 1, 10_000, 'artifact');

    blockFinalDeletion = true;
    const firstRelease = manager.requestRelease('release-aba-resource', OWNER, 1);
    await finalDeletionStarted.promise;
    const rebound = manager.bindResource(
      'release-aba-1',
      'release-aba-resource',
      OWNER,
    );
    const lateDuplicate = manager.requestRelease('release-aba-resource', OWNER, 'unknown');
    continueFinalDeletion.resolve();

    await expect(rebound).rejects.toThrow('正在完成上一轮清理');
    await expect(Promise.all([firstRelease, lateDuplicate])).resolves.toEqual([
      { released: true, state: 'released' },
      { released: true, state: 'released' },
    ]);
    expect(remove).toHaveBeenCalledOnce();

    blockFinalDeletion = false;
    await expect(manager.bindResource(
      'release-aba-1',
      'release-aba-resource',
      OWNER,
    )).resolves.toMatchObject({
      id: 'release-aba-1',
      state: 'bound',
    });
    expect(manager.getResource('release-aba-resource', OWNER)).toMatchObject({
      id: 'release-aba-1',
      state: 'bound',
    });
  });

  it('does not let a stale sweep candidate delete a rebound resource ref', async () => {
    let currentTime = 10_000;
    let nextId = 0;
    const firstRemovalStarted = createDeferred();
    const continueFirstRemoval = createDeferred();
    const removedResources: string[] = [];
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async (resourceRef) => {
            removedResources.push(resourceRef);
            if (resourceRef === 'sweep-aba-a') {
              firstRemovalStarted.resolve();
              await continueFirstRemoval.promise;
            }
          },
        },
      },
      createId: () => `sweep-aba-${nextId++}`,
      now: () => currentTime,
    });
    await manager.reserve(OWNER, 'artifact', 'run-a', 1, 1_000, 'artifact');
    await manager.bindResource('sweep-aba-0', 'sweep-aba-a', OWNER);
    await manager.reserve(OWNER, 'artifact', 'run-b', 1, 1_000, 'artifact');
    await manager.bindResource('sweep-aba-1', 'sweep-aba-b', OWNER);

    currentTime += 1_001;
    const sweeping = manager.sweep('stale-candidate-aba');
    await firstRemovalStarted.promise;
    await expect(manager.requestRelease('sweep-aba-b', OWNER)).resolves.toEqual({
      released: true,
      state: 'released',
    });
    await manager.reserve(OWNER, 'artifact', 'run-new', 1, 1_000, 'artifact');
    await manager.bindResource('sweep-aba-2', 'sweep-aba-b', OWNER);
    continueFirstRemoval.resolve();

    await expect(sweeping).resolves.toMatchObject({
      attempted: 2,
      failed: 0,
      released: 2,
    });
    expect(removedResources).toEqual(['sweep-aba-a', 'sweep-aba-b']);
    expect(manager.getResource('sweep-aba-b', OWNER)).toMatchObject({
      id: 'sweep-aba-2',
      state: 'bound',
    });
  });

  it('does not let an invalid owner occupy the valid owner release operation', async () => {
    const remove = vi.fn(async () => undefined);
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => 'owner-release-reservation',
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('owner-release-reservation', 'owner-release-resource', OWNER);

    const invalidRelease = manager.requestRelease('owner-release-resource', OTHER_OWNER);
    const validRelease = manager.requestRelease('owner-release-resource', OWNER);

    await expect(invalidRelease).rejects.toThrow('无权');
    await expect(validRelease).resolves.toEqual({ released: true, state: 'released' });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('merges a stronger observation from a coalesced release before retaining debt', async () => {
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const removalStarted = createDeferred();
    const continueRemoval = createDeferred();
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async () => {
            removalStarted.resolve();
            await continueRemoval.promise;
            throw new Error('simulated removal failure');
          },
        },
      },
      createId: () => 'stronger-observation-reservation',
      maxSingleResourceBytes: 4,
      maxTotalBytes: 10,
      persistence: {
        load: async () => snapshot,
        replace: async (records) => {
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource(
      'stronger-observation-reservation',
      'stronger-observation-resource',
      OWNER,
    );

    const first = manager.requestRelease('stronger-observation-resource', OWNER, 1);
    await removalStarted.promise;
    const duplicate = manager.requestRelease(
      'stronger-observation-resource',
      OWNER,
      'unknown',
    );
    continueRemoval.resolve();

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { released: false, state: 'deleting' },
      { released: false, state: 'deleting' },
    ]);
    expect(snapshot[0]).toMatchObject({
      actualBytes: 10,
      expectedBytes: 10,
      occupancyUnknown: true,
      state: 'deleting',
    });
  });

  it('retains a stronger coalesced observation when deletion persistence fails', async () => {
    let failPersistence = false;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const persistenceStarted = createDeferred();
    const continuePersistence = createDeferred();
    const remove = vi.fn(async () => undefined);
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => 'failed-observation-reservation',
      maxSingleResourceBytes: 4,
      maxTotalBytes: 10,
      persistence: {
        load: async () => snapshot,
        replace: async (records) => {
          if (failPersistence) {
            persistenceStarted.resolve();
            await continuePersistence.promise;
            throw new Error('simulated persistence failure');
          }
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource(
      'failed-observation-reservation',
      'failed-observation-resource',
      OWNER,
    );

    failPersistence = true;
    const first = manager.requestRelease('failed-observation-resource', OWNER, 1);
    await persistenceStarted.promise;
    const duplicate = manager.requestRelease('failed-observation-resource', OWNER, 'unknown');
    continuePersistence.resolve();

    await expect(first).rejects.toThrow('simulated persistence failure');
    await expect(duplicate).rejects.toThrow('simulated persistence failure');
    expect(remove).not.toHaveBeenCalled();

    failPersistence = false;
    await expect(manager.close()).resolves.toBeUndefined();
    expect(snapshot[0]).toMatchObject({
      actualBytes: 10,
      expectedBytes: 10,
      occupancyUnknown: true,
      state: 'deleting',
    });
  });

  it('drains a stronger observation that arrives while intent recovery is pending', async () => {
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    let fiveByteWrites = 0;
    const adapterStarted = createDeferred();
    const continueAdapter = createDeferred();
    const strongerMarkFailed = createDeferred();
    const recoveryWriteStarted = createDeferred();
    const continueRecoveryWrite = createDeferred();
    const latestWriteStarted = createDeferred();
    const continueLatestWrite = createDeferred();
    const manager = createManager({
      adapters: {
        artifact: {
          remove: async () => {
            adapterStarted.resolve();
            await continueAdapter.promise;
            throw new Error('simulated removal failure');
          },
        },
      },
      createId: () => 'revision-drain-reservation',
      maxSingleResourceBytes: 4,
      maxTotalBytes: 10,
      persistence: {
        load: async () => snapshot,
        replace: async (records) => {
          const record = records[0];
          if (record?.actualBytes === 5 && record.state === 'deleting') {
            fiveByteWrites += 1;
            if (fiveByteWrites === 1) {
              strongerMarkFailed.resolve();
              throw new Error('simulated stronger mark failure');
            }
            if (fiveByteWrites === 3) {
              throw new Error('simulated drain mark failure');
            }
            if (fiveByteWrites === 4) {
              recoveryWriteStarted.resolve();
              await continueRecoveryWrite.promise;
            }
          }
          if (record?.occupancyUnknown) {
            latestWriteStarted.resolve();
            await continueLatestWrite.promise;
          }
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource(
      'revision-drain-reservation',
      'revision-drain-resource',
      OWNER,
    );

    let releaseSettled = false;
    const first = manager.requestRelease('revision-drain-resource', OWNER, 1);
    void first.then(
      () => { releaseSettled = true; },
      () => { releaseSettled = true; },
    );
    await adapterStarted.promise;
    const second = manager.requestRelease('revision-drain-resource', OWNER, 5);
    await strongerMarkFailed.promise;
    continueAdapter.resolve();
    await recoveryWriteStarted.promise;

    const third = manager.requestRelease('revision-drain-resource', OWNER, 'unknown');
    continueRecoveryWrite.resolve();
    await latestWriteStarted.promise;
    await Promise.resolve();
    expect(releaseSettled).toBe(false);
    continueLatestWrite.resolve();

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { released: false, state: 'deleting' },
      { released: false, state: 'deleting' },
      { released: false, state: 'deleting' },
    ]);
    expect(snapshot[0]).toMatchObject({
      actualBytes: 10,
      expectedBytes: 10,
      occupancyUnknown: true,
      state: 'deleting',
    });
  });

  it('durably reconciles a deletion intent before sweep calls its adapter', async () => {
    let failPersistence = false;
    let failRemoval = true;
    let nextId = 0;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const remove = vi.fn(async () => {
      expect(snapshot[0]).toMatchObject({
        actualBytes: 8,
        expectedBytes: 8,
        state: 'deleting',
      });
      if (failRemoval) throw new Error('simulated removal failure');
    });
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => `sweep-intent-${nextId++}`,
      maxSingleResourceBytes: 4,
      maxTotalBytes: 8,
      persistence: {
        load: async () => snapshot,
        replace: async (records) => {
          if (failPersistence) throw new Error('simulated persistence failure');
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 1, 10_000, 'artifact');
    await manager.bindResource('sweep-intent-0', 'resource-sweep-intent', OWNER);

    failPersistence = true;
    await expect(manager.markDeleting('resource-sweep-intent', OWNER, 8))
      .rejects.toThrow('simulated persistence failure');
    await expect(manager.markDeleting('resource-sweep-intent', OTHER_OWNER))
      .rejects.toThrow('无权');
    failPersistence = false;
    await expect(manager.sweep('recover-unreconciled-intent')).resolves.toMatchObject({
      attempted: 1,
      failed: 1,
      released: 0,
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(manager.getUsage().totalBytes).toBe(8);
    await expect(manager.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('总量已达到上限');

    failRemoval = false;
    await expect(manager.sweep('retry-reconciled-intent')).resolves.toMatchObject({
      attempted: 1,
      failed: 0,
      released: 1,
    });
    await expect(manager.reserve(OWNER, 'artifact', 'run-2', 0, 10, 'artifact'))
      .resolves.toBe('sweep-intent-1');
  });

  it('expires unbound reservations and renews bound resources with touch', async () => {
    let currentTime = 10_000;
    const manager = createManager({ now: () => currentTime });
    const unbound = await manager.reserve(OWNER, 'artifact', 'run-1', 10, 1_000, 'artifact');
    const bound = await manager.reserve(OWNER, 'artifact', 'run-2', 10, 1_000, 'artifact');
    await manager.bindResource(bound, 'resource-live', OWNER);

    currentTime += 1_001;
    await manager.touch('resource-live', 1_000, OWNER);
    await expect(manager.sweep('expired')).resolves.toMatchObject({
      attempted: 1,
      released: 1,
    });
    expect(manager.getReservation(unbound, OWNER)).toBeNull();
    expect(manager.getResource('resource-live', OWNER)).not.toBeNull();
  });

  it('persists an expired bound resource as deleting before calling its adapter', async () => {
    let currentTime = 1_000;
    let snapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    const remove = vi.fn(async () => {
      expect(snapshot[0]).toMatchObject({ state: 'deleting' });
    });
    const manager = createManager({
      adapters: { artifact: { remove } },
      createId: () => 'expired-two-phase',
      now: () => currentTime,
      persistence: {
        load: async () => snapshot,
        replace: async (records) => {
          snapshot = structuredClone(records);
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 3, 10, 'artifact');
    await manager.bindResource('expired-two-phase', 'resource-expired', OWNER);
    currentTime += 11;

    await expect(manager.sweep('expired-two-phase')).resolves.toMatchObject({
      attempted: 1,
      failed: 0,
      released: 1,
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('supports idempotent commit and rejects a different second commit', async () => {
    const manager = createManager({ createId: () => 'reservation-1' });
    await manager.reserve(OWNER, 'artifact', 'run-1', 5, 10_000, 'artifact');
    await manager.bindResource('reservation-1', 'resource-1', OWNER);
    await manager.commit('reservation-1', 'resource-1', 4, OWNER);
    await expect(manager.commit('reservation-1', 'resource-1', 4, OWNER)).resolves.toMatchObject({
      state: 'committed',
      expectedBytes: 4,
    });
    await expect(manager.commit('reservation-1', 'resource-1', 3, OWNER)).rejects.toThrow('已经提交过');
  });

  it('requires the reservation owner for resource mutations and reads', async () => {
    const manager = createManager({ createId: () => 'reservation-1' });
    await manager.reserve(OWNER, 'artifact', 'run-1', 5, 10_000, 'artifact');

    await expect(manager.bindResource('reservation-1', 'resource-1', OTHER_OWNER))
      .rejects.toThrow('无权');
    await manager.bindResource('reservation-1', 'resource-1', OWNER);
    await expect(manager.commit('reservation-1', 'resource-1', 4, OTHER_OWNER))
      .rejects.toThrow('无权');
    expect(() => manager.getResource('resource-1', OTHER_OWNER)).toThrow('无权');
  });

  it('does not release a resource while a live lease is held', async () => {
    const manager = createManager({ createId: (() => {
      let nextId = 0;
      return () => `id-${nextId++}`;
    })() });
    await manager.reserve(OWNER, 'artifact', 'run-1', 5, 10_000, 'artifact');
    await manager.bindResource('id-0', 'resource-1', OWNER);
    await manager.commit('id-0', 'resource-1', 4, OWNER);
    const lease = await manager.acquireLease('resource-1', 1_000, OWNER);

    await expect(manager.requestRelease('resource-1', OWNER)).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    expect(manager.getResource('resource-1', OWNER)).toMatchObject({ state: 'deleting' });
    await expect(manager.sweep('lease-held')).resolves.toMatchObject({
      attempted: 0,
      released: 0,
    });

    await expect(manager.releaseLease('resource-1', lease.leaseId, OWNER)).resolves.toBe(true);
    await expect(manager.sweep('lease-released')).resolves.toMatchObject({
      attempted: 1,
      released: 1,
    });
  });

  it('preserves live leases when a persistence mutation rolls back', async () => {
    let failPersistence = false;
    let nextId = 0;
    const manager = createManager({
      createId: () => `id-${nextId++}`,
      persistence: {
        load: async () => [],
        replace: async () => {
          if (failPersistence) throw new Error('simulated persistence failure');
        },
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 5, 10_000, 'artifact');
    await manager.bindResource('id-0', 'resource-1', OWNER);
    await manager.commit('id-0', 'resource-1', 4, OWNER);
    const lease = await manager.acquireLease('resource-1', 1_000, OWNER);

    failPersistence = true;
    await expect(manager.touch('resource-1', 1_000, OWNER))
      .rejects.toThrow('simulated persistence failure');
    failPersistence = false;

    await expect(manager.requestRelease('resource-1', OWNER)).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    await expect(manager.releaseLease('resource-1', lease.leaseId, OWNER)).resolves.toBe(true);
    await expect(manager.sweep('rollback-lease-released')).resolves.toMatchObject({
      attempted: 1,
      released: 1,
    });
  });

  it('releases an in-memory lease without requiring a durable ledger rewrite', async () => {
    let failPersistence = false;
    let nextId = 0;
    const replace = vi.fn(async () => {
      if (failPersistence) throw new Error('simulated persistence failure');
    });
    const manager = createManager({
      createId: () => `ephemeral-lease-${nextId++}`,
      persistence: {
        load: async () => [],
        replace,
      },
    });
    await manager.reserve(OWNER, 'artifact', 'run-1', 5, 10_000, 'artifact');
    await manager.bindResource('ephemeral-lease-0', 'resource-lease', OWNER);
    await manager.commit('ephemeral-lease-0', 'resource-lease', 4, OWNER);
    const lease = await manager.acquireLease('resource-lease', 1_000, OWNER);
    const replaceCallsBeforeRelease = replace.mock.calls.length;

    failPersistence = true;
    await expect(manager.releaseLease('resource-lease', lease.leaseId, OWNER)).resolves.toBe(true);
    expect(replace).toHaveBeenCalledTimes(replaceCallsBeforeRelease);

    failPersistence = false;
    await expect(manager.requestRelease('resource-lease', OWNER)).resolves.toEqual({
      released: true,
      state: 'released',
    });
  });

  it('closes persistence even when durable state cannot be loaded', async () => {
    const close = vi.fn(async () => undefined);
    const manager = createManager({
      persistence: {
        close,
        load: async () => { throw new Error('corrupt quota ledger'); },
        replace: async () => undefined,
      },
    });

    await expect(manager.ready).rejects.toThrow('corrupt quota ledger');
    await expect(manager.close()).rejects.toThrow('corrupt quota ledger');
    expect(close).toHaveBeenCalledOnce();
  });
});
