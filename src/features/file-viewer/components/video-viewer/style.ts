import styled from 'styled-components';

export const VideoViewerWrapper = styled.div`
  --video-font-caption: 16px;
  --video-font-body: 18px;
  --video-font-control: 20px;
  --video-font-title: 22px;

  width: 100%;
  height: 100%;
  background: var(--semi-color-bg-0);
  color: var(--semi-color-text-0);
  overflow: hidden;

  .viewer-layout {
    width: 100%;
    height: 100%;
    display: flex;
    min-width: 0;
    min-height: 0;
    position: relative;
  }

  .viewer-main {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
    flex-direction: column;
    min-width: 0;
    transition: padding-right 0.24s ease;
  }

  .viewer-main.console-open {
    padding-right: 360px;
  }

  .subtitle-file-input {
    display: none;
  }

  .video-stage {
    flex: 1;
    min-height: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .video-shell {
    width: 100%;
    height: 100%;
    border-radius: 0;
    border: 0;
    overflow: hidden;
    position: relative;
    background: #000;
    box-shadow: none;
  }

  .subtitle-overlay {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: min(90%, 1120px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    z-index: 2;
  }

  .subtitle-line {
    display: inline-flex;
    justify-content: center;
    max-width: 100%;
    padding: 8px 20px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.52);
    color: #fff;
    font-weight: 700;
    line-height: 1.5;
    text-align: center;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.65);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
    word-break: break-word;
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

  .console-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 360px;
    border-left: 1px solid var(--semi-color-border);
    background: linear-gradient(180deg, rgba(247, 249, 252, 0.98), rgba(241, 244, 248, 0.96));
    display: flex;
    flex-direction: column;
    min-height: 0;
    transition: transform 0.24s ease, opacity 0.24s ease;
    z-index: 3;
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.16);
  }

  .console-panel.closed {
    transform: translateX(100%);
    opacity: 0;
    pointer-events: none;
  }

  body[theme-mode="dark"] & .console-panel {
    background: linear-gradient(180deg, rgba(27, 31, 38, 0.98), rgba(20, 23, 29, 0.96));
  }

  .console-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .console-section {
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
    border-radius: 14px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .section-title {
    font-size: var(--video-font-title);
    font-weight: 700;
    color: var(--semi-color-text-0);
  }

  .section-meta {
    font-size: var(--video-font-body);
    color: var(--semi-color-text-2);
    text-align: right;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-description {
    margin: 0;
    font-size: var(--video-font-body);
    line-height: 1.6;
    color: var(--semi-color-text-2);
  }

  .section-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .info-card {
    border-radius: 12px;
    background: var(--semi-color-fill-0);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .info-label {
    font-size: var(--video-font-caption);
    color: var(--semi-color-text-2);
  }

  .info-value {
    font-size: var(--video-font-control);
    color: var(--semi-color-text-0);
    font-weight: 600;
    word-break: break-word;
  }

  .inline-alert {
    border-radius: 12px;
    padding: 10px 12px;
    font-size: var(--video-font-body);
    line-height: 1.6;
  }

  .inline-alert.error {
    background: rgba(255, 77, 79, 0.12);
    color: var(--semi-color-danger);
  }

  .slider-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: var(--video-font-body);
    color: var(--semi-color-text-1);
  }

  .slider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }

  .slider-row input[type='range'] {
    width: 100%;
    accent-color: var(--semi-color-primary);
  }

  .slider-row strong {
    font-size: var(--video-font-body);
    color: var(--semi-color-text-0);
    min-width: 64px;
    text-align: right;
  }

  .subtitle-preview {
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.84);
    color: rgba(255, 255, 255, 0.92);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 96px;
    font-size: var(--video-font-control);
    line-height: 1.6;
  }

  .console-empty {
    border-radius: 12px;
    background: var(--semi-color-fill-0);
    padding: 12px;
  }

  .placeholder-grid {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .placeholder-chip {
    border-radius: 999px;
    padding: 8px 14px;
    font-size: var(--video-font-body);
    color: var(--semi-color-text-1);
    background: var(--semi-color-fill-0);
    border: 1px dashed var(--semi-color-border);
  }

  .controls-panel {
    padding: 16px 24px 20px;
    border-top: 1px solid var(--semi-color-border);
    background: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
  }

  .timeline-hitbox {
    width: 100%;
    height: 20px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .timeline-rail {
    position: relative;
    width: 100%;
    height: 6px;
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
    width: 14px;
    height: 14px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    box-shadow: 0 0 0 4px rgba(38, 110, 255, 0.25);
    pointer-events: none;
  }

  .controls-row {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 16px;
    justify-content: space-between;
  }

  .left-controls,
  .right-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .controls-row .semi-button {
    min-height: 38px;
    font-size: var(--video-font-control);
  }

  .controls-row .semi-button-content {
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }

  .controls-row .semi-button-content-right {
    line-height: 1;
  }

  .controls-row .semi-button-content-wrapper {
    display: inline-flex;
    align-items: center;
  }

  .control-popover-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  .time-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--video-font-body);
    color: rgba(255, 255, 255, 0.86);
    min-width: 136px;
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }

  .floating-control-panel {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    border-radius: 16px;
    background: rgba(18, 20, 24, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(16px);
    box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
    padding: 14px 12px;
    z-index: 4;
  }

  .volume-panel {
    width: 74px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .volume-slider-vertical {
    -webkit-appearance: slider-vertical;
    width: 28px;
    height: 156px;
    accent-color: var(--semi-color-primary);
  }

  .rate-panel {
    min-width: 92px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .floating-action-chip {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    padding: 8px 14px;
    font-size: var(--video-font-body);
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
  }

  .floating-action-chip.active {
    background: var(--semi-color-primary);
    border-color: transparent;
    color: #fff;
  }

  .floating-action-chip:hover {
    border-color: rgba(255, 255, 255, 0.22);
  }

  .console-section .semi-button {
    min-height: 38px;
    font-size: var(--video-font-body);
  }

  .console-section .semi-button-content {
    line-height: 1.2;
  }

  .console-section .semi-switch {
    transform: scale(1.08);
    transform-origin: center right;
  }

  @media (max-width: 1200px) {
    .viewer-main.console-open {
      padding-right: 320px;
    }

    .console-panel {
      width: 320px;
    }
  }

  @media (max-width: 900px) {
    .viewer-main.console-open {
      padding-right: 280px;
    }

    .console-panel {
      width: 280px;
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
