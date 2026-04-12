import { useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/hooks/useAuth';
import { setAutoImportEnabled, setAutoImportWatchDirectory } from '@/features/file-explorer/auto-import/settings';
import { setFileTreeShowSuffix } from '@/utils/fileTreeSettings';
import { resolveUserPreferences, setAppLanguage } from './user-preferences';

const UserPreferencesBootstrap = () => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!user) {
      return;
    }

    const preferences = resolveUserPreferences(user.ext);

    if (preferences.theme !== theme) {
      setTheme(preferences.theme);
    }
    setAppLanguage(preferences.language);
    setFileTreeShowSuffix(preferences.fileTreeShowSuffix);
    setAutoImportEnabled(preferences.autoImportEnabled);
    setAutoImportWatchDirectory(preferences.autoImportWatchDirectory);
  }, [setTheme, theme, user]);

  return null;
};

export default UserPreferencesBootstrap;
