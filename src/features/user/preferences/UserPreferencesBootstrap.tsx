import { useContext, useEffect, useLayoutEffect } from 'react';
import { AppearanceControlContext } from '@/features/appearance/appearance.context';
import { useAuth } from '@/hooks/useAuth';
import { setAutoImportEnabled, setAutoImportWatchDirectory } from '@/features/file-explorer/auto-import/settings';
import { setFileTreeShowSuffix } from '@/utils/fileTreeSettings';
import { resolveUserPreferences, setAppLanguage } from './user-preferences';

const UserPreferencesBootstrap = () => {
  const { user } = useAuth();
  const appearance = useContext(AppearanceControlContext);
  const accountScope = user?.id ? `user:${user.id}` : 'anonymous';
  const legacyMode = user ? resolveUserPreferences(user.ext).theme : 'system';
  const bindAccount = appearance?.bindAccount;
  useLayoutEffect(() => { bindAccount?.(accountScope, legacyMode); }, [accountScope, bindAccount, legacyMode]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const preferences = resolveUserPreferences(user.ext);

    setAppLanguage(preferences.language);
    setFileTreeShowSuffix(preferences.fileTreeShowSuffix);
    setAutoImportEnabled(preferences.autoImportEnabled);
    setAutoImportWatchDirectory(preferences.autoImportWatchDirectory);
  }, [user]);

  return null;
};

export default UserPreferencesBootstrap;
