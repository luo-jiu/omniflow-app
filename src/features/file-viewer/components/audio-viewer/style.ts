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
      width: 204px;
      height: 204px;
      display: flex;
      align-items: center;
      justify-content: center;
      
      /* Static shadow to avoid repainting during rotation */
      &::before {
        content: '';
        position: absolute;
        width: 178px;
        height: 178px;
        border-radius: 50%;
        box-shadow: 0 14px 32px rgba(0,0,0,0.34);
        z-index: 0; 
      }
    }

    .album-art {
      position: relative;
      z-index: 1;
      width: 178px;
      height: 178px;
      border-radius: 50%;
      background: #111;
      border: 7px solid #222;
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
        font-size: 64px;
        color: var(--semi-color-primary);

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
      }
    }

    /* 唱片针效果 */
    .record-needle {
      position: absolute;
      top: -14px;
      right: 14px;
      width: 70px;
      height: 104px;
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
        width: 28px;
        height: 28px;
        background: #444;
        border-radius: 50%;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      }
      
      /* 简单的唱针线条 */
      &::after {
        content: '';
        position: absolute;
        top: 14px;
        left: 12px;
        width: 6px;
        height: 84px;
        background: linear-gradient(to bottom, #666, #999);
        border-radius: 4px;
      }
    }

    .audio-lyric-preview {
      min-height: 32px;
      max-width: min(640px, 72vw);
      margin: 9px auto 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      color: var(--semi-color-text-1);
      font-size: 14px;
      line-height: 1.45;
      font-weight: 600;

      span {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  /* 下方控制栏 - 音乐播放器风格 */
  .player-bar {
    height: 76px;
    background: var(--semi-color-bg-1);
    border-top: 1px solid var(--semi-color-border);
    display: flex;
    flex-direction: column;
    position: relative;
    padding: 0 18px;
    backdrop-filter: blur(20px);

    /* 进度条移到最顶部，横跨整个宽度 */
    .progress-wrapper {
      position: absolute;
      top: -5px; /* 调整位置 */
      left: 0;
      right: 0;
      padding: 0;
      z-index: 100;
      
      .semi-slider {
        padding: 0;
        height: 10px; /* 增加感应热区 */
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
      margin-top: 6px;
    }

    .song-brief {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 25%;
      
      .mini-cover {
        width: 38px;
        height: 38px;
        border-radius: 6px;
        background: var(--semi-color-fill-0);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        .name { font-size: 12px; font-weight: 600; max-width: 124px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .author { font-size: 10px; color: var(--semi-color-text-2); }
      }
    }

    .main-btns {
      display: flex;
      align-items: center;
      gap: 18px;
      
      .play-btn {
        width: 34px;
        height: 34px;
        min-width: 34px;
        font-size: 17px;
        box-shadow: 0 3px 10px var(--semi-color-primary-light-default);
      }
    }

    .semi-button {
      min-height: 28px;
      padding: 0 8px;
      border-radius: 6px;
    }

    .semi-button-icon {
      font-size: 14px;
    }

    .extra-controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      width: 25%;

      .time-display {
        font-family: monospace;
        font-size: 10px;
        color: var(--semi-color-text-2);
      }

      .volume-pop {
        display: flex;
        align-items: center;
        gap: 5px;
      }
    }
  }

  @keyframes rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
