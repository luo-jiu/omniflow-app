import type { ThemeMode } from '@/contexts/theme.context';
import { parseUserExt } from '@/features/user/services/user.api';

export const USER_PREFERENCES_EXT_KEY = 'omniflowPreferencesV1';

const APP_LANGUAGE_STORAGE_KEY = 'app-language';

export type AppLanguage = 'zh-CN' | 'en-US';

export type UserPreferences = {
  theme?: ThemeMode;
  language?: AppLanguage;
  fileTreeShowSuffix?: boolean;
  autoImportEnabled?: boolean;
  autoImportWatchDirectory?: string;
};

export type ResolvedUserPreferences = {
  theme: ThemeMode;
  language: AppLanguage;
  fileTreeShowSuffix: boolean;
  autoImportEnabled: boolean;
  autoImportWatchDirectory: string;
};

export const DEFAULT_USER_PREFERENCES: ResolvedUserPreferences = {
  theme: 'system',
  language: 'zh-CN',
  fileTreeShowSuffix: true,
  autoImportEnabled: false,
  autoImportWatchDirectory: '',
};

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'system' || value === 'dark';
}

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'zh-CN' || value === 'en-US';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWatchDirectory(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getAppLanguage(): AppLanguage {
  const raw = localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
  return isAppLanguage(raw) ? raw : 'zh-CN';
}

export function setAppLanguage(language: AppLanguage) {
  localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
}

export function parseUserPreferencesFromExt(ext: string | null | undefined): UserPreferences {
  const extObject = parseUserExt(ext);
  const rawPreferences = extObject[USER_PREFERENCES_EXT_KEY];
  if (!isRecord(rawPreferences)) {
    return {};
  }

  const preferences: UserPreferences = {};

  if (isThemeMode(rawPreferences.theme)) {
    preferences.theme = rawPreferences.theme;
  }
  if (isAppLanguage(rawPreferences.language)) {
    preferences.language = rawPreferences.language;
  }
  if (typeof rawPreferences.fileTreeShowSuffix === 'boolean') {
    preferences.fileTreeShowSuffix = rawPreferences.fileTreeShowSuffix;
  }
  if (typeof rawPreferences.autoImportEnabled === 'boolean') {
    preferences.autoImportEnabled = rawPreferences.autoImportEnabled;
  }
  if (typeof rawPreferences.autoImportWatchDirectory === 'string') {
    preferences.autoImportWatchDirectory = normalizeWatchDirectory(rawPreferences.autoImportWatchDirectory);
  }

  return preferences;
}

export function resolveUserPreferences(ext: string | null | undefined): ResolvedUserPreferences {
  const preferences = parseUserPreferencesFromExt(ext);
  return {
    ...DEFAULT_USER_PREFERENCES,
    ...preferences,
  };
}

export function mergeUserPreferencesIntoExt(
  ext: string | null | undefined,
  patch: UserPreferences,
): string {
  const extObject = parseUserExt(ext);
  const currentPreferences = resolveUserPreferences(ext);
  const nextPreferences = {
    ...currentPreferences,
    ...patch,
  };

  extObject[USER_PREFERENCES_EXT_KEY] = nextPreferences;
  return JSON.stringify(extObject);
}
