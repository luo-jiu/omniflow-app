import styled from 'styled-components';

export const AsmrArchiveViewerWrapper = styled.div`
  --archive-card-width: 342px;
  --archive-card-gap: 22px;
  --archive-column-count: 1;

  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  color: var(--semi-color-text-0);

  .badge {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #0b7b65;
    background: #d8fff1;
    border: 1px solid #9de9d2;
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
    padding: 20px 20px 22px;
    background: var(--app-bg);
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
    min-height: 180px;
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
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: #fefefe;
    box-shadow:
      0 16px 24px rgba(2, 20, 15, 0.28),
      0 2px 0 rgba(255, 255, 255, 0.55) inset;
    overflow: hidden;
    cursor: pointer;
  }

  .archive-card:hover {
    border-color: color-mix(in srgb, var(--semi-color-primary) 36%, rgba(255, 255, 255, 0.22));
  }

  .card-cover {
    aspect-ratio: 4 / 3;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: #e9edf2;
  }

  .card-cover img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    user-select: none;
    pointer-events: none;
  }

  .cover-empty {
    width: 100%;
    height: 100%;
    background:
      linear-gradient(120deg, #edf2f7 0%, #e2e8f0 48%, #edf2f7 100%);
  }

  .card-title {
    min-height: 82px;
    max-height: 82px;
    padding: 12px 14px 10px;
    font-size: 15px;
    line-height: 1.35;
    font-weight: 600;
    color: #1f2937;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .card-tag-slot {
    height: 52px;
    padding: 8px 10px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    align-content: flex-start;
    gap: 6px;
    overflow: hidden;
    border-top: 1px dashed rgba(17, 24, 39, 0.16);
    background: rgba(249, 250, 251, 0.9);
  }

  .card-tag-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: calc(100% - 2px);
    padding: 1px 9px;
    border-radius: 999px;
    border: 1px solid transparent;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-tag-pill.fallback {
    color: var(--semi-color-text-0);
    background: color-mix(in srgb, var(--semi-color-fill-0) 92%, transparent);
    border-color: var(--semi-color-border);
  }

  .card-tag-empty {
    color: var(--semi-color-text-2);
    font-size: 12px;
    line-height: 1.3;
  }

  .archive-footer {
    height: 42px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-top: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 95%, transparent);
  }

  .footer-title-group {
    min-width: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
  }
`;
