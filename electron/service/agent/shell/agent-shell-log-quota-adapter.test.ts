import { describe, expect, it } from 'vitest';

import {
  createAgentLocalStorageQuotaManager,
} from '../storage/agent-local-storage-quota-manager';
import { createAgentShellLogQuotaAdapter } from './agent-shell-log-quota-adapter';

const OWNER = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});

function createFixture(options: Parameters<typeof createAgentLocalStorageQuotaManager>[0] = {}) {
  const removed: string[] = [];
  const manager = createAgentLocalStorageQuotaManager({
    adapters: {
      'shell-log': {
        remove: async (resourceRef) => {
          removed.push(resourceRef);
        },
      },
      ...options.adapters,
    },
    ...options,
  });
  return {
    adapter: createAgentShellLogQuotaAdapter({ quotaManager: manager }),
    manager,
    removed,
  };
}

describe('Agent Shell log quota adapter', () => {
  it('maps reserve, adjustment, commit and two-phase release to the shared ledger', async () => {
    const { adapter, manager, removed } = createFixture({
      maxTotalBytes: 100,
      createId: () => 'reservation-1',
    });
    const reservation = await adapter.reserve({
      expectedBytes: 80,
      owner: OWNER,
      resourceRef: 'log:v1:resource-1',
      runId: 'run-1',
      ttlMs: 10_000,
    });
    expect(reservation).toEqual({
      reservationId: 'reservation-1',
      resourceRef: 'log:v1:resource-1',
    });
    expect(manager.getUsage()).toMatchObject({ totalBytes: 80, resourceCount: 1 });

    await adapter.adjust({
      bytes: 12,
      owner: OWNER,
      resourceRef: reservation.resourceRef,
    });
    await adapter.commit({
      actualBytes: 12,
      owner: OWNER,
      reservationId: reservation.reservationId,
      resourceRef: reservation.resourceRef,
    });
    expect(manager.getUsage()).toMatchObject({ totalBytes: 12 });

    await expect(adapter.markDeleting({
      observedBytes: 12,
      owner: OWNER,
      reservationId: 'wrong-reservation',
      resourceRef: reservation.resourceRef,
    })).rejects.toThrow('身份不匹配');

    await adapter.markDeleting({
      observedBytes: 12,
      owner: OWNER,
      reservationId: reservation.reservationId,
      resourceRef: reservation.resourceRef,
    });
    await adapter.release({
      owner: OWNER,
      reservationId: reservation.reservationId,
      resourceRef: reservation.resourceRef,
    });
    expect(removed).toEqual(['log:v1:resource-1']);
    expect(manager.getUsage()).toMatchObject({ totalBytes: 0, resourceCount: 0 });
    await manager.close();
  });

  it('cancels the reservation when binding fails instead of leaking headroom', async () => {
    let nextId = 0;
    const manager = createAgentLocalStorageQuotaManager({
      adapters: { 'shell-log': { remove: async () => undefined } },
      createId: () => `reservation-${++nextId}`,
    });
    const adapter = createAgentShellLogQuotaAdapter({ quotaManager: manager });
    await expect(adapter.reserve({
      expectedBytes: 10,
      owner: OWNER,
      resourceRef: 'log:v1:duplicate',
      runId: 'run-1',
      ttlMs: 10_000,
    })).resolves.toMatchObject({ reservationId: 'reservation-1' });
    await expect(adapter.reserve({
      expectedBytes: 10,
      owner: OWNER,
      resourceRef: 'log:v1:duplicate',
      runId: 'run-1',
      ttlMs: 10_000,
    })).rejects.toThrow('已被占用');
    expect(manager.getUsage()).toMatchObject({ resourceCount: 1, totalBytes: 10 });
    await manager.close();
  });

  it('reattaches a persisted resource only when owner, run and adapter identity match', async () => {
    const { adapter, manager } = createFixture({
      maxTotalBytes: 100,
      createId: () => 'reservation-reattach',
    });
    const reservation = await adapter.reserve({
      expectedBytes: 40,
      owner: OWNER,
      resourceRef: 'log:v1:reattach',
      runId: 'run-reattach',
      ttlMs: 10_000,
    });
    await expect(adapter.reattach?.({
      owner: OWNER,
      resourceRef: reservation.resourceRef,
      runId: 'run-reattach',
    })).resolves.toEqual({
      accountedBytes: 40,
      reservationId: reservation.reservationId,
      state: 'bound',
    });
    await expect(adapter.reattach?.({
      owner: OWNER,
      resourceRef: reservation.resourceRef,
      runId: 'other-run',
    })).rejects.toThrow('绑定不匹配');
    await adapter.commit({
      actualBytes: 12,
      owner: OWNER,
      reservationId: reservation.reservationId,
      resourceRef: reservation.resourceRef,
    });
    await expect(adapter.reattach?.({
      owner: OWNER,
      resourceRef: reservation.resourceRef,
      runId: 'run-reattach',
    })).resolves.toMatchObject({
      accountedBytes: 12,
      reservationId: reservation.reservationId,
      state: 'committed',
    });
    await manager.close();
  });

  it('surfaces a failed physical removal without releasing ledger occupancy', async () => {
    let fail = true;
    const manager = createAgentLocalStorageQuotaManager({
      adapters: {
        'shell-log': {
          remove: async () => {
            if (fail) throw new Error('remove failed');
          },
        },
      },
      createId: () => 'reservation-3',
    });
    const adapter = createAgentShellLogQuotaAdapter({ quotaManager: manager });
    const reservation = await adapter.reserve({
      expectedBytes: 20,
      owner: OWNER,
      resourceRef: 'log:v1:resource-3',
      runId: 'run-3',
      ttlMs: 10_000,
    });
    await adapter.markDeleting({
      observedBytes: 20,
      owner: OWNER,
      reservationId: reservation.reservationId,
      resourceRef: reservation.resourceRef,
    });
    await expect(adapter.release({
      owner: OWNER,
      reservationId: 'wrong-reservation',
      resourceRef: reservation.resourceRef,
    })).rejects.toThrow('身份不匹配');
    await expect(adapter.release({
      owner: OWNER,
      reservationId: reservation.reservationId,
      resourceRef: reservation.resourceRef,
    })).rejects.toThrow('清理未完成');
    expect(manager.getUsage().totalBytes).toBe(20);

    fail = false;
    await expect(adapter.release({
      owner: OWNER,
      reservationId: reservation.reservationId,
      resourceRef: reservation.resourceRef,
    })).resolves.toBeUndefined();
    expect(manager.getUsage().totalBytes).toBe(0);
    await manager.close();
  });
});
