import { css } from 'styled-components';
import {
  SIDE_PANEL_TOGGLE_ICON_SIZE,
  SIDE_PANEL_TOGGLE_SIZE,
} from './layout-constants';

const sidePanelIconButtonInteractiveStyles = css`
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--app-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
    color: var(--app-text);
  }
`;

const sidePanelIconGlyphStyles = (iconSize = SIDE_PANEL_TOGGLE_ICON_SIZE) => css`
  .semi-icon {
    width: ${iconSize}px;
    height: ${iconSize}px;
    font-size: ${iconSize}px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .semi-icon > svg,
  svg {
    width: ${iconSize}px;
    height: ${iconSize}px;
    display: block;
  }
`;

export const sidePanelIconButtonBaseStyles = css`
  ${sidePanelIconButtonInteractiveStyles}
  width: ${SIDE_PANEL_TOGGLE_SIZE}px;
  height: ${SIDE_PANEL_TOGGLE_SIZE}px;
  ${sidePanelIconGlyphStyles()}
`;

export const sidePanelCompactIconButtonStyles = css`
  ${sidePanelIconButtonInteractiveStyles}
  width: ${SIDE_PANEL_TOGGLE_SIZE - 2}px;
  height: ${SIDE_PANEL_TOGGLE_SIZE - 2}px;
  ${sidePanelIconGlyphStyles(16)}
`;
