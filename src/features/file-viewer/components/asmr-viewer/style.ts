import styled from 'styled-components';

export const AsmrViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--semi-color-text-0);
  background:
    radial-gradient(1000px 480px at 10% -20%, rgba(59, 130, 246, 0.14), transparent 60%),
    radial-gradient(900px 420px at 90% -25%, rgba(16, 185, 129, 0.11), transparent 56%),
    linear-gradient(180deg, var(--semi-color-bg-0) 0%, var(--semi-color-bg-1) 100%);
  border: 1px solid var(--semi-color-border);
  border-radius: 12px;
  overflow: hidden;

  .top-section {
    flex: 0 0 auto;
    min-height: 0;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 8px 12px 12px 8px;
    border-bottom: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 92%, transparent);
  }

  .cover-panel {
    flex: 0 0 auto;
    width: clamp(360px, 50%, 640px);
    aspect-ratio: 4 / 3;
    height: auto;
    max-height: none;
    align-self: flex-start;
    border-radius: 10px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-fill-0);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cover-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    pointer-events: none;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 13px;
    color: var(--semi-color-text-2);
    background:
      linear-gradient(
        120deg,
        color-mix(in srgb, var(--semi-color-fill-0) 86%, #0f172a) 0%,
        color-mix(in srgb, var(--semi-color-fill-1) 90%, #111827) 54%,
        color-mix(in srgb, var(--semi-color-fill-0) 86%, #0f172a) 100%
      );
    background-size: 260% 100%;
    animation: asmr-cover-wave 1.5s ease-in-out infinite;
  }

  .meta-panel {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 4px 4px 0;
  }

  .meta-tools {
    position: absolute;
    top: 6px;
    right: 0;
    z-index: 2;
  }

  .title-row {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding-right: 64px;
  }

  .title {
    min-width: 0;
    flex: 1;
    margin: 0;
    font-size: 20px;
    line-height: 1.32;
    font-weight: 700;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .subtitle {
    margin: 0;
    color: var(--semi-color-text-2);
    font-size: 14px;
    line-height: 1.45;
    font-weight: 500;
    min-height: 20px;
  }

  .meta-divider {
    width: 100%;
    height: 1px;
    background: color-mix(in srgb, var(--semi-color-border) 88%, transparent);
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    min-height: 42px;
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: auto;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid transparent;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.1;
    white-space: nowrap;
    max-width: min(520px, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-pill.fallback {
    color: var(--semi-color-text-0);
    background: color-mix(in srgb, var(--semi-color-fill-0) 90%, transparent);
    border-color: var(--semi-color-border);
  }

  .tag-empty {
    color: var(--semi-color-text-2);
    font-size: 18px;
  }

  .bottom-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .path-strip {
    height: 52px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-bottom: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 93%, transparent);
  }

  .path-breadcrumb {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
  }

  .crumb-btn {
    border: none;
    background: transparent;
    color: var(--semi-color-text-1);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 0;
    line-height: 1.2;
  }

  .crumb-btn:hover {
    color: var(--semi-color-primary);
  }

  .crumb-sep {
    color: var(--semi-color-text-2);
    font-size: 13px;
  }

  .list-shell {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 8px 8px;
  }

  .state-loading,
  .state-error,
  .state-empty {
    height: 100%;
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--semi-color-text-2);
    font-size: 14px;
  }

  .state-error {
    color: var(--semi-color-danger);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    height: 54px;
    border-radius: 8px;
    border: 1px solid transparent;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px 116px;
    align-items: center;
    gap: 12px;
    padding: 0 12px 0 10px;
    cursor: pointer;
    user-select: none;
    transition: border-color 0.14s ease, background 0.14s ease;
  }

  .row:hover {
    border-color: var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-fill-0) 94%, transparent);
  }

  .row.selected {
    border-color: color-mix(in srgb, var(--semi-color-primary) 42%, var(--semi-color-border));
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 80%, transparent);
  }

  .row.playing {
    border-color: color-mix(in srgb, var(--semi-color-success) 46%, var(--semi-color-border));
    background: color-mix(in srgb, var(--semi-color-success-light-default) 82%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--semi-color-success) 24%, transparent);
  }

  .row-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .row-icon {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-primary);
  }

  .row-icon .tree-file-type-icon {
    width: 30px;
    height: 30px;
    margin-right: 0;
  }

  .row-name {
    min-width: 0;
    font-size: 16px;
    font-weight: 500;
    color: var(--semi-color-text-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-playing-badge {
    flex-shrink: 0;
    margin-left: 4px;
    height: 22px;
    padding: 0 9px;
    border-radius: 999px;
    border: 1px solid transparent;
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .row-playing-badge.active {
    color: #14683a;
    border-color: #8ed3af;
    background: #d7f5e5;
    animation: asmr-row-playing-pulse 1.2s ease-in-out infinite;
  }

  .row-playing-badge.paused {
    color: #775f19;
    border-color: #e6d29d;
    background: #fff4d7;
  }

  .row-type,
  .row-size {
    text-align: right;
    color: var(--semi-color-text-2);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }

  .asmr-player-bar {
    height: 74px;
    flex-shrink: 0;
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 8px 12px 0;
    border-top: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 95%, transparent);
    overflow: hidden;
  }

  .player-progress-line {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    width: 100%;
    margin: 0;
    accent-color: var(--semi-color-primary);
    height: 6px;
  }

  .player-progress-line::-webkit-slider-thumb {
    width: 0;
    height: 0;
    opacity: 0;
    appearance: none;
  }

  .player-progress-line::-moz-range-thumb {
    width: 0;
    height: 0;
    opacity: 0;
    border: none;
  }

  .player-progress-line::-ms-thumb {
    width: 0;
    height: 0;
    opacity: 0;
    border: none;
  }

  .player-track {
    min-width: 0;
    justify-self: start;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .player-track-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 85%, transparent);
    flex-shrink: 0;
  }

  .player-track-name {
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--semi-color-text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    white-space: nowrap;
    justify-self: center;
  }

  .player-main-toggle {
    min-width: 40px;
    height: 40px;
  }

  .player-right {
    min-width: 0;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
  }

  .player-time-inline {
    min-width: 132px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .player-time-sep {
    font-size: 12px;
    color: var(--semi-color-text-2);
  }

  .player-time {
    width: auto;
    font-size: 12px;
    color: var(--semi-color-text-2);
    text-align: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    flex-shrink: 0;
  }

  .player-volume {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    justify-content: flex-end;
    white-space: nowrap;
  }

  .player-volume-range {
    width: 96px;
    accent-color: var(--semi-color-primary);
    height: 6px;
  }

  .player-volume-range::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
  }

  @keyframes asmr-cover-wave {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  @keyframes asmr-row-playing-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(20, 104, 58, 0.22);
    }
    100% {
      box-shadow: 0 0 0 7px rgba(20, 104, 58, 0);
    }
  }
`;
