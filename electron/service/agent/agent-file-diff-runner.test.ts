import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('node:worker_threads', () => ({ Worker: class { constructor(...args: unknown[]) { return mocks.create(...args); } } }));
import { runAgentFileDiff } from './agent-file-diff-runner';
const job = { before: 'old', after: 'new', beforeLabel: 'a/fixture', afterLabel: 'b/fixture', pageLines: 200 };
const result = { pages: [{ patch: '-old\n+new\n', startLine: 1, endLine: 2, continuedFromPrevious: false, continuesOnNext: false }], totalLines: 2, truncated: false };
function worker() {
  const value = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => 0) });
  mocks.create.mockReturnValue(value); return value;
}
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('restricted diff worker lifecycle', () => {
  it('uses the packaged sibling worker entry with bounded heap and awaits termination after success', async () => {
    const child = worker(); let release!: (code: number) => void;
    child.terminate.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const work = runAgentFileDiff(job, new AbortController().signal);
    expect(mocks.create.mock.calls[0][0].pathname).toMatch(/\/agent-file-diff-worker\.js$/u);
    expect(mocks.create.mock.calls[0][1]).toMatchObject({ workerData: job, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    let finished = false; void work.then(() => { finished = true; });
    child.emit('message', { result });
    await Promise.resolve(); expect(finished).toBe(false);
    release(0); await expect(work).resolves.toEqual(result);
    expect(child.terminate).toHaveBeenCalledOnce();
  });

  it('cancels without accepting late output and waits for actual worker termination', async () => {
    const child = worker(); let release!: (code: number) => void;
    child.terminate.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const controller = new AbortController();
    const work = runAgentFileDiff(job, controller.signal);
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); child.emit('message', { result });
    expect(child.terminate).toHaveBeenCalledOnce();
    release(1); await rejected;
    const alreadyCancelled = new AbortController(); alreadyCancelled.abort();
    expect(() => runAgentFileDiff(job, alreadyCancelled.signal)).toThrow();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('terminates on the hard deadline, unexpected exit and invalid output', async () => {
    vi.useFakeTimers();
    const child = worker();
    const work = runAgentFileDiff(job, new AbortController().signal);
    const rejected = expect(work).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(child.terminate).toHaveBeenCalledOnce();
    const invalid = runAgentFileDiff(job, new AbortController().signal);
    child.emit('message', { result: { ...result, pages: [{ ...result.pages[0], patch: 'x'.repeat(32 * 1024 + 1) }] } });
    await expect(invalid).rejects.toThrow('无效或超限');
    const exited = runAgentFileDiff(job, new AbortController().signal);
    child.emit('exit', 1); await expect(exited).rejects.toThrow('提前退出');
  });
});
