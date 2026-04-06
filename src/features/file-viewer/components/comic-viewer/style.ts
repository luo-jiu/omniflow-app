import styled from 'styled-components';

export const ComicViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(1100px 560px at 50% -18%, rgba(34, 197, 94, 0.12), transparent 60%),
    linear-gradient(180deg, var(--semi-color-bg-0) 0%, var(--semi-color-bg-1) 100%);
  color: var(--semi-color-text-0);
  overflow: hidden;

  .viewer-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--semi-color-border);
    background: rgba(255, 255, 255, 0.02);
    backdrop-filter: blur(8px);
  }

  .title-group {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title-badge {
    font-size: 12px;
    line-height: 1;
    padding: 3px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-success) 16%, transparent);
    color: var(--semi-color-success);
    font-weight: 600;
  }

  .title {
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-meta {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--semi-color-text-2);
  }

  .pages-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 0 20px;
  }

  .pages-column {
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .page-shell {
    margin: 0 auto;
    border-radius: 0;
    overflow: hidden;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .page-image {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
    background: color-mix(in srgb, var(--semi-color-fill-0) 76%, #000);
  }

  .page-skeleton {
    width: 100%;
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--semi-color-fill-0) 84%, #000) 0%,
        color-mix(in srgb, var(--semi-color-fill-1) 88%, #000) 48%,
        color-mix(in srgb, var(--semi-color-fill-0) 84%, #000) 100%
      );
    background-size: 260% 100%;
    animation: comic-placeholder 1.4s ease-in-out infinite;
  }

  .load-more-sentinel {
    width: 100%;
    height: 8px;
  }

  .load-state {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-text-2);
    font-size: 12px;
    padding: 8px 0 0;
  }

  .state-empty,
  .state-error {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--semi-color-text-2);
    padding: 32px;
  }

  @keyframes comic-placeholder {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
`;
