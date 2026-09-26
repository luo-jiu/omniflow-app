import styled, { css } from 'styled-components';
import {
  buttonStyles,
  inputStyles,
  selectableItemStyles,
  surfaceStyles,
  textToneStyles,
  type ThemeButtonVariant,
  type ThemeSurfaceRole,
  type ThemeTextTone,
} from './theme-foundation-styles';

const buttonLayoutStyles = css`
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--app-radius-medium);
  font: inherit;
  line-height: 1.4;
  cursor: pointer;
`;

export const ThemeSurface = styled.div<{ $surface?: ThemeSurfaceRole }>`
  ${({ $surface = 'panel' }) => surfaceStyles($surface)}
`;

export const ThemeText = styled.span<{ $tone?: ThemeTextTone }>`
  ${({ $tone = 'primary' }) => textToneStyles($tone)}
`;

export const ThemeButton = styled.button.attrs<{ $variant?: ThemeButtonVariant }>(props => ({
  type: props.type ?? 'button',
}))`
  ${buttonLayoutStyles}
  ${({ $variant = 'secondary' }) => buttonStyles($variant)}
`;

export const ThemeInput = styled.input`
  ${inputStyles}
`;

export const ThemeSelectableButton = styled.button.attrs(props => ({
  type: props.type ?? 'button',
}))`
  ${buttonLayoutStyles}
  color: var(--app-text);
  justify-content: flex-start;
  border-radius: var(--app-radius-small);
  ${selectableItemStyles}
`;
