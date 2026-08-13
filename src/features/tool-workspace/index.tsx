import React from 'react';

import {
  type SelectedTreeNode,
} from '@/features/file-explorer';
import type { EmbeddedBrowserCapturedResource } from '@/features/embedded-browser/resources/types';

import { useSubtitleTranslation } from './hooks/useSubtitleTranslation';
import {
  loadToolWorkspaceState,
  saveToolWorkspaceState,
} from './tool-workspace.state';
import { isDisposingLibraryWorkspace } from '@/features/workspace-resource-release';
import ToolWorkspaceSubtitle from './ToolWorkspaceSubtitle';
import ToolWorkspaceMedia from './ToolWorkspaceMedia';
import ToolWorkspaceNav from './ToolWorkspaceNav';
import LibraryMediaTool from '@/features/media-tools/LibraryMediaTool';
import type {
  ToolWorkspaceLibraryMediaRequest,
  ToolWorkspaceMediaHlsRequest,
  ToolWorkspaceMediaMpdRequest,
  ToolWorkspaceMediaMode,
  ToolWorkspaceMediaRequest,
  ToolWorkspaceState,
} from './types';
import {
  WorkspaceMain,
  Wrapper,
} from './styles';

type ToolWorkspaceProps = {
  libraryId: number;
  libraryMediaProcessingRequest?: ToolWorkspaceLibraryMediaRequest | null;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
  mediaProcessingRequest?: ToolWorkspaceMediaRequest | null;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
};

const ToolWorkspace: React.FC<ToolWorkspaceProps> = ({
  libraryId,
  libraryMediaProcessingRequest = null,
  mediaProcessingRequest = null,
  onRefreshDirectory,
  rootNodeId,
  selectedTreeNode,
}) => {
  const [workspaceState, setWorkspaceState] = React.useState<ToolWorkspaceState>(() => (
    loadToolWorkspaceState(libraryId)
  ));
  const [mediaProcessingResources, setMediaProcessingResources] = React.useState<EmbeddedBrowserCapturedResource[]>([]);
  const [mediaProcessingHlsRequest, setMediaProcessingHlsRequest] = React.useState<ToolWorkspaceMediaHlsRequest | null>(null);
  const [mediaProcessingMpdRequest, setMediaProcessingMpdRequest] = React.useState<ToolWorkspaceMediaMpdRequest | null>(null);
  const [mediaProcessingMode, setMediaProcessingMode] = React.useState<ToolWorkspaceMediaMode>('resources');
  const [libraryMediaRequest, setLibraryMediaRequest] = React.useState<ToolWorkspaceLibraryMediaRequest | null>(libraryMediaProcessingRequest);
  const initializedLibraryIdRef = React.useRef(libraryId);

  const draft = workspaceState.subtitleTranslationDraft;
  const activeToolId = workspaceState.activeToolId;
  const patchDraft = React.useCallback((updater: (current: typeof draft) => typeof draft) => {
    setWorkspaceState((current) => ({
      ...current,
      subtitleTranslationDraft: updater(current.subtitleTranslationDraft),
    }));
  }, []);
  const replaceDraft = React.useCallback((nextDraft: typeof draft) => {
    setWorkspaceState((current) => ({
      ...current,
      subtitleTranslationDraft: nextDraft,
    }));
  }, []);
  const subtitleTranslation = useSubtitleTranslation({
    draft,
    libraryId,
    onDraftReplace: replaceDraft,
    onDraftUpdate: patchDraft,
    rootNodeId,
    selectedTreeNode,
  });

  React.useEffect(() => {
    if (initializedLibraryIdRef.current === libraryId) {
      return;
    }
    initializedLibraryIdRef.current = libraryId;
    subtitleTranslation.resetState();
    setWorkspaceState(loadToolWorkspaceState(libraryId));
  }, [libraryId, subtitleTranslation]);

  React.useEffect(() => {
    if (isDisposingLibraryWorkspace(libraryId)) {
      return;
    }
    saveToolWorkspaceState(libraryId, workspaceState);
  }, [libraryId, workspaceState]);

  React.useEffect(() => {
    if (!mediaProcessingRequest) {
      return;
    }
    if (mediaProcessingRequest.kind === 'resources') {
      setMediaProcessingResources(mediaProcessingRequest.resources);
      setMediaProcessingMode('resources');
    } else if (mediaProcessingRequest.kind === 'hls-download') {
      setMediaProcessingHlsRequest(mediaProcessingRequest);
      setMediaProcessingMode('hls-download');
    } else if (mediaProcessingRequest.kind === 'mpd-download') {
      setMediaProcessingMpdRequest(mediaProcessingRequest);
      setMediaProcessingMode('mpd-download');
    }
    setWorkspaceState((current) => ({
      ...current,
      activeToolId: 'media-processing',
    }));
  }, [mediaProcessingRequest]);

  React.useEffect(() => {
    if (!libraryMediaProcessingRequest) {
      return;
    }
    setLibraryMediaRequest(libraryMediaProcessingRequest);
    setWorkspaceState((current) => ({
      ...current,
      activeToolId: 'media-file-processing',
    }));
  }, [libraryMediaProcessingRequest]);

  const openTool = React.useCallback((toolId: ToolWorkspaceState['activeToolId']) => {
    setWorkspaceState((current) => ({
      ...current,
      activeToolId: toolId,
    }));
  }, []);

  return (
    <Wrapper>
      <ToolWorkspaceNav activeToolId={activeToolId} onSelectTool={openTool} />

      <WorkspaceMain>
        {activeToolId === 'media-processing' ? (
          <ToolWorkspaceMedia
            activeMode={mediaProcessingMode}
            hlsRequest={mediaProcessingHlsRequest}
            libraryId={libraryId}
            mpdRequest={mediaProcessingMpdRequest}
            onModeChange={setMediaProcessingMode}
            onRefreshDirectory={onRefreshDirectory}
            resources={mediaProcessingResources}
          />
        ) : null}

        {activeToolId === 'media-file-processing' ? (
          <LibraryMediaTool
            libraryId={libraryId}
            onRefreshDirectory={onRefreshDirectory}
            request={libraryMediaRequest}
          />
        ) : null}

        {activeToolId === 'subtitle-translation' ? (
          <ToolWorkspaceSubtitle
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
            subtitleListPanelRef={subtitleTranslation.subtitleListPanelRef}
            untranslatedCount={subtitleTranslation.untranslatedCount}
            onConfigChange={subtitleTranslation.handlers.onConfigChange}
            onImportLocal={subtitleTranslation.handlers.onImportLocal}
            onImportSelectedLibraryFile={subtitleTranslation.handlers.onImportSelectedLibraryFile}
            onMergeAdjacentDuplicates={subtitleTranslation.handlers.onMergeAdjacentDuplicates}
            onRefreshModels={subtitleTranslation.handlers.onRefreshModels}
            onSaveLibrary={subtitleTranslation.handlers.onSaveLibrary}
            onSaveLocal={subtitleTranslation.handlers.onSaveLocal}
            onStartTranslation={subtitleTranslation.handlers.onStartTranslation}
            onStopTranslation={subtitleTranslation.handlers.onStopTranslation}
            onToggleEditingRow={subtitleTranslation.handlers.onToggleEditingRow}
            onTranslateSingle={subtitleTranslation.handlers.onTranslateSingle}
            onTranslationChange={subtitleTranslation.handlers.onTranslationChange}
          />
        ) : null}
      </WorkspaceMain>
    </Wrapper>
  );
};

export default ToolWorkspace;
