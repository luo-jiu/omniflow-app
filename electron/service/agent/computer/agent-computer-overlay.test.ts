import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import type { AgentToolMainPreparationIdentity } from '../agent-tool-registry';
import type { OverlayWindowController } from '../../overlayWindowController';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, payload: any) => any>(),
  listeners: new Map<string, (event: any, payload?: any) => void>(),
}));
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, callback: any) => ipc.handlers.set(channel, callback),
  on: (channel: string, callback: any) => ipc.listeners.set(channel, callback),
} }));

import { registerOverlayWindowIpcHandlers } from '../../overlayWindowIpc';
import { createAgentComputerAssociatedMenu } from './agent-computer-overlay';

const PID = 700;
const REQUEST_A = '00000000-0000-4000-8000-000000000001';
const REQUEST_B = '00000000-0000-4000-8000-000000000002';

function contents(id: number) {
  return Object.assign(new EventEmitter(), { id, mainFrame: { processId: id + 100, routingId: id + 200 },
    destroyed: false, isDestroyed() { return this.destroyed; } });
}

function windowFixture(id: number, parent: BrowserWindow | null = null) {
  const state = Object.assign(new EventEmitter(), {
    webContents: contents(id), bounds: { x: 10, y: 20, width: 800, height: 600 },
    contentBounds: { x: 10, y: 20, width: 800, height: 600 },
    visible: true, destroyed: false, minimized: false, alwaysOnTop: false, parent, mediaSourceId: `window:${id}:0`,
    getMediaSourceId() { return this.mediaSourceId; },
    getBounds() { return this.bounds; }, getContentBounds() { return this.contentBounds; },
    getParentWindow() { return this.parent; }, isVisible() { return this.visible; },
    isMinimized() { return this.minimized; }, isDestroyed() { return this.destroyed; },
    isAlwaysOnTop() { return this.alwaysOnTop; },
  });
  return { state, window: state as unknown as BrowserWindow };
}

function fixture() {
  const main = windowFixture(10);
  const overlay = windowFixture(20, main.window);
  overlay.state.visible = false;
  const controller = {
    ensureReady: vi.fn().mockResolvedValue(undefined), markReady: vi.fn(), getWindow: vi.fn(() => overlay.window as BrowserWindow | null),
    showSpec: vi.fn(() => { overlay.state.visible = true; }), updateSpec: vi.fn(), dismissSpec: vi.fn(),
    setClickThrough: vi.fn(), hideIdle: vi.fn(() => { overlay.state.visible = false; }), restoreActive: vi.fn(),
    syncBoundsFromMain: vi.fn(), destroy: vi.fn(),
  } satisfies OverlayWindowController;
  const access = registerOverlayWindowIpcHandlers(controller);
  const hostEvent = () => ({ sender: overlay.state.webContents, senderFrame: overlay.state.webContents.mainFrame });
  ipc.listeners.get('overlay:host:ready')!(hostEvent());
  const provider = createAgentComputerAssociatedMenu({ getMainWindow: () => main.window, controller, access, processId: PID });
  const approved: AgentComputerSharedWindow = { windowId: 10, pid: PID, processStartedAt: 1_000, layer: 0,
    bounds: { ...main.state.bounds }, title: 'Untrusted changing title', applicationLabel: 'OmniFlow', windowLabel: 'Main' };
  const identity = { ownerWebContentsId: main.state.webContents.id } as AgentToolMainPreparationIdentity;
  function open(type = 'directory-context-menu', owner = main.state.webContents, requestId = REQUEST_A) {
    const result = ipc.handlers.get('overlay:open')!({ sender: owner, senderFrame: owner.mainFrame }, { requestId, type, props: {} }) as Promise<unknown>;
    void result.catch(() => undefined);
    return result;
  }
  function cancel(requestId = REQUEST_A) {
    return ipc.handlers.get('overlay:cancel')!({ sender: main.state.webContents, senderFrame: main.state.webContents.mainFrame }, { requestId });
  }
  return { main, overlay, controller, access, provider, approved, identity, open, cancel, hostEvent,
    current: () => provider.current(approved, identity), completion: () => provider.prepareCompletion(approved, identity) };
}

describe('main-owned directory-menu association', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    vi.useFakeTimers(); ipc.handlers.clear(); ipc.listeners.clear(); f = fixture();
  });
  afterEach(() => {
    f.overlay.state.webContents.emit('destroyed');
    vi.clearAllTimers(); vi.useRealTimers();
  });

  it('binds a visible current directory menu to the exact child CGWindowID without a title', () => {
    f.open();
    const menu = f.current()!;
    expect(menu).toBeDefined();
    expect(menu.window).toEqual({ windowId: 20, pid: PID, processStartedAt: 1_000, layer: 0, bounds: f.overlay.state.bounds });
    expect(menu.window.title).toBeUndefined();
    expect(menu.window.bounds).not.toBe(f.overlay.state.bounds);
    expect(Object.isFrozen(menu.window.bounds)).toBe(true);
    expect(menu.valid()).toBe(true);
    // Validation is read-only: it neither focuses/creates a window nor touches a request.
    for (const fn of [f.controller.showSpec, f.controller.updateSpec, f.controller.hideIdle, f.controller.dismissSpec]) fn.mockClear();
    const listeners = f.main.state.webContents.listenerCount('did-start-navigation');
    expect(menu.valid()).toBe(true);
    expect(f.main.state.webContents.listenerCount('did-start-navigation')).toBe(listeners);
    expect(f.controller.showSpec).not.toHaveBeenCalled(); expect(f.controller.updateSpec).not.toHaveBeenCalled();
    expect(f.controller.hideIdle).not.toHaveBeenCalled(); expect(f.controller.dismissSpec).not.toHaveBeenCalled();
  });

  it('invalidates update, close and replacement, including reuse of the same request id', async () => {
    const opened = f.open();
    const first = f.current()!;
    ipc.handlers.get('overlay:update')!({ sender: f.main.state.webContents, senderFrame: f.main.state.webContents.mainFrame }, {
      requestId: REQUEST_A, props: { selection: 2 },
    });
    expect(first.valid()).toBe(false);
    expect(first.dismiss?.()).toBe(false);
    const updated = f.current()!;
    expect(updated.key).not.toBe(first.key);
    expect(updated.valid()).toBe(true);
    f.cancel(); await opened;
    expect(updated.valid()).toBe(false); expect(f.current()).toBeUndefined();
    f.open();
    expect(f.current()!.key).not.toBe(updated.key); expect(updated.valid()).toBe(false);
    expect(first.dismiss?.()).toBe(false); expect(updated.dismiss?.()).toBe(false);
    expect(f.current()!.valid()).toBe(true);
  });

  it('cancels the exact current directory request once and preserves the existing cleanup', async () => {
    const result = f.open();
    const menu = f.current()!;
    expect(menu.dismiss?.()).toBe(true);
    await expect(result).resolves.toEqual({ type: 'cancel' });
    expect(f.current()).toBeUndefined();
    expect(f.overlay.state.visible).toBe(false);
    expect(f.controller.dismissSpec).toHaveBeenCalledOnce();
    expect(f.controller.dismissSpec).toHaveBeenCalledWith({ requestId: REQUEST_A });
    expect(vi.getTimerCount()).toBe(0);
    expect(menu.valid()).toBe(false); expect(menu.dismiss?.()).toBe(false);
  });

  it('cannot use a stale cancellation closure against a queued or replacement menu owner', async () => {
    const first = f.open();
    const old = f.current()!;
    const next = f.open('directory-context-menu', f.main.state.webContents, REQUEST_B);
    expect(old.dismiss?.()).toBe(false); // Queueing invalidates the frozen epoch.
    expect(f.access.read().current?.requestId).toBe(REQUEST_A);
    f.cancel(); await first;
    expect(old.dismiss?.()).toBe(false);
    expect(f.access.read().current?.requestId).toBe(REQUEST_B);
    expect(f.current()!.dismiss?.()).toBe(true);
    await expect(next).resolves.toEqual({ type: 'cancel' });
  });

  it.each([
    ['another window id', (f: ReturnType<typeof fixture>) => { f.approved.windowId = 11; }],
    ['another PID', (f: ReturnType<typeof fixture>) => { f.approved.pid++; }],
    ['a nonzero target layer', (f: ReturnType<typeof fixture>) => { f.approved.layer = 1; }],
    ['another Run owner', (f: ReturnType<typeof fixture>) => { (f.identity as any).ownerWebContentsId++; }],
    ['a stale main frame', (f: ReturnType<typeof fixture>) => { f.main.state.webContents.mainFrame = { ...f.main.state.webContents.mainFrame }; }],
    ['changed main routing id', (f: ReturnType<typeof fixture>) => { f.main.state.webContents.mainFrame.routingId++; }],
    ['a changed host frame', (f: ReturnType<typeof fixture>) => { f.overlay.state.webContents.mainFrame = { ...f.overlay.state.webContents.mainFrame }; }],
    ['changed host process id', (f: ReturnType<typeof fixture>) => { f.overlay.state.webContents.mainFrame.processId++; }],
    ['a destroyed main', (f: ReturnType<typeof fixture>) => { f.main.state.destroyed = true; }],
    ['a hidden main', (f: ReturnType<typeof fixture>) => { f.main.state.visible = false; }],
    ['a hidden overlay', (f: ReturnType<typeof fixture>) => { f.overlay.state.visible = false; }],
    ['an elevated overlay', (f: ReturnType<typeof fixture>) => { f.overlay.state.alwaysOnTop = true; }],
    ['a detached parent', (f: ReturnType<typeof fixture>) => { f.overlay.state.parent = null; }],
    ['a changed main size', (f: ReturnType<typeof fixture>) => { f.main.state.bounds.width++; }],
    ['an unsynchronized child size', (f: ReturnType<typeof fixture>) => { f.overlay.state.bounds.width++; }],
    ['a changed child CGWindowID', (f: ReturnType<typeof fixture>) => { f.overlay.state.mediaSourceId = 'window:21:0'; }],
    ['a non-window media source', (f: ReturnType<typeof fixture>) => { f.overlay.state.mediaSourceId = 'screen:20:0'; }],
    ['a replaced controller window', (f: ReturnType<typeof fixture>) => { f.controller.getWindow.mockReturnValue(windowFixture(20, f.main.window).window); }],
  ])('rejects %s before exposing or reusing an association', (_label, change) => {
    f.open();
    const menu = f.current()!;
    change(f);
    expect(menu.valid()).toBe(false);
    expect(menu.dismiss?.()).toBe(false);
    expect(f.controller.dismissSpec).not.toHaveBeenCalled();
    expect(f.current()).toBeUndefined();
  });

  it.each(['did-start-navigation', 'render-process-gone', 'destroyed'] as const)('invalidates an active menu on host %s', event => {
    f.open();
    const menu = f.current()!;
    f.overlay.state.webContents.emit(event, { isMainFrame: true });
    expect(menu.valid()).toBe(false); expect(f.current()).toBeUndefined();
  });

  it('refuses non-directory surfaces and requests owned by another renderer', async () => {
    const confirmation = f.open('delete-confirm');
    expect(f.current()).toBeUndefined();
    f.cancel(); await confirmation;
    f.open('directory-context-menu', contents(999));
    expect(f.current()).toBeUndefined();
  });

  it('requires an existing ready, hidden child and an empty request queue for a completion', () => {
    expect(f.completion()).toBeDefined();
    f.controller.getWindow.mockReturnValue(null);
    expect(f.completion()).toBeUndefined();
    f.controller.getWindow.mockReturnValue(f.overlay.window);
    f.open(); expect(f.completion()).toBeUndefined();
    f.open('directory-context-menu', f.main.state.webContents, REQUEST_B);
    f.overlay.state.visible = false;
    expect(f.completion()).toBeUndefined();
  });

  it('accepts unchanged ordinary completion only when no completion window was claimed', () => {
    const completion = f.completion()!;
    expect(completion.validate()).toBe(true);
    expect(completion.validate(10)).toBe(false); expect(completion.validate(20)).toBe(false);
    f.overlay.state.visible = true;
    expect(completion.validate()).toBe(false);
  });

  it('accepts only the first same-owner directory promotion on the preexisting child', () => {
    const completion = f.completion()!;
    f.open();
    expect(completion.validate()).toBe(true); expect(completion.validate(20)).toBe(true);
    expect(completion.validate(10)).toBe(false); expect(completion.validate(21)).toBe(false);
  });

  it('invalidates idle completion on main navigation even when its mainFrame object is unchanged', () => {
    const completion = f.completion()!;
    f.main.state.webContents.emit('did-start-navigation', {}, '#/libraries/other', true, true);
    f.open();
    expect(completion.validate()).toBe(false); expect(completion.validate(20)).toBe(false);
  });

  it.each(['update', 'queue', 'replacement', 'foreign-type', 'foreign-owner'] as const)('refuses completion after %s', async change => {
    const completion = f.completion()!;
    const first = f.open(change === 'foreign-type' ? 'delete-confirm' : 'directory-context-menu',
      change === 'foreign-owner' ? contents(999) : f.main.state.webContents);
    if (change === 'update') ipc.handlers.get('overlay:update')!({ sender: f.main.state.webContents,
      senderFrame: f.main.state.webContents.mainFrame }, { requestId: REQUEST_A, props: {} });
    if (change === 'queue') f.open('directory-context-menu', f.main.state.webContents, REQUEST_B);
    if (change === 'replacement') { f.cancel(); await first; f.open(); }
    expect(completion.validate()).toBe(false); expect(completion.validate(20)).toBe(false);
  });
});
