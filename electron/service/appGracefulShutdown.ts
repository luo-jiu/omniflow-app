interface AppBeforeQuitEvent {
  preventDefault: () => void;
}

interface AppGracefulShutdownOptions {
  cleanup: () => Promise<void>;
  onError: (error: unknown) => void;
  quit: () => void;
}

export function createAppGracefulShutdown(
  options: AppGracefulShutdownOptions,
) {
  let cleanupComplete = false;
  let cleanupPromise: Promise<void> | null = null;

  function handleBeforeQuit(event: AppBeforeQuitEvent): void {
    if (cleanupComplete) return;
    event.preventDefault();
    if (cleanupPromise) return;

    cleanupPromise = Promise.resolve()
      .then(options.cleanup)
      .catch((error) => {
        try {
          options.onError(error);
        } catch {
          // Logging must not prevent the second, authoritative quit attempt.
        }
      })
      .finally(() => {
        cleanupComplete = true;
        options.quit();
      });
  }

  async function waitForCleanup(): Promise<void> {
    await cleanupPromise;
  }

  return {
    handleBeforeQuit,
    waitForCleanup,
  };
}
