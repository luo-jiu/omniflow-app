import React from 'react';
import { IconMusic } from '@douyinfe/semi-icons';
import claudeIconUrl from '@/assets/icons/ai-providers/claude.svg';
import subtitleIconUrl from '@/assets/icons/material/subtitles.svg';
import resourceGrabIconUrl from '@/assets/icons/material/resource-grab.svg';
import videoIconUrl from '@/assets/icons/material/video.svg';
import { ContributionRegistry, isNamespacedContributionId } from '@/features/extensions/contribution-registry';
import { BUILT_IN_TOOL_DEFINITIONS, TOOL_WORKSPACE_TOOL_IDS, type BuiltInToolId } from './tool-definitions';
import type { ToolContribution, ToolContributionContext } from './tool-contribution.types';
import ToolWorkspaceSubtitle from './ToolWorkspaceSubtitle';
import ToolWorkspaceMedia from './ToolWorkspaceMedia';
import ToolWorkspaceQQMusicLyrics from './ToolWorkspaceQQMusicLyrics';
import LibraryMediaTool from '@/features/media-tools/LibraryMediaTool';
import AIServiceWorkspace from '@/features/ai-services/AIServiceWorkspace';
import PluginCommandWorkspace from '@/features/plugin-commands/PluginCommandWorkspace';
import { PLUGIN_COMMAND_WORKSPACE_ID } from '@/features/plugin-commands/command-open-request';
import { Puzzle } from 'lucide-react';

const views: Record<BuiltInToolId, React.ComponentType<ToolContributionContext>> = {
  'ai-services': () => <AIServiceWorkspace />,
  'qqmusic-lyrics': ({ libraryId, onRefreshDirectory, rootNodeId, selectedTreeNode }) => (
    <ToolWorkspaceQQMusicLyrics
      libraryId={libraryId}
      onRefreshDirectory={onRefreshDirectory}
      rootNodeId={rootNodeId}
      selectedTreeNode={selectedTreeNode}
    />
  ),
  'media-processing': ({ libraryId, mediaProcessingHlsRequest, mediaProcessingMode, mediaProcessingMpdRequest, mediaProcessingResources, onRefreshDirectory, setMediaProcessingMode }) => (
    <ToolWorkspaceMedia
      activeMode={mediaProcessingMode}
      hlsRequest={mediaProcessingHlsRequest}
      libraryId={libraryId}
      mpdRequest={mediaProcessingMpdRequest}
      onModeChange={setMediaProcessingMode}
      onRefreshDirectory={onRefreshDirectory}
      resources={mediaProcessingResources}
    />
  ),
  'media-file-processing': ({ libraryId, libraryMediaRequest, onRefreshDirectory }) => (
    <LibraryMediaTool
      libraryId={libraryId}
      onRefreshDirectory={onRefreshDirectory}
      request={libraryMediaRequest}
    />
  ),
  'subtitle-translation': ({ subtitleTranslation }) => (
    <ToolWorkspaceSubtitle
      activeServiceId={subtitleTranslation.activeServiceId}
      activeRowId={subtitleTranslation.activeRowId}
      availableModels={subtitleTranslation.availableModels}
      config={subtitleTranslation.config}
      deferredRows={subtitleTranslation.deferredRows}
      draft={subtitleTranslation.draft}
      editingRowId={subtitleTranslation.editingRowId}
      effectiveActiveRowId={subtitleTranslation.effectiveActiveRowId}
      importing={subtitleTranslation.importing}
      isRunnerActive={subtitleTranslation.isRunnerActive}
      librarySaveTarget={subtitleTranslation.librarySaveTarget}
      loadedSubtitleIdentity={subtitleTranslation.loadedSubtitleIdentity}
      loadingModels={subtitleTranslation.loadingModels}
      runnerSnapshot={subtitleTranslation.runnerSnapshot}
      savingLibrary={subtitleTranslation.savingLibrary}
      savingLocal={subtitleTranslation.savingLocal}
      selectedTreeNode={subtitleTranslation.selectedTreeNode}
      untranslatedCount={subtitleTranslation.untranslatedCount}
      onConfigChange={subtitleTranslation.handlers.onConfigChange}
      onImportDroppedFile={subtitleTranslation.handlers.onImportDroppedFile}
      onImportLocal={subtitleTranslation.handlers.onImportLocal}
      onImportSelectedLibraryFile={subtitleTranslation.handlers.onImportSelectedLibraryFile}
      onMergeAdjacentDuplicates={subtitleTranslation.handlers.onMergeAdjacentDuplicates}
      onLoadModels={subtitleTranslation.handlers.onLoadModels}
      onRetranslateAll={subtitleTranslation.handlers.onRetranslateAll}
      onSaveLibrary={subtitleTranslation.handlers.onSaveLibrary}
      onSaveLocal={subtitleTranslation.handlers.onSaveLocal}
      onStartTranslation={subtitleTranslation.handlers.onStartTranslation}
      onStopTranslation={subtitleTranslation.handlers.onStopTranslation}
      onToggleEditingRow={subtitleTranslation.handlers.onToggleEditingRow}
      onTranslateSingle={subtitleTranslation.handlers.onTranslateSingle}
      onTranslationChange={subtitleTranslation.handlers.onTranslationChange}
    />
  )
};

const image = (url: string) => <img className="tool-static-icon" src={url} alt="" draggable={false} />;
const icons = { claude: image(claudeIconUrl), music: <IconMusic />, subtitle: image(subtitleIconUrl), video: image(videoIconUrl), capture: image(resourceGrabIconUrl) };
export const toolRegistry = new ContributionRegistry<ToolContribution>((tool, owner) => {
  const legacy = owner === 'omniflow' && TOOL_WORKSPACE_TOOL_IDS.includes(tool.id as BuiltInToolId);
  if ((!legacy && (!isNamespacedContributionId(tool.id) || !tool.id.startsWith(`${owner}.`))) || !tool.title.trim() || tool.title.length > 128 || typeof tool.View !== 'function') throw new Error('Invalid tool contribution');
});
toolRegistry.registerBatch('omniflow', BUILT_IN_TOOL_DEFINITIONS.map(tool => ({ id: tool.id, title: tool.title, icon: icons[tool.icon], View: views[tool.id] })));
toolRegistry.registerBatch('omniflow', [{
  id: PLUGIN_COMMAND_WORKSPACE_ID,
  title: '插件工具',
  icon: <Puzzle size={18} aria-hidden="true" />,
  View: ({ libraryId, rootNodeId, selectedTreeNode, selectedNodeIds, pluginCommandRequest, onRefreshDirectory }) => (
    <PluginCommandWorkspace libraryId={libraryId} rootNodeId={rootNodeId}
      selectedTreeNode={selectedTreeNode} selectedNodeIds={selectedNodeIds}
      request={pluginCommandRequest} onRefreshDirectory={onRefreshDirectory} />
  ),
}]);
