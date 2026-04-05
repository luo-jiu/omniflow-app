import styled from 'styled-components';

export const VideoViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(1200px 600px at 50% -20%, rgba(99, 102, 241, 0.18), transparent 60%),
    linear-gradient(180deg, var(--semi-color-bg-0) 0%, var(--semi-color-bg-1) 100%);
  color: var(--semi-color-text-0);
  overflow: hidden;

  .viewer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--semi-color-border);
    background: rgba(255, 255, 255, 0.02);
    backdrop-filter: blur(8px);
  }

  .title-group {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .title-badge {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--semi-color-primary-light-default);
    color: var(--semi-color-primary);
    font-weight: 600;
  }

  .file-name {
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-meta {
    font-size: 12px;
    color: var(--semi-color-text-2);
    white-space: nowrap;
  }

  .video-stage {
    flex: 1;
    min-height: 0;
    padding: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .video-shell {
    width: min(1100px, 100%);
    height: min(100%, 760px);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    position: relative;
    background: #000;
    box-shadow:
      0 18px 52px rgba(0, 0, 0, 0.35),
      inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }

  .video-element {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }

  .buffering-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.45));
    pointer-events: none;
  }

  .controls-panel {
    padding: 12px 18px 16px;
    border-top: 1px solid var(--semi-color-border);
    background: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
  }

  .timeline-hitbox {
    width: 100%;
    height: 16px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .timeline-rail {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
    overflow: visible;
  }

  .timeline-track {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: inherit;
    background: var(--semi-color-primary);
  }

  .timeline-thumb {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    box-shadow: 0 0 0 3px rgba(38, 110, 255, 0.25);
    pointer-events: none;
  }

  .controls-row {
    margin-top: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: space-between;
  }

  .left-controls,
  .right-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .time-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.86);
    min-width: 96px;
  }

  .volume-box {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .volume-slider {
    width: 90px;
    accent-color: var(--semi-color-primary);
  }

  .rate-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .rate-chip {
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
  }

  .rate-chip.active {
    background: var(--semi-color-primary);
    color: #fff;
    border-color: transparent;
  }

  @media (max-width: 900px) {
    .video-stage {
      padding: 10px;
    }

    .controls-row {
      flex-wrap: wrap;
      gap: 10px;
    }

    .right-controls {
      width: 100%;
      justify-content: space-between;
    }
  }
`;
