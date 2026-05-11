import styled from 'styled-components';

export const FloatingMiniVideoPlayerWrapper = styled.div`
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 320px;
  background: var(--semi-color-bg-2, #1c1c1c);
  color: var(--semi-color-text-0, #fff);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  overflow: hidden;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  user-select: none;
  touch-action: none;

  /* 隐藏时挪到屏外但保持 connected DOM，确保 host 始终可接收视频元素，不让 Chromium 因脱离 document 触发 pause。
     不用 display:none —— 某些浏览器会因 <video> 不在 layout 树中而暂停。 */
  &[data-visible='false'] {
    pointer-events: none;
    opacity: 0;
    transform: translate(20000px, 20000px);
  }

  &[data-dragging='true'] {
    cursor: grabbing;
  }

  .floating-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.4);
    cursor: grab;

    &:active {
      cursor: grabbing;
    }

    .floating-title {
      flex: 1;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .floating-hide,
    .floating-close {
      background: transparent;
      border: none;
      color: inherit;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
      }
    }
  }

  .floating-video-host {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .floating-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.4);

    .floating-play-toggle {
      background: transparent;
      border: none;
      color: inherit;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
      }
    }

    .floating-time {
      flex: 1;
      text-align: right;
      font-variant-numeric: tabular-nums;
      opacity: 0.85;
    }
  }
`;
