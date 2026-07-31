export const TEXT_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const TEXT_VIEWER_SESSION_ESTIMATED_BYTES = 512;

export interface TextViewerSessionSnapshot {
  fontSize: number;
  wordWrap: boolean;
  selectionAnchor: number;
  selectionHead: number;
  topLine: number;
  topLineOffset: number;
  scrollTop: number;
  scrollLeft: number;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeNonNegativeInteger(value: number): number {
  return Math.max(Math.round(value), 0);
}

function normalizeNonNegativeNumber(value: number): number {
  return Math.max(value, 0);
}

export function parseTextViewerSessionSnapshot(value: unknown): TextViewerSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<TextViewerSessionSnapshot>;
  const fontSize = readFiniteNumber(candidate.fontSize);
  const selectionAnchor = readFiniteNumber(candidate.selectionAnchor);
  const selectionHead = readFiniteNumber(candidate.selectionHead);
  const topLine = readFiniteNumber(candidate.topLine);
  const topLineOffset = readFiniteNumber(candidate.topLineOffset);
  const scrollTop = readFiniteNumber(candidate.scrollTop);
  const scrollLeft = readFiniteNumber(candidate.scrollLeft);
  if (
    fontSize == null
    || fontSize <= 0
    || typeof candidate.wordWrap !== 'boolean'
    || selectionAnchor == null
    || selectionHead == null
    || topLine == null
    || topLine < 1
    || topLineOffset == null
    || scrollTop == null
    || scrollLeft == null
  ) {
    return null;
  }
  return {
    fontSize,
    wordWrap: candidate.wordWrap,
    selectionAnchor: normalizeNonNegativeInteger(selectionAnchor),
    selectionHead: normalizeNonNegativeInteger(selectionHead),
    topLine: Math.max(Math.round(topLine), 1),
    topLineOffset: normalizeNonNegativeNumber(topLineOffset),
    scrollTop: normalizeNonNegativeNumber(scrollTop),
    scrollLeft: normalizeNonNegativeNumber(scrollLeft),
  };
}

export async function createTextContentRevision(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable');
  }
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hash}`;
}
