import styled from 'styled-components';

export const UnifiedAudioViewerWrapper = styled.div`
  /* Shared by bare audio, semantic audio folders, and audio archives. */
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--semi-color-text-0);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--semi-color-bg-0) 92%, var(--semi-color-primary-light-default)), var(--semi-color-bg-0) 38%),
    var(--semi-color-bg-0);
  overflow: hidden;

  .archive-main {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 10px 92px;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }

  .archive-main::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .archive-main::-webkit-scrollbar-track {
    background: var(--app-scrollbar-track);
  }

  .archive-main::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  .archive-main:hover,
  .archive-main:focus-within,
  .archive-main:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .archive-main:hover::-webkit-scrollbar-thumb,
  .archive-main:focus-within::-webkit-scrollbar-thumb,
  .archive-main:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  .archive-header {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 1px 6px 9px;
  }

  .archive-title-wrap {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .archive-header h2 {
    margin: 0;
    max-width: min(520px, 62vw);
    font-size: 16px;
    line-height: 1.25;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 24%, transparent);
    color: color-mix(in srgb, var(--semi-color-primary) 72%, var(--semi-color-text-0));
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 72%, var(--semi-color-bg-1));
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .archive-count {
    flex-shrink: 0;
    color: var(--semi-color-text-2);
    font-size: 12px;
  }

  .state-wrap {
    min-height: 132px;
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

  .state-wrap.loading-more {
    min-height: 72px;
  }

  .song-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .song-list-header {
    display: grid;
    grid-template-columns: 34px 44px minmax(150px, 1.4fr) minmax(120px, 0.8fr) 30px 54px;
    align-items: center;
    gap: 12px;
    min-height: 34px;
    margin-bottom: 5px;
    padding: 0 10px 0 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--semi-color-border) 82%, transparent);
    color: var(--semi-color-text-1);
    background: color-mix(in srgb, var(--semi-color-bg-0) 84%, var(--semi-color-fill-0));
    font-size: 12px;
    font-weight: 700;
  }

  .song-header-title,
  .song-header-duration {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .song-header-sort {
    color: var(--semi-color-success);
    font-size: 11px;
  }

  .song-header-duration {
    justify-content: flex-end;
  }

  .song-row {
    display: grid;
    grid-template-columns: 34px 44px minmax(150px, 1.4fr) minmax(120px, 0.8fr) 30px 54px;
    align-items: center;
    gap: 12px;
    min-height: 58px;
    padding: 6px 10px 6px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--semi-color-bg-1) 76%, transparent);
    border: 1px solid transparent;
    cursor: default;
  }

  .song-row:nth-child(even) {
    background: color-mix(in srgb, var(--semi-color-fill-0) 48%, transparent);
  }

  .song-row:hover,
  .song-row.is-selected {
    background: color-mix(in srgb, var(--semi-color-fill-1) 72%, var(--semi-color-bg-1));
  }

  .song-row.is-playing {
    border-color: color-mix(in srgb, var(--semi-color-primary) 34%, transparent);
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 26%, var(--semi-color-bg-1));
  }

  .song-index {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-text-2);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .song-row.is-playing .song-index {
    color: var(--semi-color-primary);
  }

  .song-cover-button {
    position: relative;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    overflow: hidden;
  }

  .audio-cover {
    width: 100%;
    height: 100%;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: color-mix(in srgb, var(--semi-color-primary) 74%, var(--semi-color-text-1));
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--semi-color-primary-light-default) 66%, var(--semi-color-bg-1)), var(--semi-color-fill-0));
  }

  .audio-cover img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .audio-cover.is-empty {
    color: transparent;
    background: color-mix(in srgb, var(--semi-color-fill-0) 38%, transparent);
    box-shadow: none;
  }

  .cover-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.38);
    opacity: 0;
    transition: opacity 0.14s ease;
  }

  .song-cover-button:hover .cover-play,
  .song-row.is-playing .cover-play {
    opacity: 1;
  }

  .song-primary,
  .player-track {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .song-title-line {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .song-title,
  .song-album,
  .player-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .song-title {
    font-size: 13px;
    line-height: 1.25;
    font-weight: 700;
  }

  .song-artist,
  .player-artist {
    color: var(--semi-color-text-2);
    font-size: 11px;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .song-pill {
    flex-shrink: 0;
    height: 16px;
    display: inline-flex;
    align-items: center;
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--semi-color-warning) 40%, transparent);
    color: color-mix(in srgb, var(--semi-color-warning) 72%, var(--semi-color-text-0));
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .song-album,
  .song-duration {
    color: var(--semi-color-text-2);
    font-size: 12px;
  }

  .song-duration {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .row-icon-button {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 5px;
    color: var(--semi-color-text-2);
    background: transparent;
    cursor: pointer;
    opacity: 0;
  }

  .song-row:hover .row-icon-button,
  .row-icon-button:focus-visible,
  .song-row.is-playing .row-icon-button {
    opacity: 1;
  }

  .row-icon-button:hover {
    color: var(--semi-color-text-0);
    background: var(--semi-color-fill-1);
  }

  .audio-player-bar {
    position: relative;
    flex-shrink: 0;
    height: 76px;
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(190px, auto) minmax(280px, 1fr);
    align-items: center;
    gap: 18px;
    padding: 10px 16px 9px;
    border-top: 1px solid var(--semi-color-border);
    background: color-mix(in srgb, var(--semi-color-bg-1) 94%, transparent);
    box-shadow: 0 -8px 22px rgba(0, 0, 0, 0.08);
  }

  .player-progress {
    position: absolute;
    top: -5px;
    left: 0;
    right: 0;
    z-index: 2;
    height: 11px;
  }

  .player-progress input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    appearance: none;
    background: transparent;
    opacity: 0;
    cursor: pointer;
  }

  .player-progress input::-webkit-slider-runnable-track {
    height: 11px;
    background: transparent;
  }

  .player-progress input::-webkit-slider-thumb {
    width: 1px;
    height: 11px;
    appearance: none;
    border: 0;
    background: transparent;
  }

  .player-progress input::-moz-range-track {
    height: 11px;
    border: 0;
    background: transparent;
  }

  .player-progress input::-moz-range-thumb {
    width: 1px;
    height: 11px;
    border: 0;
    background: transparent;
  }

  .player-progress input:disabled {
    cursor: default;
  }

  .player-progress-track {
    position: absolute;
    left: 0;
    right: 0;
    top: 5px;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--semi-color-fill-0);
    pointer-events: none;
    transition: box-shadow 0.14s ease;
  }

  .player-progress input:focus-visible + .player-progress-track {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--player-progress-end) 32%, transparent);
  }

  .player-progress-track > span {
    display: block;
    height: 100%;
    border-radius: 0 999px 999px 0;
    background: linear-gradient(
      90deg,
      var(--player-progress-start) 0%,
      var(--player-progress-end) 100%
    );
  }

  .player-brief {
    min-width: 0;
    height: 48px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .player-brief:disabled {
    opacity: 1;
    cursor: default;
  }

  .player-cover-trigger {
    position: relative;
    flex-shrink: 0;
    width: 42px;
    height: 42px;
    display: block;
  }

  .audio-cover.mini {
    width: 42px;
    height: 42px;
  }

  .player-cover-toggle {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    color: #fff;
    background: rgba(0, 0, 0, 0.42);
    font-size: 16px;
    opacity: 0;
    transform: translateY(2px);
    transition: opacity 0.14s ease, transform 0.14s ease;
  }

  .player-brief:hover .player-cover-toggle,
  .player-brief:focus-visible .player-cover-toggle,
  &.is-expanded .player-cover-toggle {
    opacity: 1;
    transform: translateY(0);
  }

  .player-title {
    max-width: 230px;
    font-size: 12px;
    line-height: 1.25;
    font-weight: 700;
  }

  .player-controls,
  .player-extra {
    display: flex;
    align-items: center;
  }

  .player-controls {
    justify-content: center;
    gap: 12px;
  }

  .player-controls .play-main {
    width: 36px;
    height: 36px;
    min-width: 36px;
  }

  .player-extra {
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .time-display {
    color: var(--semi-color-text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    white-space: nowrap;
  }

  .expanded-player {
    flex: 1;
    min-height: 0;
    position: relative;
    display: grid;
    grid-template-columns: minmax(210px, 35%) minmax(260px, 1fr);
    grid-template-rows: minmax(0, 1fr) clamp(96px, 15vh, 150px);
    align-items: center;
    column-gap: 36px;
    row-gap: 18px;
    padding: 28px 48px 16px;
    background:
      radial-gradient(circle at 18% 22%, color-mix(in srgb, var(--semi-color-primary-light-default) 42%, transparent), transparent 34%),
      linear-gradient(180deg, color-mix(in srgb, var(--semi-color-bg-1) 82%, transparent), var(--semi-color-bg-0));
    border-bottom: 1px solid var(--semi-color-border);
  }

  &.is-expanded .archive-main {
    display: none;
  }

  .expanded-state {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-secondary);
    font-size: 12px;
    text-align: center;
  }

  .expanded-state.state-error {
    color: var(--semi-color-danger);
  }

  .expanded-cover-wrap {
    display: flex;
    justify-content: flex-end;
    min-width: 0;
  }

  .audio-cover.large {
    width: min(300px, 28vw);
    height: min(300px, 28vw);
    min-width: 180px;
    min-height: 180px;
    border-radius: 10px;
    font-size: 68px;
    box-shadow: 0 24px 58px rgba(0, 0, 0, 0.22);
  }

  .audio-cover.large.is-empty {
    box-shadow: none;
  }

  .expanded-lyrics {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .expanded-spectrum {
    grid-column: 1 / -1;
    width: min(100%, 980px);
    height: 100%;
    min-height: 0;
    justify-self: center;
  }

  .expanded-title {
    max-width: 620px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 800;
  }

  .expanded-subtitle {
    color: var(--semi-color-text-2);
    font-size: 12px;
  }

  .lyrics-stage {
    height: clamp(250px, 42vh, 420px);
    min-height: 0;
    overflow: auto;
    scrollbar-width: none;
    mask-image: linear-gradient(180deg, transparent 0%, #000 15%, #000 85%, transparent 100%);
  }

  .lyrics-stage::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .lyric-roller {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
    padding: 42% 0;
  }

  .lyric-line {
    position: relative;
    margin: 0;
    width: fit-content;
    max-width: min(720px, 100%);
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 17px;
    line-height: 1.55;
    font-weight: 700;
    color: var(--semi-color-text-2);
    text-align: left;
    white-space: pre-wrap;
    cursor: pointer;
    opacity: 0.48;
    transform-origin: left center;
    transition:
      opacity 0.18s ease,
      color 0.18s ease,
      transform 0.18s ease;
  }

  .lyric-line:hover {
    opacity: 0.78;
    color: var(--semi-color-text-1);
  }

  .lyric-line.is-focus {
    font-size: 25px;
    font-weight: 850;
    opacity: 1;
    transform: translateX(2px);
    color: transparent;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--semi-color-primary) 74%, var(--semi-color-text-0)) 0%,
        color-mix(in srgb, var(--semi-color-primary) 74%, var(--semi-color-text-0)) var(--lyric-progress),
        var(--semi-color-text-0) var(--lyric-progress),
        var(--semi-color-text-0) 100%
      );
    background-clip: text;
    -webkit-background-clip: text;
    will-change: background;
  }

  .lyric-line.muted {
    color: var(--semi-color-text-2);
    font-size: 14px;
    font-weight: 500;
  }

  @media (max-width: 860px) {
    .song-row {
      grid-template-columns: 28px 40px minmax(120px, 1fr) 46px;
      gap: 9px;
    }

    .song-list-header {
      grid-template-columns: 28px 40px minmax(120px, 1fr) 46px;
      gap: 9px;
    }

    .song-album,
    .row-icon-button,
    .song-list-header span:nth-child(4),
    .song-list-header span:nth-child(5) {
      display: none;
    }

    .audio-player-bar {
      grid-template-columns: minmax(130px, 1fr) auto;
      gap: 10px;
    }

    .player-extra {
      display: none;
    }

    .expanded-player {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(220px, 1fr) 76px;
      align-items: start;
      gap: 18px;
      padding: 44px 20px 18px;
    }

    .expanded-cover-wrap {
      justify-content: center;
    }
  }
`;
