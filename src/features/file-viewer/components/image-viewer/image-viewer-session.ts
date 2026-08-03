export const IMAGE_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const IMAGE_VIEWER_SESSION_ESTIMATED_BYTES = 256;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const MAX_ABSOLUTE_OFFSET = 10_000_000;
const MAX_ABSOLUTE_OFFSET_RATIO = 100;

export interface ImageViewerSessionSnapshot {
  zoom: number;
  offsetX: number;
  offsetY: number;
  offsetRatioX: number | null;
  offsetRatioY: number | null;
  rotateSteps: number;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseNullableRatio(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = readFiniteNumber(value);
  if (parsed == null) return undefined;
  return clamp(parsed, -MAX_ABSOLUTE_OFFSET_RATIO, MAX_ABSOLUTE_OFFSET_RATIO);
}

export function parseImageViewerSessionSnapshot(
  value: unknown,
): ImageViewerSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ImageViewerSessionSnapshot>;
  const zoom = readFiniteNumber(candidate.zoom);
  const offsetX = readFiniteNumber(candidate.offsetX);
  const offsetY = readFiniteNumber(candidate.offsetY);
  const offsetRatioX = parseNullableRatio(candidate.offsetRatioX);
  const offsetRatioY = parseNullableRatio(candidate.offsetRatioY);
  const rotateSteps = readFiniteNumber(candidate.rotateSteps);
  if (
    zoom == null
    || zoom <= 0
    || offsetX == null
    || offsetY == null
    || offsetRatioX === undefined
    || offsetRatioY === undefined
    || rotateSteps == null
  ) {
    return null;
  }
  const normalizedRotation = ((Math.round(rotateSteps) % 4) + 4) % 4;
  return {
    zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
    offsetX: clamp(offsetX, -MAX_ABSOLUTE_OFFSET, MAX_ABSOLUTE_OFFSET),
    offsetY: clamp(offsetY, -MAX_ABSOLUTE_OFFSET, MAX_ABSOLUTE_OFFSET),
    offsetRatioX,
    offsetRatioY,
    rotateSteps: normalizedRotation,
  };
}
