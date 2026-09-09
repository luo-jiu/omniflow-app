import { setTimeout as delay } from 'node:timers/promises';

export function isTransientAgentTransportError(error: unknown): boolean {
  if (error instanceof TypeError && ['fetch failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.'].includes(error.message)) return true;
  if (!(error instanceof Error)) return false;
  // Chromium transport failures are ordinary Errors in Electron.
  return /^net::ERR_(CONNECTION_CLOSED|CONNECTION_RESET|CONNECTION_ABORTED|TIMED_OUT|NETWORK_CHANGED|EMPTY_RESPONSE|HTTP2_PROTOCOL_ERROR)$/u.test(error.message)
    || ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE'].includes(String((error as NodeJS.ErrnoException).code || ''));
}

export function canResumeInterruptedReadTurn(input: {
  error: unknown; aborted: boolean; nonReadToolAttempted: boolean; recoveries: number; hasPartialContent: boolean;
}): boolean {
  const error = input.error;
  return !input.aborted && !input.nonReadToolAttempted && input.recoveries < 2 && input.hasPartialContent
    && error instanceof Error && (isTransientAgentTransportError(error)
      || ['stream_incomplete', 'request_timeout'].includes(String((error as { code?: string }).code || '')));
}

// Only for fully buffered, side-effect-free model requests such as summaries.
export async function retryBufferedAgentTransport<T>(request: () => Promise<T>, signal: AbortSignal, delayMs = 500): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    try { return await request(); }
    catch (error) {
      signal.throwIfAborted();
      if (attempt >= 2 || !isTransientAgentTransportError(error)) throw error;
      await delay(delayMs * 2 ** attempt, undefined, { signal });
    }
  }
}
