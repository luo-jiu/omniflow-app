import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AppearanceViewContext } from '@/features/appearance/appearance.context';
import { DEFAULT_COLOR_TOKENS } from '@/features/appearance/color-theme';
import type { ThemeView } from '@/features/appearance/theme-view';
import { useAudioSpectrumColors } from './use-audio-spectrum-colors';
import { loadCoverSpectrumColors, type SpectrumColors } from './audio-spectrum-cover-color';

vi.mock('./audio-spectrum-cover-color', async importOriginal => ({
  ...await importOriginal<typeof import('./audio-spectrum-cover-color')>(), loadCoverSpectrumColors: vi.fn(),
}));
let result: SpectrumColors;
let renderer: TestRenderer.ReactTestRenderer;
function Probe({ cover }: { cover?: string }) { result = useAudioSpectrumColors(cover); return null; }
const view = (accent: string, mode: 'light' | 'dark' = 'dark') => ({ mode, colors: { ...DEFAULT_COLOR_TOKENS[mode], 'accent.default': accent } } as ThemeView);
const render = (accent: string, cover?: string, mode: 'light' | 'dark' = 'dark') => <AppearanceViewContext.Provider value={view(accent, mode)}><Probe cover={cover} /></AppearanceViewContext.Provider>;
afterEach(() => { act(() => renderer?.unmount()); vi.resetAllMocks(); });

it('updates the fallback immediately for same-mode theme preview, custom accent and cancel', () => {
  act(() => { renderer = TestRenderer.create(render('#c3a0f6')); });
  expect(result.primary).toBe('#c3a0f6');
  act(() => renderer.update(render('#5a9e7c')));
  expect(result.primary).toBe('#5a9e7c');
  act(() => renderer.update(render('rgba(120, 60, 180, 0.9)')));
  expect(result.primary).toBe('rgba(120, 60, 180, 0.9)');
  act(() => renderer.update(render('#c3a0f6')));
  expect(result.primary).toBe('#c3a0f6');
  expect(loadCoverSpectrumColors).not.toHaveBeenCalled();
});

it('keeps cover colors across accent changes without another request and discards stale results after changing covers', async () => {
  const coverColors = { primary: '#d09050', mirrored: '#805020' };
  vi.mocked(loadCoverSpectrumColors).mockResolvedValueOnce(coverColors);
  await act(async () => { renderer = TestRenderer.create(render('#c3a0f6', 'cover-a')); });
  expect(result).toEqual(coverColors);
  act(() => renderer.update(render('#5a9e7c', 'cover-a')));
  expect(result).toEqual(coverColors);
  expect(loadCoverSpectrumColors).toHaveBeenCalledTimes(1);
  let resolveCover!: (colors: SpectrumColors | null) => void;
  vi.mocked(loadCoverSpectrumColors).mockReturnValueOnce(new Promise(resolve => { resolveCover = resolve; }));
  act(() => renderer.update(render('#5a9e7c', 'cover-b')));
  expect(result.primary).toBe('#5a9e7c');
  act(() => renderer.update(render('#7546ae', undefined, 'light')));
  await act(async () => resolveCover(coverColors));
  expect(result.primary).toBe('#7546ae');
});

it('uses the latest theme when a cover has no usable color', async () => {
  vi.mocked(loadCoverSpectrumColors).mockResolvedValue(null);
  await act(async () => { renderer = TestRenderer.create(render('#c3a0f6', 'gray-cover')); });
  act(() => renderer.update(render('#80b4ff', 'gray-cover')));
  expect(result.primary).toBe('#80b4ff');
  expect(loadCoverSpectrumColors).toHaveBeenCalledTimes(1);
});
