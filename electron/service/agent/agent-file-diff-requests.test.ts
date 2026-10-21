import { EventEmitter } from 'node:events';
import type { WebContents, WebFrameMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createAgentFileDiffRequests } from './agent-file-diff-requests';
import type { AgentFileDiffRequest, AgentFileDiffResult } from '../../../src/shared/agent/agent-file-changes';

const input = { ownerScope: { accountScope: 'user:7', backendScope: 'https://fixture.invalid' }, libraryId: 3,
  sessionId: 'session', changeId: 'change', requestId: 'cd15fe5d-1262-47c7-a59f-bd8fed0517b6' };
const frame = { processId: 1, routingId: 2 } as WebFrameMain;
function sender() { return Object.assign(new EventEmitter(), { id: 17 }) as unknown as WebContents; }
function pending() {
  let finish!: () => void;
  const execute = vi.fn((signal: AbortSignal) => new Promise<AgentFileDiffResult>((_, reject) => {
    signal.addEventListener('abort', () => { finish = () => reject(new Error('cancelled')); }, { once: true });
  }));
  return { execute, acknowledge: () => finish() };
}

describe('frame-bound diff cancellation', () => {
  it.each([undefined, null, [], 'invalid', 7])('rejects malformed request %j before scheduling work', async value => {
    const requests = createAgentFileDiffRequests(); const owner = sender(); const execute = vi.fn();
    await expect(requests.read(owner, frame, value as unknown as AgentFileDiffRequest, execute)).rejects.toThrow('差异请求范围无效');
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(owner.eventNames()).toEqual([]);
  });

  it('rejects failed metadata serialization and missing frames before scheduling work', async () => {
    const requests = createAgentFileDiffRequests(); const owner = sender(); const execute = vi.fn();
    const circular: unknown[] = []; circular.push(circular);
    await expect(requests.read(owner, frame, { ...input, sessionId: circular } as unknown as AgentFileDiffRequest, execute))
      .rejects.toThrow('差异请求范围无效');
    await expect(requests.read(owner, null as unknown as WebFrameMain, input, execute)).rejects.toThrow('差异请求范围无效');
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(owner.eventNames()).toEqual([]);
  });

  it('returns execution rejection and removes owner listeners', async () => {
    const requests = createAgentFileDiffRequests(); const owner = sender();
    const execute = vi.fn(async () => { throw new Error('read failed'); });
    await expect(requests.read(owner, frame, input, execute)).rejects.toThrow('read failed');
    expect(execute).toHaveBeenCalledOnce();
    expect(owner.eventNames()).toEqual([]);
  });

  it('prevents ID reuse and cancellation from another window, frame, owner or session', async () => {
    const requests = createAgentFileDiffRequests(); const owner = sender(); const work = pending();
    const reading = requests.read(owner, frame, input, work.execute); const rejected = expect(reading).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(work.execute).toHaveBeenCalledOnce());
    await expect(requests.read(owner, frame, input, work.execute)).rejects.toThrow('已在使用');
    expect(await requests.cancel(sender(), frame, input)).toBe(false);
    expect(await requests.cancel(owner, { ...frame } as WebFrameMain, input)).toBe(false);
    expect(await requests.cancel(owner, frame, { ...input, sessionId: 'other' })).toBe(false);
    expect(await requests.cancel(owner, frame, { ...input, ownerScope: { ...input.ownerScope, accountScope: 'user:8' } })).toBe(false);
    const cancelling = requests.cancel(owner, frame, input);
    let cancelled = false; void cancelling.then(() => { cancelled = true; });
    await Promise.resolve(); expect(cancelled).toBe(false);
    work.acknowledge(); await rejected; expect(await cancelling).toBe(true);
    expect(owner.listenerCount('did-start-navigation')).toBe(0);
  });

  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])('cancels and cleans listeners on %s', async event => {
    const requests = createAgentFileDiffRequests(); const owner = sender(); const work = pending();
    const reading = requests.read(owner, frame, input, work.execute); const rejected = expect(reading).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(work.execute).toHaveBeenCalledOnce());
    if (event === 'did-start-navigation') {
      owner.emit(event, {}, 'https://fixture.invalid', false, false);
      expect(work.execute.mock.calls[0][0].aborted).toBe(false);
      owner.emit(event, {}, 'https://fixture.invalid', false, true);
    } else owner.emit(event);
    expect(work.execute.mock.calls[0][0].aborted).toBe(true);
    work.acknowledge(); await rejected;
    expect(owner.listenerCount('destroyed')).toBe(0);
    expect(owner.listenerCount('render-process-gone')).toBe(0);
    expect(owner.listenerCount('did-start-navigation')).toBe(0);
  });
});
