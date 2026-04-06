import styled from 'styled-components';

export const PdfViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--semi-color-bg-0);

  .viewer-stage {
    flex: 1;
    min-height: 0;
    overflow: auto;
    position: relative;
    background: #252a31;
    padding: 12px 14px 22px;

    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.36) rgba(255, 255, 255, 0.08);
  }

  .viewer-stage::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  .viewer-stage::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
  }

  .viewer-stage::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.36);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  .viewer-stage::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.5);
    background-clip: padding-box;
  }

  .pages-column {
    margin: 0 auto;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  .virtual-spacer {
    width: 1px;
    min-height: 1px;
    pointer-events: none;
  }

  .page-shell {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
  }

  .page-frame {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
  }

  .pdf-canvas {
    display: block;
    background: #fff;
  }

  .page-caption {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.78);
    letter-spacing: 0.01em;
  }

  .page-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, #fafafa 84%, transparent);
    z-index: 1;
    pointer-events: none;
  }

  .page-error {
    width: 480px;
    max-width: calc(100vw - 120px);
    height: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-danger);
    font-size: 13px;
    background: #fff;
  }

  .loading-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, #1f2329 72%, transparent);
    z-index: 2;
    pointer-events: none;
  }

  .state-error,
  .state-empty {
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--semi-color-text-2);
  }

  .state-error {
    color: var(--semi-color-danger);
  }

  .viewer-footer {
    height: 46px;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-top: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
  }

  .footer-title-group {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title-badge {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-danger) 15%, transparent);
    color: var(--semi-color-danger);
    border: 1px solid color-mix(in srgb, var(--semi-color-danger) 34%, transparent);
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .title {
    min-width: 0;
    font-size: 13px;
    color: var(--semi-color-text-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .footer-controls {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-self: center;
  }

  .meta-text {
    font-size: 12px;
    color: var(--semi-color-text-2);
    min-width: 28px;
    text-align: center;
  }

  .zoom-text {
    min-width: 46px;
  }

  .footer-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-self: end;
  }

  .action-link {
    font-size: 12px;
    color: var(--semi-color-text-1);
    text-decoration: none;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--semi-color-border);

    &:hover {
      color: var(--semi-color-primary);
      border-color: var(--semi-color-primary);
      background: var(--semi-color-primary-light-default);
    }
  }
`;
