import { getFileLink, uploadLocalPathAndCreateNode } from '@/features/file-explorer/services/file.api';
import type { SelectedTreeNode } from '@/features/file-explorer';

import type {
  SubtitleFileFormat,
  SubtitleTranslationConfig,
  SubtitleTranslationRow,
} from './types';
import {
  buildTranslatedSubtitleContent,
  parseSubtitleDocument,
} from './subtitle-translation.utils';

const SUBTITLE_TRANSLATION_PREFERENCES_KEY = 'subtitle-translation-preferences:v1';

type ModelListResponse = {
  data?: Array<{
    id?: string;
    name?: string;
  }>;
  models?: Array<{
    id?: string;
    name?: string;
  }>;
};

function normalizeBaseUrl(input: string): string {
  return String(input || '').trim().replace(/\/+$/, '');
}

function buildApiUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
  return `${normalizedBaseUrl}/${normalizedPath}`;
}

function buildRequestHeaders(apiKey: string): Record<string, string> {
  const normalizedKey = String(apiKey || '').trim();
  return {
    'Content-Type': 'application/json',
    ...(normalizedKey ? { Authorization: `Bearer ${normalizedKey}` } : {}),
  };
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

function extractModelIds(body: ModelListResponse | null | undefined): string[] {
  const data = Array.isArray(body?.data)
    ? body?.data
    : Array.isArray(body?.models)
      ? body?.models
      : [];

  return data
    .map((item) => String(item?.id || item?.name || '').trim())
    .filter(Boolean);
}

function extractTranslatedText(body: any): string {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        return typeof item?.text === 'string' ? item.text : '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function buildTranslationPrompt(
  rows: SubtitleTranslationRow[],
  rowIndex: number,
  targetLanguage: string,
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
    `把 CURRENT 小节翻译成 ${targetLanguage}。`,
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
    apiKey: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    contextWindow: 5,
    model: '',
    presetPrompt: '',
    targetLanguage: '简体中文',
    unloadModelAfterTranslate: true,
  };

  const raw = localStorage.getItem(SUBTITLE_TRANSLATION_PREFERENCES_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SubtitleTranslationConfig>;
    return {
      apiKey: String(parsed.apiKey ?? fallback.apiKey),
      baseUrl: normalizeBaseUrl(String(parsed.baseUrl ?? fallback.baseUrl)) || fallback.baseUrl,
      contextWindow: Math.max(0, Math.min(10, Number(parsed.contextWindow ?? fallback.contextWindow) || fallback.contextWindow)),
      model: String(parsed.model ?? fallback.model),
      presetPrompt: String(parsed.presetPrompt ?? fallback.presetPrompt),
      targetLanguage: String(parsed.targetLanguage ?? fallback.targetLanguage) || fallback.targetLanguage,
      unloadModelAfterTranslate: parsed.unloadModelAfterTranslate !== false,
    };
  } catch {
    return fallback;
  }
}

export function saveSubtitleTranslationPreferences(config: SubtitleTranslationConfig) {
  localStorage.setItem(SUBTITLE_TRANSLATION_PREFERENCES_KEY, JSON.stringify({
    apiKey: String(config.apiKey || ''),
    baseUrl: normalizeBaseUrl(config.baseUrl),
    contextWindow: Math.max(0, Math.min(10, Number(config.contextWindow) || 0)),
    model: String(config.model || ''),
    presetPrompt: String(config.presetPrompt || ''),
    targetLanguage: String(config.targetLanguage || '简体中文'),
    unloadModelAfterTranslate: config.unloadModelAfterTranslate !== false,
  }));
}

function isLikelyOllamaEndpoint(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
  return normalized.includes('localhost:11434') || normalized.includes('127.0.0.1:11434');
}

function buildOllamaNativeApiUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl).replace(/\/v1$/i, '');
  const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
  return `${normalizedBaseUrl}/${normalizedPath}`;
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

export async function fetchAvailableTranslationModels(config: SubtitleTranslationConfig): Promise<string[]> {
  const response = await window.electronAPI.fetch(buildApiUrl(config.baseUrl, 'models'), {
    headers: buildRequestHeaders(config.apiKey),
    method: 'GET',
  });
  if (Number(response?.status || 0) >= 400) {
    throw new Error('获取模型列表失败');
  }
  return extractModelIds(response?.body as ModelListResponse)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export async function translateSubtitleRow(
  config: SubtitleTranslationConfig,
  rows: SubtitleTranslationRow[],
  rowIndex: number,
): Promise<string> {
  const model = String(config.model || '').trim();
  if (!model) {
    throw new Error('请先选择模型');
  }

  const response = await window.electronAPI.fetch(buildApiUrl(config.baseUrl, 'chat/completions'), {
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(config),
        },
        {
          role: 'user',
          content: buildTranslationPrompt(
            rows,
            rowIndex,
            config.targetLanguage,
            Math.max(0, Math.floor(Number(config.contextWindow) || 0)),
          ),
        },
      ],
      model,
      temperature: 0.2,
    }),
    headers: buildRequestHeaders(config.apiKey),
    method: 'POST',
  });

  if (Number(response?.status || 0) >= 400) {
    throw new Error(readTextResponseBody(response?.body) || '翻译请求失败');
  }

  const translated = extractTranslatedText(response?.body);
  if (!translated) {
    throw new Error('模型未返回可用译文');
  }
  return translated;
}

export async function unloadOllamaModel(config: SubtitleTranslationConfig): Promise<void> {
  const model = String(config.model || '').trim();
  if (!model) {
    return;
  }
  if (!config.unloadModelAfterTranslate || !isLikelyOllamaEndpoint(config.baseUrl)) {
    return;
  }

  const response = await window.electronAPI.fetch(buildOllamaNativeApiUrl(config.baseUrl, 'api/generate'), {
    body: JSON.stringify({
      keep_alive: 0,
      model,
    }),
    headers: buildRequestHeaders(config.apiKey),
    method: 'POST',
  });

  if (Number(response?.status || 0) >= 400) {
    throw new Error(readTextResponseBody(response?.body) || '模型卸载失败');
  }
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
    return await uploadLocalPathAndCreateNode(staged.filePath, payload.parentId, payload.libraryId);
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
    return await uploadLocalPathAndCreateNode(staged.filePath, parentId, libraryId);
  } finally {
    await window.electronAPI.cleanupStagedTextFile(staged.filePath).catch(() => false);
  }
}
