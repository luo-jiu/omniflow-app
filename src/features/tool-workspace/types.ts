import type { SelectedTreeNode } from '@/features/file-explorer';

export type ToolWorkspaceToolId = 'subtitle-translation';

export type SubtitleFileFormat = 'srt' | 'vtt';

export type SubtitleSourceType = 'library' | 'local';

export type SubtitleTranslationRowStatus = 'error' | 'idle' | 'success' | 'translating';

export interface SubtitleTranslationRow {
  cueId?: string;
  endMs: number;
  endTimestamp: string;
  error?: string;
  id: string;
  index: number;
  settings?: string;
  sourceText: string;
  startMs: number;
  startTimestamp: string;
  status: SubtitleTranslationRowStatus;
  translatedText: string;
}

export interface SubtitleTranslationConfig {
  apiKey: string;
  baseUrl: string;
  contextWindow: number;
  model: string;
  presetPrompt: string;
  targetLanguage: string;
  unloadModelAfterTranslate: boolean;
}

export interface SubtitleTranslationDraft {
  fileFormat: SubtitleFileFormat | null;
  fileName: string;
  filePath?: string;
  rows: SubtitleTranslationRow[];
  sourceNode?: SelectedTreeNode | null;
  sourceType: SubtitleSourceType | null;
}

export interface ToolWorkspaceState {
  activeToolId: ToolWorkspaceToolId;
  subtitleTranslationDraft: SubtitleTranslationDraft;
}
