export interface VideoSubtitleCue {
  id: string;
  start: number;
  end: number;
  lines: string[];
}

function normalizeSubtitleText(raw: string): string {
  return raw.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim();
}

function parseSubtitleTimestamp(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;

  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const secondsPart = Number(parts[parts.length - 1]);
  const minutesPart = Number(parts[parts.length - 2]);
  const hoursPart = parts.length === 3 ? Number(parts[0]) : 0;

  if ([hoursPart, minutesPart, secondsPart].some(value => Number.isNaN(value) || value < 0)) {
    return null;
  }

  return (hoursPart * 3600) + (minutesPart * 60) + secondsPart;
}

function parseSubtitleBlock(block: string, index: number): VideoSubtitleCue | null {
  const lines = block
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0);

  if (lines.length === 0) return null;

  const timelineIndex = lines.findIndex(line => line.includes('-->'));
  if (timelineIndex < 0) return null;

  const [rawStart = '', rawEndWithSettings = ''] = lines[timelineIndex].split('-->');
  const rawEnd = rawEndWithSettings.trim().split(/\s+/u)[0] ?? '';
  const start = parseSubtitleTimestamp(rawStart);
  const end = parseSubtitleTimestamp(rawEnd);

  if (start === null || end === null || end <= start) {
    return null;
  }

  const textLines = lines
    .slice(timelineIndex + 1)
    .map(line => line.trim())
    .filter(Boolean);

  if (textLines.length === 0) {
    return null;
  }

  return {
    id: `subtitle-cue-${index}-${start}-${end}`,
    start,
    end,
    lines: textLines,
  };
}

export function parseVideoSubtitle(raw: string): VideoSubtitleCue[] {
  const normalized = normalizeSubtitleText(raw);
  if (!normalized) return [];

  const blocks = normalized
    .replace(/^WEBVTT[\t ]*\n/iu, '')
    .split(/\n{2,}/u)
    .map(block => block.trim())
    .filter(Boolean);

  return blocks
    .map((block, index) => parseSubtitleBlock(block, index))
    .filter((item): item is VideoSubtitleCue => Boolean(item))
    .sort((left, right) => left.start - right.start);
}

export function findActiveSubtitleCue(
  cues: VideoSubtitleCue[],
  currentTime: number,
): VideoSubtitleCue | null {
  if (!Number.isFinite(currentTime) || currentTime < 0 || cues.length === 0) {
    return null;
  }

  let left = 0;
  let right = cues.length - 1;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const cue = cues[middle];

    if (currentTime < cue.start) {
      right = middle - 1;
      continue;
    }

    if (currentTime > cue.end) {
      left = middle + 1;
      continue;
    }

    return cue;
  }

  return null;
}
