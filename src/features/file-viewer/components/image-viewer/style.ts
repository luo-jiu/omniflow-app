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
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    /* 缩放平滑切换，平移不建议加 transition 会有延迟感 */
    transition: transform 0.1s ease-out;
    user-select: none;
    pointer-events: none;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    will-change: transform;
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
`;


