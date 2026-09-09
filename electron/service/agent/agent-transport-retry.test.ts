import { describe, expect, it, vi } from 'vitest';
import { agentRetryDelayMs, parseAgentRetryAfter, waitForAgentRetry, canResumeInterruptedReadTurn, isTransientAgentTransportError, retryBufferedAgentTransport } from './agent-transport-retry';

describe('buffered summary transport retry', () => {
  it('uses jittered long backoff and caps server advice', () => {
    expect([1, 2, 3, 4, 5].map(attempt => agentRetryDelayMs(attempt, undefined, 0.5)))
      .toEqual([5000, 10000, 20000, 40000, 60000]);
    expect(agentRetryDelayMs(1, 25000, 0)).toBe(25000);
    expect(agentRetryDelayMs(5, 120000, 1)).toBe(60000);
    expect(parseAgentRetryAfter('25')).toBe(25000);
    expect(parseAgentRetryAfter('900')).toBe(60000);
    expect(parseAgentRetryAfter('Wed, 09 Sep 2026 00:00:25 GMT', Date.parse('2026-09-09T00:00:00Z'))).toBe(25000);
    expect(parseAgentRetryAfter('invalid')).toBeUndefined();
    expect(parseAgentRetryAfter('-2')).toBeUndefined();
    expect(parseAgentRetryAfter('-2', 0)).toBeUndefined();
  });
  it('reports the planned wait and can cancel before or during backoff', async () => {
    const before = new AbortController();
    const onRetry = vi.fn(() => before.abort());
    await expect(waitForAgentRetry(1, before.signal, { retryAfterMs: 25000, onRetry })).rejects.toMatchObject({ name: 'AbortError' });
    expect(onRetry).toHaveBeenCalledWith(1, 5, 25000);
    const during = new AbortController();
    const wait = waitForAgentRetry(1, during.signal, { delayMs: 10000 });
    const rejected = expect(wait).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 10));
    during.abort();
    await rejected;
  });
  it('does not classify programming TypeErrors as network failures', () => {
    expect(isTransientAgentTransportError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isTransientAgentTransportError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientAgentTransportError(new TypeError('Failed to fetch'))).toBe(true);
  });
  it('never resumes after a non-read attempt, cancellation, or exhausted continuations', () => {
    const base = { error: new Error('net::ERR_CONNECTION_CLOSED'), aborted: false, nonReadToolAttempted: false,
      recoveries: 0, hasPartialContent: true };
    expect(canResumeInterruptedReadTurn(base)).toBe(true);
    expect(canResumeInterruptedReadTurn({ ...base, nonReadToolAttempted: true })).toBe(false);
    expect(canResumeInterruptedReadTurn({ ...base, aborted: true })).toBe(false);
    expect(canResumeInterruptedReadTurn({ ...base, recoveries: 2 })).toBe(false);
    expect(canResumeInterruptedReadTurn({ ...base, hasPartialContent: false })).toBe(false);
    expect(canResumeInterruptedReadTurn({ ...base, error: new Error('net::ERR_CERT_AUTHORITY_INVALID') })).toBe(false);
  });
  it('retries a closed summary connection without exposing partial output', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('net::ERR_CONNECTION_CLOSED')).mockResolvedValueOnce('whole summary');
    expect(await retryBufferedAgentTransport(request, new AbortController().signal, 0)).toBe('whole summary');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not retry schema failures and caps repeated network failures', async () => {
    const request = vi.fn().mockRejectedValue(new Error('invalid JSON'));
    await expect(retryBufferedAgentTransport(request, new AbortController().signal, 0)).rejects.toThrow('invalid JSON');
    expect(request).toHaveBeenCalledOnce();
    request.mockClear().mockRejectedValue(new Error('net::ERR_CONNECTION_CLOSED'));
    await expect(retryBufferedAgentTransport(request, new AbortController().signal, 0)).rejects.toThrow('CONNECTION_CLOSED');
    expect(request).toHaveBeenCalledTimes(6);
  });
  it('aborts the backoff without another request', async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => { controller.abort(); throw new Error('net::ERR_CONNECTION_CLOSED'); });
    await expect(retryBufferedAgentTransport(request, controller.signal, 1000)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });
});
