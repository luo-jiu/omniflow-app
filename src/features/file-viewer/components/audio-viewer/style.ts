import styled from 'styled-components';

export const AudioViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--semi-color-bg-0);
  color: var(--semi-color-text-0);
  overflow: hidden;

  /* 上方歌词/内容预览区 */
  .main-display {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    background: radial-gradient(circle at center, var(--semi-color-primary-light-hover) 0%, var(--semi-color-bg-0) 100%);
    
    .record-player {
      position: relative;
      width: 300px;
      height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      
      /* Static shadow to avoid repainting during rotation */
      &::before {
        content: '';
        position: absolute;
        width: 260px;
        height: 260px;
        border-radius: 50%;
        box-shadow: 0 20px 50px rgba(0,0,0,0.4);
        z-index: 0; 
      }
    }

    .album-art {
      position: relative;
      z-index: 1;
      width: 260px;
      height: 260px;
      border-radius: 50%;
      background: #111;
      border: 10px solid #222;
      display: flex;
      align-items: center;
      justify-content: center;
      /* box-shadow moved to record-player::before */
      animation: rotate 20s linear infinite;
      animation-play-state: paused;
      overflow: hidden;
      
      &.playing {
        animation-play-state: running;
      }

      .inner-cover {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 100px;
        color: var(--semi-color-primary);
      }
    }

    /* 唱片针效果 */
    .record-needle {
      position: absolute;
      top: -20px;
      right: 20px;
      width: 100px;
      height: 150px;
      z-index: 10;
      transform-origin: 20px 20px;
      transform: rotate(-30deg);
      transition: transform 0.5s ease;
      pointer-events: none;

      &.playing {
        transform: rotate(0deg);
      }

      &::before {
        content: '';
        position: absolute;
        width: 40px;
        height: 40px;
        background: #444;
        border-radius: 50%;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      }
      
      /* 简单的唱针线条 */
      &::after {
        content: '';
        position: absolute;
        top: 20px;
        left: 18px;
        width: 8px;
        height: 120px;
        background: linear-gradient(to bottom, #666, #999);
        border-radius: 4px;
      }
    }
  }

  /* 下方控制栏 - 音乐播放器风格 */
  .player-bar {
    height: 120px;
    background: var(--semi-color-bg-1);
    border-top: 1px solid var(--semi-color-border);
    display: flex;
    flex-direction: column;
    position: relative;
    padding: 0 32px;
    backdrop-filter: blur(20px);

    /* 进度条移到最顶部，横跨整个宽度 */
    .progress-wrapper {
      position: absolute;
      top: -6px; /* 调整位置 */
      left: 0;
      right: 0;
      padding: 0;
      z-index: 100;
      
      .semi-slider {
        padding: 0;
        height: 12px; /* 增加感应热区 */
        cursor: pointer;
      }
      
      .semi-slider-rail { 
        height: 4px; /* 默认轨道厚度 */
        background-color: var(--semi-color-fill-0); 
        border-radius: 0;
      }
      
      .semi-slider-track {
        height: 4px;
        border-radius: 0;
      }

      .semi-slider-handle {
        opacity: 0; /* 默认隐藏滑块小圆点，更美观 */
        transition: opacity 0.2s;
      }

      &:hover {
        .semi-slider-rail, .semi-slider-track {
          height: 6px; /* 悬浮时变厚 */
        }
        .semi-slider-handle {
          opacity: 1;
        }
      }
    }

    .controls-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
    }

    .song-brief {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 25%;
      
      .mini-cover {
        width: 56px;
        height: 56px;
        border-radius: 8px;
        background: var(--semi-color-fill-0);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .info {
        display: flex;
        flex-direction: column;
        .name { font-size: 16px; font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .author { font-size: 13px; color: var(--semi-color-text-2); }
      }
    }

    .main-btns {
      display: flex;
      align-items: center;
      gap: 32px;
      
      .play-btn {
        width: 50px;
        height: 50px;
        font-size: 24px;
        box-shadow: 0 4px 15px var(--semi-color-primary-light-default);
      }
    }

    .extra-controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 20px;
      width: 25%;

      .time-display {
        font-family: monospace;
        font-size: 13px;
        color: var(--semi-color-text-2);
      }

      .volume-pop {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    }
  }

  @keyframes rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;