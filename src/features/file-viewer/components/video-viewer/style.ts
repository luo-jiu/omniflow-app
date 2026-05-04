import styled from 'styled-components';

export const VideoViewerWrapper = styled.div`
  --video-font-caption: 10px;
  --video-font-body: 11px;
  --video-font-control: 12px;
  --video-font-title: 14px;

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
    padding-right: 260px;
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
    gap: 4px;
    pointer-events: none;
    z-index: 2;
  }

  .subtitle-line {
    display: inline-flex;
    justify-content: center;
    max-width: 100%;
    padding: 6px 14px;
    border-radius: 10px;
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
    width: 260px;
    border-left: 1px solid var(--semi-color-border);
    background: linear-gradient(180deg, rgba(247, 249, 252, 0.98), rgba(241, 244, 248, 0.96));
    display: flex;
    flex-direction: column;
    min-height: 0;
    transition: transform 0.24s ease, opacity 0.24s ease;
    z-index: 3;
    box-shadow: -10px 0 28px rgba(0, 0, 0, 0.14);
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
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .console-section {
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
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
    max-width: 116px;
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
    gap: 7px;
    flex-wrap: wrap;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }

  .info-card {
    border-radius: 7px;
    background: var(--semi-color-fill-0);
    padding: 8px 9px;
    display: flex;
    flex-direction: column;
    gap: 3px;
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
    border-radius: 7px;
    padding: 7px 8px;
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
    gap: 5px;
    font-size: var(--video-font-body);
    color: var(--semi-color-text-1);
  }

  .slider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
  }

  .slider-row input[type='range'] {
    width: 100%;
    accent-color: var(--semi-color-primary);
  }

  .slider-row strong {
    font-size: var(--video-font-body);
    color: var(--semi-color-text-0);
    min-width: 43px;
    text-align: right;
  }

  .subtitle-preview {
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.84);
    color: rgba(255, 255, 255, 0.92);
    padding: 9px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 64px;
    font-size: var(--video-font-control);
    line-height: 1.6;
  }

  .console-empty {
    border-radius: 8px;
    background: var(--semi-color-fill-0);
    padding: 8px;
  }

  .console-empty .semi-empty {
    padding: 7px 0;
  }

  .console-empty .semi-empty-title {
    font-size: var(--video-font-body);
    line-height: 1.35;
  }

  .console-empty .semi-empty-description {
    font-size: var(--video-font-caption);
    line-height: 1.5;
  }

  .placeholder-grid {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .placeholder-chip {
    border-radius: 999px;
    padding: 5px 9px;
    font-size: var(--video-font-body);
    color: var(--semi-color-text-1);
    background: var(--semi-color-fill-0);
    border: 1px dashed var(--semi-color-border);
  }

  .controls-panel {
    padding: 10px 16px 12px;
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
    box-shadow: 0 0 0 3px rgba(38, 110, 255, 0.24);
    pointer-events: none;
  }

  .controls-row {
    margin-top: 9px;
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }

  .left-controls,
  .right-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .controls-row .semi-button {
    min-height: 30px;
    font-size: var(--video-font-control);
    padding: 0 10px;
    border-radius: 6px;
  }

  .controls-row .semi-button-icon {
    font-size: 14px;
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
    min-width: 92px;
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }

  .floating-control-panel {
    position: absolute;
    bottom: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
    border-radius: 10px;
    background: rgba(18, 20, 24, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(16px);
    box-shadow: 0 12px 26px rgba(0, 0, 0, 0.26);
    padding: 9px 8px;
    z-index: 4;
  }

  .volume-panel {
    width: 54px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .volume-slider-vertical {
    -webkit-appearance: slider-vertical;
    width: 22px;
    height: 112px;
    accent-color: var(--semi-color-primary);
  }

  .rate-panel {
    min-width: 66px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .floating-action-chip {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    padding: 6px 10px;
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
    min-height: 30px;
    font-size: var(--video-font-body);
    padding: 0 10px;
    border-radius: 6px;
  }

  .console-section .semi-button-content {
    line-height: 1.2;
  }

  .console-section .semi-switch {
    transform: scale(0.84);
    transform-origin: center right;
  }

  @media (max-width: 1200px) {
    .viewer-main.console-open {
      padding-right: 240px;
    }

    .console-panel {
      width: 240px;
    }
  }

  @media (max-width: 900px) {
    .viewer-main.console-open {
      padding-right: 220px;
    }

    .console-panel {
      width: 220px;
    }

    .controls-row {
      flex-wrap: wrap;
      gap: 7px;
    }

    .right-controls {
      width: 100%;
      justify-content: space-between;
    }
  }
`;
