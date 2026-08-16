import React, { useEffect, useRef } from 'react';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { AudioSpectrumVisualizerWrapper } from './style';
import type { SpectrumColors } from './audio-spectrum-cover-color';
import {
  clearUnusedSpectrumHeights,
  resolveMirroredSpectrumBar,
  resolveSpectrumOpacity,
  resolveSpectrumWaveHeight,
} from './audio-spectrum-mirror';

interface AudioSpectrumVisualizerProps {
  colors: SpectrumColors;
  enabled: boolean;
  isPlaying: boolean;
  url: string;
}

const MAX_BAR_COUNT = 140;

function readSmoothedLiveLevel(levels: Float32Array, index: number, count: number): number {
  const at = (offset: number) => levels[Math.min(Math.max(index + offset, 0), count - 1)] || 0;
  return at(-2) * 0.08 + at(-1) * 0.2 + at(0) * 0.44 + at(1) * 0.2 + at(2) * 0.08;
}

function resolveFallbackLevel(index: number, time: number): number {
  const pulse = 0.2 + Math.pow(Math.max(Math.sin(time * 2.3 + index * 0.12), 0), 2) * 0.8;
  return Math.min(
    0.06 + Math.abs(Math.sin(time * 4.8 + index * 0.29)) * pulse * 0.72,
    0.82,
  );
}

function drawBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const radius = Math.min(width / 2, 0.8, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

export const AudioSpectrumVisualizer: React.FC<AudioSpectrumVisualizerProps> = ({
  colors,
  enabled,
  isPlaying,
  url,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const displayedHeightsRef = useRef(new Float32Array(MAX_BAR_COUNT * 0.8));
  const liveLevelsRef = useRef(new Float32Array(MAX_BAR_COUNT * 0.8));
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    const displayedHeights = displayedHeightsRef.current;
    let canvasCssWidth = Math.max(canvas.clientWidth, 1);
    let canvasCssHeight = Math.max(canvas.clientHeight, 1);
    let frameId = 0;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      canvasCssWidth = Math.max(entry.contentRect.width, 1);
      canvasCssHeight = Math.max(entry.contentRect.height, 1);
    });
    resizeObserver.observe(canvas);

    const render = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(Math.floor(canvasCssWidth * pixelRatio), 1);
      const height = Math.max(Math.floor(canvasCssHeight * pixelRatio), 1);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, width, height);
      if (!enabled) {
        displayedHeights.fill(0);
        return;
      }

      const playerState = globalAudioPlayer.getState();
      const playbackTime = playerState.src === url ? playerState.currentTime : 0;
      const availableBarCount = Math.min(
        MAX_BAR_COUNT,
        Math.max(40, Math.floor(canvasCssWidth / 7)),
      );
      const barCount = availableBarCount - (availableBarCount % 5);
      const sourceBarCount = (barCount * 4) / 5;
      clearUnusedSpectrumHeights(displayedHeights, sourceBarCount);
      const gap = Math.round(Math.max(
        2 * pixelRatio,
        Math.min(4 * pixelRatio, width / barCount / 2),
      ));
      const barWidth = Math.max(
        Math.floor((width - gap * (barCount - 1)) / barCount),
        Math.round(pixelRatio),
      );
      const spectrumWidth = barWidth * barCount + gap * (barCount - 1);
      const spectrumStartX = Math.floor((width - spectrumWidth) / 2);
      const minimumHeight = 1.5 * pixelRatio;
      const maximumHeight = height * 0.64;
      let hasVisibleBar = false;
      const hasLiveSpectrum = isPlayingRef.current
        && playerState.src === url
        && globalAudioPlayer.readSpectrumLevels(liveLevelsRef.current, sourceBarCount);
      let livePeak = 0;
      if (hasLiveSpectrum) {
        for (let index = 0; index < sourceBarCount; index += 1) {
          livePeak = Math.max(livePeak, liveLevelsRef.current[index]);
        }
      }

      for (let sourceIndex = 0; sourceIndex < sourceBarCount; sourceIndex += 1) {
        const level = isPlayingRef.current
          ? hasLiveSpectrum && livePeak > 0.002
            ? readSmoothedLiveLevel(liveLevelsRef.current, sourceIndex, sourceBarCount)
            : resolveFallbackLevel(sourceIndex, playbackTime)
          : 0;
        const target = level > 0
          ? Math.max(minimumHeight, Math.pow(level, 1.08) * maximumHeight)
          : 0;
        const previous = displayedHeights[sourceIndex];
        const smoothing = target > previous ? 0.48 : 0.16;
        let displayedHeight = previous + (target - previous) * smoothing;
        if (target === 0 && displayedHeight < pixelRatio) {
          displayedHeight = 0;
        }
        displayedHeights[sourceIndex] = displayedHeight;
        hasVisibleBar ||= displayedHeight > 0;
      }

      context.globalCompositeOperation = 'source-over';
      for (let sourceIndex = 0; sourceIndex < sourceBarCount; sourceIndex += 1) {
        const mirroredBar = resolveMirroredSpectrumBar(sourceIndex, sourceBarCount, barCount);
        const position = mirroredBar.mirroredIndex / Math.max(barCount - 1, 1);
        const pixelHeight = Math.round(
          displayedHeights[sourceIndex] * resolveSpectrumWaveHeight(mirroredBar.bandRatio),
        );
        if (pixelHeight < 1) continue;
        const x = spectrumStartX + mirroredBar.mirroredIndex * (barWidth + gap);
        context.fillStyle = colors.mirrored;
        context.globalAlpha = resolveSpectrumOpacity(position);
        drawBar(context, x, height - pixelHeight, barWidth, pixelHeight);
      }

      for (let sourceIndex = 0; sourceIndex < sourceBarCount; sourceIndex += 1) {
        const mirroredBar = resolveMirroredSpectrumBar(sourceIndex, sourceBarCount, barCount);
        const position = mirroredBar.primaryIndex / Math.max(barCount - 1, 1);
        const pixelHeight = Math.round(
          displayedHeights[sourceIndex] * resolveSpectrumWaveHeight(mirroredBar.bandRatio),
        );
        if (pixelHeight < 1) continue;
        const x = spectrumStartX + mirroredBar.primaryIndex * (barWidth + gap);
        context.fillStyle = colors.primary;
        context.globalAlpha = resolveSpectrumOpacity(position);
        drawBar(context, x, height - pixelHeight, barWidth, pixelHeight);
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      if (isPlayingRef.current || hasVisibleBar) {
        frameId = window.requestAnimationFrame(render);
      }
    };

    render();
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, [colors, enabled, isPlaying, url]);

  return (
    <AudioSpectrumVisualizerWrapper data-playing={enabled && isPlaying ? 'true' : 'false'}>
      <canvas ref={canvasRef} role="img" aria-label="实时音频频谱" />
    </AudioSpectrumVisualizerWrapper>
  );
};
