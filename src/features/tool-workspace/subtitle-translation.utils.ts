import type {
  SubtitleFileFormat,
  SubtitleTranslationRow,
} from './types';

function parseTimestampToMs(raw: string): number | null {
  const normalized = String(raw || '').trim().replace(',', '.');
  const match = normalized.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const milliseconds = Number(match[4] || 0);

  return ((((hours * 60) + minutes) * 60) + seconds) * 1000 + milliseconds;
}

export function formatTimestamp(ms: number, format: SubtitleFileFormat): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const milliseconds = safeMs % 1000;
  const fractionSeparator = format === 'srt' ? ',' : '.';
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(milliseconds).padStart(3, '0');
  return `${hh}:${mm}:${ss}${fractionSeparator}${mmm}`;
}

function detectSubtitleFormat(raw: string, fileName?: string): SubtitleFileFormat | null {
  const normalizedFileName = String(fileName || '').trim().toLowerCase();
  if (normalizedFileName.endsWith('.srt')) {
    return 'srt';
  }
  if (normalizedFileName.endsWith('.vtt')) {
    return 'vtt';
  }

  const normalized = String(raw || '').trimStart();
  if (normalized.startsWith('WEBVTT')) {
    return 'vtt';
  }
  if (/\d+\s*\n\s*\d{2}:\d{2}:\d{2},\d{3}\s+-->/.test(normalized)) {
    return 'srt';
  }
  if (/\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->/.test(normalized)) {
    return 'vtt';
  }
  return null;
}

export function isSupportedSubtitleExtension(extOrFileName: string): boolean {
  const normalized = String(extOrFileName || '').trim().toLowerCase();
  return (
    normalized.endsWith('.srt')
    || normalized.endsWith('.vtt')
    || normalized === 'srt'
    || normalized === 'vtt'
  );
}

export function parseSubtitleDocument(raw: string, fileName?: string): {
  fileFormat: SubtitleFileFormat;
  rows: SubtitleTranslationRow[];
} {
  const fileFormat = detectSubtitleFormat(raw, fileName);
  if (!fileFormat) {
    throw new Error('当前仅支持 SRT 或 VTT 字幕文件');
  }

  const normalized = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const content = fileFormat === 'vtt'
    ? normalized.replace(/^WEBVTT[^\n]*\n+/i, '')
    : normalized;
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const rows: SubtitleTranslationRow[] = [];
  blocks.forEach((block, blockIndex) => {
    const lines = block
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return;
    }

    if (fileFormat === 'vtt' && /^(NOTE|STYLE|REGION)\b/i.test(lines[0])) {
      return;
    }

    const timestampLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timestampLineIndex < 0) {
      return;
    }

    const cueId = timestampLineIndex > 0 ? lines.slice(0, timestampLineIndex).join(' ').trim() : '';
    const timestampLine = lines[timestampLineIndex];
    const timeMatch = timestampLine.match(
      /^\s*([0-9:,.\s]+)\s+-->\s+([0-9:,.\s]+)(?:\s+(.*))?$/,
    );
    if (!timeMatch) {
      return;
    }

    const startTimestamp = String(timeMatch[1] || '').trim();
    const endTimestamp = String(timeMatch[2] || '').trim();
    const startMs = parseTimestampToMs(startTimestamp);
    const endMs = parseTimestampToMs(endTimestamp);
    if (startMs === null || endMs === null) {
      return;
    }

    const sourceText = lines.slice(timestampLineIndex + 1).join('\n').trim();
    if (!sourceText) {
      return;
    }

    rows.push({
      cueId: cueId || undefined,
      endMs,
      endTimestamp,
      id: `${blockIndex + 1}-${startMs}-${endMs}`,
      index: rows.length + 1,
      settings: String(timeMatch[3] || '').trim() || undefined,
      sourceText,
      startMs,
      startTimestamp,
      status: 'idle',
      translatedText: '',
    });
  });

  if (rows.length === 0) {
    throw new Error('未识别到有效字幕片段');
  }

  return {
    fileFormat,
    rows,
  };
}

export function buildTranslatedSubtitleContent(
  format: SubtitleFileFormat,
  rows: SubtitleTranslationRow[],
): string {
  const orderedRows = [...rows].sort((a, b) => a.index - b.index);
  const blocks = orderedRows.map((row, index) => {
    const content = String(row.translatedText || row.sourceText || '').trim() || row.sourceText;
    const timeline = `${formatTimestamp(row.startMs, format)} --> ${formatTimestamp(row.endMs, format)}${row.settings ? ` ${row.settings}` : ''}`;
    if (format === 'vtt') {
      const cueLines = [row.cueId, timeline, content].filter(Boolean);
      return cueLines.join('\n');
    }
    return `${index + 1}\n${timeline}\n${content}`;
  });

  if (format === 'vtt') {
    return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
  }
  return `${blocks.join('\n\n')}\n`;
}

export function mergeAdjacentDuplicateRows(
  rows: SubtitleTranslationRow[],
  fileFormat: SubtitleFileFormat,
): SubtitleTranslationRow[] {
  if (rows.length === 0) {
    return [];
  }

  const merged: SubtitleTranslationRow[] = [];
  let groupStart = 0;

  for (let i = 1; i <= rows.length; i += 1) {
    if (i < rows.length && rows[i].sourceText === rows[groupStart].sourceText) {
      continue;
    }

    const first = rows[groupStart];
    const last = rows[i - 1];

    const translatedText = rows
      .slice(groupStart, i)
      .find((row) => String(row.translatedText || '').trim())
      ?.translatedText || '';

    merged.push({
      ...first,
      endMs: last.endMs,
      endTimestamp: formatTimestamp(last.endMs, fileFormat),
      index: merged.length + 1,
      startTimestamp: formatTimestamp(first.startMs, fileFormat),
      status: String(translatedText || '').trim() ? 'success' : 'idle',
      translatedText,
    });

    groupStart = i;
  }

  return merged;
}

export function buildTranslatedSubtitleFileName(fileName: string, format: SubtitleFileFormat | null): string {
  const normalized = String(fileName || '').trim();
  const fallbackExtension = format ?? 'srt';
  if (!normalized) {
    return `subtitle.translated.${fallbackExtension}`;
  }

  const dotIndex = normalized.lastIndexOf('.');
  if (dotIndex <= 0) {
    return `${normalized}.translated.${fallbackExtension}`;
  }

  const baseName = normalized.slice(0, dotIndex);
  const extension = normalized.slice(dotIndex + 1) || fallbackExtension;
  return `${baseName}.translated.${extension}`;
}
