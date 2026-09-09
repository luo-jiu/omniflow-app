import { setTimeout as delay } from 'node:timers/promises';

export const AGENT_REQUEST_MAX_RETRIES = 5;
export const AGENT_RETRY_MAX_DELAY_MS = 60_000;

export function agentRetryDelayMs(attempt: number, retryAfterMs?: number, random = Math.random()): number {
  const base = Math.min(AGENT_RETRY_MAX_DELAY_MS, 5_000 * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.round(base * (0.9 + Math.max(0, Math.min(1, random)) * 0.2));
  return Math.min(AGENT_RETRY_MAX_DELAY_MS, Math.max(jittered, retryAfterMs ?? 0));
}

export function parseAgentRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  const ms = /^-?\d+(?:\.\d+)?$/u.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, AGENT_RETRY_MAX_DELAY_MS) : undefined;
}

export async function waitForAgentRetry(attempt: number, signal: AbortSignal, options: {
  delayMs?: number; retryAfterMs?: number; onRetry?: (attempt: number, maximum: number, waitMs: number) => void | Promise<void>;
  maximum?: number;
} = {}): Promise<void> {
  signal.throwIfAborted();
  const waitMs = options.delayMs === undefined ? agentRetryDelayMs(attempt, options.retryAfterMs) : options.delayMs * 2 ** (attempt - 1);
  await options.onRetry?.(attempt, options.maximum ?? AGENT_REQUEST_MAX_RETRIES, waitMs);
  signal.throwIfAborted();
  await delay(waitMs, undefined, { signal });
}

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
export async function retryBufferedAgentTransport<T>(request: () => Promise<T>, signal: AbortSignal, delayMs?: number,
  onRetry?: (attempt: number, maximum: number, waitMs: number) => void | Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    try { return await request(); }
    catch (error) {
      signal.throwIfAborted();
      if (attempt >= AGENT_REQUEST_MAX_RETRIES || !isTransientAgentTransportError(error)) throw error;
      await waitForAgentRetry(attempt + 1, signal, { delayMs, onRetry });
    }
  }
}
