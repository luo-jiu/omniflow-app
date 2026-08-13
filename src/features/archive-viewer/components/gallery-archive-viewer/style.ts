import styled from 'styled-components';

export const GalleryArchiveViewerWrapper = styled.div`
  --archive-card-width: 220px;
  --archive-card-gap: 18px;
  --archive-column-count: 1;

  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--semi-color-text-0);

  .gallery-archive-surface {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
    padding: 18px;
    background: var(--app-bg);
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }

  .gallery-archive-surface::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .gallery-archive-surface::-webkit-scrollbar-track {
    background: var(--app-scrollbar-track);
  }

  .gallery-archive-surface::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  .gallery-archive-surface:hover,
  .gallery-archive-surface:focus-within,
  .gallery-archive-surface:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .gallery-archive-surface:hover::-webkit-scrollbar-thumb,
  .gallery-archive-surface:focus-within::-webkit-scrollbar-thumb,
  .gallery-archive-surface:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  .gallery-archive-grid {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(var(--archive-column-count), minmax(0, var(--archive-card-width)));
    justify-content: start;
    align-items: start;
    gap: var(--archive-card-gap);
  }

  .gallery-album-card {
    width: var(--archive-card-width);
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
    color: var(--semi-color-text-2);
    font-size: 11px;
    line-height: 16px;
  }

  .gallery-album-card:hover .gallery-album-cover {
    box-shadow:
      0 18px 32px rgba(0, 0, 0, 0.3),
      0 0 0 1px color-mix(in srgb, var(--semi-color-tertiary) 58%, transparent);
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
    color: var(--app-text-secondary);
    font-size: 12px;
    text-align: center;
  }

  .state-wrap.state-error {
    color: var(--semi-color-danger);
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

  .badge {
    flex-shrink: 0;
    font-size: 10px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, var(--semi-color-tertiary) 76%, var(--semi-color-primary) 24%);
    background: color-mix(in srgb, var(--semi-color-tertiary-light-default) 82%, transparent);
    border: 1px solid color-mix(in srgb, var(--semi-color-tertiary) 34%, transparent);
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
`;
