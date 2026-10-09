import { PluginViewer } from '../plugin-viewer';
import { installManagedViewerContributions } from '../../contributions/installed-viewers';
import { viewerRegistry, resolveViewerContribution } from '../../contributions/viewer-registry';
import { resourceViewerId } from '@/shared/viewer-contribution-id';
import { ViewerContributionContext } from '../../session/viewer-contribution.context';
import React from 'react';
import { LOCAL_PREVIEW_PREFIX, readLocalPreview } from '../../services/local-preview';
import { Spin } from "@douyinfe/semi-ui";
import ImageViewer from "../image-viewer";
import VideoViewer from "../video-viewer";
import ComicViewer from "../comic-viewer";
import GalleryViewer from "../gallery-viewer";
import PdfViewer from "../pdf-viewer";
import TextViewer from "../text-viewer";
import AsmrViewer from "../asmr-viewer";
import AsmrArchiveViewer from "../../../archive-viewer/components/asmr-archive-viewer";
import ComicArchiveViewer from "../../../archive-viewer/components/comic-archive-viewer";
import GalleryArchiveViewer from "../../../archive-viewer/components/gallery-archive-viewer";
import VideoArchiveViewer from "../../../archive-viewer/components/video-archive-viewer";
import UnifiedAudioViewer from "../../../audio-viewer/components/unified-audio-viewer";
import styled from 'styled-components';
import FloatingViewerDock from '@/components/ui/floating-viewer-dock';
import ViewerOptionsButton from '../ViewerOptionsButton';
import ViewerOptionsDialog from '../ViewerOptionsDialog';
import { ViewerOptionsContext } from '../viewer-options.context';
import type { FileDispatcherProps } from '../../contributions/viewer.types';
const DispatcherWrapper = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;

  .comic-plugin-content { display: flex; flex: 1; min-height: 0; width: calc(100% - 64px); }

  .viewer-selector { padding: 4px 8px; display: flex; gap: 8px; align-items: center; font-size: 12px; }
  .viewer-selector button, .viewer-selector select { min-height: 28px; border: 1px solid var(--app-border-strong); border-radius: var(--app-radius-small); color: var(--app-text); background: var(--app-panel); padding: 2px 8px; }
  .viewer-selector button:focus-visible, .viewer-selector select:focus-visible { outline: 2px solid var(--app-focus-border); outline-offset: 2px; }
  .loading-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .unsupported-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px;
    text-align: center;
    
    .filename {
      color: var(--semi-color-text-2);
      font-size: 14px;
    }

    .download-btn {
      padding: 10px 24px;
      background: var(--semi-color-primary);
      color: var(--app-accent-foreground);
      text-decoration: none;
      border-radius: 6px;
      transition: background 0.2s;
      &:hover {
        background: var(--semi-color-primary-hover);
      }
    }
  }

`;

/**
 * 文件分发器组件
 * 根据文件类型渲染对应的查看器 Feature
 */
const BuiltInDispatcher: React.FC<FileDispatcherProps> = ({
  accountScope,
  libraryId,
  nodeId,
  fileUrl,
  fileName,
  fileType,
  returnTarget,
  videoSubtitleSources,
  videoPlaylist,
  videoAutoPlay = false,
  videoTransition,
  loading,
  active = true,
  reloadToken = 0,
  contentRevision,
  tabId,
}) => {
  if (fileUrl?.startsWith(LOCAL_PREVIEW_PREFIX)) return <LocalFilePreview
    source={fileUrl} tabId={tabId} active={active} reloadToken={reloadToken} />;
  if (loading) {
    return (
      <DispatcherWrapper>
        <div className="loading-container">
          <Spin size="large" tip="正在加载文件..." />
        </div>
      </DispatcherWrapper>
    );
  }

  if (!fileUrl) return null;

  switch (fileType) {
    case 'image':
      return (
        <ImageViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          libraryId={libraryId}
          nodeId={nodeId}
          reloadToken={reloadToken}
          tabId={tabId}
          url={fileUrl}
        />
      );
    
    case 'audio':
      return (
        <UnifiedAudioViewer
          accountScope={accountScope}
          contentRevision={contentRevision}
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          libraryId={libraryId}
          active={active}
          tabId={tabId}
          reloadToken={reloadToken}
        />
      );

    case 'video':
      return (
        <VideoViewer
          accountScope={accountScope}
          contentRevision={contentRevision}
          libraryId={libraryId}
          nodeId={nodeId}
          url={fileUrl}
          fileName={fileName}
          active={active}
          tabId={tabId}
          returnTarget={returnTarget}
          subtitleSources={videoSubtitleSources}
          playlist={videoPlaylist}
          autoPlay={videoAutoPlay}
          transition={videoTransition}
          reloadToken={reloadToken}
        />
      );

    case 'pdf':
      return (
        <PdfViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          libraryId={libraryId}
          nodeId={nodeId}
          reloadToken={reloadToken}
          tabId={tabId}
          url={fileUrl}
        />
      );

    case 'text':
      return (
        <TextViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          libraryId={libraryId}
          nodeId={nodeId}
          reloadToken={reloadToken}
          tabId={tabId}
          url={fileUrl}
        />
      );

    case 'comic':
      return (
        <ComicViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          fileUrl={fileUrl}
          folderNodeId={nodeId}
          libraryId={libraryId}
          reloadToken={reloadToken}
          tabId={tabId}
        />
      );

    case 'gallery':
      return (
        <GalleryViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          folderNodeId={nodeId}
          libraryId={libraryId}
          reloadToken={reloadToken}
          tabId={tabId}
        />
      );

    case 'asmr':
      return (
        <AsmrViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          fileUrl={fileUrl}
          folderNodeId={nodeId}
          libraryId={libraryId}
          reloadToken={reloadToken}
          tabId={tabId}
        />
      );

    case 'asmr_archive':
      return (
        <AsmrArchiveViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          fileUrl={fileUrl}
          folderNodeId={nodeId}
          libraryId={libraryId}
          reloadToken={reloadToken}
          tabId={tabId}
        />
      );

    case 'comic_archive':
      return (
        <ComicArchiveViewer
          accountScope={accountScope}
          contentRevision={contentRevision}
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          libraryId={libraryId}
          active={active}
          reloadToken={reloadToken}
          returnTarget={returnTarget}
          tabId={tabId}
        />
      );

    case 'gallery_archive':
      return (
        <GalleryArchiveViewer
          accountScope={accountScope}
          contentRevision={contentRevision}
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          libraryId={libraryId}
          active={active}
          reloadToken={reloadToken}
          returnTarget={returnTarget}
          tabId={tabId}
        />
      );

    case 'video_archive':
      return (
        <VideoArchiveViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          fileUrl={fileUrl}
          folderNodeId={nodeId}
          libraryId={libraryId}
          reloadToken={reloadToken}
          tabId={tabId}
        />
      );

    case 'audio_archive':
      return (
        <UnifiedAudioViewer
          accountScope={accountScope}
          contentRevision={contentRevision}
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          libraryId={libraryId}
          active={active}
          tabId={tabId}
          reloadToken={reloadToken}
        />
      );

    default:
      return (
        <DispatcherWrapper>
          <div className="unsupported-container">
            <p>该文件类型暂不支持预览</p>
            <p className="filename">{fileName}</p>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="download-btn">
              下载文件
            </a>
          </div>
        </DispatcherWrapper>
      );
  }
};

const disposeCsv = installManagedViewerContributions(PluginViewer);
if (import.meta.hot) import.meta.hot.dispose(disposeCsv);
const disposeBuiltIns = viewerRegistry.installBuiltIns(BuiltInDispatcher);
if (import.meta.hot) import.meta.hot.dispose(disposeBuiltIns);

class ViewerBoundary extends React.Component<React.PropsWithChildren<{ onError: () => void; fallback: React.ReactNode }>, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const FileDispatcher: React.FC<FileDispatcherProps> = props => {
  React.useSyncExternalStore(viewerRegistry.subscribe, viewerRegistry.getSnapshot);
  const [failedId, setFailedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  React.useEffect(() => { if (props.active === false) setOptionsOpen(false); }, [props.active]);
  const choice = resolveViewerContribution(props, props.viewerId);
  const requested = choice.selected;
  const failed = Boolean(requested && failedId === requested.id);
  const selected = failed ? viewerRegistry.get(choice.fallbackId) : requested;
  const effectiveId = selected?.id ?? choice.fallbackId;
  const View = selected?.View ?? BuiltInDispatcher;
  const unavailable = choice.missingRequested || failed;
  const canChoose = Boolean(props.onSelectViewer && (choice.candidates.length > 1 || unavailable));
  const comicOptions = props.fileType === 'comic';
  const externalComic = comicOptions && effectiveId !== choice.fallbackId;
  const choose = (id: string, remember = false) => {
    try { props.onSelectViewer?.(id, remember); setError(''); setOptionsOpen(false); }
    catch { setError('无法切换或保存打开方式，请重试。'); }
  };
  const fallback = <div role="alert">查看器无法显示此文件。<a href={props.fileUrl ?? undefined} target="_blank" rel="noopener noreferrer">访问原始文件</a>{comicOptions && <ViewerOptionsButton />}</div>;
  return <ViewerOptionsContext.Provider value={comicOptions && canChoose ? { open: () => setOptionsOpen(true), unavailable } : null}>
  <DispatcherWrapper>
    {!comicOptions && canChoose && <div className="viewer-selector">
      <label>查看器 <select aria-label="查看器打开方式" value={props.viewerId ?? choice.fallbackId} onChange={event => choose(event.target.value)}>
        {choice.missingRequested && <option value={props.viewerId}>不可用的查看器</option>}
        {choice.candidates.map(viewer => <option key={viewer.id} value={viewer.id}>{viewer.title}</option>)}
      </select></label>
      <button onClick={() => choose(effectiveId, true)}>设为此类文件默认</button>
      {failed && <button onClick={() => setFailedId(null)}>重试查看器</button>}
    </div>}
    {!comicOptions && unavailable && <div role="status">所选查看器不可用，已回退到内置查看器；原选择与恢复状态保留。</div>}
    {!comicOptions && error && <div role="alert">{error}</div>}
    <ViewerContributionContext.Provider value={resourceViewerId(effectiveId, props.fileType ?? 'other') ?? undefined}>
      <ViewerBoundary key={`${effectiveId}:${props.viewerGeneration ?? 0}`} fallback={fallback} onError={() => { if (effectiveId !== choice.fallbackId) setFailedId(effectiveId); }}>
        {externalComic ? <div className="comic-plugin-content"><View {...props} active={props.active !== false && !optionsOpen} /></div>
          : <View {...props} active={props.active !== false && !(comicOptions && optionsOpen)} />}
      </ViewerBoundary>
    </ViewerContributionContext.Provider>
    {externalComic && canChoose && <FloatingViewerDock label="漫画" title={props.fileName || '漫画'} icon="book" placement="right" hideIdentity><ViewerOptionsButton /></FloatingViewerDock>}
    {comicOptions && canChoose && <ViewerOptionsDialog visible={optionsOpen && props.active !== false}
      currentId={effectiveId} candidates={choice.candidates} unavailable={unavailable} failed={failed} error={error}
      onChoose={choose} onClose={() => setOptionsOpen(false)} onRetry={() => { setFailedId(null); setOptionsOpen(false); }} />}
  </DispatcherWrapper>
  </ViewerOptionsContext.Provider>;
};

function LocalFilePreview({ source, tabId, active, reloadToken }: { source: string; tabId: string; active: boolean; reloadToken: number }) {
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof readLocalPreview>> | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let cancelled = false;
    setResult(null); setError('');
    void readLocalPreview(source).then(value => { if (!cancelled) setResult(value); }, () => {
      if (!cancelled) setError('无法预览本机文件：文件不存在、不可读、格式不支持或超过 32 MiB。');
    });
    return () => { cancelled = true; };
  }, [source, reloadToken]);
  if (error) return <div role="alert">{error}</div>;
  if (!result) return <Spin tip="正在读取本机文件" />;
  return <FileDispatcher accountScope={null} libraryId={null} nodeId={null} fileUrl={result.dataUrl}
    fileName={result.name} fileType={result.type} contentRevision={null} tabId={tabId}
    active={active} reloadToken={reloadToken} loading={false} />;
}

export default FileDispatcher;
