import { createThemeState, type ThemeSelection } from './theme-state';
import type { ThemeMode } from '@/contexts/theme.context';

export const APPEARANCE_STORAGE_PREFIX = 'omniflow:appearance:v1:';
export function defaultSelection(mode: ThemeMode = 'system'): ThemeSelection {
  return { mode, colorThemeId: 'omniflow.default', iconThemeId: 'omniflow.material' };
}
export function readAppearance(accountScope: string, fallback: ThemeSelection, storage: Pick<Storage, 'getItem'> = localStorage): ThemeSelection {
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_PREFIX + accountScope);
    if (!raw) return fallback;
    return createThemeState({ ownerEpoch: 'read', accountScope, systemMode: 'light', selection: JSON.parse(raw) }).committed;
  } catch { return fallback; }
}
export function saveAppearance(accountScope: string, selection: ThemeSelection, storage: Pick<Storage, 'setItem'> = localStorage) {
  const validated = createThemeState({ ownerEpoch: 'write', accountScope, systemMode: 'light', selection }).committed;
  storage.setItem(APPEARANCE_STORAGE_PREFIX + accountScope, JSON.stringify(validated));
}
