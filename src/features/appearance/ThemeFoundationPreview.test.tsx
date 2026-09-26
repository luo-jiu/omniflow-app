import { useContext, type ReactNode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AppearanceControlContext, type AppearanceControls } from './appearance.context';
import ThemeFoundationPreview from './ThemeFoundationPreview';

// These controls are not involved in the appearance transaction under test.
vi.mock('@douyinfe/semi-ui', () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Checkbox: () => null,
  Select: () => null,
  Switch: () => null,
  Divider: () => <hr />,
}));

let renderer: TestRenderer.ReactTestRenderer | undefined;
let controls: AppearanceControls;
function Probe() { controls = useContext(AppearanceControlContext)!; return null; }
function Screen({ sample = true }: { sample?: boolean }) {
  return <ThemeProvider><Probe />{sample && <ThemeFoundationPreview />}</ThemeProvider>;
}
function click(text: string) {
  const button = renderer!.root.findAllByType('button').find(node => node.children.includes(text));
  expect(button, `missing button ${text}`).toBeTruthy();
  act(() => button!.props.onClick());
}
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => values.set(key, value)) };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.stubGlobal('document', { body: { setAttribute: vi.fn(), removeAttribute: vi.fn(), style: { setProperty: vi.fn() } } });
  act(() => { renderer = TestRenderer.create(<Screen />); });
  act(() => controls.bindAccount('user:900001', 'system'));
  return storage;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

describe('theme foundation sample preview lifecycle', () => {
  it('previews palette and mode without saving, preserves overrides, and restores the committed appearance', () => {
    const storage = setup();
    act(() => {
      const token = controls.preview({ ...controls.selection, overrides: { colors: { 'accent.default': '#8158b8' } } });
      controls.confirm(token);
    });
    const saved = controls.selection;
    const writeCount = storage.setItem.mock.calls.length;
    click('紫罗兰');
    click('夜间');
    expect(controls.selection).toMatchObject({ mode: 'dark', colorThemeId: 'omniflow.violet', overrides: saved.overrides });
    expect(controls.phase).toBe('preview');
    expect(storage.setItem).toHaveBeenCalledTimes(writeCount);
    click('恢复已保存外观');
    expect(controls.selection).toEqual(saved);
    expect(controls.phase).toBe('committed');
    click('海蓝');
    act(() => renderer!.update(<Screen sample={false} />));
    expect(controls.selection).toEqual(saved);
    expect(controls.phase).toBe('committed');
    expect(storage.setItem).toHaveBeenCalledTimes(writeCount);
  });

  it('does not cancel a newer preview owned by another screen when leaving the sample', () => {
    setup();
    click('紫罗兰');
    act(() => { controls.preview({ ...controls.selection, colorThemeId: 'omniflow.ocean', mode: 'dark' }); });
    act(() => renderer!.update(<Screen sample={false} />));
    expect(controls.phase).toBe('preview');
    expect(controls.selection).toMatchObject({ colorThemeId: 'omniflow.ocean', mode: 'dark' });
  });
});
