import { describe, expect, it, vi } from 'vitest';
import { canResumeInterruptedReadTurn, isTransientAgentTransportError, retryBufferedAgentTransport } from './agent-transport-retry';

describe('buffered summary transport retry', () => {
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
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('aborts the backoff without another request', async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => { controller.abort(); throw new Error('net::ERR_CONNECTION_CLOSED'); });
    await expect(retryBufferedAgentTransport(request, controller.signal, 1000)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });
});
