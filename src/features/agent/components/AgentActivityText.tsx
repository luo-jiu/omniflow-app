import styled, { keyframes } from 'styled-components';

const sweep = keyframes`
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
`;

// Animate the text paint only, keeping line metrics and layout stable.
const AgentActivityText = styled.span<{ $active?: boolean }>`
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--app-text-muted);
  ${({ $active }) => $active && `
    background-color: var(--app-text-muted);
    background-image: linear-gradient(100deg,
      var(--app-text-muted) 40%, var(--app-text) 50%, var(--app-text-muted) 60%);
    background-size: 220% 100%;
    background-repeat: no-repeat;
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  `}
  animation: ${({ $active }) => $active ? sweep : 'none'} 2.4s linear infinite;

  @media (prefers-reduced-motion: reduce), (forced-colors: active) {
    animation: none;
    background: none;
    -webkit-text-fill-color: currentColor;
  }
`;

export default AgentActivityText;
