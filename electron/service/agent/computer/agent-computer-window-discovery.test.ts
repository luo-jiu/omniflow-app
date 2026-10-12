import { describe, expect, it, vi } from 'vitest';

import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import type { AgentToolMainPreparationIdentity } from '../agent-tool-registry';
import { createAgentComputerWindowDiscovery, type AgentComputerWindowDiscoveryContext,
  type AgentComputerWindowDiscoveryDependencies } from './agent-computer-window-discovery';

function identity(overrides: Partial<AgentToolMainPreparationIdentity> = {}): AgentToolMainPreparationIdentity {
  return { aiDestinationIdentity: 'destination-1', callId: 'call-list', libraryId: 3,
    ownerScope: { accountScope: 'user:7', backendScope: 'http://localhost:9000' }, ownerWebContentsId: 17,
    preparedActionId: 'prepared-list', runCapabilityIdentity: 'capability-1', runId: 'run-1', sessionId: 'session-1',
    toolInputHash: 'input-1', toolName: 'computer.windows', toolRegistrationId: 'computer.windows@1', toolRunId: 'tool-list',
    ...overrides };
}

function window(overrides: Partial<AgentComputerSharedWindow> = {}): AgentComputerSharedWindow {
  return { windowId: 24, pid: 800, processStartedAt: 1_770_000_000_000, layer: 0,
    bounds: { x: -1920, y: 20, width: 1920, height: 1200 }, title: 'Fixture window',
    applicationLabel: 'Finder', windowLabel: '测试窗口', ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function fixture(initial = [window()]) {
  const controller = new AbortController();
  const context: AgentComputerWindowDiscoveryContext = { identity: identity(), signal: controller.signal };
  let current = structuredClone(initial);
  let truncated = false;
  let time = 0;
  const dependencies = {
    windows: vi.fn<AgentComputerWindowDiscoveryDependencies['windows']>(async () => ({ windows: structuredClone(current), truncated })),
    now: () => time,
  };
  const discovery = createAgentComputerWindowDiscovery(dependencies);
  const firstRef = async () => (await discovery.list({}, context)).windows[0].windowRef;
  return { controller, context, dependencies, discovery, firstRef,
    setWindows: (windows: AgentComputerSharedWindow[], incomplete = false) => { current = structuredClone(windows); truncated = incomplete; },
    advance: (milliseconds: number) => { time += milliseconds; } };
}

describe('main-owned searchable window discovery', () => {
  it('returns only public labels and an opaque reference without capturing or granting input', async () => {
    const f = fixture();
    const result = await f.discovery.list({}, f.context);
    expect(result).toEqual({ truncated: false, windows: [{ applicationLabel: 'Finder', windowLabel: '测试窗口',
      windowRef: expect.stringMatching(/^[a-f0-9-]{36}$/u) }] });
    expect(Object.keys(result.windows[0]).sort()).toEqual(['applicationLabel', 'windowLabel', 'windowRef']);
    expect(f.dependencies.windows).toHaveBeenCalledTimes(1);
    expect(f.dependencies.windows).toHaveBeenCalledWith(f.controller.signal);
  });

  it('filters application and window labels by case-insensitive substrings', async () => {
    const f = fixture([
      window({ applicationLabel: 'WebStorm', windowLabel: 'OmniFlow App' }),
      window({ windowId: 25, applicationLabel: 'Safari', windowLabel: 'OmniFlow Docs' }),
      window({ windowId: 26, applicationLabel: 'WebStorm', windowLabel: 'Other Project' }),
    ]);
    expect((await f.discovery.list({ query: 'omnIFLow' }, f.context)).windows.map(item => item.windowLabel))
      .toEqual(['OmniFlow App', 'OmniFlow Docs']);
    expect((await f.discovery.list({ query: 'storm' }, f.context)).windows).toHaveLength(2);
    expect((await f.discovery.list({ application: 'WEB', query: 'app' }, f.context)).windows.map(item => item.windowLabel))
      .toEqual(['OmniFlow App']);
    expect((await f.discovery.list({ query: '不存在' }, f.context)).windows).toEqual([]);
  });

  it('keeps equal labels distinguishable without exposing native identifiers', async () => {
    const first = window();
    const second = window({ windowId: 25 });
    const f = fixture([first, second]);
    const result = await f.discovery.list({}, f.context);
    expect(result.windows).toHaveLength(2);
    expect(result.windows[0].windowRef).not.toBe(result.windows[1].windowRef);
    expect(await f.discovery.resolve(result.windows[0].windowRef, f.context)).toEqual(first);
    expect(await f.discovery.resolve(result.windows[1].windowRef, f.context)).toEqual(second);
  });

  it('keeps references stable across filtered lists and per-call preparation identities', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    expect((await f.discovery.list({ application: 'find' }, f.context)).windows[0].windowRef).toBe(ref);
    const nextCall = { ...f.context, identity: identity({ toolName: 'computer.observe', toolRegistrationId: 'computer.observe@1',
      toolInputHash: 'input-observe', toolRunId: 'observe-1', callId: 'observe-1', preparedActionId: 'observe-prepared' }) };
    expect(await f.discovery.resolve(ref, nextCall)).toEqual(window());
  });

  it('preserves source truncation even when the filtered result is short or empty', async () => {
    const f = fixture();
    f.setWindows([window()], true);
    expect(await f.discovery.list({ query: 'missing' }, f.context)).toEqual({ windows: [], truncated: true });
    const result = await f.discovery.list({}, f.context);
    expect(result.truncated).toBe(true);
    expect(await f.discovery.resolve(result.windows[0].windowRef, f.context)).toEqual(window());
  });

  it('bounds both one result and retained references to 64 windows', async () => {
    const f = fixture(Array.from({ length: 65 }, (_, index) => window({ windowId: index + 1, windowLabel: `Window ${index}` })));
    const result = await f.discovery.list({}, f.context);
    expect(result.windows).toHaveLength(64);
    expect(result.truncated).toBe(true);
    const references = result.windows.map(item => item.windowRef);
    f.setWindows([window({ windowId: 66, windowLabel: 'New window' })], true);
    const narrow = await f.discovery.list({}, f.context);
    expect(narrow.windows).toHaveLength(1);
    expect(narrow.truncated).toBe(true);
    await expect(f.discovery.resolve(references[0], f.context)).rejects.toThrow('失效');
    f.setWindows([window({ windowId: 66, windowLabel: 'New window' })]);
    const next = await f.discovery.list({}, f.context);
    expect(next.windows).toHaveLength(1);
    expect(next.truncated).toBe(false);
    for (const ref of references) await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('失效');
  });

  it('discovers the 65th window through a narrow query and retires the oldest unused reference', async () => {
    const f = fixture(Array.from({ length: 65 }, (_, index) => window({ windowId: index + 1, windowLabel: `Window ${index}` })));
    const initial = await f.discovery.list({}, f.context);
    const narrow = await f.discovery.list({ query: 'Window 64' }, f.context);
    expect(narrow.windows).toHaveLength(1);
    expect(narrow.truncated).toBe(false);
    expect(narrow.windows[0].windowLabel).toBe('Window 64');
    expect((await f.discovery.resolve(narrow.windows[0].windowRef, f.context)).windowId).toBe(65);
    await expect(f.discovery.resolve(initial.windows[0].windowRef, f.context)).rejects.toThrow('失效');
    expect((await f.discovery.resolve(initial.windows[1].windowRef, f.context)).windowId).toBe(2);
  });

  it('uses recent resolutions when choosing which unused discovery reference to retire', async () => {
    const f = fixture(Array.from({ length: 65 }, (_, index) => window({ windowId: index + 1, windowLabel: `Window ${index}` })));
    const initial = await f.discovery.list({}, f.context);
    await f.discovery.resolve(initial.windows[0].windowRef, f.context);
    await f.discovery.list({ query: 'Window 64' }, f.context);
    await expect(f.discovery.resolve(initial.windows[1].windowRef, f.context)).rejects.toThrow('失效');
    expect((await f.discovery.resolve(initial.windows[0].windowRef, f.context)).windowId).toBe(1);
  });

  it('bounds concurrent Run state and frees capacity after release', async () => {
    const f = fixture();
    for (let index = 0; index < 32; index++) {
      await f.discovery.list({}, { ...f.context, identity: identity({ runId: `run-${index}` }) });
    }
    const extra = { ...f.context, identity: identity({ runId: 'run-extra' }) };
    await expect(f.discovery.list({}, extra)).rejects.toThrow('上限');
    expect(f.dependencies.windows).toHaveBeenCalledTimes(32);
    f.discovery.releaseRun('run-0');
    expect((await f.discovery.list({}, extra)).windows).toHaveLength(1);
  });

  it.each([
    { runId: 'other-run' }, { sessionId: 'other-session' }, { libraryId: 4 }, { ownerWebContentsId: 18 },
    { ownerScope: { accountScope: 'user:8', backendScope: 'http://localhost:9000' } },
    { ownerScope: { accountScope: 'user:7', backendScope: 'http://other-backend:9000' } },
    { aiDestinationIdentity: 'destination-2' }, { runCapabilityIdentity: 'capability-2' },
  ])('rejects a reference outside its Run identity: %j', async changed => {
    const f = fixture();
    const ref = await f.firstRef();
    await expect(f.discovery.resolve(ref, { ...f.context, identity: identity(changed) })).rejects.toThrow(/失效|身份/u);
    expect(f.dependencies.windows).toHaveBeenCalledTimes(1);
    expect(await f.discovery.resolve(ref, f.context)).toEqual(window());
  });

  it('never replaces an active Run with a mismatching identity through list', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    await expect(f.discovery.list({}, { ...f.context, identity: identity({ aiDestinationIdentity: 'other' }) })).rejects.toThrow('身份');
    expect(await f.discovery.resolve(ref, f.context)).toEqual(window());
  });

  it.each([
    { pid: 801 }, { processStartedAt: 1_770_000_000_001 }, { layer: 1 }, { title: 'New title' },
    { applicationLabel: 'Other application' }, { windowLabel: 'New label' },
    { bounds: { x: -1919, y: 20, width: 1920, height: 1200 } },
    { bounds: { x: -1920, y: 21, width: 1920, height: 1200 } },
    { bounds: { x: -1920, y: 20, width: 1919, height: 1200 } },
    { bounds: { x: -1920, y: 20, width: 1920, height: 1199 } },
  ])('invalidates changed window metadata rather than retargeting the old reference: %j', async changed => {
    const f = fixture();
    const ref = await f.firstRef();
    f.setWindows([window(changed)]);
    await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('变化');
    f.setWindows([window()]);
    await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('失效');
    expect(await f.firstRef()).not.toBe(ref);
  });

  it('rejects a missing or duplicated native window rather than guessing', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    f.setWindows([]);
    await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('变化');
    f.setWindows([window()]);
    const next = await f.firstRef();
    f.setWindows([window(), window()]);
    await expect(f.discovery.resolve(next, f.context)).rejects.toThrow('变化');
  });

  it('removes stale references when a refreshed list detects moved or closed windows', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    f.setWindows([window({ title: 'Changed title' })]);
    const next = await f.firstRef();
    expect(next).not.toBe(ref);
    await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('失效');
    f.setWindows([]);
    await f.discovery.list({}, f.context);
    await expect(f.discovery.resolve(next, f.context)).rejects.toThrow('失效');
  });

  it('does not issue discovery references for non-actionable window identities', async () => {
    const f = fixture([window({ processStartedAt: 0 }), window({ windowId: 25, pid: 0 }),
      window({ windowId: 26, layer: 1 }), window({ windowId: 27, bounds: { x: 0, y: 0, width: 0, height: 30 } })]);
    expect(await f.discovery.list({}, f.context)).toEqual({ windows: [], truncated: false });
  });

  it('returns copies so callers cannot mutate the private frozen window identity', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    const resolved = await f.discovery.resolve(ref, f.context);
    resolved.pid = 999;
    resolved.bounds.width = 1;
    expect(await f.discovery.resolve(ref, f.context)).toEqual(window());
  });

  it('does not retain a cancelled list result even when metadata returns late', async () => {
    const f = fixture();
    const wait = deferred<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>();
    f.dependencies.windows.mockReturnValueOnce(wait.promise);
    const pending = f.discovery.list({}, f.context);
    f.controller.abort();
    wait.resolve({ windows: [window()], truncated: false });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const next = { ...f.context, signal: new AbortController().signal };
    expect((await f.discovery.list({}, next)).windows).toHaveLength(1);
  });

  it('rejects cancellation before metadata access and during reference resolution', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    const wait = deferred<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>();
    f.dependencies.windows.mockReturnValueOnce(wait.promise);
    const pending = f.discovery.resolve(ref, f.context);
    f.controller.abort();
    wait.resolve({ windows: [window()], truncated: false });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(f.discovery.list({}, f.context)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.dependencies.windows).toHaveBeenCalledTimes(2);
  });

  it('invalidates references on release and refuses the result of an in-flight list', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    const wait = deferred<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>();
    f.dependencies.windows.mockReturnValueOnce(wait.promise);
    const pending = f.discovery.list({}, f.context);
    f.discovery.releaseRun('run-1');
    const nextRef = await f.firstRef();
    wait.resolve({ windows: [window()], truncated: false });
    await expect(pending).rejects.toThrow('失效');
    expect(nextRef).not.toBe(ref);
    await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('失效');
    expect(await f.discovery.resolve(nextRef, f.context)).toEqual(window());
  });

  it('refuses in-flight resolution after release', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    const wait = deferred<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>();
    f.dependencies.windows.mockReturnValueOnce(wait.promise);
    const pending = f.discovery.resolve(ref, f.context);
    f.discovery.releaseRun('run-1');
    wait.resolve({ windows: [window()], truncated: false });
    await expect(pending).rejects.toThrow('失效');
  });

  it('expires abandoned Run references and lets later discovery start cleanly', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    f.advance(10 * 60_000);
    await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('失效');
    expect(await f.firstRef()).not.toBe(ref);
  });

  it('disposes all references and refuses late or future results', async () => {
    const f = fixture();
    const ref = await f.firstRef();
    const wait = deferred<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>();
    f.dependencies.windows.mockReturnValueOnce(wait.promise);
    const pending = f.discovery.list({}, f.context);
    f.discovery.dispose();
    wait.resolve({ windows: [window()], truncated: false });
    await expect(pending).rejects.toThrow('失效');
    await expect(f.discovery.resolve(ref, f.context)).rejects.toThrow('结束');
    await expect(f.discovery.list({}, f.context)).rejects.toThrow('结束');
  });

  it('does not leak Run slots when metadata fails or a search finds no windows', async () => {
    const f = fixture();
    for (let index = 0; index < 40; index++) {
      const context = { ...f.context, identity: identity({ runId: `empty-${index}` }) };
      if (index % 2) {
        f.dependencies.windows.mockRejectedValueOnce(new Error('metadata failed'));
        await expect(f.discovery.list({}, context)).rejects.toThrow('metadata failed');
      } else expect((await f.discovery.list({ query: 'missing' }, context)).windows).toEqual([]);
    }
    expect((await f.discovery.list({}, f.context)).windows).toHaveLength(1);
  });

  it('rejects oversized search conditions and malformed references before metadata access', async () => {
    const f = fixture();
    await expect(f.discovery.list({ query: '界'.repeat(201) }, f.context)).rejects.toThrow('标识或名称');
    await expect(f.discovery.list({ application: 'a'.repeat(201) }, f.context)).rejects.toThrow('标识或名称');
    await expect(f.discovery.resolve('window:24', f.context)).rejects.toThrow('引用无效');
    expect(f.dependencies.windows).not.toHaveBeenCalled();
  });

  it('uses the canonical 200-codepoint boundary for multibyte search text', async () => {
    const f = fixture();
    expect((await f.discovery.list({ query: '界'.repeat(200) }, f.context)).windows).toEqual([]);
    expect((await f.discovery.list({ application: '😀'.repeat(200) }, f.context)).windows).toEqual([]);
    await expect(f.discovery.list({ query: '😀'.repeat(201) }, f.context)).rejects.toThrow('标识或名称');
  });

  it.each(['', ' Finder', 'Finder ', 'Find\ner', 'Find\u202eer', 'Find\u2066er', '\ud800'])(
    'rejects noncanonical search text rather than silently rewriting it: %j', async query => {
    const f = fixture();
    await expect(f.discovery.list({ query }, f.context)).rejects.toThrow('标识或名称');
    expect(f.dependencies.windows).not.toHaveBeenCalled();
    });
});
