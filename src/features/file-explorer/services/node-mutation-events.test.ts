import { expect, it, vi } from 'vitest';
import { consumeLibraryNodeMutationDirty, notifyLibraryNodesMutated, subscribeLibraryNodesMutated } from './node-mutation-events';
vi.mock('@/utils/runtimeLogger', () => ({ runtimeLogger: { warn: vi.fn() } }));

it('isolates failing listeners and invalidates only the exact inactive tree scope', async () => {
  const disposeThrow = subscribeLibraryNodesMutated(() => { throw new Error('refresh'); });
  const disposeReject = subscribeLibraryNodesMutated(async () => { throw new Error('refresh'); });
  const listener = vi.fn();
  const dispose = subscribeLibraryNodesMutated(listener);
  const event = { accountScope: 'user:71', backendScope: 'https://backend.invalid', libraryId: 3, affectedParentIds: [9] };
  expect(() => notifyLibraryNodesMutated(event)).not.toThrow();
  await Promise.resolve();
  expect(listener).toHaveBeenCalledWith(event);
  expect(consumeLibraryNodeMutationDirty('user:72', event.backendScope, 3)).toBe(false);
  expect(consumeLibraryNodeMutationDirty(event.accountScope, 'https://other.invalid', 3)).toBe(false);
  expect(consumeLibraryNodeMutationDirty(event.accountScope, event.backendScope, 4)).toBe(false);
  expect(consumeLibraryNodeMutationDirty(event.accountScope, event.backendScope, 3)).toBe(true);
  expect(consumeLibraryNodeMutationDirty(event.accountScope, event.backendScope, 3)).toBe(false);
  disposeThrow(); disposeReject(); dispose();
  notifyLibraryNodesMutated(event);
  expect(listener).toHaveBeenCalledTimes(1);
});
