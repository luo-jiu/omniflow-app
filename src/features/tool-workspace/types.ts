import type { SelectedTreeNode } from '@/features/file-explorer';
import type {
  EmbeddedBrowserHlsDownloadPlan,
  EmbeddedBrowserHlsManifest,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-manifest';
import type {
  EmbeddedBrowserMpdDownloadPlan,
  EmbeddedBrowserMpdManifest,
} from '@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest';
import type { EmbeddedBrowserCapturedResource } from '@/features/embedded-browser/resources/types';

export type ToolWorkspaceToolId = 'subtitle-translation' | 'media-processing';

export type ToolWorkspaceMediaMode = 'resources' | 'hls-download' | 'mpd-download';

export interface ToolWorkspaceMediaResourceRequest {
  id: number;
  kind: 'resources';
  resources: EmbeddedBrowserCapturedResource[];
}

export interface ToolWorkspaceMediaHlsRequest {
  id: number;
  kind: 'hls-download';
  manifest: EmbeddedBrowserHlsManifest;
  plan: EmbeddedBrowserHlsDownloadPlan;
  resource: EmbeddedBrowserCapturedResource;
}

export interface ToolWorkspaceMediaMpdRequest {
  id: number;
  kind: 'mpd-download';
  manifest: EmbeddedBrowserMpdManifest;
  plan: EmbeddedBrowserMpdDownloadPlan;
  resource: EmbeddedBrowserCapturedResource;
}

export type ToolWorkspaceMediaRequest =
  | ToolWorkspaceMediaResourceRequest
  | ToolWorkspaceMediaHlsRequest
  | ToolWorkspaceMediaMpdRequest;

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
