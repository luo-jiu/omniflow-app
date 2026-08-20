import { getFileLink, uploadLocalPathAndCreateNode } from '@/features/file-explorer/services/file.api';
import type { SelectedTreeNode } from '@/features/file-explorer';
import {
  beginAIServiceRun,
  completeWithAIService,
  endAIServiceRun,
  fetchActiveAIServiceModels,
} from '@/features/ai-services/ai-service.api';

import type {
  SubtitleFileFormat,
  SubtitleTranslationConfig,
  SubtitleTranslationRow,
} from './types';
import {
  buildTranslatedSubtitleContent,
  isSupportedSubtitleExtension,
  parseSubtitleDocument,
} from './subtitle-translation.utils';

const SUBTITLE_TRANSLATION_PREFERENCES_KEY = 'subtitle-translation-preferences:v2';
const LEGACY_SUBTITLE_TRANSLATION_PREFERENCES_KEY = 'subtitle-translation-preferences:v1';
export const MAX_DROPPED_SUBTITLE_FILE_BYTES = 20 * 1024 * 1024;

function normalizeContextWindow(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(10, Math.floor(parsed)));
}

function readTextResponseBody(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body === null || body === undefined) {
    return '';
  }
  return String(body);
}

function buildTranslationPrompt(
  rows: SubtitleTranslationRow[],
  rowIndex: number,
  contextWindow: number,
): string {
  const start = Math.max(0, rowIndex - contextWindow);
  const end = Math.min(rows.length - 1, rowIndex + contextWindow);
  const previous = rows.slice(start, rowIndex);
  const current = rows[rowIndex];
  const next = rows.slice(rowIndex + 1, end + 1);

  const formatRows = (inputRows: SubtitleTranslationRow[]) => (
    inputRows.length > 0
      ? inputRows
          .map((row) => `${row.index}. ${row.sourceText}`)
          .join('\n')
      : '无'
  );

  return [
    '按照 SYSTEM 中指定的语言和规则翻译 CURRENT 小节。',
    '只返回 CURRENT 的译文，不要解释，不要加编号，不要输出额外标记。',
    '保留原句中的换行、专有名词和语气，必要时做自然化处理。',
    '',
    '[PREVIOUS]',
    formatRows(previous),
    '',
    '[CURRENT]',
    current.sourceText,
    '',
    '[NEXT]',
    formatRows(next),
  ].join('\n');
}

function buildSystemPrompt(config: SubtitleTranslationConfig): string {
  const presetPrompt = String(config.presetPrompt || '').trim();
  return [
    '你是专业字幕翻译助手。你只能输出当前字幕句子的译文，不要解释，不要补充说明。',
    presetPrompt,
  ].filter(Boolean).join('\n\n');
}

export function loadSubtitleTranslationPreferences(): SubtitleTranslationConfig {
  const fallback: SubtitleTranslationConfig = {
    contextWindow: 5,
    model: '',
    presetPrompt: '',
    reasoningEffort: 'auto',
  };

  const currentRaw = localStorage.getItem(SUBTITLE_TRANSLATION_PREFERENCES_KEY);
  const legacyRaw = localStorage.getItem(LEGACY_SUBTITLE_TRANSLATION_PREFERENCES_KEY);
  const raw = currentRaw || legacyRaw;
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SubtitleTranslationConfig>;
    const normalized = {
      contextWindow: normalizeContextWindow(parsed.contextWindow, fallback.contextWindow),
      model: String(parsed.model ?? fallback.model),
      presetPrompt: String(parsed.presetPrompt ?? fallback.presetPrompt),
      reasoningEffort: parsed.reasoningEffort === 'low'
        || parsed.reasoningEffort === 'medium'
        || parsed.reasoningEffort === 'high'
        ? parsed.reasoningEffort
        : 'auto' as const,
    };
    localStorage.setItem(SUBTITLE_TRANSLATION_PREFERENCES_KEY, JSON.stringify(normalized));
    localStorage.removeItem(LEGACY_SUBTITLE_TRANSLATION_PREFERENCES_KEY);
    return normalized;
  } catch {
    localStorage.removeItem(SUBTITLE_TRANSLATION_PREFERENCES_KEY);
    localStorage.removeItem(LEGACY_SUBTITLE_TRANSLATION_PREFERENCES_KEY);
    return fallback;
  }
}

export function saveSubtitleTranslationPreferences(config: SubtitleTranslationConfig) {
  localStorage.setItem(SUBTITLE_TRANSLATION_PREFERENCES_KEY, JSON.stringify({
    contextWindow: normalizeContextWindow(config.contextWindow, 5),
    model: String(config.model || ''),
    presetPrompt: String(config.presetPrompt || ''),
    reasoningEffort: config.reasoningEffort,
  }));
  localStorage.removeItem(LEGACY_SUBTITLE_TRANSLATION_PREFERENCES_KEY);
}

export async function pickLocalSubtitleFile() {
  const result = await window.electronAPI.openTextFile({
    filters: [
      { name: 'Subtitles', extensions: ['srt', 'vtt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!result || result.canceled) {
    return null;
  }

  const parsed = parseSubtitleDocument(result.content, result.filePath);
  return {
    ...parsed,
    fileName: result.filePath.split(/[\\/]/).pop() || 'subtitle.srt',
    filePath: result.filePath,
  };
}

function validateDroppedSubtitleFile(file: File) {
  const fileName = String(file?.name || '').trim();
  if (!isSupportedSubtitleExtension(fileName)) {
    throw new Error('当前仅支持拖入 SRT 或 VTT 字幕文件');
  }
  if (Number.isFinite(file.size) && file.size > MAX_DROPPED_SUBTITLE_FILE_BYTES) {
    throw new Error('拖入字幕文件不能超过 20 MB');
  }

  return fileName;
}

export function selectSingleDroppedSubtitleFile(files: ArrayLike<File>): File {
  const candidates = Array.from(files);
  if (candidates.length !== 1) {
    throw new Error(candidates.length > 1 ? '一次只能拖入一个字幕文件' : '未读取到可用的本地文件');
  }
  validateDroppedSubtitleFile(candidates[0]);
  return candidates[0];
}

export async function loadSubtitleFromDroppedFile(file: File) {
  const fileName = validateDroppedSubtitleFile(file);

  const parsed = parseSubtitleDocument(await file.text(), fileName);
  return {
    ...parsed,
    fileName,
    filePath: '',
  };
}

export async function loadSubtitleFromLibraryNode(
  libraryId: number,
  node: SelectedTreeNode,
) {
  const url = await getFileLink(node.id, libraryId, 60);
  const response = await window.electronAPI.fetch(url, {
    method: 'GET',
  });
  const parsed = parseSubtitleDocument(readTextResponseBody(response?.body), `${node.name}${node.ext ? `.${node.ext}` : ''}`);
  return {
    ...parsed,
    fileName: `${node.name}${node.ext ? `.${node.ext}` : ''}`,
    filePath: '',
  };
}

export function fetchAvailableTranslationModels(): Promise<string[]> {
  return fetchActiveAIServiceModels();
}

export async function beginSubtitleTranslationRun(serviceProfileId: string): Promise<string> {
  const session = await beginAIServiceRun(serviceProfileId);
  return session.id;
}

export function endSubtitleTranslationRun(runSessionId: string): Promise<boolean> {
  return endAIServiceRun(runSessionId);
}

export async function translateSubtitleRow(
  config: SubtitleTranslationConfig,
  rows: SubtitleTranslationRow[],
  rowIndex: number,
  serviceProfileId: string,
  runSessionId?: string,
): Promise<string> {
  const model = String(config.model || '').trim();
  if (!model) {
    throw new Error('请先选择模型');
  }

  return completeWithAIService({
    model,
    profileId: serviceProfileId,
    reasoningEffort: config.reasoningEffort,
    runSessionId,
    systemPrompt: buildSystemPrompt(config),
    userPrompt: buildTranslationPrompt(
      rows,
      rowIndex,
      Math.max(0, Math.floor(Number(config.contextWindow) || 0)),
    ),
  });
}

export async function saveSubtitleToLocalFile(
  fileName: string,
  format: SubtitleFileFormat,
  rows: SubtitleTranslationRow[],
) {
  const saveResult = await window.electronAPI.saveDownloadFile(fileName, {
    filters: [
      { name: format.toUpperCase(), extensions: [format] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!saveResult || saveResult.canceled || !saveResult.filePath) {
    return null;
  }

  const content = buildTranslatedSubtitleContent(format, rows);
  await window.electronAPI.writeTextFile(saveResult.filePath, content);
  return saveResult.filePath;
}

export async function saveSubtitleToLibraryNode(payload: {
  fileName: string;
  format: SubtitleFileFormat;
  libraryId: number;
  parentId: number;
  rows: SubtitleTranslationRow[];
}) {
  const content = buildTranslatedSubtitleContent(payload.format, payload.rows);
  const staged = await window.electronAPI.createStagedTextFile(payload.fileName, content);
  try {
    return await uploadLocalPathAndCreateNode(staged.filePath, payload.parentId, payload.libraryId, {
      conflictPolicy: 'auto_rename',
    });
  } finally {
    await window.electronAPI.cleanupStagedTextFile(staged.filePath).catch(() => false);
  }
}

export async function uploadGeneratedSubtitleContent(
  fileName: string,
  content: string,
  libraryId: number,
  parentId: number,
) {
  const staged = await window.electronAPI.createStagedTextFile(fileName, content);
  try {
    return await uploadLocalPathAndCreateNode(staged.filePath, parentId, libraryId, {
      conflictPolicy: 'auto_rename',
    });
  } finally {
    await window.electronAPI.cleanupStagedTextFile(staged.filePath).catch(() => false);
  }
}
