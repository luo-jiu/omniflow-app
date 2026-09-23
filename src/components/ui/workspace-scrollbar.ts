import { css } from 'styled-components';

export const workspaceScrollbarStyles = css`
  scrollbar-width: thin;
  scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track,
  &::-webkit-scrollbar-corner {
    background: var(--app-scrollbar-track);
  }

  &::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
    border-radius: 999px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
  }
`;
