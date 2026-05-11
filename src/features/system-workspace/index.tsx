import { useMemo, useState, type FC } from 'react';
import {
  systemWorkspaceMeta,
  systemWorkspaceViews,
} from './registry';
import {
  SystemWorkspaceBody,
  SystemWorkspaceHeader,
  SystemWorkspaceRoot,
  SystemWorkspaceViewport,
} from './style';
import type {
  SettingsWorkspaceSection,
  SystemWorkspaceActionRoute,
  SystemWorkspaceView,
} from './types';

type SystemWorkspaceProps = {
  activeView: SystemWorkspaceView | null;
  libraryId: number;
  onClose: () => void;
  onOpenLegacyRoute: (route: SystemWorkspaceActionRoute) => void;
  onOpenView: (view: SystemWorkspaceView) => void;
};

const SystemWorkspace: FC<SystemWorkspaceProps> = ({
  activeView: activeViewProp,
  libraryId,
  onClose,
  onOpenLegacyRoute,
  onOpenView,
}) => {
  const [settingsSection, setSettingsSection] = useState<SettingsWorkspaceSection>('home');
  const activeView = activeViewProp ?? 'overview';
  const meta = systemWorkspaceMeta[activeView];
  const ViewComponent = systemWorkspaceViews[activeView];
  const frameClassKey = activeView === 'settings' && settingsSection !== 'home'
    ? 'settings-detail'
    : activeView;
  const activeMeta = useMemo(() => {
    if (activeView !== 'settings' || settingsSection === 'home') {
      return meta;
    }
    return {
      ...meta,
      description: '管理设置里的高级配置项',
    };
  }, [activeView, meta, settingsSection]);

  return (
    <SystemWorkspaceRoot>
      <SystemWorkspaceViewport>
        <div className={`system-workspace-center-frame system-workspace-frame-${frameClassKey}`}>
          <SystemWorkspaceHeader>
            <div className="system-workspace-header-inner">
              <div className="system-workspace-title-group">
                <span className="system-workspace-icon">{activeMeta.icon}</span>
                <div>
                  <div className="system-workspace-title">{activeMeta.title}</div>
                  <div className="system-workspace-description">{activeMeta.description}</div>
                </div>
              </div>
            </div>
          </SystemWorkspaceHeader>
          <SystemWorkspaceBody>
            <ViewComponent
              currentView={activeView}
              libraryId={libraryId}
              onClose={onClose}
              onOpenLegacyRoute={onOpenLegacyRoute}
              onOpenView={onOpenView}
              onSettingsSectionChange={setSettingsSection}
              settingsSection={activeView === 'settings' ? settingsSection : 'home'}
            />
          </SystemWorkspaceBody>
        </div>
      </SystemWorkspaceViewport>
    </SystemWorkspaceRoot>
  );
};

export default SystemWorkspace;
export type {
  SystemWorkspaceActionRoute,
  SystemWorkspaceReturnMode,
  SystemWorkspaceView,
  SettingsWorkspaceSection,
} from './types';
