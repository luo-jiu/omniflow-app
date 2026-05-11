import type { ReactNode } from 'react';

export type SystemWorkspaceView = 'overview' | 'settings' | 'uploads' | 'recycle-bin' | 'profile' | 'resource-monitor';

export type SettingsWorkspaceSection = 'home' | 'tags' | 'storage' | 'browser-mappings';

export type SystemWorkspaceReturnMode = 'search-home' | 'file-viewer' | 'browser' | 'tools';

export type SystemWorkspaceActionRoute = string;

export type SystemWorkspaceViewMeta = {
  description: string;
  icon: ReactNode;
  title: string;
};

export type SystemWorkspaceViewProps = {
  currentView: SystemWorkspaceView;
  libraryId: number;
  onClose: () => void;
  onOpenLegacyRoute: (route: SystemWorkspaceActionRoute) => void;
  onOpenView: (view: SystemWorkspaceView) => void;
  onSettingsSectionChange?: (section: SettingsWorkspaceSection) => void;
  settingsSection?: SettingsWorkspaceSection;
};
