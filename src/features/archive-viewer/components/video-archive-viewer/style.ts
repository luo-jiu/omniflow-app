import styled from 'styled-components';

export const VideoArchiveViewerWrapper = styled.div`
  --archive-card-width: 336px;
  --archive-card-gap: 20px;
  --archive-column-count: 1;

  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--semi-color-text-0);

  .badge {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #0f3f71;
    background: #d9edff;
    border: 1px solid #9dccff;
    border-radius: 999px;
    padding: 4px 8px;
  }

  .title {
    min-width: 0;
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .table-surface {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 20px 20px 24px;
    background:
      radial-gradient(circle at top, color-mix(in srgb, var(--semi-color-info-light-default) 36%, transparent), transparent 56%),
      var(--app-bg);
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }

  .table-surface::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .table-surface::-webkit-scrollbar-track {
    background: var(--app-scrollbar-track);
  }

  .table-surface::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  .table-surface:hover,
  .table-surface:focus-within,
  .table-surface:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .table-surface:hover::-webkit-scrollbar-thumb,
  .table-surface:focus-within::-webkit-scrollbar-thumb,
  .table-surface:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  .table-surface:hover::-webkit-scrollbar-thumb:hover,
  .table-surface:focus-within::-webkit-scrollbar-thumb:hover,
  .table-surface:active::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
  }

  .state-wrap {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-secondary);
    font-size: 14px;
    text-align: center;
  }

  .state-wrap.state-error {
    color: var(--semi-color-danger);
  }

  .cards-grid {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(var(--archive-column-count), minmax(0, var(--archive-card-width)));
    justify-content: start;
    gap: var(--archive-card-gap);
  }

  .archive-card {
    width: var(--archive-card-width);
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--semi-color-info) 18%, rgba(255, 255, 255, 0.2));
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 251, 255, 0.96));
    box-shadow:
      0 18px 36px rgba(9, 32, 58, 0.14),
      inset 0 1px 0 rgba(255, 255, 255, 0.58);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .archive-card:hover {
    border-color: color-mix(in srgb, var(--semi-color-info) 42%, rgba(255, 255, 255, 0.2));
    box-shadow:
      0 22px 42px rgba(9, 32, 58, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.62);
  }

  .card-cover {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background:
      linear-gradient(135deg, rgba(11, 27, 54, 0.92), rgba(21, 79, 139, 0.88)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 48%);
  }

  .card-cover img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .card-cover::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 28%, rgba(5, 10, 18, 0.28) 100%);
    pointer-events: none;
  }

  .card-cover-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: rgba(255, 255, 255, 0.88);
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .card-cover-fallback::before,
  .card-cover-fallback::after {
    content: '';
    position: absolute;
    top: 12px;
    bottom: 12px;
    width: 18px;
    border-radius: 999px;
    background:
      repeating-linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.22) 0,
        rgba(255, 255, 255, 0.22) 9px,
        transparent 9px,
        transparent 16px
      );
    opacity: 0.6;
  }

  .card-cover-fallback::before {
    left: 14px;
  }

  .card-cover-fallback::after {
    right: 14px;
  }

  .card-cover-icon {
    position: relative;
    z-index: 1;
    min-width: 86px;
    height: 40px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(8px);
  }

  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 15px 16px;
  }

  .card-tag-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .card-tag-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: calc(100% - 2px);
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--semi-color-info) 18%, rgba(11, 18, 32, 0.1));
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
    color: #0f3f71;
    background: color-mix(in srgb, var(--semi-color-info-light-default) 74%, white);
    white-space: nowrap;
  }

  .card-open-hint {
    font-size: 12px;
    color: var(--app-text-secondary);
    white-space: nowrap;
  }

  .card-title {
    min-height: 44px;
    margin: 0;
    font-size: 16px;
    line-height: 1.35;
    font-weight: 700;
    color: #0b1220;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: var(--app-text-secondary);
  }
`;
