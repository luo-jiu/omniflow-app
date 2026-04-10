import styled from 'styled-components';

export const ComicArchiveViewerWrapper = styled.div`
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
    color: #116d48;
    background: #dbfce8;
    border: 1px solid #a8efc8;
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
    position: relative;
    display: flex;
    flex-direction: column;
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
    min-height: 94px;
    max-height: 94px;
    padding: 12px 14px 10px;
    font-size: 15px;
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
    height: 70px;
    padding: 8px 10px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    align-content: flex-start;
    gap: 6px;
    overflow: hidden;
    background: transparent;
  }

  .card-meta {
    --card-meta-seam-fix: 2px;
    position: relative;
    z-index: 2;
    /* 亚像素缝修正，避免封面与遮罩交界闪线 */
    margin-top: calc(var(--card-meta-seam-fix) * -1);
    padding-top: var(--card-meta-seam-fix);
    padding-bottom: 20px;
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
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid rgba(30, 41, 59, 0.22);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    color: #0b1220;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
