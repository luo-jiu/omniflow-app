import styled from 'styled-components';

export const ComicArchiveViewerWrapper = styled.div`
  --archive-card-width: 275px;
  --archive-card-gap: 15px;
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
    font-size: 10px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #116d48;
    background: #dbfce8;
    border: 1px solid #a8efc8;
    border-radius: 999px;
    padding: 3px 6px;
  }

  .title {
    min-width: 0;
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .table-surface {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
    padding: 13px 13px 15px;
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
    min-height: 121px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-secondary);
    font-size: 11px;
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
    align-items: start;
  }

  .archive-card {
    width: var(--archive-card-width);
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: #fefefe;
    box-shadow:
      0 11px 16px rgba(2, 20, 15, 0.28),
      0 2px 0 rgba(255, 255, 255, 0.55) inset;
    overflow: hidden;
    cursor: pointer;
    contain: layout paint style;
    content-visibility: auto;
    contain-intrinsic-size: 0 330px;
  }

  .archive-card:hover {
    border-color: color-mix(in srgb, var(--semi-color-success) 40%, rgba(255, 255, 255, 0.22));
  }

  .card-bg-image,
  .card-bg-empty {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    user-select: none;
  }

  .card-bg-image {
    display: block;
    object-fit: cover;
    object-position: top center;
  }

  .card-bg-empty {
    background:
      linear-gradient(120deg, #edf2f7 0%, #e2e8f0 48%, #edf2f7 100%);
  }

  .card-cover {
    position: relative;
    z-index: 1;
    aspect-ratio: 4 / 3;
  }

  .card-title {
    min-height: 63px;
    max-height: 63px;
    padding: 8px 9px 7px;
    font-size: 11px;
    line-height: 1.35;
    font-weight: 700;
    color: #0b1220;
    text-shadow: none;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
    background: transparent;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .card-tag-slot {
    height: 47px;
    padding: 5px 7px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    align-content: flex-start;
    gap: 4px;
    overflow: hidden;
    background: transparent;
  }

  .card-meta {
    --card-meta-seam-fix: 1px;
    position: relative;
    z-index: 2;
    /* 亚像素缝修正，避免封面与遮罩交界闪线 */
    margin-top: calc(var(--card-meta-seam-fix) * -1);
    padding-top: var(--card-meta-seam-fix);
    padding-bottom: 13px;
    overflow: hidden;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.18) 22%,
      rgba(255, 255, 255, 0.56) 48%,
      rgba(255, 255, 255, 0.86) 76%,
      #ffffff 100%
    );
    background-clip: padding-box;
  }

  .card-tag-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: calc(100% - 2px);
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid rgba(30, 41, 59, 0.22);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    color: #0b1220;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-tag-pill.collection {
    border-color: color-mix(in srgb, var(--semi-color-success) 42%, rgba(30, 41, 59, 0.22));
    color: #116d48;
    background: color-mix(in srgb, #dbfce8 88%, rgba(255, 255, 255, 0.9));
  }

  .archive-footer {
    height: 28px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border-top: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 95%, transparent);
  }

  .footer-title-group {
    min-width: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
  }
`;
