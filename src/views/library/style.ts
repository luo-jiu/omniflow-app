import styled from 'styled-components'

export const LibraryWrapper = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  padding: 18px 22px;
  padding-top: 34px;
  background: var(--app-bg);
  color: var(--semi-color-text-0);
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 12px;
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }
`

export const ContentRow = styled.div`
  display: flex;
  gap: 14px;
  flex: 1;
  min-height: 0;
`

export const SideMenu = styled.aside`
  flex: 0 0 176px;
  min-width: 176px;
  margin-top: 7px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px 9px 9px;
  display: flex;
  flex-direction: column;
  min-height: 0;
`

export const SideMenuHeader = styled.div`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  margin-bottom: 8px;
  padding: 0 7px;
`

export const SideMenuList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`

export const SideMenuItem = styled.div`
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--app-text-secondary);
  background: transparent;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  line-height: 1.35;

  &:not(:last-child) { margin-bottom: 2px; }

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    color: var(--app-text);
  }

  &[data-active='true'] {
    background: rgba(0, 0, 0, 0.06);
    color: var(--app-text);
    font-weight: 600;
  }
`

export const SideMenuFooter = styled.div`
  margin-top: auto;
  padding-top: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
`

export const SideMenuAction = styled.button`
  width: 28px;
  height: 28px;
  border: none;
  outline: none;
  background: transparent;
  padding: 0;
  border-radius: 7px;
  color: var(--app-text-secondary);
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text);
  }
`

export const VerticalDivider = styled.div`
  display: none;
`

export const CardArea = styled.section`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 11px;
`

export const RightHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: -5px;

  .header-right {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .semi-button {
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 500;
    box-shadow: none;
  }

  .user-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border-radius: 999px;
    cursor: pointer;
    color: var(--app-text-secondary);
  }

  .user-trigger:hover {
    background: rgba(0, 0, 0, 0.04);
    color: var(--app-text);
  }
`

export const RightHeaderTitle = styled.h3`
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
`

export const RightHeaderDivider = styled.div`
  height: 1px;
  background: var(--app-border);
  width: 100%;
`

export const CardScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;

  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
`

export const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
  padding: 2px 0 8px;
  align-content: flex-start;
`

export const CardItem = styled.div`
  position: relative;
  min-height: 120px;
  width: min(100%, 132px);
  justify-self: center;
  box-sizing: border-box;
  border-radius: 8px;
  background: transparent;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-end;
  gap: 0;
  cursor: pointer;
  transition: transform .15s ease;
  user-select: none;
  padding: 0;

  &:hover {
    transform: translateY(-1px);
  }

  &:hover .card-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .card-main {
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
`

export const CardIcon = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 120px;
  background: transparent;
  background-position: center;
  background-size: contain;
  background-repeat: no-repeat;
  user-select: none;
  pointer-events: none;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    background: transparent;
    pointer-events: none;
    z-index: 1;
  }

  body[theme-mode="dark"] &::after {
    background: rgba(15, 18, 24, 0.24);
  }
`

export const CardName = styled.div`
  position: absolute;
  top: 58px;
  left: 18px;
  right: 16px;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  color: #6d4b0a;
  text-shadow: 0 1px 0 rgba(255, 243, 209, 0.45);
  line-height: 1.4;
  pointer-events: none;
  z-index: 2;

  body[theme-mode="dark"] & {
    color: #f3e0b2;
    text-shadow: 0 1px 0 rgba(25, 22, 14, 0.52);
  }
`

/* 实验版文件夹样式备份（当前停用）
const FolderArt = styled.div`
  position: relative;
  width: min(100%, 188px);
  height: 136px;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 20px;
    bottom: 0;
    border-radius: 0 10px 10px 10px;
    border: 1px solid var(--folder-border);
    background: var(--folder-body);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--folder-body) 22%, #ffffff 78%),
      0 6px 12px color-mix(in srgb, var(--folder-border) 35%, transparent 65%);
    z-index: 1;
  }

  .folder-tab-main {
    position: absolute;
    top: 2px;
    left: 0;
    width: 92px;
    height: 20px;
    background: var(--folder-top);
    border: 1px solid var(--folder-border);
    border-right: none;
    border-bottom: none;
    border-radius: 8px 0 0 0;
    z-index: 4;

    &::after {
      content: '';
      position: absolute;
      top: -1px;
      right: -15px;
      width: 24px;
      height: 21px;
      background: var(--folder-top);
      border-top: 1px solid var(--folder-border);
      border-right: 1px solid var(--folder-border);
      border-radius: 0 8px 0 0;
      transform: skewX(30deg);
      transform-origin: left top;
      z-index: 5;
    }
  }

  .folder-top-band {
    position: absolute;
    top: 19px;
    left: -1px;
    right: -1px;
    height: 25px;
    border-radius: 0 10px 0 0;
    background: var(--folder-top);
    box-shadow: none;
    z-index: 2;
  }
`;

const FolderLabel = styled.div`
  position: absolute;
  top: 53px;
  left: 12px;
  right: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--folder-label);
  font-size: 15px;
  font-weight: 700;
  text-shadow: 0 1px 0 color-mix(in srgb, var(--folder-body) 16%, #ffffff 84%);
  z-index: 6;
`;
*/

export const CardNameEdit = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;

  .semi-input-wrapper,
  input {
    height: 30px;
    font-size: 11px;
    border-radius: 6px;
  }
`

export const CardActions = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .1s ease;
`

export const ActionIconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 7px;
  border: 1px solid var(--app-border);
  background: var(--app-bg-elevated);
  color: var(--app-text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--app-panel-muted);
    color: var(--app-text);
  }
`

export const ContextMenu = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 240px;
  padding: 10px;
  border-radius: 10px;
  background: var(--app-panel);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow);
`

export const ContextMenuTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--app-text);
  font-size: 14px;
  padding: 4px 8px;
`

export const ContextMenuActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  & > * { width: 100%; }
`

export const EmptyTip = styled.div`
  padding: 38px 0 18px;
  text-align: center;
  color: var(--app-text-muted);
  font-size: 11px;
`

export default LibraryWrapper
