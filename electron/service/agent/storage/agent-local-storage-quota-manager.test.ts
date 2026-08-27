import { describe, expect, it, vi } from 'vitest';

import {
  createAgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaOwner,
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
