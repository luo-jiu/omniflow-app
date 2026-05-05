import styled from 'styled-components';

export const VideoArchiveViewerWrapper = styled.div`
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
    color: #0f3f71;
    background: #d9edff;
    border: 1px solid #9dccff;
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
      0 11px 16px rgba(9, 32, 58, 0.24),
      0 2px 0 rgba(255, 255, 255, 0.55) inset;
    overflow: hidden;
    cursor: pointer;
    contain: layout paint style;
    content-visibility: auto;
    contain-intrinsic-size: 0 238px;
  }

  .archive-card:hover {
    border-color: color-mix(in srgb, var(--semi-color-info) 40%, rgba(255, 255, 255, 0.22));
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

  .card-cover video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    background: #08111f;
    pointer-events: none;
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
    gap: 8px;
    color: rgba(255, 255, 255, 0.88);
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .card-cover-fallback.collection {
    background:
      linear-gradient(135deg, rgba(20, 72, 77, 0.94), rgba(22, 123, 113, 0.88)),
      radial-gradient(circle at 72% 24%, rgba(255, 255, 255, 0.2), transparent 34%);
  }

  .card-cover-fallback::before,
  .card-cover-fallback::after {
    content: '';
    position: absolute;
    top: 8px;
    bottom: 8px;
    width: 13px;
    border-radius: 999px;
    background:
      repeating-linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.22) 0,
        rgba(255, 255, 255, 0.22) 7px,
        transparent 7px,
        transparent 13px
      );
    opacity: 0.6;
  }

  .card-cover-fallback::before {
    left: 10px;
  }

  .card-cover-fallback::after {
    right: 10px;
  }

  .card-cover-icon {
    position: relative;
    z-index: 1;
    min-width: 58px;
    height: 28px;
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
    gap: 7px;
    padding: 10px 10px 11px;
  }

  .card-tag-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
  }

  .card-tag-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: calc(100% - 2px);
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--semi-color-info) 18%, rgba(11, 18, 32, 0.1));
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    color: #0f3f71;
    background: color-mix(in srgb, var(--semi-color-info-light-default) 74%, white);
    white-space: nowrap;
  }

  .card-tag-pill.collection {
    border-color: color-mix(in srgb, #11a789 28%, rgba(11, 18, 32, 0.1));
    color: #075f54;
    background: color-mix(in srgb, #bdf3e8 82%, white);
  }

  .card-duration {
    font-size: 10px;
    color: var(--app-text-secondary);
    white-space: nowrap;
  }

  .card-duration.collection {
    color: #087969;
    font-weight: 700;
  }

  .card-title {
    height: 30px;
    margin: 0;
    font-size: 11px;
    line-height: 15px;
    font-weight: 700;
    color: #0b1220;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    word-break: break-all;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    font-size: 10px;
    line-height: 1;
    color: var(--app-text-secondary);
  }

  .card-footer span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .archive-footer {
    height: 28px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 8px;
    border-top: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-0) 95%, transparent);
  }

  .footer-title-group {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .archive-count {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    color: var(--app-text-secondary);
    white-space: nowrap;
  }
`;
