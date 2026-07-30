import styled from 'styled-components';

export const GalleryViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--semi-color-bg-0);
  color: var(--semi-color-text-0);
  overflow: hidden;

  .gallery-loading,
  .gallery-empty {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-text-2);
    font-size: 14px;
  }

  .gallery-image-keepalive {
    position: absolute;
    left: -10000px;
    top: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .gallery-image-keepalive img {
    width: 1px;
    height: 1px;
    object-fit: contain;
  }

  .gallery-grid-wrap {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .gallery-header {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px 14px;
    border-bottom: 1px solid var(--semi-color-border);
  }

  .gallery-title-block {
    min-width: 0;
  }

  .gallery-kicker {
    display: block;
    margin-bottom: 4px;
    color: color-mix(in srgb, var(--semi-color-tertiary) 72%, var(--semi-color-success) 28%);
    font-size: 11px;
    font-weight: 700;
  }

  .gallery-title-block h2 {
    margin: 0;
    max-width: 52vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 20px;
    line-height: 28px;
    font-weight: 650;
  }

  .gallery-counts {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--semi-color-text-2);
    font-size: 12px;
  }

  .gallery-counts span {
    padding: 3px 8px;
    border: 1px solid var(--semi-color-border);
    border-radius: 6px;
    background: var(--semi-color-fill-0);
  }

  .gallery-grid {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
    padding: 18px 24px 28px;
    display: block;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }

  .gallery-grid::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .gallery-grid::-webkit-scrollbar-track {
    background: var(--app-scrollbar-track);
  }

  .gallery-grid::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  .gallery-grid:hover,
  .gallery-grid:focus-within,
  .gallery-grid:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .gallery-grid:hover::-webkit-scrollbar-thumb,
  .gallery-grid:focus-within::-webkit-scrollbar-thumb,
  .gallery-grid:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  .gallery-card {
    align-self: start;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    contain: layout paint style;
    content-visibility: auto;
    contain-intrinsic-size: 0 160px;
  }

  .gallery-grid-virtual-space {
    position: relative;
    width: 100%;
    min-height: 0;
  }

  .gallery-grid-content {
    position: absolute;
    inset: 0 auto auto 0;
    display: grid;
    align-content: start;
    align-items: start;
    gap: 14px;
    will-change: transform;
  }

  .gallery-card:focus-visible {
    outline: 2px solid var(--semi-color-focus-border);
    outline-offset: 3px;
    border-radius: 8px;
  }

  .gallery-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: 8px;
    background:
      linear-gradient(135deg, rgba(65, 169, 255, 0.16), rgba(67, 207, 124, 0.14)),
      var(--semi-color-fill-0);
    box-shadow: inset 0 0 0 1px var(--semi-color-border);
  }

  .gallery-thumb::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.34), transparent 32%);
    filter: blur(12px);
    opacity: 0.75;
    transition: opacity 0.2s ease;
  }

  .gallery-thumb.loaded::before {
    opacity: 0;
  }

  .gallery-thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transform: scale(1.03);
    transition: opacity 0.18s ease, transform 0.18s ease;
  }

  .gallery-thumb.loaded img {
    opacity: 1;
    transform: scale(1);
  }

  .gallery-thumb.video {
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(135deg, rgba(45, 170, 220, 0.2), rgba(240, 120, 72, 0.12)),
      var(--semi-color-fill-0);
  }

  .video-thumb-mark {
    position: relative;
    z-index: 1;
    color: color-mix(in srgb, var(--semi-color-info) 78%, var(--semi-color-warning) 22%);
    font-size: 12px;
    font-weight: 800;
  }

  .gallery-detail {
    position: relative;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--semi-color-bg-0);
  }

  .gallery-detail-topbar {
    flex: 0 0 48px;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) minmax(160px, auto);
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    border-bottom: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
  }

  .gallery-detail-title {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .gallery-detail-title small {
    color: var(--semi-color-text-2);
    font-size: 11px;
  }

  .gallery-image-tools {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    color: var(--semi-color-text-2);
    font-size: 12px;
  }

  .gallery-tool-button,
  .gallery-tool-readout {
    width: 32px;
    height: 32px;
    border: 1px solid var(--semi-color-border);
    border-radius: 8px;
    background: var(--semi-color-fill-0);
    color: var(--semi-color-text-1);
  }

  .gallery-tool-button.semi-button {
    padding: 0;
  }

  .gallery-tool-button:hover,
  .gallery-tool-readout:hover {
    background: var(--semi-color-fill-1);
    color: var(--semi-color-text-0);
  }

  .gallery-tool-readout {
    width: auto;
    min-width: 58px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .gallery-detail-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--semi-color-bg-0) 92%, #000 8%), var(--semi-color-bg-0));
  }

  .gallery-detail-stage.image {
    cursor: grab;
    user-select: none;
  }

  .gallery-detail-stage.image.dragging {
    cursor: grabbing;
  }

  .gallery-detail-image {
    max-width: min(100%, 1600px);
    max-height: 100%;
    object-fit: contain;
    transform-origin: center center;
    will-change: transform;
    user-select: none;
    pointer-events: none;
    transition: none;
  }

  .gallery-nav {
    position: absolute;
    top: 50%;
    z-index: 4;
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--semi-color-border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-bg-3) 82%, transparent);
    color: var(--semi-color-text-0);
    transform: translateY(-50%);
    cursor: pointer;
    opacity: 0.78;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
    transition: opacity 0.15s ease, background 0.15s ease, transform 0.15s ease;
  }

  .gallery-nav:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--semi-color-bg-3) 94%, transparent);
    transform: translateY(-50%) scale(1.04);
  }

  .gallery-nav:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    transform: translateY(-50%);
  }

  .gallery-nav:disabled:hover {
    background: color-mix(in srgb, var(--semi-color-bg-3) 82%, transparent);
    transform: translateY(-50%);
  }

  .gallery-nav.prev {
    left: 20px;
  }

  .gallery-nav.next {
    right: 20px;
  }

  .gallery-video-host {
    width: 100%;
    height: 100%;
  }

  .gallery-video-controls {
    position: absolute;
    left: 50%;
    bottom: 20px;
    z-index: 5;
    width: min(720px, calc(100% - 96px));
    min-height: 42px;
    display: grid;
    grid-template-columns: 38px 42px minmax(120px, 1fr) 42px;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--semi-color-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-bg-3) 88%, transparent);
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.18);
    transform: translateX(-50%);
  }

  .gallery-video-controls input[type="range"] {
    width: 100%;
  }

  .video-time {
    color: var(--semi-color-text-1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .gallery-metadata-loading {
    min-height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .gallery-metadata-body {
    min-height: 80px;
    padding-bottom: 18px;
  }

  .gallery-metadata-list {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px 14px;
    margin: 0;
  }

  .gallery-metadata-list dt {
    color: var(--semi-color-text-2);
    font-size: 12px;
    line-height: 20px;
  }

  .gallery-metadata-list dd {
    min-width: 0;
    margin: 0;
    color: var(--semi-color-text-0);
    font-size: 12px;
    line-height: 20px;
    overflow-wrap: anywhere;
  }

  .gallery-metadata-note {
    margin-top: 14px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--semi-color-fill-0);
    color: var(--semi-color-text-2);
    font-size: 12px;
    line-height: 18px;
  }

  .image-crop-layer {
    position: absolute;
    inset: 0;
    z-index: 8;
    overflow: hidden;
    cursor: default;
  }

  .image-crop-toolbar {
    position: absolute;
    top: 16px;
    left: 50%;
    z-index: 4;
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 5px 6px 5px 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(17, 24, 39, 0.78);
    color: #fff;
    box-shadow: 0 14px 42px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    transform: translateX(-50%);
  }

  .image-crop-title,
  .image-crop-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .image-crop-title {
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }

  .image-crop-action.semi-button {
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 6px;
  }

  .image-crop-dim {
    position: absolute;
    z-index: 1;
    background: rgba(0, 0, 0, 0.52);
    pointer-events: none;
  }

  .image-crop-dim.top {
    top: 0;
    left: 0;
    right: 0;
  }

  .image-crop-dim.right {
    top: 0;
    right: 0;
    bottom: 0;
  }

  .image-crop-dim.bottom {
    left: 0;
    right: 0;
    bottom: 0;
  }

  .image-crop-dim.left {
    top: 0;
    left: 0;
    bottom: 0;
  }

  .image-crop-box {
    position: absolute;
    z-index: 3;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.96);
    background: rgba(255, 255, 255, 0.03);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.42),
      0 14px 36px rgba(0, 0, 0, 0.22);
    cursor: move;
    touch-action: none;
  }

  .image-crop-grid {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to right, transparent 33.333%, rgba(255, 255, 255, 0.58) 33.333%, rgba(255, 255, 255, 0.58) calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent 66.666%, rgba(255, 255, 255, 0.58) 66.666%, rgba(255, 255, 255, 0.58) calc(66.666% + 1px), transparent calc(66.666% + 1px)),
      linear-gradient(to bottom, transparent 33.333%, rgba(255, 255, 255, 0.58) 33.333%, rgba(255, 255, 255, 0.58) calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent 66.666%, rgba(255, 255, 255, 0.58) 66.666%, rgba(255, 255, 255, 0.58) calc(66.666% + 1px), transparent calc(66.666% + 1px));
    pointer-events: none;
  }

  .image-crop-size {
    position: absolute;
    right: 6px;
    bottom: 6px;
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(17, 24, 39, 0.76);
    color: rgba(255, 255, 255, 0.92);
    font-size: 10px;
    line-height: 14px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .image-crop-handle {
    position: absolute;
    width: 13px;
    height: 13px;
    border: 2px solid #fff;
    border-radius: 4px;
    background: var(--semi-color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.34);
    touch-action: none;
  }

  .image-crop-handle.nw { left: -7px; top: -7px; cursor: nwse-resize; }
  .image-crop-handle.n { left: 50%; top: -7px; transform: translateX(-50%); cursor: ns-resize; }
  .image-crop-handle.ne { right: -7px; top: -7px; cursor: nesw-resize; }
  .image-crop-handle.e { right: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
  .image-crop-handle.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
  .image-crop-handle.s { left: 50%; bottom: -7px; transform: translateX(-50%); cursor: ns-resize; }
  .image-crop-handle.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
  .image-crop-handle.w { left: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
`;
