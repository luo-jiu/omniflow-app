import { describe, expect, it, vi } from 'vitest';
import type { FirstPartyControlRequest, FirstPartyControlSnapshot } from '@/shared/computer-use/first-party-control-contract';
import { createFirstPartyControlsRuntime, FIRST_PARTY_REQUEST_LIMIT, registerFirstPartyLocalControls } from './first-party-controls';

const context = { ownerScope: { accountScope: 'user:7', backendScope: 'http://127.0.0.1:8850/api' }, libraryId: 3, sessionId: '11111111-1111-4111-8111-111111111111' };
const token = { registrationId: '22222222-2222-4222-8222-222222222222', documentGeneration: '33333333-3333-4333-8333-333333333333' };
const instanceId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
function snapshot(): FirstPartyControlSnapshot {
  return { controlId: 'agent-composer', instanceId, revision: 1, bounds: { x: 10, y: 20, width: 200, height: 80 },
    operations: ['replaceText', 'insertText'], state: { kind: 'text', selectionStart: 0, selectionEnd: 0, textLength: 0 } };
}
let nonce = 0;
function request(kind: 'observe' | 'verify' | 'dispatch', overrides: Record<string, unknown> = {}): FirstPartyControlRequest {
  return { ...token, context, runId, expiresAt: 15_000, requestId: `66666666-6666-4666-8666-${(++nonce).toString(16).padStart(12, '0')}`,
    kind, ...(kind === 'observe' ? {} : { snapshot: snapshot(), operation: 'replaceText', ...(kind === 'dispatch' ? { text: '中文😀' } : {}) }),
    ...overrides } as FirstPartyControlRequest;
}
function fixture() {
  let time = 10_000; let current = true; let observed = snapshot();
  const apply = vi.fn((_request: FirstPartyControlRequest, beginApply: () => void) => { beginApply(); return true; });
  const runtime = createFirstPartyControlsRuntime({ token, context, instanceId, now: () => time, isCurrent: () => current,
    controls: { 'agent-composer': { getSnapshot: () => observed, apply } } });
  return { runtime, apply, change: (value: FirstPartyControlSnapshot) => { observed = value; }, expire: () => { time = 16_000; }, invalidate: () => { current = false; } };
}

describe('first-party local request dispatcher', () => {
  it('returns only bounded control metadata and applies a validated request once', () => {
    const { runtime, apply } = fixture();
    const observation = runtime.handle(request('observe'));
    expect(observation).toMatchObject({ status: 'observed', controls: [snapshot()] });
    expect(observation).not.toHaveProperty('text');
    expect(runtime.handle(request('verify'))?.status).toBe('verified');
    const dispatch = request('dispatch');
    expect(runtime.handle(dispatch)?.status).toBe('applied');
    expect(runtime.handle(dispatch)?.status).toBe('rejected');
    expect(apply).toHaveBeenCalledOnce();
  });
  it('rejects expired, changed-scope, stale-draft and closed registrations before mutation', () => {
    const old = fixture(); old.expire();
    expect(old.runtime.handle(request('dispatch'))?.status).toBe('rejected'); expect(old.apply).not.toHaveBeenCalled();
    const scoped = fixture();
    expect(scoped.runtime.handle(request('dispatch', { context: { ...context, libraryId: 4 } }))?.status).toBe('rejected');
    expect(scoped.runtime.handle(request('dispatch', { documentGeneration: '77777777-7777-4777-8777-777777777777' }))).toBeUndefined();
    scoped.change({ ...snapshot(), revision: 2 });
    expect(scoped.runtime.handle(request('dispatch'))?.status).toBe('rejected');
    scoped.runtime.close();
    expect(scoped.runtime.handle(request('dispatch'))?.status).toBe('rejected'); expect(scoped.apply).not.toHaveBeenCalled();
  });
  it('rejects malformed text, arbitrary controls and unexpected fields without answering or applying', () => {
    const { runtime, apply } = fixture();
    expect(runtime.handle(request('dispatch', { text: '\u0000' }))).toBeUndefined();
    expect(runtime.handle(request('dispatch', { snapshot: { ...snapshot(), controlId: '__proto__' } }))).toBeUndefined();
    expect(runtime.handle({ ...request('observe'), text: 'leak' })).toBeUndefined();
    expect(runtime.handle({ ...request('observe'), execute: 'arbitrary' })).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });
  it('settles pre-apply exceptions as rejected and any post-boundary exception as unknown', () => {
    const before = fixture(); before.apply.mockImplementation(() => { throw new Error('private text'); });
    expect(before.runtime.handle(request('dispatch'))?.status).toBe('rejected');
    const after = fixture(); after.apply.mockImplementation((_request, beginApply) => { beginApply(); throw new Error('private text'); });
    const receipt = after.runtime.handle(request('dispatch'));
    expect(receipt?.status).toBe('unknown'); expect(JSON.stringify(receipt)).not.toContain('private text');
    const lost = fixture(); lost.apply.mockImplementation((_request, beginApply) => { beginApply(); return false; });
    expect(lost.runtime.handle(request('dispatch'))?.status).toBe('unknown');
  });
  it('keeps live nonces rather than evicting them to admit replays', () => {
    const { runtime, apply } = fixture();
    for (let i = 0; i < FIRST_PARTY_REQUEST_LIMIT; i++) expect(runtime.handle(request('observe'))?.status).toBe('observed');
    expect(runtime.handle(request('dispatch'))?.status).toBe('rejected'); expect(apply).not.toHaveBeenCalled();
  });
  it('checks the live context again immediately before the callback mutation', () => {
    const { runtime, apply, invalidate } = fixture();
    apply.mockImplementation((_request, beginApply) => { invalidate(); beginApply(); return true; });
    expect(runtime.handle(request('dispatch'))?.status).toBe('rejected');
  });
});

describe('first-party registration lifecycle', () => {
  it('releases a request listener if registration fails synchronously or asynchronously', async () => {
    for (const register of [vi.fn(() => { throw new Error('unavailable'); }), vi.fn(async () => { throw new Error('unavailable'); })]) {
      const remove = vi.fn(); const bridge = { register, unregister: vi.fn(async () => undefined), complete: vi.fn(async () => undefined), onRequest: vi.fn(() => remove) };
      const release = registerFirstPartyLocalControls({ context, instanceId, controls: {}, isCurrent: () => true, bridge });
      await Promise.resolve(); await Promise.resolve(); release();
      expect(remove).toHaveBeenCalledOnce(); expect(bridge.unregister).not.toHaveBeenCalled();
    }
  });
  it('unregisters a late registration reply after cleanup and retains only one listener', async () => {
    let resolve!: (value: typeof token) => void;
    const remove = vi.fn();
    const bridge = { register: vi.fn(() => new Promise<typeof token>(done => { resolve = done; })), unregister: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined), onRequest: vi.fn(() => remove) };
    const release = registerFirstPartyLocalControls({ context, instanceId, controls: {}, isCurrent: () => true, bridge });
    release(); release();
    resolve(token); await Promise.resolve(); await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce(); expect(bridge.onRequest).toHaveBeenCalledOnce();
    expect(bridge.unregister).toHaveBeenCalledOnce(); expect(bridge.unregister).toHaveBeenCalledWith(token);
  });
  it('releases the exact token after a successful registration and ignores subsequent callbacks', async () => {
    let listener!: (request: FirstPartyControlRequest) => void;
    const remove = vi.fn();
    const bridge = { register: vi.fn(async () => token), unregister: vi.fn(async () => undefined), complete: vi.fn(async () => undefined),
      onRequest: vi.fn((callback: (request: FirstPartyControlRequest) => void) => { listener = callback; return remove; }) };
    const release = registerFirstPartyLocalControls({ context, instanceId, controls: {}, isCurrent: () => true, now: () => 10_000, bridge });
    await Promise.resolve(); listener(request('observe'));
    expect(bridge.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'observed', controls: [] }));
    release(); listener(request('dispatch'));
    expect(bridge.complete).toHaveBeenCalledOnce();
    expect(bridge.unregister).toHaveBeenCalledOnce(); expect(bridge.unregister).toHaveBeenCalledWith(token); expect(remove).toHaveBeenCalledOnce();
  });
});
