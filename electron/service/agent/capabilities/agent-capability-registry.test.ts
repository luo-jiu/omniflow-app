import { describe, expect, it, vi } from 'vitest';

import {
  createAgentCapabilityRegistry,
  createAgentCapabilitySnapshot,
} from './agent-capability-registry';
import type { AgentCapabilityDefinition } from './agent-capability.types';

const OWNER_ONE = {
  accountScope: 'user:1',
  backendScope: 'https://one.example/api',
};
const OWNER_TWO = {
  accountScope: 'user:2',
  backendScope: 'https://one.example/api',
};

function request(
  capabilityIds: string[],
  overrides: Partial<{
    libraryId: number;
    ownerScope: typeof OWNER_ONE;
    signal: AbortSignal;
  }> = {},
) {
  return {
    capabilityIds,
    libraryId: overrides.libraryId || 3,
    ownerScope: overrides.ownerScope || OWNER_ONE,
    signal: overrides.signal || new AbortController().signal,
  };
}

function definition(
  overrides: Partial<AgentCapabilityDefinition> = {},
): AgentCapabilityDefinition {
  return {
    cacheTtlMs: 1_000,
    id: 'test.machine',
    probe: vi.fn(async () => ({ state: 'available' as const })),
    revision: 'test@1',
    scope: 'machine',
    timeoutMs: 100,
    ...overrides,
  };
}

describe('Agent Capability Registry', () => {
  it('registers immutable definitions and rejects duplicate or unknown IDs', async () => {
    const registry = createAgentCapabilityRegistry([definition()]);

    expect(registry.get('test.machine')).toMatchObject({
      id: 'test.machine',
      scope: 'machine',
    });
    expect(Object.isFrozen(registry.get('test.machine'))).toBe(true);
    expect(() => registry.register(definition())).toThrow('已注册');
    await expect(registry.createSnapshot(request(['test.missing'])))
      .rejects.toThrow('未注册');
  });

  it('shares a fresh machine result without exposing raw scope data', async () => {
    const probe = vi.fn(async () => ({ state: 'available' as const }));
    const registry = createAgentCapabilityRegistry([definition({ probe })]);

    const first = await registry.createSnapshot(request(['test.machine']));
    const second = await registry.createSnapshot(request(['test.machine'], {
      ownerScope: OWNER_TWO,
    }));

    expect(probe).toHaveBeenCalledTimes(1);
    expect(first.identity).toBe(second.identity);
    expect(first.get('test.machine')).toMatchObject({ state: 'available' });
    expect(JSON.stringify(first)).not.toContain(OWNER_ONE.accountScope);
    expect(JSON.stringify(first)).not.toContain(OWNER_ONE.backendScope);
  });

  it('isolates owner and library scoped caches', async () => {
    const ownerProbe = vi.fn(async () => ({ state: 'available' as const }));
    const libraryProbe = vi.fn(async () => ({ state: 'available' as const }));
    const registry = createAgentCapabilityRegistry([
      definition({ id: 'test.owner', probe: ownerProbe, scope: 'owner' }),
      definition({ id: 'test.library', probe: libraryProbe, scope: 'library' }),
    ]);

    await registry.createSnapshot(request(['test.owner', 'test.library']));
    await registry.createSnapshot(request(['test.owner', 'test.library'], { libraryId: 4 }));
    await registry.createSnapshot(request(['test.owner', 'test.library'], {
      libraryId: 4,
      ownerScope: OWNER_TWO,
    }));

    expect(ownerProbe).toHaveBeenCalledTimes(2);
    expect(libraryProbe).toHaveBeenCalledTimes(3);
  });

  it('does not invalidate machine cache when an owner scope is released', async () => {
    const probe = vi.fn(async () => ({ state: 'available' as const }));
    const registry = createAgentCapabilityRegistry([definition({ probe })]);
    await registry.createSnapshot(request(['test.machine']));

    registry.invalidate({ ownerScope: OWNER_ONE });
    await registry.createSnapshot(request(['test.machine'], { ownerScope: OWNER_TWO }));

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('normalizes probe failures and timeouts to safe unknown states', async () => {
    vi.useFakeTimers();
    try {
      const registry = createAgentCapabilityRegistry([
        definition({
          id: 'test.failure',
          probe: async () => { throw new Error('/private/secret/path'); },
        }),
        definition({
          id: 'test.timeout',
          probe: async () => new Promise(() => undefined),
          timeoutMs: 10,
        }),
      ]);
      const pending = registry.createSnapshot(request(['test.failure', 'test.timeout']));
      await vi.advanceTimersByTimeAsync(11);
      const snapshot = await pending;

      expect(snapshot.get('test.failure')).toMatchObject({
        reasonCode: 'capability.probe_failed',
        state: 'unknown',
      });
      expect(snapshot.get('test.timeout')).toMatchObject({
        reasonCode: 'capability.probe_timeout',
        state: 'unknown',
      });
      expect(JSON.stringify(snapshot)).not.toContain('/private/secret/path');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets caller cancellation stop waiting without poisoning the shared probe', async () => {
    let finishProbe: ((value: { state: 'available' }) => void) | undefined;
    const probe = vi.fn(() => new Promise<{ state: 'available' }>((resolve) => {
      finishProbe = resolve;
    }));
    const registry = createAgentCapabilityRegistry([definition({ probe })]);
    const controller = new AbortController();
    const cancelled = registry.createSnapshot(request(['test.machine'], {
      signal: controller.signal,
    }));
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = registry.createSnapshot(request(['test.machine']));
    finishProbe?.({ state: 'available' });
    await expect(next).resolves.toMatchObject({
      entries: [expect.objectContaining({ state: 'available' })],
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('retries after invalidation and rejects a late old-generation result', async () => {
    type ProbeResult = { state: 'available' }
      | { reasonCode: string; state: 'unavailable' };
    const resolvers: Array<(value: ProbeResult) => void> = [];
    const probe = vi.fn(() => new Promise<ProbeResult>((resolve) => {
      resolvers.push(resolve);
    }));
    const registry = createAgentCapabilityRegistry([definition({ probe })]);
    const pending = registry.createSnapshot(request(['test.machine']));
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    registry.invalidate({ capabilityId: 'test.machine' });
    resolvers[0]?.({ state: 'available' });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]?.({ reasonCode: 'test.no_longer_available', state: 'unavailable' });

    await expect(pending).resolves.toMatchObject({
      entries: [expect.objectContaining({
        reasonCode: 'test.no_longer_available',
        state: 'unavailable',
      })],
    });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('keeps identity stable across checkedAt changes but changes on state', () => {
    const base = {
      checkedAt: 1,
      definitionRevision: 'test@1',
      id: 'test.machine',
      scopeIdentity: 'machine-scope',
      state: 'available' as const,
    };
    const first = createAgentCapabilitySnapshot({ entries: [base], registryRevision: 1 });
    const later = createAgentCapabilitySnapshot({
      entries: [{ ...base, checkedAt: 999 }],
      registryRevision: 1,
    });
    const unavailable = createAgentCapabilitySnapshot({
      entries: [{
        ...base,
        checkedAt: 999,
        reasonCode: 'test.missing',
        state: 'unavailable',
      }],
      registryRevision: 1,
    });

    expect(later.identity).toBe(first.identity);
    expect(unavailable.identity).not.toBe(first.identity);
  });
});
