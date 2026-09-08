import { net } from 'electron';
import { AgentMediaError } from '../../../src/shared/agent/agent-media-error';

/** Probe only an already-issued local media claim; never accept arbitrary URLs here. */
export async function assertAgentMediaSourceReadable(proxyUrl: string, signal: AbortSignal): Promise<void> {
  const url = new URL(proxyUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new AgentMediaError('source_unknown');
  }
  signal.throwIfAborted();
  try {
    const response = await net.fetch(proxyUrl, {
      method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    await response.body?.cancel();
    const upstreamStatus = Number(response.headers.get('X-OmniFlow-Source-Status'));
    const status = response.status === 502 && [401, 403, 404, 416].includes(upstreamStatus)
      ? upstreamStatus : response.status;
    if (status === 404) throw new AgentMediaError('source_not_found');
    if (status === 401 || status === 403) throw new AgentMediaError('source_access_denied');
    if (status === 416) throw new AgentMediaError('invalid_media');
    if (response.status !== 200 && response.status !== 206) throw new AgentMediaError('source_unreachable');
    signal.throwIfAborted();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AgentMediaError) throw error;
    throw new AgentMediaError('source_unreachable');
  }
}
