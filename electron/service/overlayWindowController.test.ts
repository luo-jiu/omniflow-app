import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('electron', () => ({
  screen: { on: vi.fn() },
  BrowserWindow: class extends EventEmitter {
    visible = false;
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
    constructor() { super(); mocks.windows.push(this); }
    isDestroyed = () => this.destroyed;
    isVisible = () => this.visible;
    setIgnoreMouseEvents = vi.fn();
    setContentBounds = vi.fn();
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
    show = vi.fn(() => { this.visible = true; });
    hide = vi.fn(() => { this.visible = false; });
    moveTop = vi.fn();
    focus = vi.fn();
    destroy = () => { this.destroyed = true; this.emit('closed'); };
  },
}));
import { createOverlayWindowController } from './overlayWindowController';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const main = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
    isFocused: vi.fn(() => true), getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) };
  const controller = createOverlayWindowController({ getMainWindow: () => main as never,
    preloadPath: '/preload', rendererDist: '/dist', devServerUrl: 'http://localhost:8849' });
  controller.showSpec({ requestId: 'properties', type: 'node-properties', props: {} });
  const win = mocks.windows.at(-1)!;
  return { main, controller, win };
}
describe('overlay focus restoration', () => {
  it('restores pending properties after switching apps without remounting or losing state', async () => {
    const { main, controller, win } = fixture();
    controller.markReady(win.webContents);
    await tick();
    win.hide();
    main.isFocused.mockReturnValue(false);
    controller.restoreActive();
    await tick();
    expect(win.visible).toBe(false);
    main.isFocused.mockReturnValue(true);
    controller.restoreActive(); controller.restoreActive();
    await tick();
    expect(win.visible).toBe(true);
    expect(win.moveTop).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    controller.hideIdle();
    controller.restoreActive();
    await tick();
    expect(win.visible).toBe(false);
    controller.destroy();
  });
  it('does not resurrect a dismissed request when renderer readiness resolves late', async () => {
    const { controller, win } = fixture();
    controller.dismissSpec({ requestId: 'properties' });
    controller.hideIdle();
    controller.markReady(win.webContents);
    await tick();
    expect(win.show).not.toHaveBeenCalled();
    controller.destroy();
  });
});
