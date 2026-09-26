import styled from 'styled-components';
import { floatingViewerDockSurfaceStyles } from '@/components/ui/floating-viewer-dock-styles';

export const ComicDockControls = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  .comic-dock-anchor { position: relative; }
  .comic-dock-anchor, > button { z-index: 2; }
  .comic-page-counter { height: 62px; padding: 5px 0; }
`;

export const ComicScrollProgressRing = styled.svg`
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  z-index: 0;
  cursor: pointer;
  outline: none;
  &:focus-visible { filter: drop-shadow(0 0 2px var(--app-accent)); }
  .comic-scroll-progress-track, .comic-scroll-progress-fill { fill: none; stroke-width: 4; vector-effect: non-scaling-stroke; }
  .comic-scroll-progress-track { stroke: var(--app-border-strong); }
  .comic-scroll-progress-fill { stroke: var(--app-accent); stroke-linecap: round; }
`;

export const ComicDockPanel = styled.div<{ $progress?: boolean }>`
  ${floatingViewerDockSurfaceStyles}
  position: absolute;
  right: calc(100% + 16px);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: ${({ $progress }) => $progress ? 'min(220px, calc(100cqw - 84px))' : 'max-content'};
  max-width: calc(100cqw - 84px);
  padding: 8px;
  border-radius: 16px;
  background: var(--app-bg-popover);
  animation: comic-dock-reveal 140ms ease-out;

  &::after {
    content: '';
    position: absolute;
    right: -5px;
    top: calc(50% - 5px);
    width: 8px;
    height: 8px;
    background: var(--app-bg-popover);
    border-top: 1px solid var(--app-border);
    border-right: 1px solid var(--app-border);
    transform: rotate(45deg);
  }
  .comic-progress-value { font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .comic-progress-range { position: relative; flex: 1; min-width: 0; height: 20px; }
  .comic-progress-track {
    position: absolute; inset: 8.5px 0; border-radius: 999px;
    background: var(--app-border-strong); overflow: hidden; pointer-events: none;
  }
  .comic-progress-track > span {
    display: block; height: 100%; border-radius: inherit;
    background: linear-gradient(90deg, var(--app-accent-active), var(--app-accent));
  }
  input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .comic-progress-range:has(input:focus-visible) { outline: 2px solid var(--app-focus-border); outline-offset: 2px; border-radius: 5px; }
  @keyframes comic-dock-reveal {
    from { opacity: 0; transform: translate(6px, -50%); }
    to { opacity: 1; transform: translate(0, -50%); }
  }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
