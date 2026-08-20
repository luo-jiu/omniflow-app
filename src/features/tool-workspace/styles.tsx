import styled from 'styled-components';

import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { getToolNavCollapseButtonLeft } from './tool-workspace.layout';

export const Wrapper = styled.div<{ $toolNavCollapsed: boolean; $toolNavWidth: number }>`
  --tool-nav-motion-duration: 220ms;
  --tool-nav-width: ${({ $toolNavWidth }) => `${$toolNavWidth}px`};
  --tool-nav-collapse-button-left: ${({ $toolNavCollapsed, $toolNavWidth }) => (
    `${getToolNavCollapseButtonLeft($toolNavWidth, $toolNavCollapsed)}px`
  )};

  flex: 1;
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: var(--tool-nav-width) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
  position: relative;
  transition: grid-template-columns var(--tool-nav-motion-duration) cubic-bezier(0.4, 0, 0.2, 1);

  @media (prefers-reduced-motion: reduce) {
    --tool-nav-motion-duration: 1ms;
  }

  &[data-resizing='true'] {
    --tool-nav-motion-duration: 0ms;
  }
`;

export const ToolNav = styled.aside`
  container-name: tool-nav;
  container-type: inline-size;
  box-sizing: border-box;
  border-right: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-sidebar-vibrancy) 88%, var(--app-bg) 12%);
  padding: 13px 11px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
  overflow: hidden;

  .title {
    padding-right: 28px;
    font-size: 14px;
    font-weight: 700;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-card {
    appearance: none;
    box-sizing: border-box;
    display: flex;
    align-items: stretch;
    width: 100%;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg-elevated) 88%, transparent);
    overflow: hidden;
  }

  .tool-card.is-active {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
  }

  .tool-card:disabled {
    cursor: default;
  }

  .tool-card.is-dragging {
    z-index: 2;
    opacity: 0.72;
    box-shadow: var(--app-shadow);
  }

  .tool-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
    min-width: 0;
  }

  .tool-card-action,
  .tool-card-handle {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
  }

  .tool-card-action {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    padding: 0 8px;
    text-align: left;
    cursor: pointer;
  }

  .tool-card-action:focus-visible,
  .tool-card-handle:focus-visible {
    outline: 1px solid var(--semi-color-primary);
    outline-offset: -2px;
  }

  .tool-card-handle {
    display: inline-flex;
    width: 28px;
    min-width: 28px;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--app-text-muted);
    cursor: grab;
    touch-action: none;
    opacity: 0.62;
  }

  .tool-card-handle:hover,
  .tool-card-handle:focus-visible {
    color: var(--app-text);
    opacity: 1;
  }

  .tool-card-handle:active {
    cursor: grabbing;
  }

  .tool-card-handle-dots {
    position: relative;
    width: 6px;
    height: 10px;
  }

  .tool-card-handle-dots::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 2px;
    height: 2px;
    border-radius: 1px;
    background: currentColor;
    box-shadow:
      0 4px currentColor,
      0 8px currentColor,
      4px 0 currentColor,
      4px 4px currentColor,
      4px 8px currentColor;
  }

  .tool-card-title {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    width: 100%;
    font-size: 12px;
    font-weight: 700;
    color: var(--app-text);
  }

  .tool-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: none;
    color: currentColor;
  }

  .tool-card-icon svg {
    width: 16px;
    height: 16px;
  }

  .tool-card-icon .tool-static-icon {
    display: block;
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  .tool-card-icon .tool-material-icon {
    display: block;
    width: 16px;
    height: 16px;
    background: currentColor;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: 16px 16px;
    mask-size: 16px 16px;
  }

  .tool-card-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @container tool-nav (max-width: 156px) {
    .tool-card-handle {
      display: none;
    }
  }

  @container tool-nav (max-width: 34px) {
    .title {
      visibility: hidden;
    }

    .tool-card-label {
      display: none;
    }

    .tool-card-title {
      justify-content: center;
    }

    .tool-card {
      position: relative;
      align-self: center;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      overflow: visible;
    }

    .tool-card-action {
      position: relative;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .tool-card-action::before {
      content: '';
      position: absolute;
      inset: -4px -5px;
      background: transparent;
    }
  }

  .semi-button {
    min-height: 30px;
    font-size: 11px;
  }
`;

export const ToolNavCollapseButton = styled.button`
  appearance: none;
  position: absolute;
  top: 10px;
  left: var(--tool-nav-collapse-button-left);
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--semi-color-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    left var(--tool-nav-motion-duration) cubic-bezier(0.4, 0, 0.2, 1),
    background-color 140ms ease,
    transform 140ms ease;
  z-index: 5;

  &:hover {
    background: var(--semi-color-primary-light-default);
  }

  &:active {
    transform: scale(0.94);
  }

  &:focus-visible {
    outline: 2px solid var(--semi-color-primary);
    outline-offset: 2px;
  }

  svg {
    width: 14px;
    height: 14px;
    transform: rotate(0deg);
    transition: transform var(--tool-nav-motion-duration) cubic-bezier(0.4, 0, 0.2, 1);
  }

  &[data-collapsed='true'] svg {
    transform: rotate(180deg);
  }
`;

export const ToolNavResizeHandle = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--tool-nav-width) - 3px);
  width: 6px;
  cursor: col-resize;
  z-index: 4;
  touch-action: none;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 1px;
    background: transparent;
  }

  &:hover::after,
  &:focus-visible::after,
  &[data-resizing='true']::after {
    background: var(--semi-color-primary);
  }

  &:focus-visible {
    outline: none;
  }
`;

export const WorkspaceMain = styled.div`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

export const WorkspaceSection = styled.div<{ $active: boolean }>`
  display: ${({ $active }) => ($active ? 'flex' : 'none')};
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
`;

export const WorkspaceHeader = styled.div`
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--app-border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;

  .header-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.2;
  }

  .header-desc {
    font-size: 11px;
    line-height: 1.55;
    color: var(--app-text-muted);
  }

  .header-tags {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
`;

export const WorkspaceBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  ${workspaceScrollbarStyles}
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const Panel = styled.section`
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--app-bg-elevated) 92%, transparent);
  padding: 12px;

  .panel-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--app-text);
    margin-bottom: 8px;
  }

  .panel-desc {
    font-size: 11px;
    line-height: 1.55;
    color: var(--app-text-muted);
    margin-bottom: 9px;
  }
`;

export const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .field.full {
    grid-column: 1 / -1;
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text-muted);
  }

  .models-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .model-input {
    flex: 1;
    min-width: 0;
  }

  .model-refresh-button {
    min-height: 32px;
    flex: none;
    font-size: 12px;
  }

  .semi-input-wrapper,
  .semi-input,
  .semi-input-number,
  .semi-input-number-input,
  .semi-input-textarea {
    font-size: 13px;
  }

  .semi-input-wrapper,
  .semi-input-number {
    min-height: 32px;
    border-radius: 6px;
  }
`;

export const ActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;

  .semi-button {
    min-height: 30px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 11px;
  }

  .semi-tag {
    font-size: 10px;
  }

  .merge-status {
    font-size: 11px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .merge-status.ok {
    color: var(--app-text);
  }
`;
