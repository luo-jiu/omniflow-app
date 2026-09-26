import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

export const ComicViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(1100px 560px at 50% -18%, rgba(34, 197, 94, 0.12), transparent 60%),
    linear-gradient(180deg, var(--semi-color-bg-0) 0%, var(--semi-color-bg-1) 100%);
  color: var(--semi-color-text-0);
  overflow: hidden;

  .pages-scroll {
    flex: 1;
    min-height: 0;
    width: calc(100% - 64px);
    box-sizing: border-box;
    overflow-y: auto;
    overflow-x: auto;
    padding: 7px 0 13px;
    ${workspaceScrollbarStyles}
    scrollbar-width: none;
    &::-webkit-scrollbar { display: none; }
  }

  .pages-grid {
    margin: 0 auto;
    display: grid;
    align-items: start;
    row-gap: 0;
  }

  .pages-grid.column-1 {
    justify-content: center;
  }

  .pages-grid.column-2 {
    justify-content: center;
  }

  .page-shell {
    margin: 0 auto;
    border-radius: 0;
    overflow: hidden;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .page-image {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
    background: transparent;
  }

  .page-skeleton {
    width: 100%;
    min-height: 134px;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--semi-color-fill-0) 84%, #000) 0%,
        color-mix(in srgb, var(--semi-color-fill-1) 88%, #000) 48%,
        color-mix(in srgb, var(--semi-color-fill-0) 84%, #000) 100%
      );
    background-size: 260% 100%;
    animation: comic-placeholder 1.4s ease-in-out infinite;
  }

  .load-more-sentinel {
    grid-column: 1 / -1;
    width: 100% !important;
    height: 8px;
  }

  .load-state {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-text-2);
    font-size: 10px;
    padding: 5px 0 0;
  }

  .state-empty,
  .state-error {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--semi-color-text-2);
    padding: 21px;
  }

  .flip-stage {
    outline: none;
    flex: 1;
    min-height: 0;
    width: calc(100% - 64px);
    position: relative;
    overflow: hidden;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .flip-stage:focus-visible { outline: 2px solid var(--app-focus-border); outline-offset: -2px; }
  html[data-app-input-modality='pointer'] & .flip-stage:focus-visible { outline: none; }

  .comic-context-menu-layer {
    position: absolute;
    z-index: 9999;
    transform: translate(0, 4px);
  }

  .flip-canvas {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    gap: 4px;
    padding: 0 29px;
    box-sizing: border-box;
  }

  .flip-canvas.single {
    gap: 0;
    padding: 0 29px;
  }

  .flip-canvas.double {
    gap: 3px;
    padding: 0 21px;
  }

  .comic-page-counter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    line-height: 1.25;
    color: var(--app-text);
  }

  .comic-page-divider {
    display: flex;
    gap: 4px;
    padding: 2px 0;
  }

  .comic-page-divider::before,
  .comic-page-divider::after {
    content: '';
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: currentColor;
  }

  .flip-page-panel {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .flip-canvas.double .flip-page-panel:first-child {
    justify-content: flex-end;
  }

  .flip-canvas.double .flip-page-panel:last-child {
    justify-content: flex-start;
  }

  .flip-canvas.double .flip-page-panel:first-child .flip-image {
    transform-origin: right center;
  }

  .flip-canvas.double .flip-page-panel:last-child .flip-image {
    transform-origin: left center;
  }

  .flip-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform-origin: center center;
    will-change: transform;
  }

  .flip-image-skeleton {
    width: min(78vw, 656px);
    height: min(80vh, 509px);
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--semi-color-fill-0) 84%, #000) 0%,
        color-mix(in srgb, var(--semi-color-fill-1) 88%, #000) 48%,
        color-mix(in srgb, var(--semi-color-fill-0) 84%, #000) 100%
      );
    background-size: 260% 100%;
    animation: comic-placeholder 1.4s ease-in-out infinite;
  }

  .flip-image-empty {
    width: min(78vw, 656px);
    height: min(80vh, 509px);
    border-radius: 7px;
    background: color-mix(in srgb, var(--semi-color-fill-0) 56%, transparent);
    border: 1px dashed color-mix(in srgb, var(--semi-color-border) 70%, transparent);
  }

  .flip-stage.can-pan .flip-image {
    cursor: grab;
  }

  .flip-stage.is-panning .flip-image {
    cursor: grabbing;
    transition: none;
  }

  @keyframes comic-placeholder {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
`;
