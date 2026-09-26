import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { surfaceStyles, textToneStyles } from '@/components/ui/theme-foundation-styles';
import { archiveCardSurfaceStyles, archiveViewerThemeStyles } from '../archive-card-theme';

export const AsmrArchiveViewerWrapper = styled.div`
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
    padding: 13px 13px 64px;
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
    contain-intrinsic-size: 0 300px;
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
    min-height: 59px;
    max-height: 59px;
    padding: 8px 9px 7px;
    font-size: 11px;
    line-height: 1.35;
    font-weight: 700;
    ${textToneStyles('primary')}
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .card-tag-slot {
    height: 43px;
    padding: 5px 7px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    align-content: flex-start;
    gap: 4px;
    overflow: hidden;
    border-top: 1px dashed var(--app-border);
    ${surfaceStyles('raised')}
  }

  .card-tag-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: calc(100% - 2px);
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid transparent;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-tag-pill.fallback {
    ${textToneStyles('primary')}
    background-color: var(--app-fill-subtle);
    border-color: var(--app-border);
  }

  .card-tag-empty {
    ${textToneStyles('muted')}
    font-size: 10px;
    line-height: 1.3;
  }
`;
