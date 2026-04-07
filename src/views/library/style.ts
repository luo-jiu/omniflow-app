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
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 16px 12px;
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
    gap: 6px;
    padding: 4px 8px 4px 4px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--app-text-secondary);
  }

  .user-trigger:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text);
  }

  .user-name {
    font-size: 13px;
    color: inherit;
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
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  padding: 4px 0 10px;
  align-content: flex-start;
`

export const CardItem = styled.div`
  position: relative;
  min-height: 160px;
  box-sizing: border-box;
  border-radius: 12px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 14px;
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease;
  user-select: none;
  padding: 18px;

  &:hover {
    border-color: var(--app-border-strong);
    background: #fafaf8;
  }

  &:hover .card-actions {
    opacity: 1;
    pointer-events: auto;
  }
`

export const CardIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 10px;
  background: var(--app-panel-muted);
  color: var(--app-accent);
`

export const CardName = styled.div`
  max-width: 100%;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
`

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
