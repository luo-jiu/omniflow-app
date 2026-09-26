import type { ReactNode } from 'react';
import styled from 'styled-components';
import OutlineIcon, { type OutlineIconName } from './outline-icon';
import { focusVisibleStyles } from './theme-foundation-styles';
import { floatingViewerDockSurfaceStyles } from './floating-viewer-dock-styles';

const Dock = styled.div`
  ${floatingViewerDockSurfaceStyles}
  position: absolute;
  z-index: 12;
  box-sizing: border-box;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  max-width: calc(100% - 32px);
  min-width: 0;
  min-height: 40px;
  padding: 5px 10px;
  border-radius: 16px;
  font-size: 12px;
  line-height: 1.4;

  .viewer-dock-decoration { position: absolute; inset: -1px; z-index: 0; pointer-events: none; }
  .viewer-dock-decoration > * { pointer-events: auto; }

  .viewer-dock-identity {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .viewer-dock-kind { display: inline-flex; flex: none; }
  .viewer-dock-name {
    min-width: 0;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .viewer-dock-detail {
    flex: none;
    color: var(--app-text-secondary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
  }
  .viewer-dock-actions {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: none;
  }

  &[data-placement='right'] {
    left: auto;
    right: 12px;
    top: 50%;
    bottom: auto;
    transform: translateY(-50%);
    flex-direction: column;
    width: 40px;
    max-height: calc(100% - 24px);
    padding: 10px 5px;
    border-radius: 20px;

    .viewer-dock-identity {
      flex-direction: column;
      min-height: 0;
      gap: 10px;
    }
    .viewer-dock-name {
      writing-mode: vertical-rl;
      text-orientation: mixed;
      max-width: none;
      max-height: 180px;
      min-height: 0;
    }
    .viewer-dock-actions { flex-direction: column; }
  }
`;

export const FloatingViewerDockButton = styled.button.attrs({ type: 'button' })`
  appearance: none;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--app-text);
  cursor: pointer;

  .app-outline-icon:not([data-selected='true']) { color: inherit; }
  &:hover:not(:disabled) { background: var(--app-hover-bg); }
  &:active:not(:disabled) { background: var(--app-active-bg); }
  &:disabled { color: var(--app-text-disabled); cursor: not-allowed; }
  &:disabled .app-outline-icon[data-selected] { color: inherit; }
  ${focusVisibleStyles}
`;

export default function FloatingViewerDock({ label, title, icon, detail, placement = 'bottom', hideIdentity = false, decoration, children }: {
  label: string;
  title: string;
  icon: OutlineIconName;
  detail?: ReactNode;
  placement?: 'bottom' | 'right';
  hideIdentity?: boolean;
  decoration?: ReactNode;
  children?: ReactNode;
}) {
  return <Dock role="group" aria-label={`${label}信息与操作`} title={`${label} · ${title}`} data-placement={placement}>
    {decoration && <div className="viewer-dock-decoration">{decoration}</div>}
    {!hideIdentity && <div className="viewer-dock-identity" title={`${label} · ${title}`}>
      <span className="viewer-dock-kind" aria-label={label}><OutlineIcon name={icon} /></span>
      <span className="viewer-dock-name">{title}</span>
    </div>}
    {detail != null && <span className="viewer-dock-detail">{detail}</span>}
    {children && <div className="viewer-dock-actions">{children}</div>}
  </Dock>;
}
