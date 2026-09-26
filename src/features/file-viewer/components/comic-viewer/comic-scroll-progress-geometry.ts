export interface ComicScrollProgressGeometry {
  width: number;
  height: number;
  inset: number;
  radius: number;
  straightHorizontal: number;
  straightVertical: number;
  arcLength: number;
  length: number;
}

type ProgressSegment = {
  offset: number;
  length: number;
  point: (distance: number) => { x: number; y: number };
  project: (x: number, y: number) => number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function createComicScrollProgressGeometry(width: number, height: number, inset = 2): ComicScrollProgressGeometry | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= inset * 2 || height <= inset * 2) return null;
  const radius = Math.min((width - inset * 2) / 2, (height - inset * 2) / 2);
  const straightHorizontal = Math.max(width - inset * 2 - radius * 2, 0);
  const straightVertical = Math.max(height - inset * 2 - radius * 2, 0);
  const arcLength = Math.PI * radius / 2;
  return { width, height, inset, radius, straightHorizontal, straightVertical, arcLength, length: straightHorizontal * 2 + straightVertical * 2 + arcLength * 4 };
}

function lineSegment(offset: number, x1: number, y1: number, x2: number, y2: number): ProgressSegment {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  return {
    offset,
    length,
    point: distance => {
      const t = length > 0 ? clamp(distance / length, 0, 1) : 0;
      return { x: x1 + dx * t, y: y1 + dy * t };
    },
    project: (x, y) => length > 0 ? clamp(((x - x1) * dx + (y - y1) * dy) / (length * length), 0, 1) * length : 0,
  };
}

function arcSegment(offset: number, cx: number, cy: number, radius: number, start: number, end: number): ProgressSegment {
  const range = end - start;
  const length = Math.abs(range * radius);
  return {
    offset,
    length,
    point: distance => {
      const angle = start + range * (length > 0 ? clamp(distance / length, 0, 1) : 0);
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    },
    project: (x, y) => {
      if (radius <= 0 || length <= 0) return 0;
      let angle = Math.atan2(y - cy, x - cx);
      while (angle < start) angle += Math.PI * 2;
      while (angle > end) angle -= Math.PI * 2;
      return ((clamp(angle, start, end) - start) / range) * length;
    },
  };
}

function getSegments(geometry: ComicScrollProgressGeometry): ProgressSegment[] {
  const { inset, radius, width, height } = geometry;
  const left = inset;
  const right = width - inset;
  const top = inset;
  const bottom = height - inset;
  const topRight = right - radius;
  const bottomRight = bottom - radius;
  const bottomLeft = left + radius;
  const topLeft = top + radius;
  let offset = 0;
  const segments: ProgressSegment[] = [];
  const add = (segment: ProgressSegment) => { segments.push(segment); offset += segment.length; };
  add(lineSegment(offset, bottomLeft, top, topRight, top));
  add(arcSegment(offset, topRight, topLeft, radius, -Math.PI / 2, 0));
  add(lineSegment(offset, right, topLeft, right, bottomRight));
  add(arcSegment(offset, topRight, bottomRight, radius, 0, Math.PI / 2));
  add(lineSegment(offset, topRight, bottom, bottomLeft, bottom));
  add(arcSegment(offset, bottomLeft, bottomRight, radius, Math.PI / 2, Math.PI));
  add(lineSegment(offset, left, bottomRight, left, topLeft));
  add(arcSegment(offset, bottomLeft, topLeft, radius, Math.PI, Math.PI * 1.5));
  return segments;
}

export function getComicScrollProgressPoint(geometry: ComicScrollProgressGeometry, progress: number) {
  const distance = clamp(progress, 0, 1) * geometry.length;
  const segments = getSegments(geometry);
  const segment = segments.find(item => distance <= item.offset + item.length) ?? segments[segments.length - 1];
  return segment.point(distance - segment.offset);
}

export function getComicScrollProgressRatio(geometry: ComicScrollProgressGeometry, x: number, y: number) {
  const segments = getSegments(geometry);
  let nearestDistance = Infinity;
  let nearestProgress = 0;
  segments.forEach(segment => {
    const distance = segment.project(x, y);
    const point = segment.point(distance);
    const distanceSquared = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (distanceSquared < nearestDistance) {
      nearestDistance = distanceSquared;
      nearestProgress = (segment.offset + distance) / geometry.length;
    }
  });
  return clamp(nearestProgress, 0, 1);
}
