import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAppearanceTheme } from './appearance-theme';
import { applyThemeView, cancelThemeTransition } from './theme-dom';
import type { ThemeView } from './theme-view';

const targets: HTMLElement[] = [];
afterEach(() => { for (const target of targets.splice(0)) cancelThemeTransition(target); });

function view(mode: 'light' | 'dark', revision = 1): ThemeView {
  const resolved = resolveAppearanceTheme({ mode });
  return { schemaVersion: 1, ownerEpoch: 'test', revision, mode, source: mode,
    iconThemeId: 'omniflow.material', colors: resolved.colors, effects: resolved.effects };
}

function surface({ reduced = false, supported = true } = {}) {
  const attributes = new Map<string, string>();
  const inline = new Map<string, string>();
  const displayed = new Map<string, string>();
  const animations: Array<{ cancel: ReturnType<typeof vi.fn>; finish: () => void; finished: Promise<void> }> = [];
  const animate = vi.fn(() => {
    let finish!: () => void;
    let reject!: () => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new Error('cancelled')); });
    const animation = { cancel: vi.fn(reject), finish, finished };
    animations.push(animation);
    return animation;
  });
  const registerProperty = vi.fn();
  const target = {
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    style: { setProperty: (key: string, value: string) => inline.set(key, value) },
    animate,
    ownerDocument: { defaultView: {
      CSS: supported ? { registerProperty } : {},
      matchMedia: () => ({ matches: reduced }),
      getComputedStyle: () => ({ getPropertyValue: (key: string) => displayed.get(key) ?? inline.get(key) ?? '' }),
    } },
  } as unknown as HTMLElement;
  targets.push(target);
  return { target, inline, attributes, displayed, animations, animate, registerProperty };
}

describe('shared theme color motion', () => {
  it('paints the first palette immediately, then animates app, Semi, editor and Agent colors together', async () => {
    const s = surface();
    applyThemeView(view('light'), s.target);
    expect(s.animate).not.toHaveBeenCalled();
    applyThemeView(view('dark'), s.target);
    expect(s.animate).toHaveBeenCalledTimes(1);
    expect(s.animate).toHaveBeenCalledWith([
      expect.objectContaining({ '--app-text': '#1a1a1a', '--semi-color-text-0': '#1a1a1a',
        '--app-editor-text': view('light').colors['editor.text'], '--app-agent-syntax-keyword': '#7850b8' }),
      expect.objectContaining({ '--app-text': '#e8e8e8', '--semi-color-text-0': '#e8e8e8',
        '--app-editor-text': view('dark').colors['editor.text'], '--app-agent-syntax-keyword': '#c5a3ee' }),
    ], { duration: 200, easing: 'ease-in-out' });
    expect(s.registerProperty).not.toHaveBeenCalledWith(expect.objectContaining({ name: '--app-radius-small' }));
    expect(s.attributes.has('data-app-theme-transition')).toBe(true);
    s.animations[0].finish();
    await Promise.resolve();
    expect(s.attributes.has('data-app-theme-transition')).toBe(false);
    expect(s.inline.get('--app-text')).toBe('#e8e8e8');
  });

  it('reverses from the displayed intermediate color and ignores the previous cancellation cleanup', async () => {
    const s = surface();
    applyThemeView(view('light'), s.target);
    applyThemeView(view('dark'), s.target);
    s.displayed.set('--app-text', 'rgb(128, 128, 128)');
    applyThemeView(view('light', 2), s.target);
    expect(s.animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(s.animate).toHaveBeenLastCalledWith([
      expect.objectContaining({ '--app-text': 'rgb(128, 128, 128)' }),
      expect.objectContaining({ '--app-text': '#1a1a1a' }),
    ], expect.anything());
    await Promise.resolve();
    expect(s.attributes.has('data-app-theme-transition')).toBe(true);
    s.animations[1].finish();
    await Promise.resolve();
    expect(s.attributes.has('data-app-theme-transition')).toBe(false);
  });

  it('does not restart motion for a source/revision-only update', async () => {
    const s = surface();
    applyThemeView(view('light'), s.target);
    applyThemeView(view('dark'), s.target);
    applyThemeView({ ...view('dark', 2), source: 'system' }, s.target);
    expect(s.animate).toHaveBeenCalledTimes(1);
    expect(s.animations[0].cancel).not.toHaveBeenCalled();
    expect(s.attributes.has('data-app-theme-transition')).toBe(true);
    cancelThemeTransition(s.target);
    await Promise.resolve();
    expect(s.animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(s.attributes.has('data-app-theme-transition')).toBe(false);
  });

  it.each([{ reduced: true }, { supported: false }])('applies a complete immediate palette for %j', options => {
    const s = surface(options);
    applyThemeView(view('light'), s.target);
    applyThemeView(view('dark'), s.target);
    expect(s.animate).not.toHaveBeenCalled();
    expect(s.inline.get('--app-text')).toBe('#e8e8e8');
    expect(s.attributes.has('data-app-theme-transition')).toBe(false);
  });

  it('keeps the final theme and restores interactions if animation creation fails', () => {
    const s = surface();
    applyThemeView(view('light'), s.target);
    s.animate.mockImplementation(() => { throw new Error('unsupported animation'); });
    expect(() => applyThemeView(view('dark'), s.target)).not.toThrow();
    expect(s.inline.get('--app-text')).toBe('#e8e8e8');
    expect(s.attributes.has('data-app-theme-transition')).toBe(false);
  });
});
