import type { AudioDockProgressGeometry } from './audio-dock-progress-geometry';

export function createAudioDockReturnPath(g: AudioDockProgressGeometry) {
  const { width: w, height: h, inset: i, corner: c, radius: r, arcLength, straightLength } = g;
  const side = h - 2 * c;
  return {
    length: side * 2 + arcLength * 2 + straightLength,
    path: `M ${w - i} ${c} V ${h - c} A ${r} ${r} 0 0 1 ${w - c} ${h - i} H ${c} A ${r} ${r} 0 0 1 ${i} ${h - c} V ${c}`,
  };
}

/** Continue clockwise from the upper track's end, along the bottom, to its start. */
export function getAudioDockReturnPoint(g: AudioDockProgressGeometry, ratio: number) {
  const { width: w, height: h, inset: i, corner: c, radius: r, arcLength: arc, straightLength: straight } = g;
  const side = h - 2 * c;
  let distance = Math.min(Math.max(ratio, 0), 1) * createAudioDockReturnPath(g).length;
  if (distance <= side) return { x: w - i, y: c + distance };
  distance -= side;
  if (distance <= arc) return { x: w - c + r * Math.cos(distance / r), y: h - c + r * Math.sin(distance / r) };
  distance -= arc;
  if (distance <= straight) return { x: w - c - distance, y: h - i };
  distance -= straight;
  if (distance <= arc) return { x: c - r * Math.sin(distance / r), y: h - c + r * Math.cos(distance / r) };
  return { x: i, y: h - c - (distance - arc) };
}

export const AUDIO_DOCK_METEOR_SHRINK_MS = 220;
export const AUDIO_DOCK_METEOR_FLIGHT_MS = 950;
export const AUDIO_DOCK_METEOR_DURATION_MS = 1050;
