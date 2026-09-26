import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { focusVisibleStyles, textToneStyles } from '@/components/ui/theme-foundation-styles';
import { archiveViewerThemeStyles } from '../archive-card-theme';

export const GalleryArchiveViewerWrapper = styled.div`
  --archive-card-min-width: 220px;
  --archive-card-gap: 18px;

  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  ${archiveViewerThemeStyles}

  .gallery-archive-surface {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
    padding: 18px 18px 64px;
    ${workspaceScrollbarStyles}
  }

  .gallery-archive-grid {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--archive-card-min-width)), 1fr));
    justify-content: start;
    align-items: start;
    gap: var(--archive-card-gap);
  }

  .gallery-album-card {
    width: 100%;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    contain: layout paint style;
    content-visibility: auto;
    contain-intrinsic-size: 0 220px;
    ${focusVisibleStyles}
  }

  .gallery-album-stack {
    position: relative;
    width: 100%;
    flex: 0 0 auto;
    aspect-ratio: 1 / 1;
    border-radius: 8px;
  }

  .gallery-album-stack::before,
  .gallery-album-stack::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-fill-1) 76%, var(--semi-color-bg-2) 24%);
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 74%, transparent);
  }

  .gallery-album-stack::before {
    transform: translate(7px, -7px);
    opacity: 0.58;
  }

  .gallery-album-stack::after {
    transform: translate(3px, -3px);
    opacity: 0.78;
  }

  .gallery-album-cover {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: 8px;
    overflow: hidden;
    background:
      linear-gradient(145deg, rgba(111, 126, 202, 0.42), rgba(18, 24, 38, 0.22)),
      color-mix(in srgb, var(--semi-color-fill-1) 84%, var(--semi-color-bg-2) 16%);
    box-shadow:
      0 14px 24px rgba(0, 0, 0, 0.24),
      0 1px 0 rgba(255, 255, 255, 0.18) inset;
  }

  .gallery-album-cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
    pointer-events: none;
  }

  .gallery-album-overlay {
    position: absolute;
    inset: auto 0 0;
    z-index: 2;
    min-height: 56px;
    padding: 22px 10px 9px;
    display: flex;
    align-items: flex-end;
    background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.58) 100%);
  }

  .gallery-album-title {
    min-width: 0;
    color: #fff;
    font-size: 13px;
    line-height: 18px;
    font-weight: 700;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.42);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gallery-album-badge {
    position: absolute;
    z-index: 3;
    top: 8px;
    right: 8px;
    padding: 3px 7px;
    border-radius: 999px;
    color: #fff;
    background: rgba(29, 34, 48, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.22);
    backdrop-filter: blur(10px);
    font-size: 10px;
    line-height: 14px;
    font-weight: 700;
  }

  .gallery-album-meta {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 2px;
    ${textToneStyles('secondary')}
    font-size: 11px;
    line-height: 16px;
  }

  .gallery-album-card:not(:disabled):not([aria-disabled='true']):hover .gallery-album-cover {
    box-shadow:
      0 18px 32px rgba(0, 0, 0, 0.3),
      0 0 0 1px var(--app-focus-border);
  }

  .gallery-album-card:not(:disabled):not([aria-disabled='true']):active .gallery-album-cover {
    box-shadow:
      0 18px 32px rgba(0, 0, 0, 0.3),
      0 0 0 1px var(--app-accent-active);
  }

  .gallery-album-placeholder {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.72);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .state-wrap {
    min-height: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    text-align: center;
  }
`;
