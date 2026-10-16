import { css } from 'styled-components';
import { surfaceStyles } from '@/components/ui/theme-foundation-styles';

export const agentToolDetailSurfaceStyles = css`
  ${surfaceStyles('raised')}

  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-small);
`;

export const agentToolDetailDisclosureSummaryStyles = css`
  display: flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  max-width: 100%;
  min-height: 20px;
  border-radius: var(--app-radius-small);
  cursor: pointer;
  list-style: none;

  &::-webkit-details-marker { display: none; }
  &::marker { content: ''; }

  &:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
`;
