import styled, { createGlobalStyle } from 'styled-components';

export const SystemWorkspaceDropdownStyle = createGlobalStyle`
  .system-workspace-select-dropdown {
    padding: 3px;
    border-radius: 8px;
    background: var(--semi-color-bg-3);
    border: 1px solid var(--semi-color-border);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
    overflow: hidden;
  }

  .system-workspace-select-dropdown .semi-select-option {
    min-height: 28px;
    height: 28px;
    padding: 0 9px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 28px;
  }
`;

export const SystemWorkspaceRoot = styled.section`
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  color: var(--app-text);
  overflow: hidden;
`;

export const SystemWorkspaceTabBar = styled.div`
  width: 100%;
  min-width: 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  position: relative;
  margin-top: 2px;
  padding: 1px 32px 4px 2px;

  &::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--app-border);
    pointer-events: none;
    z-index: 1;
  }

  .system-tab {
    height: 30px;
    min-width: 130px;
    max-width: 240px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
    color: var(--app-text);
    border-radius: 8px;
    padding: 0 9px 0 10px;
    cursor: pointer;
    user-select: none;
    position: relative;
    z-index: 2;
  }

  .system-tab.active {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
    cursor: default;
  }

  .system-tab:not(.active) {
    border-color: var(--app-border);
    background: var(--app-bg-elevated);
  }

  .system-tab:not(.active):hover {
    border-color: color-mix(in srgb, var(--semi-color-primary) 46%, var(--app-border));
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 36%, var(--app-bg-elevated));
  }

  .system-tab-badge {
    flex-shrink: 0;
    min-width: 30px;
    height: 20px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-primary) 14%, var(--app-bg-elevated));
    color: var(--semi-color-primary);
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 36%, transparent);
    font-size: 10px;
    line-height: 18px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-align: center;
    padding: 0 6px;
  }

  .system-tab-title {
    min-width: 0;
    flex: 1;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  .system-tab-close {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--semi-color-text-2);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .system-tab-close:hover {
    color: var(--semi-color-danger);
    background: color-mix(in srgb, var(--semi-color-danger) 12%, transparent);
  }

  .system-tab-close .semi-icon {
    font-size: 11px;
  }
`;

export const SystemWorkspaceViewport = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 24px 24px;
  display: flex;
  container-type: inline-size;

  .system-workspace-center-frame {
    width: 100%;
    margin: 0;
    min-height: 0;
  }

  .system-workspace-frame-settings,
  .system-workspace-frame-profile {
    width: 760px;
    min-width: 760px;
    margin: 0 auto;
  }

  .system-workspace-frame-settings-detail {
    width: 1120px;
    min-width: 1120px;
    height: 100%;
    min-height: 520px;
    max-height: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  .system-workspace-frame-uploads,
  .system-workspace-frame-recycle-bin {
    width: 760px;
    min-width: 760px;
    margin: 0 auto;
  }

  @container (max-width: 808px) {
    .system-workspace-frame-settings,
    .system-workspace-frame-profile,
    .system-workspace-frame-uploads,
    .system-workspace-frame-recycle-bin {
      margin-left: 0;
      margin-right: 0;
    }
  }

  @container (max-width: 1168px) {
    .system-workspace-frame-settings-detail {
      margin-left: 0;
      margin-right: 0;
    }
  }

  .system-workspace-frame-settings .system-workspace-header-inner,
  .system-workspace-frame-profile .system-workspace-header-inner,
  .system-workspace-frame-settings-detail .system-workspace-header-inner {
    width: 100%;
    margin: 0;
  }

  .system-workspace-frame-uploads .system-workspace-header-inner,
  .system-workspace-frame-recycle-bin .system-workspace-header-inner {
    width: 100%;
    margin: 0;
  }

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--semi-color-text-2) 24%, transparent);
    border-radius: 999px;
  }
`;

export const SystemWorkspaceHeader = styled.div`
  flex-shrink: 0;
  padding: 14px 0 12px;

  .system-workspace-header-inner {
    width: 100%;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
  }

  .system-workspace-title-group {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .system-workspace-icon {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--semi-color-primary-light-default);
    color: var(--semi-color-primary);
    flex-shrink: 0;
  }

  .system-workspace-icon .semi-icon {
    font-size: 15px;
  }

  .system-workspace-title {
    font-size: 15px;
    line-height: 1.25;
    font-weight: 650;
    color: var(--app-text);
  }

  .system-workspace-description {
    margin-top: 3px;
    font-size: 11px;
    line-height: 1.35;
    color: var(--app-text-muted);
  }

`;

export const SystemWorkspaceBody = styled.div`
  padding: 18px 0 24px;

  .system-workspace-frame-settings-detail & {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  &::before {
    content: "";
    display: block;
    width: 100%;
    height: 1px;
    margin: 0 0 13px;
    background: var(--app-border);
  }
`;

export const SystemWorkspaceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
`;

export const SystemWorkspaceCard = styled.button`
  min-height: 92px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-bg-elevated);
  color: var(--app-text);
  padding: 13px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 11px;

  &:hover {
    border-color: var(--semi-color-primary-light-active);
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 28%, var(--app-bg-elevated));
  }

  .system-card-icon {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--semi-color-fill-0);
    color: var(--semi-color-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .system-card-icon .semi-icon {
    font-size: 15px;
  }

  .system-card-main {
    min-width: 0;
  }

  .system-card-title {
    display: block;
    font-size: 13px;
    line-height: 1.3;
    font-weight: 650;
  }

  .system-card-description {
    display: block;
    margin-top: 5px;
    font-size: 11px;
    line-height: 1.45;
    color: var(--app-text-muted);
  }
`;

export const SystemWorkspacePanel = styled.div`
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-bg-elevated);
  overflow: hidden;
`;
