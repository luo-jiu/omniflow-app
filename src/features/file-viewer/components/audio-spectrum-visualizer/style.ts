import styled from 'styled-components';

export const AudioSpectrumVisualizerWrapper = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  opacity: 0.72;
  transition: opacity 0.18s ease;

  &[data-playing='true'] {
    opacity: 1;
  }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
`;
