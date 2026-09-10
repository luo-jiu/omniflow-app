import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('node:worker_threads', () => ({ Worker: class { constructor() { return mocks.create(); } } }));
import { runAgentDocument } from './document-runner';
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe('document worker lifecycle', () => {
  it('terminates and rejects on cancellation without returning partial output', async () => {
    const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => 0) });
    mocks.create.mockReturnValue(worker);
    const controller = new AbortController();
    const work = runAgentDocument({ format: 'pdf', operation: 'read', bytes: new Uint8Array() }, controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('terminates timed-out parsing and terminates completed workers too', async () => {
    vi.useFakeTimers();
    const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => 0) });
    mocks.create.mockReturnValue(worker);
    const work = runAgentDocument({ format: 'pdf', operation: 'read', bytes: new Uint8Array() }, new AbortController().signal);
    const rejected = expect(work).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(30000); await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const completed = runAgentDocument({ format: 'pdf', operation: 'inspect', bytes: new Uint8Array() }, new AbortController().signal);
    worker.emit('message', { result: { pageCount: 2 } });
    await expect(completed).resolves.toEqual({ pageCount: 2 });
    expect(worker.terminate).toHaveBeenCalledTimes(2);
  });
});
