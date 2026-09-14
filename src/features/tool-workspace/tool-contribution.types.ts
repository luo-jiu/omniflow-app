import type { ComponentType, ReactNode } from 'react';
import type { SelectedTreeNode } from '@/features/file-explorer';
import type { EmbeddedBrowserCapturedResource } from '@/features/embedded-browser/resources/types';
import type { useSubtitleTranslation } from './hooks/useSubtitleTranslation';
import type { ToolWorkspaceToolId, ToolWorkspaceLibraryMediaRequest, ToolWorkspaceMediaHlsRequest, ToolWorkspaceMediaMpdRequest, ToolWorkspaceMediaMode } from './types';

export interface ToolContributionContext {
  libraryId: number;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
  onRefreshDirectory?: (id: number) => void | Promise<void>;
  subtitleTranslation: ReturnType<typeof useSubtitleTranslation>;
  mediaProcessingMode: ToolWorkspaceMediaMode;
  mediaProcessingHlsRequest: ToolWorkspaceMediaHlsRequest | null;
  mediaProcessingMpdRequest: ToolWorkspaceMediaMpdRequest | null;
  mediaProcessingResources: EmbeddedBrowserCapturedResource[];
  setMediaProcessingMode: (mode: ToolWorkspaceMediaMode) => void;
  libraryMediaRequest: ToolWorkspaceLibraryMediaRequest | null;
}
export interface ToolContribution {
  readonly id: ToolWorkspaceToolId;
  readonly title: string;
  readonly icon: ReactNode;
  readonly View: ComponentType<ToolContributionContext>;
}
