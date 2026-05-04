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
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-panel-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .resource-panel-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-panel-subtitle {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--app-text-muted);
    word-break: break-all;
  }

  .resource-panel-badges {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-panel-badge {
    padding: 4px 7px;
    border-radius: 999px;
    font-size: 10px;
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
    gap: 7px;
  }

  .resource-panel-filter {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .resource-panel-filter-label {
    font-size: 11px;
    color: var(--app-text-muted);
    line-height: 1.4;
  }

  .resource-panel-filter-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .resource-panel-filter-input {
    flex: 1;
    min-width: 0;
    height: 30px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    padding: 0 8px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-panel-filter-input:focus {
    outline: none;
    border-color: var(--semi-color-primary);
  }

  .resource-panel-filter-reset {
    height: 30px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 11px;
    flex-shrink: 0;
  }

  .resource-panel-filter-error {
    font-size: 11px;
    color: #c93c37;
    line-height: 1.5;
  }

  .resource-extension-filter {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-display-mode {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-extension-chip {
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 10px;
    font-weight: 600;
  }

  .resource-extension-chip.is-active {
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 8%, var(--app-bg));
  }

  .resource-panel-btn {
    height: 30px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    cursor: pointer;
    font-size: 11px;
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
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .resource-panel-bulk-shell {
    padding: 8px 10px;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    flex: 0 0 auto;
  }

  .resource-section {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .resource-section-header {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 1px 3px 0;
  }

  .resource-section-title-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .resource-section-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-section-count {
    font-size: 10px;
    line-height: 1;
    padding: 3px 6px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text-muted);
  }

  .resource-section-description {
    font-size: 11px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .resource-panel-empty {
    padding: 12px;
    border-radius: 8px;
    border: 1px dashed var(--app-border);
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.55;
    background: var(--app-bg);
  }

  .resource-toolkit-card {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 9px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-toolkit-recorder {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 9px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-primary) 8%, var(--app-bg));
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 35%, var(--app-border));
  }

  .resource-toolkit-recorder-main {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .resource-toolkit-status {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--app-text);
    font-size: 11px;
    font-weight: 700;
  }

  .resource-toolkit-status-dot {
    width: 7px;
    height: 7px;
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
    font-size: 22px;
    line-height: 1.1;
    font-weight: 800;
  }

  .resource-toolkit-progress {
    height: 6px;
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, var(--app-border) 70%, var(--app-bg));
  }

  .resource-toolkit-progress-bar {
    height: 100%;
    min-width: 8px;
    border-radius: 8px;
    background: var(--semi-color-primary);
    transition: width 180ms ease;
  }

  .resource-toolkit-track-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    color: var(--app-text-muted);
    font-size: 10px;
    line-height: 1.5;
  }

  .resource-toolkit-primary-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-toolkit-header {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .resource-toolkit-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-toolkit-description {
    font-size: 11px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .resource-toolkit-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-toolkit-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--app-bg-elevated) 70%, white);
  }

  .resource-toolkit-meta-label {
    font-size: 10px;
    color: var(--app-text-muted);
  }

  .resource-toolkit-meta-value {
    font-size: 11px;
    line-height: 1.5;
    color: var(--app-text);
    word-break: break-all;
  }

  .resource-toolkit-settings {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .resource-toolkit-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--app-text);
  }

  .resource-toolkit-toggle input {
    margin: 0;
  }

  .resource-toolkit-input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--app-text);
  }

  .resource-toolkit-input {
    height: 30px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    padding: 0 8px;
    font-size: 11px;
  }

  .resource-toolkit-input:focus {
    outline: none;
    border-color: var(--semi-color-primary);
  }

  .resource-toolkit-warning {
    font-size: 10px;
    line-height: 1.5;
    color: #c93c37;
  }

  .resource-toolkit-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-toolkit-advanced {
    display: flex;
    flex-direction: column;
    gap: 7px;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .resource-toolkit-advanced summary {
    cursor: pointer;
    user-select: none;
    width: fit-content;
    color: var(--app-text);
    font-weight: 700;
  }

  .resource-toolkit-advanced[open] {
    gap: 8px;
  }

  .resource-debug-shell {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 8px;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .resource-debug-shell summary {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5px;
    color: var(--app-text);
    font-size: 11px;
    font-weight: 700;
  }

  .resource-debug-content {
    margin-top: 7px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .resource-card {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 8px 9px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .resource-card.is-selected {
    border-color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 8%, var(--app-bg));
  }

  .resource-card-top {
    display: flex;
    align-items: flex-start;
    gap: 7px;
  }

  .resource-card-check {
    width: 18px;
    min-width: 18px;
    display: flex;
    justify-content: center;
    padding-top: 2px;
  }

  .resource-card-check input {
    width: 13px;
    height: 13px;
    margin: 0;
  }

  .resource-card-main {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .resource-card-title-row {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
  }

  .resource-card-title {
    min-width: 0;
    flex: 1;
    color: var(--app-text);
    font-size: 11px;
    line-height: 1.4;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-card-size {
    flex: 0 0 auto;
    color: var(--app-text-muted);
    font-size: 10px;
    font-weight: 700;
  }

  .resource-card-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-chip {
    padding: 3px 6px;
    border-radius: 999px;
    font-size: 10px;
    line-height: 1;
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text-muted);
  }

  .resource-url {
    color: var(--app-text);
    font-size: 10px;
    line-height: 1.5;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-page-url {
    color: var(--app-text-muted);
    font-size: 10px;
    line-height: 1.5;
    word-break: break-all;
  }

  .resource-request-meta {
    color: var(--app-text-muted);
    font-size: 10px;
    line-height: 1.5;
    word-break: break-all;
  }

  .resource-hls-analysis {
    border: 1px dashed var(--app-border);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--app-text-muted);
    font-size: 10px;
    line-height: 1.5;
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
    gap: 5px;
  }

  .resource-card-btn {
    height: 28px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 10px;
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
    margin-left: 25px;
    color: var(--app-text-muted);
    font-size: 10px;
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
    gap: 5px;
  }

  .resource-bulk-bar {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 88%, var(--app-bg));
  }

  .resource-bulk-summary {
    min-height: 16px;
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-bulk-status {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--app-text-muted);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.4;
  }

  .resource-bulk-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .resource-bulk-bar .resource-card-btn {
    border-color: color-mix(in srgb, var(--app-text-muted) 45%, var(--app-border));
    background: color-mix(in srgb, var(--app-bg) 84%, var(--app-text) 16%);
    color: var(--app-text);
  }

  .resource-bulk-bar .resource-card-btn:not(:disabled):hover {
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .resource-bulk-bar .resource-card-btn.is-active {
    border-color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 12%, var(--app-bg));
    color: var(--semi-color-primary);
  }

  .resource-bulk-bar .resource-card-btn.primary {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary);
    color: #fff;
  }

  .resource-bulk-bar .resource-card-btn:disabled {
    opacity: 0.38;
  }

  .resource-more-shell {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 7px 8px;
  }

  .resource-more-shell > summary {
    cursor: pointer;
    user-select: none;
    color: var(--app-text);
    font-size: 11px;
    font-weight: 700;
  }

  .resource-more-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding-top: 7px;
  }

  .resource-toolkit-shell {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    padding: 8px 9px;
  }

  .resource-toolkit-shell > summary {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--app-text);
    font-size: 11px;
    font-weight: 700;
  }

  .resource-toolkit-shell > summary span:last-child {
    color: var(--app-text-muted);
    font-size: 10px;
    font-weight: 500;
  }
`;

export default PanelShell;
