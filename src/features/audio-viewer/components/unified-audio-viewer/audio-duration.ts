export function normalizeAudioDuration(value: unknown): number | null {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

export function loadAudioMetadataDuration(
  url: string,
  {
    signal,
    timeoutMs = 15_000,
    createAudio = () => new Audio(),
  }: {
    signal?: AbortSignal;
    timeoutMs?: number;
    createAudio?: () => HTMLAudioElement;
  } = {},
): Promise<number | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let audio: HTMLAudioElement;
    try {
      audio = createAudio();
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', handleError);
      audio.removeEventListener('loadedmetadata', handleMetadata);
      audio.removeEventListener('error', handleError);
      // Removing the source and reloading aborts the metadata request. Some
      // media implementations can throw during teardown; still settle callers.
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch { /* The request has already reached its terminal state. */ }
    };
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(duration);
    };
    const handleMetadata = () => finish(normalizeAudioDuration(audio.duration));
    const handleError = () => finish(null);
    const timeout = setTimeout(handleError, Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 15_000);

    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', handleMetadata);
    audio.addEventListener('error', handleError);
    signal?.addEventListener('abort', handleError, { once: true });
    if (signal?.aborted) {
      handleError();
      return;
    }
    try {
      audio.src = url;
      audio.load();
    } catch {
      finish(null);
    }
  });
}
