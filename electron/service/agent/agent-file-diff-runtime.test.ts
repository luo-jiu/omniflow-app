import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentFileDiffRuntime, type AgentFileDiffSource } from './agent-file-diff-runtime';
import { computeAgentFileDiff } from './agent-file-diff-engine';

const source = (key = 'owner/library/session/change/snapshot-revisions/operation'): AgentFileDiffSource => ({ key,
  result: { path: '/fixture.txt', scope: 'library', state: 'committed', available: true, patch: '', truncated: false, baseline: 'operation' },
  job: { before: '', after: 'first\nsecond\nthird\n', beforeLabel: 'a/fixture', afterLabel: 'b/fixture' } });
const runtimes: ReturnType<typeof createAgentFileDiffRuntime>[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.close())); vi.useRealTimers(); });
function fixture() {
  let now = 0;
  const run = vi.fn(async (job: Parameters<typeof computeAgentFileDiff>[0], signal: AbortSignal) => {
    signal.throwIfAborted(); return computeAgentFileDiff(job);
  });
  const runtime = createAgentFileDiffRuntime({ run, clock: () => now }); runtimes.push(runtime);
  return { runtime, run, advance: (duration: number) => { now += duration; } };
}

describe('main-owned diff paging and lifetimes', () => {
  it('loads verified bodies only for the first page, rechecks scope on every page and never recomputes a cached page', async () => {
    const f = fixture();
    const load = vi.fn(async () => source());
    const first = await f.runtime.read(load, { pageLines: 2 });
    const second = await f.runtime.read(load, { pageLines: 2, cursor: first.page!.nextCursor });
    expect(load.mock.calls).toHaveLength(2);
    expect(load).toHaveBeenNthCalledWith(1, expect.any(AbortSignal), true);
    expect(load).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), false);
    expect(f.run).toHaveBeenCalledOnce();
    expect(second.page!.index).toBe(1); expect(second.page!.previousCursor).toBeDefined();
    const back = await f.runtime.read(load, { pageLines: 2, cursor: second.page!.previousCursor });
    expect(back.patch).toBe(first.patch);
  });

  it('binds cursors to owner, revisions, variant and page size, with explicit expiry instead of current-file fallback', async () => {
    const f = fixture(); const load = async () => source();
    const first = await f.runtime.read(load, { pageLines: 2 });
    const cursor = first.page!.nextCursor!;
    for (const key of ['another-owner', 'another-snapshot-revision', 'run-instead-of-operation']) {
      await expect(f.runtime.read(async () => source(key), { pageLines: 2, cursor })).rejects.toThrow('范围已变化');
    }
    await expect(f.runtime.read(load, { pageLines: 3, cursor })).rejects.toThrow('范围已变化');
    await expect(f.runtime.read(load, { pageLines: 2, cursor: cursor.replace(/:[0-9]+$/u, ':999999') })).rejects.toThrow('首屏');
    f.advance(60_001);
    await expect(f.runtime.read(load, { pageLines: 2, cursor })).rejects.toThrow('已过期');
    expect(f.run).toHaveBeenCalledOnce();
  });

  it('evicts bounded cached results and preserves unavailable history without starting a worker', async () => {
    const f = fixture(); const first = await f.runtime.read(async () => source('first'), { pageLines: 2 });
    for (let index = 0; index < 4; index += 1) await f.runtime.read(async () => source(`next-${index}`), { pageLines: 2 });
    await expect(f.runtime.read(async () => source('first'), { pageLines: 2, cursor: first.page!.nextCursor })).rejects.toThrow('已过期');
    const unavailable = source(); unavailable.result.available = false; unavailable.job = undefined;
    expect(await f.runtime.read(async () => unavailable, {})).toEqual(unavailable.result);
    expect(f.run).toHaveBeenCalledTimes(5);
  });

  it('bounds concurrent reads and waits for cancelled work to finish during close', async () => {
    let finish!: () => void;
    const run = vi.fn((_job, signal: AbortSignal) => new Promise<ReturnType<typeof computeAgentFileDiff>>((_, reject) => {
      signal.addEventListener('abort', () => { finish = () => reject(new Error('stopped')); }, { once: true });
    }));
    const runtime = createAgentFileDiffRuntime({ run }); runtimes.push(runtime);
    const a = runtime.read(async () => source(), {}); const b = runtime.read(async () => source(), {});
    const settled = Promise.allSettled([a, b]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await expect(runtime.read(async () => source(), {})).rejects.toThrow('繁忙');
    // Use independent cancellation acknowledgments, just as worker.terminate promises.
    const acknowledgments: (() => void)[] = [];
    run.mock.calls.forEach(([, signal]) => signal.addEventListener('abort', () => acknowledgments.push(finish), { once: true }));
    let closed = false; const close = runtime.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    acknowledgments.forEach(acknowledge => acknowledge());
    await settled; await close; expect(closed).toBe(true);
    await expect(runtime.read(async () => source(), {})).rejects.toThrow('已关闭');
  });
});
