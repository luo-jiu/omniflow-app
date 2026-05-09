import { IconClose } from '@douyinfe/semi-icons';
import { useMemo, useState, type FC } from 'react';
import {
  systemWorkspaceMeta,
  systemWorkspaceViews,
} from './registry';
import {
  SystemWorkspaceBody,
  SystemWorkspaceHeader,
  SystemWorkspaceRoot,
  SystemWorkspaceTabBar,
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
  tabs: SystemWorkspaceView[];
  onActivateView: (view: SystemWorkspaceView) => void;
  onClose: () => void;
  onCloseView: (view: SystemWorkspaceView) => void;
  onOpenLegacyRoute: (route: SystemWorkspaceActionRoute) => void;
  onOpenView: (view: SystemWorkspaceView) => void;
};

const SystemWorkspace: FC<SystemWorkspaceProps> = ({
  activeView: activeViewProp,
  libraryId,
  tabs,
  onActivateView,
  onClose,
  onCloseView,
  onOpenLegacyRoute,
  onOpenView,
}) => {
  const [settingsSection, setSettingsSection] = useState<SettingsWorkspaceSection>('home');
  const activeView = activeViewProp ?? tabs[0] ?? 'overview';
  const visibleTabs = tabs.length > 0 ? tabs : [activeView];
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
      <SystemWorkspaceTabBar>
        {visibleTabs.map((tabView) => {
          const tabMeta = systemWorkspaceMeta[tabView];
          const isActive = tabView === activeView;
          return (
            <button
              key={tabView}
              type="button"
              className={`system-tab ${isActive ? 'active' : ''}`}
              onClick={() => onActivateView(tabView)}
            >
              <span className="system-tab-badge">系统</span>
              <span className="system-tab-title">{tabMeta.title}</span>
              <span
                role="button"
                tabIndex={0}
                className="system-tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseView(tabView);
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onCloseView(tabView);
                  }
                }}
              >
                <IconClose />
              </span>
            </button>
          );
        })}
      </SystemWorkspaceTabBar>
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
