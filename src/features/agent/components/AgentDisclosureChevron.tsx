import styled from 'styled-components';

const Chevron = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 20px;
  flex: none;
  color: inherit;
  svg {
    display: block;
    transform-origin: 6px 8px;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  &[data-expanded='true'] svg { transform: rotate(90deg); }
  @media (prefers-reduced-motion: reduce) { svg { transition: none; } }
`;

export default function AgentDisclosureChevron({ expanded }: { expanded: boolean }) {
  return <Chevron data-expanded={expanded} aria-hidden="true">
    <svg width="12" height="16" viewBox="0 0 12 16" fill="none" focusable="false">
      <polyline points="4,4 8,8 4,12" stroke="currentColor" strokeWidth="1"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </Chevron>;
}
