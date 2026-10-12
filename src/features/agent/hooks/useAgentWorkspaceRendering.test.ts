import { randomUUID } from 'node:crypto';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRenderingRegistrationInput, WorkspaceRenderingRegistrationToken } from '@/shared/computer-use/workspace-rendering-contract';
import { useAgentWorkspaceRendering, type AgentWorkspaceRenderingInput } from './useAgentWorkspaceRendering';

const ownerScope = { accountScope: 'user:7', backendScope: 'http://127.0.0.1:8850/api' };
const renderers: TestRenderer.ReactTestRenderer[] = [];
function token(): WorkspaceRenderingRegistrationToken {
  return { registrationId: randomUUID(), documentGeneration: randomUUID() };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
function Probe(input: AgentWorkspaceRenderingInput & { sessionId?: string | null; managerMode?: boolean; modal?: boolean; runStatus?: string }) {
  useAgentWorkspaceRendering(input);
  return null;
}
async function mount(input: React.ComponentProps<typeof Probe>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, input)); renderers.push(renderer); });
  return renderer;
}
async function update(renderer: TestRenderer.ReactTestRenderer, input: React.ComponentProps<typeof Probe>) {
  await act(async () => { renderer.update(React.createElement(Probe, input)); });
}
afterEach(() => {
  act(() => renderers.splice(0).forEach(renderer => renderer.unmount()));
  vi.unstubAllGlobals();
});

describe('visible Agent workspace drawing registration', () => {
  it('covers the first conversation, managers, image previews and idle UI without a Run or Session registration', async () => {
    vi.stubGlobal('crypto', { randomUUID });
    const registered = token();
    const bridge = { register: vi.fn(async () => registered), unregister: vi.fn(async () => true) };
    const input = { active: true, ownerScope, libraryId: 3, bridge, sessionId: null };
    const renderer = await mount(input);
    expect(bridge.register).toHaveBeenCalledOnce();
    expect(bridge.register).toHaveBeenCalledWith({ instanceId: expect.any(String), ownerScope, libraryId: 3 });
    for (const state of [{ sessionId: randomUUID(), runStatus: 'running' }, { managerMode: true },
      { modal: true }, { runStatus: 'completed' }, { runStatus: 'cancelled' }, { sessionId: null }]) {
      await update(renderer, { ...input, ...state, ownerScope: { ...ownerScope } });
    }
    expect(bridge.register).toHaveBeenCalledOnce();
    expect(bridge.unregister).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    expect(bridge.unregister).toHaveBeenCalledOnce();
    expect(bridge.unregister).toHaveBeenCalledWith(registered);
  });

  it('releases on hidden workspace, account/backend/library changes, absent owner and unmount', async () => {
    vi.stubGlobal('crypto', { randomUUID });
    const registrations: WorkspaceRenderingRegistrationToken[] = [];
    const bridge = { register: vi.fn<(input: WorkspaceRenderingRegistrationInput) => Promise<WorkspaceRenderingRegistrationToken>>(async () => {
      const registered = token(); registrations.push(registered); return registered;
    }), unregister: vi.fn<(token: WorkspaceRenderingRegistrationToken) => Promise<boolean>>(async () => true) };
    const input = { active: true, ownerScope, libraryId: 3, bridge };
    const renderer = await mount(input);
    await update(renderer, { ...input, active: false });
    expect(bridge.unregister).toHaveBeenLastCalledWith(registrations[0]);
    await update(renderer, input);
    await update(renderer, { ...input, ownerScope: { ...ownerScope, accountScope: 'user:8' } });
    await update(renderer, { ...input, ownerScope: { ...ownerScope, backendScope: 'http://127.0.0.1:8851/api' } });
    await update(renderer, { ...input, libraryId: 4 });
    await update(renderer, { ...input, ownerScope: null });
    expect(bridge.register).toHaveBeenCalledTimes(5);
    expect(bridge.unregister.mock.calls.map(([registered]) => registered)).toEqual(registrations);
    const ids = bridge.register.mock.calls.map(([registered]) => registered.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    await update(renderer, input);
    act(() => renderer.unmount());
    expect(bridge.unregister.mock.calls.map(([registered]) => registered)).toEqual(registrations);
  });

  it('returns a late replaced registration only by its own token without releasing the current owner', async () => {
    vi.stubGlobal('crypto', { randomUUID });
    const old = deferred<WorkspaceRenderingRegistrationToken>();
    const oldToken = token(); const currentToken = token();
    const bridge = { register: vi.fn(async () => currentToken).mockImplementationOnce(() => old.promise),
      unregister: vi.fn<(token: WorkspaceRenderingRegistrationToken) => Promise<boolean>>(async () => true) };
    const input = { active: true, ownerScope, libraryId: 3, bridge };
    const renderer = await mount(input);
    await update(renderer, { ...input, libraryId: 4 });
    expect(bridge.unregister).not.toHaveBeenCalled();
    await act(async () => { old.resolve(oldToken); });
    expect(bridge.unregister).toHaveBeenCalledOnce();
    expect(bridge.unregister).toHaveBeenCalledWith(oldToken);
    act(() => renderer.unmount());
    expect(bridge.unregister.mock.calls.map(([registered]) => registered)).toEqual([oldToken, currentToken]);
  });

  it('returns a registration completed after unmount once and contains IPC failure without retry timers', async () => {
    vi.stubGlobal('crypto', { randomUUID });
    const pending = deferred<WorkspaceRenderingRegistrationToken>();
    const registered = token();
    const bridge = { register: vi.fn(() => pending.promise), unregister: vi.fn(async () => { throw new Error('window destroyed'); }) };
    const input = { active: true, ownerScope, libraryId: 3, bridge };
    const renderer = await mount(input);
    act(() => renderer.unmount());
    await act(async () => { pending.resolve(registered); });
    expect(bridge.unregister).toHaveBeenCalledOnce();
    expect(bridge.unregister).toHaveBeenCalledWith(registered);
    const failingBridge = { register: vi.fn(async () => { throw new Error('unavailable'); }), unregister: vi.fn(async () => true) };
    const failed = await mount({ ...input, bridge: failingBridge });
    await update(failed, { ...input, bridge: failingBridge, modal: true });
    expect(failingBridge.register).toHaveBeenCalledOnce();
    expect(failingBridge.unregister).not.toHaveBeenCalled();
  });
});
