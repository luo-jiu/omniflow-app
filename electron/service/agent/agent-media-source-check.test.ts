import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }));
import { assertAgentMediaSourceReadable } from './agent-media-source-check';
import { classifyAgentMediaProcessFailure, readAgentMediaError } from '../../../src/shared/agent/agent-media-error';

describe('Agent media source checks', () => {
  beforeEach(() => { mocks.fetch.mockReset(); });
  const proxy = 'http://127.0.0.1:8888/opaque-source';
  it('uses only the broker diagnostic status on an error response', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 502, headers: { 'X-OmniFlow-Source-Status': '403' } }))
      .mockResolvedValueOnce(new Response('', { status: 206, headers: { 'X-OmniFlow-Source-Status': '403' } }));
    await expect(assertAgentMediaSourceReadable(proxy, new AbortController().signal)).rejects.toMatchObject({ code: 'source_access_denied' });
    await expect(assertAgentMediaSourceReadable(proxy, new AbortController().signal)).resolves.toBeUndefined();
  });
  it('uses a bounded range and cancels the body, including servers that ignore Range', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 200 }));
    await assertAgentMediaSourceReadable(proxy, new AbortController().signal);
    expect(mocks.fetch).toHaveBeenCalledWith(proxy, expect.objectContaining({ headers: { Range: 'bytes=0-0' }, redirect: 'error' }));
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([[404, 'source_not_found'], [403, 'source_access_denied'], [502, 'source_unreachable'], [416, 'invalid_media']] as const)(
    'classifies status %s without leaking URLs or upstream response bodies', async (status, code) => {
      mocks.fetch.mockResolvedValue(new Response('secret upstream endpoint', { status }));
      const error = await assertAgentMediaSourceReadable(proxy, new AbortController().signal).catch(value => value);
      expect(error).toMatchObject({ code });
      expect(error.message).not.toContain('secret');
      expect(error.message).not.toContain('127.0.0.1');
    },
  );
  it('preserves cancellation and rejects non-claim origins before networking', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(assertAgentMediaSourceReadable(proxy, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(assertAgentMediaSourceReadable('https://example.com/source', new AbortController().signal)).rejects.toMatchObject({ code: 'source_unknown' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not return raw process diagnostics', () => {
    const error = classifyAgentMediaProcessFailure('https://secret/path?token=private: Connection refused', 8);
    expect(error.code).toBe('source_unreachable');
    expect(error.message).not.toContain('private');
    expect(classifyAgentMediaProcessFailure('Stream map 0:a:0 matches no streams', 1).code).toBe('no_audio');
    expect(classifyAgentMediaProcessFailure('Error opening output: No such file or directory', 1).code).toBe('processing_failed');
    expect(readAgentMediaError(new Error("Error invoking remote method: [source_unreachable] private endpoint"))?.message)
      .not.toContain('private endpoint');
  });
});
