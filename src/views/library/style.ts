import styled from 'styled-components'

export const LibraryWrapper = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  padding: 24px 28px;
  padding-top: 40px;
  background: var(--app-bg);
  color: var(--semi-color-text-0);
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 15px;
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }
`

export const ContentRow = styled.div`
  display: flex;
  gap: 18px;
  flex: 1;
  min-height: 0;
`

export const SideMenu = styled.aside`
  flex: 0 0 240px;
  min-width: 240px;
  margin-top: 10px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 16px 12px 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
`

export const SideMenuHeader = styled.div`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  margin-bottom: 12px;
  padding: 0 10px;
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
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--app-text-secondary);
  background: transparent;
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  line-height: 1.4;

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
  width: 32px;
  height: 32px;
  border: none;
  outline: none;
  background: transparent;
  padding: 0;
  border-radius: 8px;
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
  gap: 16px;
`

export const RightHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: -8px;

  .header-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .semi-button {
    height: 38px;
    padding: 0 16px;
    border-radius: 10px;
    font-size: 14px;
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
  font-size: 26px;
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
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 8px;
  padding: 4px 0 10px;
  align-content: flex-start;
`

export const CardItem = styled.div`
  position: relative;
  min-height: 170px;
  width: min(100%, 188px);
  justify-self: center;
  box-sizing: border-box;
  border-radius: 12px;
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
  height: 170px;
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
    border-radius: 10px;
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
  top: 82px;
  left: 26px;
  right: 24px;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  font-size: 15px;
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
    height: 38px;
    font-size: 14px;
    border-radius: 8px;
  }
`

export const CardActions = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 5px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .1s ease;
`

export const ActionIconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 8px;
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
  padding: 52px 0 24px;
  text-align: center;
  color: var(--app-text-muted);
  font-size: 14px;
`

export default LibraryWrapper
