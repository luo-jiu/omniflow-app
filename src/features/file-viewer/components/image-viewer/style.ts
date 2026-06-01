import styled from 'styled-components';

export const ImageViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  background: var(--semi-color-bg-0);

  /* 移除外层可能存在的间距，确保占满 */
  margin: 0;
  padding: 0;

  &.can-pan {
    .image-container {
      cursor: grab;
    }
  }

  &.is-panning {
    .image-container {
      cursor: grabbing;
    }
  }

  .image-container {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }

  .viewer-image {
    display: block;
    max-width: none;
    max-height: none;
    user-select: none;
    pointer-events: none;
    box-shadow: none;
    border-radius: 0;
    transform-origin: center center;
    will-change: transform;
  }

  .image-preview-placeholder {
    width: min(320px, 72vw);
    min-height: 140px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--semi-color-text-2);
    font-size: 13px;
    line-height: 20px;
    text-align: center;
    white-space: nowrap;
  }

  /* 悬浮功能栏：居中、透明玻璃效果 */
  .viewer-floating-bar {
    position: absolute;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    
    background: var(--semi-color-bg-3);
    /* 玻璃拟态效果 */
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    background-color: rgba(var(--semi-grey-9), 0.7); /* 半透明背景 */
    
    border: 1px solid var(--semi-color-border);
    border-radius: 24px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    z-index: 100;
    
    /* 默认半透明，悬浮时更清晰 */
    opacity: 0.85;
    transition: all 0.3s ease;
    
    &:hover {
      opacity: 1;
      transform: translateX(-50%) translateY(-2px);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
    }
  }

  .info-tag {
    font-size: 13px;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0,0,0,0.2);
  }

  .scale-tag {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.7);
    background: rgba(255, 255, 255, 0.15);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .image-crop-layer {
    position: absolute;
    inset: 0;
    z-index: 120;
    overflow: hidden;
    cursor: default;
  }

  .image-crop-toolbar {
    position: absolute;
    top: 16px;
    left: 50%;
    z-index: 4;
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 5px 6px 5px 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(17, 24, 39, 0.78);
    color: #fff;
    box-shadow: 0 14px 42px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    transform: translateX(-50%);
  }

  .image-crop-title,
  .image-crop-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .image-crop-title {
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }

  .image-crop-action.semi-button {
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 6px;
  }

  .image-crop-dim {
    position: absolute;
    z-index: 1;
    background: rgba(0, 0, 0, 0.52);
    pointer-events: none;
  }

  .image-crop-dim.top {
    top: 0;
    left: 0;
    right: 0;
  }

  .image-crop-dim.right {
    top: 0;
    right: 0;
    bottom: 0;
  }

  .image-crop-dim.bottom {
    left: 0;
    right: 0;
    bottom: 0;
  }

  .image-crop-dim.left {
    top: 0;
    left: 0;
    bottom: 0;
  }

  .image-crop-box {
    position: absolute;
    z-index: 3;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.96);
    background: rgba(255, 255, 255, 0.03);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.42),
      0 14px 36px rgba(0, 0, 0, 0.22);
    cursor: move;
    touch-action: none;
  }

  .image-crop-grid {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to right, transparent 33.333%, rgba(255, 255, 255, 0.58) 33.333%, rgba(255, 255, 255, 0.58) calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent 66.666%, rgba(255, 255, 255, 0.58) 66.666%, rgba(255, 255, 255, 0.58) calc(66.666% + 1px), transparent calc(66.666% + 1px)),
      linear-gradient(to bottom, transparent 33.333%, rgba(255, 255, 255, 0.58) 33.333%, rgba(255, 255, 255, 0.58) calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent 66.666%, rgba(255, 255, 255, 0.58) 66.666%, rgba(255, 255, 255, 0.58) calc(66.666% + 1px), transparent calc(66.666% + 1px));
    pointer-events: none;
  }

  .image-crop-size {
    position: absolute;
    right: 6px;
    bottom: 6px;
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(17, 24, 39, 0.76);
    color: rgba(255, 255, 255, 0.92);
    font-size: 10px;
    line-height: 14px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .image-crop-handle {
    position: absolute;
    width: 13px;
    height: 13px;
    border: 2px solid #fff;
    border-radius: 4px;
    background: var(--semi-color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.34);
    touch-action: none;
  }

  .image-crop-handle.nw { left: -7px; top: -7px; cursor: nwse-resize; }
  .image-crop-handle.n { left: 50%; top: -7px; transform: translateX(-50%); cursor: ns-resize; }
  .image-crop-handle.ne { right: -7px; top: -7px; cursor: nesw-resize; }
  .image-crop-handle.e { right: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
  .image-crop-handle.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
  .image-crop-handle.s { left: 50%; bottom: -7px; transform: translateX(-50%); cursor: ns-resize; }
  .image-crop-handle.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
  .image-crop-handle.w { left: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
`;
