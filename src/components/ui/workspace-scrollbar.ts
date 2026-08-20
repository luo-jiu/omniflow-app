import { css } from 'styled-components';

export const workspaceScrollbarStyles = css`
  scrollbar-width: thin;
  scrollbar-color: transparent var(--app-scrollbar-track);

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track,
  &::-webkit-scrollbar-corner {
    background: var(--app-scrollbar-track);
  }

  &::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  &:hover,
  &:focus-within,
  &:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  &:hover::-webkit-scrollbar-thumb,
  &:focus-within::-webkit-scrollbar-thumb,
  &:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  &:hover::-webkit-scrollbar-thumb:hover,
  &:focus-within::-webkit-scrollbar-thumb:hover,
  &:active::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
  }
`;
