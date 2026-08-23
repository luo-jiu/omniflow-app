import React from 'react';
import { IconDoubleChevronLeft } from '@douyinfe/semi-icons';

import { beginDocumentDragSession } from '@/components/ui/document-drag-session';
import {
  type SelectedTreeNode,
} from '@/features/file-explorer';
import type { EmbeddedBrowserCapturedResource } from '@/features/embedded-browser/resources/types';

import { useSubtitleTranslation } from './hooks/useSubtitleTranslation';
import { useToolWorkspaceLayout } from './hooks/useToolWorkspaceLayout';
import {
  loadToolWorkspaceState,
  saveToolWorkspaceState,
} from './tool-workspace.state';
import { isDisposingLibraryWorkspace } from '@/features/workspace-resource-release';
import ToolWorkspaceSubtitle from './ToolWorkspaceSubtitle';
import ToolWorkspaceMedia from './ToolWorkspaceMedia';
import ToolWorkspaceNav from './ToolWorkspaceNav';
import ToolWorkspaceQQMusicLyrics from './ToolWorkspaceQQMusicLyrics';
import LibraryMediaTool from '@/features/media-tools/LibraryMediaTool';
import AIServiceWorkspace from '@/features/ai-services/AIServiceWorkspace';
import type {
  ToolWorkspaceLibraryMediaRequest,
  ToolWorkspaceMediaHlsRequest,
  ToolWorkspaceMediaMpdRequest,
  ToolWorkspaceMediaMode,
  ToolWorkspaceMediaRequest,
  ToolWorkspaceState,
} from './types';
import {
  ToolNavCollapseButton,
  WorkspaceMain,
  ToolNavResizeHandle,
  Wrapper,
} from './styles';
import {
  DEFAULT_TOOL_NAV_WIDTH,
  MAX_TOOL_NAV_WIDTH,
  MIN_TOOL_NAV_WIDTH,
  clampToolNavWidth,
  getToolNavCollapseButtonLeft,
} from './tool-workspace.layout';

const TOOL_NAV_KEYBOARD_STEP = 8;

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
  const { layout, saveNavWidth, saveToolOrder } = useToolWorkspaceLayout();
  const [workspaceState, setWorkspaceState] = React.useState<ToolWorkspaceState>(() => (
    loadToolWorkspaceState(libraryId)
  ));
  const [mediaProcessingResources, setMediaProcessingResources] = React.useState<EmbeddedBrowserCapturedResource[]>([]);
  const [mediaProcessingHlsRequest, setMediaProcessingHlsRequest] = React.useState<ToolWorkspaceMediaHlsRequest | null>(null);
  const [mediaProcessingMpdRequest, setMediaProcessingMpdRequest] = React.useState<ToolWorkspaceMediaMpdRequest | null>(null);
  const [mediaProcessingMode, setMediaProcessingMode] = React.useState<ToolWorkspaceMediaMode>('resources');
  const [libraryMediaRequest, setLibraryMediaRequest] = React.useState<ToolWorkspaceLibraryMediaRequest | null>(libraryMediaProcessingRequest);
  const [isToolNavResizing, setIsToolNavResizing] = React.useState(false);
  const [toolNavWidth, setToolNavWidth] = React.useState(layout.navWidth);
  const initializedLibraryIdRef = React.useRef(libraryId);
  const toolNavResizeRef = React.useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const toolNavDocumentDragReleaseRef = React.useRef<(() => void) | null>(null);
  const toolNavWidthRef = React.useRef(toolNavWidth);
  const toolNavWrapperRef = React.useRef<HTMLDivElement>(null);
  const toolNavCollapseButtonRef = React.useRef<HTMLButtonElement>(null);
  const toolNavPreviewFrameRef = React.useRef<number | null>(null);
  const pendingToolNavPreviewWidthRef = React.useRef(toolNavWidth);
  const lastExpandedToolNavWidthRef = React.useRef(
    layout.navWidth > MIN_TOOL_NAV_WIDTH ? layout.navWidth : DEFAULT_TOOL_NAV_WIDTH,
  );

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
    active: activeToolId === 'subtitle-translation',
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

  React.useEffect(() => {
    if (toolNavResizeRef.current) return;
    toolNavWidthRef.current = layout.navWidth;
    if (layout.navWidth > MIN_TOOL_NAV_WIDTH) {
      lastExpandedToolNavWidthRef.current = layout.navWidth;
    }
    setToolNavWidth(layout.navWidth);
  }, [layout.navWidth]);

  const updateToolNavWidth = React.useCallback((width: number) => {
    const nextWidth = clampToolNavWidth(width);
    toolNavWidthRef.current = nextWidth;
    setToolNavWidth(nextWidth);
    return nextWidth;
  }, []);

  const applyToolNavWidthPreview = React.useCallback((nextWidth: number) => {
    const collapsed = nextWidth === MIN_TOOL_NAV_WIDTH;
    toolNavWrapperRef.current?.style.setProperty('--tool-nav-width', `${nextWidth}px`);
    toolNavWrapperRef.current?.style.setProperty(
      '--tool-nav-collapse-button-left',
      `${getToolNavCollapseButtonLeft(nextWidth, collapsed)}px`,
    );
    toolNavCollapseButtonRef.current?.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  }, []);

  const flushToolNavWidthPreview = React.useCallback(() => {
    if (toolNavPreviewFrameRef.current !== null) {
      cancelAnimationFrame(toolNavPreviewFrameRef.current);
      toolNavPreviewFrameRef.current = null;
    }
    applyToolNavWidthPreview(pendingToolNavPreviewWidthRef.current);
  }, [applyToolNavWidthPreview]);

  const previewToolNavWidth = React.useCallback((width: number) => {
    const nextWidth = clampToolNavWidth(width);
    toolNavWidthRef.current = nextWidth;
    pendingToolNavPreviewWidthRef.current = nextWidth;
    if (toolNavPreviewFrameRef.current === null) {
      toolNavPreviewFrameRef.current = requestAnimationFrame(() => {
        toolNavPreviewFrameRef.current = null;
        applyToolNavWidthPreview(pendingToolNavPreviewWidthRef.current);
      });
    }
    return nextWidth;
  }, [applyToolNavWidthPreview]);

  const finishToolNavResize = React.useCallback((target?: HTMLElement, pointerId?: number) => {
    const resize = toolNavResizeRef.current;
    if (!resize) return;
    flushToolNavWidthPreview();
    toolNavResizeRef.current = null;
    setIsToolNavResizing(false);
    toolNavDocumentDragReleaseRef.current?.();
    toolNavDocumentDragReleaseRef.current = null;
    if (target && pointerId !== undefined && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    setToolNavWidth(toolNavWidthRef.current);
    if (toolNavWidthRef.current > MIN_TOOL_NAV_WIDTH) {
      lastExpandedToolNavWidthRef.current = toolNavWidthRef.current;
    }
    saveNavWidth(toolNavWidthRef.current);
  }, [flushToolNavWidthPreview, saveNavWidth]);

  const handleToolNavResizePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || toolNavResizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    if (toolNavWidth > MIN_TOOL_NAV_WIDTH) {
      lastExpandedToolNavWidthRef.current = toolNavWidth;
    }
    pendingToolNavPreviewWidthRef.current = toolNavWidth;
    toolNavResizeRef.current = {
      pointerId: event.pointerId,
      startWidth: toolNavWidth,
      startX: event.clientX,
    };
    setIsToolNavResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    toolNavDocumentDragReleaseRef.current?.();
    toolNavDocumentDragReleaseRef.current = beginDocumentDragSession('col-resize');
  }, [toolNavWidth]);

  const handleToolNavResizePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resize = toolNavResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.stopPropagation();
    previewToolNavWidth(resize.startWidth + event.clientX - resize.startX);
  }, [previewToolNavWidth]);

  const handleToolNavResizePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (toolNavResizeRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishToolNavResize(event.currentTarget, event.pointerId);
  }, [finishToolNavResize]);

  const handleToolNavResizeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    if (event.key === 'ArrowLeft') nextWidth = toolNavWidth - TOOL_NAV_KEYBOARD_STEP;
    if (event.key === 'ArrowRight') nextWidth = toolNavWidth + TOOL_NAV_KEYBOARD_STEP;
    if (event.key === 'Home') nextWidth = MIN_TOOL_NAV_WIDTH;
    if (event.key === 'End') nextWidth = MAX_TOOL_NAV_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    const committedWidth = updateToolNavWidth(nextWidth);
    if (committedWidth > MIN_TOOL_NAV_WIDTH) {
      lastExpandedToolNavWidthRef.current = committedWidth;
    }
    saveNavWidth(committedWidth);
  }, [saveNavWidth, toolNavWidth, updateToolNavWidth]);

  React.useEffect(() => () => {
    if (toolNavPreviewFrameRef.current !== null) {
      cancelAnimationFrame(toolNavPreviewFrameRef.current);
    }
    toolNavDocumentDragReleaseRef.current?.();
    toolNavDocumentDragReleaseRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    if (isToolNavResizing) return;
    toolNavWrapperRef.current?.style.removeProperty('--tool-nav-width');
    toolNavWrapperRef.current?.style.removeProperty('--tool-nav-collapse-button-left');
  }, [isToolNavResizing, toolNavWidth]);

  const isToolNavCollapsed = toolNavWidth === MIN_TOOL_NAV_WIDTH;

  const toggleToolNav = React.useCallback(() => {
    const nextWidth = isToolNavCollapsed
      ? lastExpandedToolNavWidthRef.current
      : MIN_TOOL_NAV_WIDTH;
    if (!isToolNavCollapsed) {
      lastExpandedToolNavWidthRef.current = toolNavWidth;
    }
    const committedWidth = updateToolNavWidth(nextWidth);
    saveNavWidth(committedWidth);
  }, [isToolNavCollapsed, saveNavWidth, toolNavWidth, updateToolNavWidth]);

  return (
    <Wrapper
      ref={toolNavWrapperRef}
      $toolNavCollapsed={isToolNavCollapsed}
      $toolNavWidth={toolNavWidth}
      data-resizing={isToolNavResizing ? 'true' : 'false'}
    >
      <ToolWorkspaceNav
        activeToolId={activeToolId}
        collapsed={isToolNavCollapsed}
        onOrderChange={saveToolOrder}
        onSelectTool={openTool}
        order={layout.toolOrder}
      />
      <ToolNavCollapseButton
        ref={toolNavCollapseButtonRef}
        aria-expanded={!isToolNavCollapsed}
        aria-label={isToolNavCollapsed ? '展开工具区导航' : '收起工具区导航'}
        data-collapsed={isToolNavCollapsed ? 'true' : 'false'}
        title={isToolNavCollapsed ? '展开工具区导航' : '收起工具区导航'}
        type="button"
        onClick={toggleToolNav}
      >
        <IconDoubleChevronLeft aria-hidden="true" />
      </ToolNavCollapseButton>
      <ToolNavResizeHandle
        aria-label="调整工具区宽度"
        aria-orientation="vertical"
        aria-valuemax={MAX_TOOL_NAV_WIDTH}
        aria-valuemin={MIN_TOOL_NAV_WIDTH}
        aria-valuenow={toolNavWidth}
        data-resizing={isToolNavResizing ? 'true' : 'false'}
        role="separator"
        tabIndex={0}
        onKeyDown={handleToolNavResizeKeyDown}
        onLostPointerCapture={() => finishToolNavResize()}
        onPointerDown={handleToolNavResizePointerDown}
        onPointerMove={handleToolNavResizePointerMove}
        onPointerCancel={handleToolNavResizePointerUp}
        onPointerUp={handleToolNavResizePointerUp}
      />

      <WorkspaceMain>
        {activeToolId === 'ai-services' ? <AIServiceWorkspace /> : null}

        {activeToolId === 'qqmusic-lyrics' ? (
          <ToolWorkspaceQQMusicLyrics
            libraryId={libraryId}
            onRefreshDirectory={onRefreshDirectory}
            rootNodeId={rootNodeId}
            selectedTreeNode={selectedTreeNode}
          />
        ) : null}

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
        ) : null}
      </WorkspaceMain>
    </Wrapper>
  );
};

export default ToolWorkspace;
