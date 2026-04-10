import styled from 'styled-components';

export const ComicViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
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
    overflow-y: auto;
    overflow-x: auto;
    padding: 10px 0 20px;
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
    min-height: 200px;
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
    font-size: 12px;
    padding: 8px 0 0;
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
    padding: 32px;
  }

  .viewer-footer {
    height: 42px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 12px;
    border-top: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 95%, transparent);
  }

  .back-top-btn {
    position: absolute;
    right: 14px;
    bottom: 52px;
    z-index: 12;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 80%, transparent);
    background: color-mix(in srgb, var(--semi-color-bg-0) 94%, transparent);
    color: var(--semi-color-text-1);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
    backdrop-filter: blur(6px);
  }

  .back-top-btn:hover {
    border-color: color-mix(in srgb, var(--semi-color-success) 52%, var(--semi-color-border));
    color: var(--semi-color-success);
  }

  .footer-side {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 0;
  }

  .footer-side-left {
    justify-content: flex-start;
    overflow: hidden;
  }

  .footer-side-right {
    justify-content: flex-end;
  }

  .footer-title-badge {
    font-size: 11px;
    line-height: 1;
    padding: 3px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-success) 16%, transparent);
    color: var(--semi-color-success);
    font-weight: 600;
    flex-shrink: 0;
  }

  .footer-title {
    min-width: 0;
    font-size: 13px;
    color: var(--semi-color-text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .footer-page-meta {
    flex: 0 0 auto;
    min-width: 120px;
    text-align: center;
    font-size: 13px;
    color: var(--semi-color-text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    white-space: nowrap;
  }

  .footer-btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 96%, transparent);
    color: var(--semi-color-text-1);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: all 120ms ease;
  }

  .footer-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--semi-color-success) 52%, var(--semi-color-border));
    color: var(--semi-color-success);
  }

  .footer-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .footer-btn.is-active {
    border-color: color-mix(in srgb, var(--semi-color-success) 58%, var(--semi-color-border));
    color: var(--semi-color-success);
    background: color-mix(in srgb, var(--semi-color-success-light-default) 30%, var(--semi-color-bg-0));
  }

  .flip-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .flip-canvas {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    gap: 6px;
    padding: 0 44px;
    box-sizing: border-box;
  }

  .flip-canvas.single {
    gap: 0;
    padding: 0 44px;
  }

  .flip-canvas.double {
    gap: 4px;
    padding: 0 32px;
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
    width: min(78vw, 980px);
    height: min(80vh, 760px);
    border-radius: 10px;
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
    width: min(78vw, 980px);
    height: min(80vh, 760px);
    border-radius: 10px;
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
