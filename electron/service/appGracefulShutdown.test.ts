import { describe, expect, it, vi } from 'vitest';

import { createAppGracefulShutdown } from './appGracefulShutdown';

describe('App graceful shutdown', () => {
  it('prevents repeated quit attempts until one cleanup sequence finishes', async () => {
    let finishCleanup!: () => void;
    const pendingCleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const cleanup = vi.fn(() => pendingCleanup);
    const quit = vi.fn();
    const shutdown = createAppGracefulShutdown({
      cleanup,
      onError: vi.fn(),
      quit,
    });
    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };

    shutdown.handleBeforeQuit(firstEvent);
    shutdown.handleBeforeQuit(repeatedEvent);
    await Promise.resolve();
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    finishCleanup();
    await shutdown.waitForCleanup();
    expect(quit).toHaveBeenCalledOnce();

    const authoritativeEvent = { preventDefault: vi.fn() };
    shutdown.handleBeforeQuit(authoritativeEvent);
    expect(authoritativeEvent.preventDefault).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('reports cleanup failures and still permits the authoritative quit', async () => {
    const failure = new Error('sqlite close failed');
    const onError = vi.fn();
    const quit = vi.fn();
    const shutdown = createAppGracefulShutdown({
      cleanup: async () => { throw failure; },
      onError,
      quit,
    });
    const event = { preventDefault: vi.fn() };

    shutdown.handleBeforeQuit(event);
    await shutdown.waitForCleanup();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(quit).toHaveBeenCalledOnce();
  });
});
