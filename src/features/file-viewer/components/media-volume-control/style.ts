import styled from 'styled-components';

export const MediaVolumeControlWrapper = styled.div`
  --media-volume-progress: 0%;

  width: 132px;
  min-width: 132px;
  height: 28px;
  display: grid;
  grid-template-columns: 28px 66px 30px;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;

  .media-volume-toggle {
    width: 28px;
    min-width: 28px;
    height: 28px;
    min-height: 28px;
    padding: 0;
    border-radius: 6px;
  }

  .media-volume-range {
    width: 66px;
    height: 18px;
    margin: 0;
    padding: 0;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .media-volume-range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(
      90deg,
      var(--semi-color-primary) 0 var(--media-volume-progress),
      var(--semi-color-fill-1) var(--media-volume-progress) 100%
    );
  }

  .media-volume-range::-webkit-slider-thumb {
    width: 10px;
    height: 10px;
    margin-top: -3px;
    border: 2px solid var(--semi-color-bg-0);
    border-radius: 50%;
    appearance: none;
    background: var(--semi-color-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .media-volume-range::-moz-range-track {
    height: 4px;
    border: 0;
    border-radius: 2px;
    background: var(--semi-color-fill-1);
  }

  .media-volume-range::-moz-range-progress {
    height: 4px;
    border-radius: 2px;
    background: var(--semi-color-primary);
  }

  .media-volume-range::-moz-range-thumb {
    width: 8px;
    height: 8px;
    border: 2px solid var(--semi-color-bg-0);
    border-radius: 50%;
    background: var(--semi-color-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .media-volume-range:focus-visible {
    outline: 2px solid var(--semi-color-focus-border);
    outline-offset: 2px;
    border-radius: 3px;
  }

  .media-volume-value {
    width: 30px;
    color: var(--semi-color-text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    line-height: 1;
    text-align: right;
    white-space: nowrap;
  }
`;
