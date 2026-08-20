import type { SelectedTreeNode } from '@/features/file-explorer';
import type { AIServiceReasoningEffort } from '@/features/ai-services/ai-service.types';
import type {
  EmbeddedBrowserHlsDownloadPlan,
  EmbeddedBrowserHlsManifest,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-manifest';
import type {
  EmbeddedBrowserMpdDownloadPlan,
  EmbeddedBrowserMpdManifest,
} from '@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest';
import type { EmbeddedBrowserCapturedResource } from '@/features/embedded-browser/resources/types';

export const TOOL_WORKSPACE_TOOL_IDS = [
  'ai-services',
  'subtitle-translation',
  'media-file-processing',
  'media-processing',
] as const;

export type ToolWorkspaceToolId = typeof TOOL_WORKSPACE_TOOL_IDS[number];

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

export interface ToolWorkspaceLibraryMediaRequest {
  id: number;
  node: SelectedTreeNode;
}

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
  contextWindow: number;
  model: string;
  presetPrompt: string;
  reasoningEffort: AIServiceReasoningEffort;
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
