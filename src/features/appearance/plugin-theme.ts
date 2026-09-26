import type { ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import { DEFAULT_COLOR_TOKENS } from './color-theme';
import type { ThemeView } from './theme-view';

/** Only visual values cross the plugin boundary; the host remains the theme owner. */
export function toPluginThemeSnapshot(view: Pick<ThemeView, 'mode' | 'colors'> | null, revision: number): ThemeSnapshot {
  const mode = view?.mode ?? 'light';
  return Object.freeze({
    schemaVersion: 1,
    revision,
    mode,
    colors: Object.freeze({ ...(view?.colors ?? DEFAULT_COLOR_TOKENS[mode]) }),
  });
}
