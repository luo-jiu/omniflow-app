import styled from 'styled-components';

// Presentation only: callers derive archive state from their existing node owner.
// Row selection paints the container; the resource meaning stays on its label.
export const ResourceLabel = styled.span<{ $archived?: boolean }>`
  color: ${({ $archived }) => $archived ? 'var(--app-folder-archive-label, var(--app-text))' : 'inherit'};
  font-weight: ${({ $archived }) => $archived ? 600 : 'inherit'};
`;
