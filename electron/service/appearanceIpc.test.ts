import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), native: { themeSource: 'system' }, background: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) }, nativeTheme: mocks.native }));
vi.mock('./mainWindowBackground', () => ({ applyMainWindowAppearanceBackground: mocks.background }));
import { registerAppearanceIpc } from './appearanceIpc';
import { createThemeSnapshot, createThemeState } from '../../src/features/appearance/theme-state';
import { toThemeView } from '../../src/features/appearance/theme-view';
import { defaultSelection } from '../../src/features/appearance/appearance-storage';

function setup() {
  mocks.handlers.clear();
  const contents = () => Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() });
  const main = { webContents: contents(), isDestroyed: () => false };
  const overlay = { webContents: contents(), isDestroyed: () => false };
  const foreign = contents();
  registerAppearanceIpc({ getMainWindow: () => main as never, getOverlayWindow: () => overlay as never });
  const event = (sender: typeof main.webContents) => ({ sender, senderFrame: sender.mainFrame });
  const call = (name: string, sender = main.webContents, value?: unknown) => mocks.handlers.get(name)!(event(sender), value);
  const view = toThemeView(createThemeSnapshot(createThemeState({ ownerEpoch: 'epoch-a', accountScope: 'anonymous', systemMode: 'light', selection: defaultSelection() }), () => undefined));
  return { main, overlay, foreign, event, call, view };
}
describe('appearance transport trust and lifecycle', () => {
  it('requires a main-frame owner claim and rejects foreign publishers/readers', () => {
    const s = setup();
    expect(s.call('appearance:publish', s.main.webContents, s.view)).toBe(false);
    expect(s.call('appearance:claim', s.overlay.webContents, 'epoch-a')).toBe(false);
    expect(s.call('appearance:claim', s.foreign, 'epoch-a')).toBe(false);
    expect(s.call('appearance:claim', s.main.webContents, 'epoch-a')).toBe(true);
    expect(s.call('appearance:publish', s.main.webContents, s.view)).toBe(true);
    expect(s.call('appearance:get', s.foreign)).toBeNull();
    expect(s.call('appearance:get', s.overlay.webContents)).toEqual(s.view);
    expect(mocks.handlers.get('appearance:publish')!({ sender: s.main.webContents, senderFrame: {} }, { ...s.view, revision: 1 })).toBe(false);
  });
  it('rejects invalid colors, stale revisions and old owners after reload', () => {
    const s = setup();
    s.call('appearance:claim', s.main.webContents, 'epoch-a');
    expect(s.call('appearance:publish', s.main.webContents, s.view)).toBe(true);
    expect(s.call('appearance:publish', s.main.webContents, s.view)).toBe(false);
    expect(s.call('appearance:publish', s.main.webContents, { ...s.view, revision: 1, colors: { ...s.view.colors, 'surface.app': 'url(x)' } })).toBe(false);
    s.main.webContents.emit('did-start-navigation', {}, 'file:///new', false, true);
    expect(s.call('appearance:get', s.overlay.webContents)).toBeNull();
    s.call('appearance:claim', s.main.webContents, 'epoch-b');
    expect(s.call('appearance:publish', s.main.webContents, { ...s.view, revision: 100 })).toBe(false);
    expect(s.call('appearance:publish', s.main.webContents, { ...s.view, ownerEpoch: 'epoch-b' })).toBe(true);
  });
});
