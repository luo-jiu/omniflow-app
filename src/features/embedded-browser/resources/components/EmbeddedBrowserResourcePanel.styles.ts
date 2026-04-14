import styled from 'styled-components';

const PanelShell = styled.aside`
  width: 100%;
  min-width: 0;
  max-width: none;
  height: 100%;
  border-left: 1px solid var(--app-border);
  background: var(--app-bg-elevated);
  display: flex;
  flex-direction: column;
  min-height: 0;

  .resource-panel-header {
    padding: 16px 18px 14px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .resource-panel-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .resource-panel-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-panel-subtitle {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--app-text-muted);
    word-break: break-all;
  }

  .resource-panel-badges {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-panel-badge {
    padding: 5px 9px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 1;
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
    background: var(--app-bg);
  }

  .resource-panel-badge.is-active {
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 10%, white);
  }

  .resource-panel-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .resource-panel-filter {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-panel-filter-label {
    font-size: 13px;
    color: var(--app-text-muted);
    line-height: 1.4;
  }

  .resource-panel-filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .resource-panel-filter-input {
    flex: 1;
    min-width: 0;
    height: 38px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    padding: 0 10px;
    font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-panel-filter-input:focus {
    outline: none;
    border-color: var(--semi-color-primary);
  }

  .resource-panel-filter-reset {
    height: 38px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 13px;
    flex-shrink: 0;
  }

  .resource-panel-filter-error {
    font-size: 13px;
    color: #c93c37;
    line-height: 1.5;
  }

  .resource-extension-filter {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
  }

  .resource-extension-chip {
    height: 30px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .resource-extension-chip.is-active {
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 8%, var(--app-bg));
  }

  .resource-panel-btn {
    height: 38px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }

  .resource-panel-btn.primary {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary);
    color: #fff;
  }

  .resource-panel-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .resource-panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-section-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 4px 0;
  }

  .resource-section-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .resource-section-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-section-count {
    font-size: 12px;
    line-height: 1;
    padding: 4px 7px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text-muted);
  }

  .resource-section-description {
    font-size: 13px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .resource-panel-empty {
    padding: 16px;
    border-radius: 8px;
    border: 1px dashed var(--app-border);
    color: var(--app-text-muted);
    font-size: 14px;
    line-height: 1.7;
    background: var(--app-bg);
  }

  .resource-toolkit-card {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .resource-toolkit-recorder {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-primary) 8%, var(--app-bg));
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 35%, var(--app-border));
  }

  .resource-toolkit-recorder-main {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .resource-toolkit-status {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text);
    font-size: 14px;
    font-weight: 700;
  }

  .resource-toolkit-status-dot {
    width: 9px;
    height: 9px;
    border-radius: 8px;
    flex: 0 0 auto;
    background: var(--semi-color-warning);
  }

  .resource-toolkit-status-dot.is-recording {
    background: #d94f2b;
  }

  .resource-toolkit-status-dot.is-complete {
    background: #1f9d55;
  }

  .resource-toolkit-size {
    color: var(--app-text);
    font-size: 28px;
    line-height: 1.1;
    font-weight: 800;
  }

  .resource-toolkit-progress {
    height: 8px;
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, var(--app-border) 70%, var(--app-bg));
  }

  .resource-toolkit-progress-bar {
    height: 100%;
    min-width: 12px;
    border-radius: 8px;
    background: var(--semi-color-primary);
    transition: width 180ms ease;
  }

  .resource-toolkit-track-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .resource-toolkit-primary-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-toolkit-header {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-toolkit-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-toolkit-description {
    font-size: 13px;
    line-height: 1.6;
    color: var(--app-text-muted);
  }

  .resource-toolkit-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .resource-toolkit-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 70%, white);
  }

  .resource-toolkit-meta-label {
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .resource-toolkit-meta-value {
    font-size: 13px;
    line-height: 1.6;
    color: var(--app-text);
    word-break: break-all;
  }

  .resource-toolkit-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-toolkit-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--app-text);
  }

  .resource-toolkit-toggle input {
    margin: 0;
  }

  .resource-toolkit-input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--app-text);
  }

  .resource-toolkit-input {
    height: 36px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    padding: 0 10px;
    font-size: 14px;
  }

  .resource-toolkit-input:focus {
    outline: none;
    border-color: var(--semi-color-primary);
  }

  .resource-toolkit-warning {
    font-size: 12px;
    line-height: 1.5;
    color: #c93c37;
  }

  .resource-toolkit-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-toolkit-advanced {
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .resource-toolkit-advanced summary {
    cursor: pointer;
    user-select: none;
    width: fit-content;
    color: var(--app-text);
    font-weight: 700;
  }

  .resource-toolkit-advanced[open] {
    gap: 12px;
  }

  .resource-debug-shell {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 10px;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .resource-debug-shell summary {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--app-text);
    font-size: 14px;
    font-weight: 700;
  }

  .resource-debug-content {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-card {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-card.is-selected {
    border-color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 8%, var(--app-bg));
  }

  .resource-card-top {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .resource-card-check {
    width: 24px;
    min-width: 24px;
    display: flex;
    justify-content: center;
    padding-top: 2px;
  }

  .resource-card-check input {
    width: 18px;
    height: 18px;
    margin: 0;
  }

  .resource-card-main {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .resource-card-title-row {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .resource-card-title {
    min-width: 0;
    flex: 1;
    color: var(--app-text);
    font-size: 14px;
    line-height: 1.45;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-card-size {
    flex: 0 0 auto;
    color: var(--app-text-muted);
    font-size: 13px;
    font-weight: 700;
  }

  .resource-card-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .resource-chip {
    padding: 4px 7px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 1;
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text-muted);
  }

  .resource-url {
    color: var(--app-text);
    font-size: 13px;
    line-height: 1.6;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-page-url {
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
  }

  .resource-request-meta {
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
  }

  .resource-merge-selection {
    border: 1px dashed var(--app-border);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.6;
    background: var(--app-bg);
  }

  .resource-hls-analysis {
    border: 1px dashed var(--app-border);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.6;
    background: color-mix(in srgb, var(--app-bg-elevated) 70%, white);
  }

  .resource-hls-analysis strong {
    color: var(--app-text);
    font-weight: 700;
  }

  .resource-hls-analysis code {
    color: var(--app-text);
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-card-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-card-btn {
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .resource-card-btn.primary {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary);
    color: #fff;
  }

  .resource-card-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .resource-card-details {
    margin-left: 34px;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .resource-card-details summary {
    cursor: pointer;
    user-select: none;
    width: fit-content;
    color: var(--app-text-muted);
  }

  .resource-card-details[open] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-bulk-bar {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 88%, var(--app-bg));
  }

  .resource-bulk-summary {
    font-size: 14px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-bulk-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-more-shell {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 9px 10px;
  }

  .resource-more-shell > summary {
    cursor: pointer;
    user-select: none;
    color: var(--app-text);
    font-size: 14px;
    font-weight: 700;
  }

  .resource-more-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 10px;
  }

  .resource-toolkit-shell {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 10px 12px;
  }

  .resource-toolkit-shell > summary {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--app-text);
    font-size: 14px;
    font-weight: 700;
  }

  .resource-toolkit-shell > summary span:last-child {
    color: var(--app-text-muted);
    font-size: 13px;
    font-weight: 500;
  }
`;

export default PanelShell;
