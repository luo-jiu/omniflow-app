export const AUDIO_DOCK_RADIUS = 24;
export const AUDIO_DOCK_PROGRESS_STROKE = 3;

export interface AudioDockProgressGeometry {
  width: number;
  height: number;
  inset: number;
  radius: number;
  corner: number;
  arcLength: number;
  straightLength: number;
  length: number;
  path: string;
}

export function createAudioDockProgressGeometry(width: number, height: number): AudioDockProgressGeometry | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 3 || height <= 3) return null;
  const inset = AUDIO_DOCK_PROGRESS_STROKE / 2;
  const corner = Math.min(AUDIO_DOCK_RADIUS, width / 2, height / 2);
  const radius = corner - inset;
  const arcLength = Math.PI * radius / 2;
  const straightLength = width - 2 * corner;
  return {
    width,
    height,
    inset,
    radius,
    corner,
    arcLength,
    straightLength,
    length: arcLength * 2 + straightLength,
    path: `M ${inset} ${corner} A ${radius} ${radius} 0 0 1 ${corner} ${inset} H ${width - corner} A ${radius} ${radius} 0 0 1 ${width - inset} ${corner}`,
  };
}

export function getAudioDockProgressPoint(geometry: AudioDockProgressGeometry, ratio: number) {
  const { inset, radius, corner, arcLength, straightLength, length, width } = geometry;
  const distance = Math.min(Math.max(ratio, 0), 1) * length;
  if (distance < arcLength) {
    const angle = distance / radius;
    return { x: corner - radius * Math.cos(angle), y: corner - radius * Math.sin(angle) };
  }
  if (distance <= arcLength + straightLength) {
    return { x: corner + distance - arcLength, y: inset };
  }
  const angle = (distance - arcLength - straightLength) / radius;
  return { x: width - corner + radius * Math.sin(angle), y: corner - radius * Math.cos(angle) };
}

/** Project onto the closest point of both quarter circles and the top edge. */
export function getAudioDockProgressRatio(geometry: AudioDockProgressGeometry, x: number, y: number): number {
  const { width, inset, corner, radius, arcLength, straightLength, length } = geometry;
  const candidates = [0, arcLength, arcLength + straightLength, length];
  candidates.push(arcLength + Math.min(Math.max(x - corner, 0), straightLength));
  const leftAngle = Math.atan2(corner - y, corner - x);
  if (leftAngle >= 0 && leftAngle <= Math.PI / 2) candidates.push(leftAngle * radius);
  const rightAngle = Math.atan2(x - (width - corner), corner - y);
  if (rightAngle >= 0 && rightAngle <= Math.PI / 2) {
    candidates.push(arcLength + straightLength + rightAngle * radius);
  }

  let nearestDistance = Infinity;
  let nearestRatio = 0;
  for (const distance of candidates) {
    const ratio = distance / length;
    const point = getAudioDockProgressPoint(geometry, ratio);
    const distanceSquared = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (distanceSquared < nearestDistance) {
      nearestDistance = distanceSquared;
      nearestRatio = ratio;
    }
  }
  // Exact endpoint values avoid tiny residual strokes after seeking to an end.
  if (x <= inset && y >= corner) return 0;
  if (x >= width - inset && y >= corner) return 1;
  return nearestRatio;
}
