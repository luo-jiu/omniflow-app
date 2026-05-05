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

function parseSrtOrVttSubtitle(raw: string): VideoSubtitleCue[] {
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

function cleanAssText(raw: string): string[] {
  return raw
    .replace(/\{[^}]*\}/gu, '')
    .replace(/\\N|\\n/gu, '\n')
    .replace(/\\h/gu, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function splitAssDialoguePayload(payload: string, expectedColumns: number): string[] {
  const columns = payload.split(',');
  if (expectedColumns <= 1 || columns.length <= expectedColumns) {
    return columns.map(item => item.trim());
  }
  const head = columns.slice(0, expectedColumns - 1).map(item => item.trim());
  const text = columns.slice(expectedColumns - 1).join(',').trim();
  return [...head, text];
}

function parseAssSubtitle(raw: string): VideoSubtitleCue[] {
  const normalized = normalizeSubtitleText(raw);
  if (!normalized || !/\[events\]/iu.test(normalized)) return [];

  const cues: VideoSubtitleCue[] = [];
  let inEvents = false;
  let formatColumns: string[] = [];

  normalized.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^\[[^\]]+\]$/u.test(trimmed)) {
      inEvents = /^\[events\]$/iu.test(trimmed);
      return;
    }
    if (!inEvents) return;

    const formatMatch = /^Format\s*:\s*(.+)$/iu.exec(trimmed);
    if (formatMatch) {
      formatColumns = formatMatch[1]
        .split(',')
        .map(item => item.trim().toLowerCase());
      return;
    }

    const dialogueMatch = /^Dialogue\s*:\s*(.+)$/iu.exec(trimmed);
    if (!dialogueMatch) return;

    const expectedColumns = formatColumns.length || 10;
    const values = splitAssDialoguePayload(dialogueMatch[1], expectedColumns);
    const startIndex = formatColumns.indexOf('start');
    const endIndex = formatColumns.indexOf('end');
    const textIndex = formatColumns.indexOf('text');
    const start = parseSubtitleTimestamp(values[startIndex >= 0 ? startIndex : 1] || '');
    const end = parseSubtitleTimestamp(values[endIndex >= 0 ? endIndex : 2] || '');
    const lines = cleanAssText(values[textIndex >= 0 ? textIndex : expectedColumns - 1] || '');
    if (start === null || end === null || end <= start || lines.length === 0) return;

    cues.push({
      id: `subtitle-ass-${cues.length}-${start}-${end}`,
      start,
      end,
      lines,
    });
  });

  return cues.sort((left, right) => left.start - right.start);
}

function parseLrcSubtitle(raw: string): VideoSubtitleCue[] {
  const normalized = normalizeSubtitleText(raw);
  if (!normalized) return [];

  const timedLines: Array<{ start: number; lines: string[] }> = [];
  normalized.split('\n').forEach((line) => {
    const matches = Array.from(line.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/gu));
    if (matches.length === 0) return;
    const text = line.replace(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/gu, '').trim();
    if (!text) return;
    matches.forEach((match) => {
      const start = parseSubtitleTimestamp(match[1]);
      if (start === null) return;
      timedLines.push({ start, lines: [text] });
    });
  });

  return timedLines
    .sort((left, right) => left.start - right.start)
    .map((item, index, list) => ({
      id: `subtitle-lrc-${index}-${item.start}`,
      start: item.start,
      end: list[index + 1]?.start ?? item.start + 4,
      lines: item.lines,
    }))
    .filter(item => item.end > item.start);
}

export function parseVideoSubtitle(raw: string): VideoSubtitleCue[] {
  const srtOrVttCues = parseSrtOrVttSubtitle(raw);
  if (srtOrVttCues.length > 0) return srtOrVttCues;

  const assCues = parseAssSubtitle(raw);
  if (assCues.length > 0) return assCues;

  return parseLrcSubtitle(raw);
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
