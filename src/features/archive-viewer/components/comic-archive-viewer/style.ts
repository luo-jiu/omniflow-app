import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { archiveCardSurfaceStyles, archiveViewerThemeStyles } from '../archive-card-theme';

export const ComicArchiveViewerWrapper = styled.div`
  --archive-card-min-width: 275px;
  --archive-card-gap: 15px;

  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  ${archiveViewerThemeStyles}

  .table-surface {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
    padding: 13px 64px 15px 13px;
    ${workspaceScrollbarStyles}
  }

  .state-wrap {
    min-height: 121px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    text-align: center;
  }

  .cards-grid {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--archive-card-min-width)), 1fr));
    justify-content: start;
    gap: var(--archive-card-gap);
    align-items: start;
  }

  .archive-card {
    width: 100%;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    border: 1px solid;
    ${archiveCardSurfaceStyles}
    box-shadow:
      0 11px 16px rgba(2, 20, 15, 0.28),
      0 2px 0 rgba(255, 255, 255, 0.55) inset;
    overflow: hidden;
    cursor: pointer;
    contain: layout paint style;
    content-visibility: auto;
    contain-intrinsic-size: 0 330px;
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
`;
