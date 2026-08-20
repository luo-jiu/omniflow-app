import React from 'react';
import { Toast } from '@douyinfe/semi-ui';

import { useSyncedUserPreferences } from '@/hooks/useSyncedUserPreferences';

import {
  normalizeToolWorkspaceLayout,
  TOOL_WORKSPACE_LAYOUT_SCHEMA_VERSION,
  TOOL_WORKSPACE_PREFERENCE_NAMESPACE,
  type ToolWorkspaceLayout,
} from '../tool-workspace.layout';

export function useToolWorkspaceLayout() {
  const { entries, savePreference } = useSyncedUserPreferences();
  const entry = entries[TOOL_WORKSPACE_PREFERENCE_NAMESPACE];
  const layout = React.useMemo(
    () => normalizeToolWorkspaceLayout(entry?.preferences, entry?.schemaVersion),
    [entry?.preferences, entry?.schemaVersion],
  );

  const saveLayout = React.useCallback((next: ToolWorkspaceLayout) => {
    void savePreference({
      namespace: TOOL_WORKSPACE_PREFERENCE_NAMESPACE,
      preferences: normalizeToolWorkspaceLayout(next),
      schemaVersion: TOOL_WORKSPACE_LAYOUT_SCHEMA_VERSION,
    }).catch((error) => {
      Toast.warning(error?.message || '当前布局已保留，但跨设备同步失败');
    });
  }, [savePreference]);

  const saveNavWidth = React.useCallback((navWidth: number) => {
    saveLayout({ ...layout, navWidth });
  }, [layout, saveLayout]);

  const saveToolOrder = React.useCallback((toolOrder: ToolWorkspaceLayout['toolOrder']) => {
    saveLayout({ ...layout, toolOrder });
  }, [layout, saveLayout]);

  return {
    layout,
    saveNavWidth,
    saveToolOrder,
  };
}
