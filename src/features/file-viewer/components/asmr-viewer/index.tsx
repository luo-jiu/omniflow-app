import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconFolder,
  IconBackward,
  IconForward,
  IconMute,
  IconPlay,
  IconPause,
  IconVolume2,
  IconMusic,
} from '@douyinfe/semi-icons';
import { Button, Spin, Toast } from '@douyinfe/semi-ui';
import { getChildrenByNodeId, getFileLink } from '@/features/file-explorer/services/file.api';
import { getFileNodeIcon, isImageExtension } from '@/features/file-explorer/utils/file-node-icon';
import { AsmrViewerWrapper } from './style';
import { useFileViewer } from '@/hooks/useFileViewer';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { parseAsmrRouteInfo, resolveAsmrOwnerKey } from '@/features/file-viewer/utils/asmr-owner-key';
import { resolvePreviewFileType } from '@/utils/preview-file-type';

interface AsmrViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
}

interface AsmrNodeItem {
  id: number;
  name: string;
  type: 'dir' | 'file' | string | number;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
}

interface AsmrPathItem {
  id: number;
  name: string;
}

interface AsmrViewerSnapshot {
  hasLoadedList: boolean;
  pathStack: AsmrPathItem[];
  items: AsmrNodeItem[];
  selectedId: number | null;
  coverUrl: string | null;
  currentAudioId: number | null;
  currentAudioSrc: string | null;
  audioQueue: AsmrNodeItem[];
  audioUrlEntries: Array<[number, string]>;
}

const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

const ASMR_VIEWER_CACHE_MAX_ENTRIES = 24;
const asmrViewerSnapshotCache = new Map<string, AsmrViewerSnapshot>();

function normalizeExt(ext?: string): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

function isDirectoryNode(item: AsmrNodeItem): boolean {
  return String(item.type) === 'dir' || Number(item.type) === 0;
}

function sortNodes(items: AsmrNodeItem[]): AsmrNodeItem[] {
  return [...items].sort((a, b) => {
    const aDir = isDirectoryNode(a);
    const bDir = isDirectoryNode(b);
    if (aDir !== bDir) {
      return aDir ? -1 : 1;
    }
    return NAME_COLLATOR.compare(String(a.name || ''), String(b.name || ''));
  });
}

function resolveAsmrViewerCacheKey(fileUrl: string, folderNodeId: number | null): string | null {
  return resolveAsmrOwnerKey(fileUrl, folderNodeId);
}

function setAsmrViewerSnapshot(cacheKey: string, snapshot: AsmrViewerSnapshot) {
  if (asmrViewerSnapshotCache.has(cacheKey)) {
    asmrViewerSnapshotCache.delete(cacheKey);
  }
  asmrViewerSnapshotCache.set(cacheKey, snapshot);
  if (asmrViewerSnapshotCache.size > ASMR_VIEWER_CACHE_MAX_ENTRIES) {
    const oldestKey = asmrViewerSnapshotCache.keys().next().value;
    if (oldestKey) {
      asmrViewerSnapshotCache.delete(oldestKey);
    }
  }
}

function resolveDisplayName(item: AsmrNodeItem): string {
  if (isDirectoryNode(item)) {
    return item.name;
  }
  const ext = normalizeExt(item.ext);
  if (!ext) {
    return item.name;
  }
  return `${item.name}.${ext}`;
}

function formatFileSize(size?: number): string {
  const bytes = Number(size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function resolveRowType(item: AsmrNodeItem): string {
  if (isDirectoryNode(item)) return '文件夹';
  const ext = normalizeExt(item.ext);
  if (ext) return ext.toUpperCase();
  return item.mimeType || '文件';
}

function resolveFileType(item: AsmrNodeItem): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
  return resolvePreviewFileType(item.mimeType, item.ext);
}

function isImageFile(item: AsmrNodeItem): boolean {
  if (isDirectoryNode(item)) return false;
  if (item.mimeType?.startsWith('image/')) return true;
  return isImageExtension(item.ext);
}

function normalizeViewerTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'ASMR 集合';
  if (raw.toUpperCase().startsWith('ASMR ·')) {
    const parts = raw.split('·');
    if (parts.length >= 2) {
      const right = parts.slice(1).join('·').trim();
      if (right) return right;
    }
  }
  return raw;
}

function formatDuration(time: number): string {
  if (!Number.isFinite(time)) return '00:00';
  const minutes = Math.floor(Math.max(time, 0) / 60);
  const seconds = Math.floor(Math.max(time, 0) % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const AsmrViewer: React.FC<AsmrViewerProps> = ({ folderNodeId, fileUrl, fileName, active = true }) => {
  const { setFileUrl } = useFileViewer();
  const routeInfo = useMemo(() => parseAsmrRouteInfo(fileUrl), [fileUrl]);
  const libraryId = routeInfo?.libraryId ?? null;
  const viewerCacheKey = useMemo(
    () => resolveAsmrViewerCacheKey(fileUrl, folderNodeId),
    [fileUrl, folderNodeId],
  );
  const initialSnapshot = useMemo(
    () => (viewerCacheKey ? asmrViewerSnapshotCache.get(viewerCacheKey) ?? null : null),
    [viewerCacheKey],
  );
  const title = useMemo(() => normalizeViewerTitle(fileName), [fileName]);

  const [pathStack, setPathStack] = useState<AsmrPathItem[]>(() => initialSnapshot?.pathStack ?? []);
  const [items, setItems] = useState<AsmrNodeItem[]>(() => initialSnapshot?.items ?? []);
  const [selectedId, setSelectedId] = useState<number | null>(() => initialSnapshot?.selectedId ?? null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(() => initialSnapshot?.coverUrl ?? null);
  const [playerState, setPlayerState] = useState(() => globalAudioPlayer.getState());
  const [audioQueue, setAudioQueue] = useState<AsmrNodeItem[]>(() => initialSnapshot?.audioQueue ?? []);
  const [currentAudioId, setCurrentAudioId] = useState<number | null>(() => initialSnapshot?.currentAudioId ?? null);
  const [currentAudioSrc, setCurrentAudioSrc] = useState<string | null>(() => initialSnapshot?.currentAudioSrc ?? null);
  const [seekingTime, setSeekingTime] = useState<number | null>(null);

  const listRequestIdRef = useRef(0);
  const coverRequestIdRef = useRef(0);
  const audioUrlCacheRef = useRef<Map<number, string>>(new Map(initialSnapshot?.audioUrlEntries ?? []));

  const persistViewerSnapshot = useCallback((patch?: Partial<AsmrViewerSnapshot>) => {
    if (!viewerCacheKey) return;
    const previous = asmrViewerSnapshotCache.get(viewerCacheKey);
    setAsmrViewerSnapshot(viewerCacheKey, {
      hasLoadedList: patch?.hasLoadedList ?? previous?.hasLoadedList ?? (items.length > 0 || pathStack.length > 0),
      pathStack: patch?.pathStack ?? pathStack,
      items: patch?.items ?? items,
      selectedId: patch?.selectedId ?? selectedId,
      coverUrl: patch?.coverUrl ?? coverUrl,
      currentAudioId: patch?.currentAudioId ?? currentAudioId,
      currentAudioSrc: patch?.currentAudioSrc ?? currentAudioSrc,
      audioQueue: patch?.audioQueue ?? audioQueue,
      audioUrlEntries: patch?.audioUrlEntries ?? Array.from(audioUrlCacheRef.current.entries()),
    });
  }, [audioQueue, coverUrl, currentAudioId, currentAudioSrc, items, pathStack, selectedId, viewerCacheKey]);

  const relativePath = useMemo(() => {
    const segments = pathStack.slice(1).map(item => item.name);
    if (segments.length === 0) return 'ROOT/';
    return `ROOT/${segments.join('/')}/`;
  }, [pathStack]);

  const currentAudioQueueIndex = useMemo(
    () => audioQueue.findIndex(item => item.id === currentAudioId),
    [audioQueue, currentAudioId],
  );
  const hasPrevAudio = currentAudioQueueIndex > 0;
  const hasNextAudio = currentAudioQueueIndex >= 0 && currentAudioQueueIndex < audioQueue.length - 1;
  const visibleCurrentTime = seekingTime ?? playerState.currentTime;
  const currentTrackName = useMemo(() => {
    if (currentAudioQueueIndex >= 0) {
      const active = audioQueue[currentAudioQueueIndex];
      return resolveDisplayName(active);
    }
    return playerState.trackName || '未选择音频';
  }, [audioQueue, currentAudioQueueIndex, playerState.trackName]);

  const loadDirectory = useCallback(async (targetNodeId: number, nextPathStack: AsmrPathItem[]) => {
    if (!libraryId) {
      setListError('ASMR 目录参数异常');
      setItems([]);
      return [] as AsmrNodeItem[];
    }

    const requestId = ++listRequestIdRef.current;
    setListLoading(true);
    setListError(null);

    try {
      const children = (await getChildrenByNodeId(targetNodeId, libraryId)) as AsmrNodeItem[];
      if (requestId !== listRequestIdRef.current) {
        return [] as AsmrNodeItem[];
      }
      const sorted = sortNodes(children || []);
      setPathStack(nextPathStack);
      setItems(sorted);
      setSelectedId(null);
      return sorted;
    } catch (error) {
      runtimeLogger.error('加载 ASMR 目录失败:', error);
      if (requestId === listRequestIdRef.current) {
        setPathStack(nextPathStack);
        setItems([]);
        setListError('加载目录失败');
      }
      return [] as AsmrNodeItem[];
    } finally {
      if (requestId === listRequestIdRef.current) {
        setListLoading(false);
      }
    }
  }, [libraryId]);

  const resolveAudioUrl = useCallback(async (item: AsmrNodeItem): Promise<string> => {
    const cached = audioUrlCacheRef.current.get(item.id);
    if (cached) {
      return cached;
    }
    if (!libraryId) {
      throw new Error('ASMR 目录参数异常');
    }
    const url = await getFileLink(item.id, libraryId, 60);
    if (!url) {
      throw new Error('无法获取音频访问地址');
    }
    audioUrlCacheRef.current.set(item.id, url);
    return url;
  }, [libraryId]);

  const playAudioInAsmr = useCallback(async (
    targetAudio: AsmrNodeItem,
    queue: AsmrNodeItem[],
  ) => {
    try {
      const url = await resolveAudioUrl(targetAudio);
      globalAudioPlayer.ensureSource(
        url,
        resolveDisplayName(targetAudio),
        {
          ownerType: 'asmr',
          ownerKey: resolveAsmrOwnerKey(fileUrl, folderNodeId || targetAudio.id),
        },
      );
      await globalAudioPlayer.play();
      setAudioQueue(queue);
      setCurrentAudioId(targetAudio.id);
      setCurrentAudioSrc(url);
      setSelectedId(targetAudio.id);
      setSeekingTime(null);
      persistViewerSnapshot({
        currentAudioId: targetAudio.id,
        currentAudioSrc: url,
        audioQueue: queue,
        selectedId: targetAudio.id,
      });
    } catch (error: any) {
      runtimeLogger.error('ASMR 音频播放失败:', error);
      Toast.error(error?.message || '播放音频失败');
    }
  }, [fileUrl, folderNodeId, persistViewerSnapshot, resolveAudioUrl]);

  const resolveCover = useCallback(async (rootChildren: AsmrNodeItem[]) => {
    if (!libraryId) {
      setCoverUrl(null);
      setCoverLoading(false);
      return;
    }

    const coverCandidate = rootChildren.find(isImageFile);
    if (!coverCandidate) {
      setCoverUrl(null);
      setCoverLoading(false);
      return;
    }

    const requestId = ++coverRequestIdRef.current;
    setCoverLoading(true);
    try {
      const url = await getFileLink(coverCandidate.id, libraryId, 60);
      if (requestId !== coverRequestIdRef.current) return;
      setCoverUrl(url || null);
    } catch (error) {
      runtimeLogger.warn('加载 ASMR 封面失败:', error);
      if (requestId === coverRequestIdRef.current) {
        setCoverUrl(null);
      }
    } finally {
      if (requestId === coverRequestIdRef.current) {
        setCoverLoading(false);
      }
    }
  }, [libraryId]);

  useEffect(() => {
    if (!active) return;
    setPlayerState(globalAudioPlayer.getState());
    return globalAudioPlayer.subscribe(setPlayerState);
  }, [active]);

  useEffect(() => {
    if (!folderNodeId || !Number.isFinite(folderNodeId) || !libraryId) {
      setPathStack([]);
      setItems([]);
      setListError('ASMR 目录参数异常');
      setListLoading(false);
      setCoverUrl(null);
      setCoverLoading(false);
      return;
    }

    const snapshot = viewerCacheKey ? asmrViewerSnapshotCache.get(viewerCacheKey) : null;
    if (snapshot?.hasLoadedList && snapshot.pathStack.length > 0) {
      setPathStack(snapshot.pathStack);
      setItems(snapshot.items || []);
      setSelectedId(snapshot.selectedId ?? null);
      setListError(null);
      setListLoading(false);
      setCoverUrl(snapshot.coverUrl ?? null);
      setCoverLoading(false);
      setCurrentAudioId(snapshot.currentAudioId ?? null);
      setCurrentAudioSrc(snapshot.currentAudioSrc ?? null);
      setAudioQueue(snapshot.audioQueue || []);
      audioUrlCacheRef.current = new Map(snapshot.audioUrlEntries || []);
      return;
    }

    const rootPath: AsmrPathItem[] = [{ id: folderNodeId, name: 'ROOT' }];
    setCoverUrl(null);
    setCoverLoading(true);

    void (async () => {
      const rootChildren = await loadDirectory(folderNodeId, rootPath);
      await resolveCover(rootChildren);
    })();
  }, [folderNodeId, libraryId, loadDirectory, resolveCover, viewerCacheKey]);

  useEffect(() => {
    if (currentAudioId === null) {
      return;
    }
    if (!playerState.src || !currentAudioSrc || playerState.src !== currentAudioSrc) {
      setCurrentAudioId(null);
      setCurrentAudioSrc(null);
      setAudioQueue([]);
      setSeekingTime(null);
    }
  }, [currentAudioId, currentAudioSrc, playerState.src]);

  useEffect(() => {
    const shouldPersist = (
      pathStack.length > 0
      || items.length > 0
      || coverUrl !== null
      || currentAudioId !== null
      || currentAudioSrc !== null
      || audioQueue.length > 0
    );
    if (!shouldPersist) {
      return;
    }
    persistViewerSnapshot({
      hasLoadedList: items.length > 0 || pathStack.length > 0,
      audioUrlEntries: Array.from(audioUrlCacheRef.current.entries()),
    });
  }, [audioQueue, coverUrl, currentAudioId, currentAudioSrc, items, pathStack, persistViewerSnapshot, selectedId]);

  useEffect(() => {
    return () => {
      const shouldPersist = (
        pathStack.length > 0
        || items.length > 0
        || coverUrl !== null
        || currentAudioId !== null
        || currentAudioSrc !== null
        || audioQueue.length > 0
      );
      if (!shouldPersist) {
        return;
      }
      persistViewerSnapshot({
        hasLoadedList: items.length > 0 || pathStack.length > 0,
        audioUrlEntries: Array.from(audioUrlCacheRef.current.entries()),
      });
    };
  }, [audioQueue.length, coverUrl, currentAudioId, currentAudioSrc, items, pathStack, persistViewerSnapshot]);

  const handleOpenNode = useCallback(async (item: AsmrNodeItem) => {
    if (!libraryId) return;
    if (isDirectoryNode(item)) {
      const nextStack = [...pathStack, { id: item.id, name: item.name }];
      await loadDirectory(item.id, nextStack);
      return;
    }

    try {
      const fileType = resolveFileType(item);
      if (fileType === 'audio') {
        const queue = items.filter(candidate => (
          !isDirectoryNode(candidate) && resolveFileType(candidate) === 'audio'
        ));
        await playAudioInAsmr(item, queue);
        return;
      }

      const url = await getFileLink(item.id, libraryId, 60);
      if (!url) {
        Toast.error('无法获取文件访问地址');
        return;
      }
      setFileUrl(url, resolveDisplayName(item), fileType, item.id);
    } catch (error: any) {
      runtimeLogger.error('打开 ASMR 内文件失败:', error);
      Toast.error(error?.message || '打开文件失败');
    }
  }, [items, libraryId, loadDirectory, pathStack, playAudioInAsmr, setFileUrl]);

  const handleJumpToCrumb = useCallback(async (index: number) => {
    if (index < 0 || index >= pathStack.length) return;
    const nextStack = pathStack.slice(0, index + 1);
    const target = nextStack[nextStack.length - 1];
    await loadDirectory(target.id, nextStack);
  }, [loadDirectory, pathStack]);

  const handlePlayPrevAudio = useCallback(async () => {
    if (!hasPrevAudio || currentAudioQueueIndex <= 0) return;
    const prevTrack = audioQueue[currentAudioQueueIndex - 1];
    await playAudioInAsmr(prevTrack, audioQueue);
  }, [audioQueue, currentAudioQueueIndex, hasPrevAudio, playAudioInAsmr]);

  const handlePlayNextAudio = useCallback(async () => {
    if (!hasNextAudio || currentAudioQueueIndex < 0) return;
    const nextTrack = audioQueue[currentAudioQueueIndex + 1];
    await playAudioInAsmr(nextTrack, audioQueue);
  }, [audioQueue, currentAudioQueueIndex, hasNextAudio, playAudioInAsmr]);

  return (
    <AsmrViewerWrapper>
      <section className="top-section">
        <div className="cover-panel">
          {coverLoading ? (
            <div className="cover-placeholder">
              <Spin size="middle" />
              <span>封面加载中</span>
            </div>
          ) : coverUrl ? (
            <img src={coverUrl} alt={title} className="cover-image" draggable={false} />
          ) : (
            <div className="cover-placeholder">
              <span>暂无封面</span>
              <span>将自动使用目录中的首张图片</span>
            </div>
          )}
        </div>

        <div className="meta-panel">
          <div className="title-row">
            <span className="badge">ASMR</span>
            <h2 className="title" title={title}>{title}</h2>
          </div>
          <p className="subtitle">集合内可混合文件与目录，支持目录内逐层浏览。</p>
          <div className="reserved-grid">
            <div className="reserved-slot">预留扩展区域 A</div>
            <div className="reserved-slot">预留扩展区域 B</div>
            <div className="reserved-slot">预留扩展区域 C</div>
            <div className="reserved-slot">预留扩展区域 D</div>
          </div>
        </div>
      </section>

      <section className="bottom-section">
        <div className="path-strip">
          <div className="path-breadcrumb" title={relativePath}>
            {pathStack.map((item, index) => {
              const isCurrent = index === pathStack.length - 1;
              return (
                <React.Fragment key={`${item.id}-${index}`}>
                  <button
                    type="button"
                    className="crumb-btn"
                    onClick={() => {
                      if (!isCurrent && !listLoading) {
                        void handleJumpToCrumb(index);
                      }
                    }}
                    disabled={isCurrent || listLoading}
                  >
                    {item.name}
                  </button>
                  {!isCurrent ? <span className="crumb-sep">/</span> : null}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="list-shell">
          {listLoading ? (
            <div className="state-loading">
              <Spin size="large" tip="目录加载中..." />
            </div>
          ) : listError ? (
            <div className="state-error">{listError}</div>
          ) : items.length === 0 ? (
            <div className="state-empty">当前目录为空</div>
          ) : (
            <div className="rows">
              {items.map((item) => {
                const isDir = isDirectoryNode(item);
                const displayName = resolveDisplayName(item);
                const isPlayingRow = !isDir && item.id === currentAudioId;
                return (
                  <div
                    key={item.id}
                    className={`row ${selectedId === item.id ? 'selected' : ''} ${isPlayingRow ? 'playing' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => {
                      void handleOpenNode(item);
                    }}
                    title={displayName}
                  >
                    <div className="row-main">
                      <span className="row-icon">
                        {isDir ? <IconFolder size="extra-large" /> : getFileNodeIcon(item.ext)}
                      </span>
                      <span className="row-name">{displayName}</span>
                      {isPlayingRow ? (
                        <span className={`row-playing-badge ${playerState.isPlaying ? 'active' : 'paused'}`}>
                          {playerState.isPlaying ? '播放中' : '已暂停'}
                        </span>
                      ) : null}
                    </div>
                    <span className="row-type">{resolveRowType(item)}</span>
                    <span className="row-size">{isDir ? '-' : formatFileSize(item.fileSize)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {currentAudioId !== null ? (
          <div className="asmr-player-bar">
            <input
              className="player-progress-line"
              type="range"
              min={0}
              max={Math.max(playerState.duration, 0)}
              step={0.1}
              value={Math.min(visibleCurrentTime, Math.max(playerState.duration, 0))}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeekingTime(next);
                globalAudioPlayer.seekTo(next);
              }}
              onMouseUp={() => {
                setSeekingTime(null);
              }}
              onKeyUp={() => {
                setSeekingTime(null);
              }}
            />

            <div className="player-track">
              <span className="player-track-icon"><IconMusic /></span>
              <span className="player-track-name" title={currentTrackName}>{currentTrackName}</span>
            </div>

            <div className="player-controls">
              <Button
                theme="borderless"
                size="default"
                icon={<IconBackward />}
                disabled={!hasPrevAudio}
                onClick={() => {
                  void handlePlayPrevAudio();
                }}
              />
              <Button
                theme="solid"
                size="large"
                className="player-main-toggle"
                icon={playerState.isPlaying ? <IconPause /> : <IconPlay />}
                onClick={() => {
                  void globalAudioPlayer.togglePlay().catch((error) => {
                    runtimeLogger.error('ASMR 音频切换播放失败:', error);
                  });
                }}
              />
              <Button
                theme="borderless"
                size="default"
                icon={<IconForward />}
                disabled={!hasNextAudio}
                onClick={() => {
                  void handlePlayNextAudio();
                }}
              />
            </div>

            <div className="player-right">
              <div className="player-time-inline">
                <span className="player-time">{formatDuration(visibleCurrentTime)}</span>
                <span className="player-time-sep">/</span>
                <span className="player-time">{formatDuration(playerState.duration)}</span>
              </div>

              <div className="player-volume">
                <Button
                  theme="borderless"
                  size="default"
                  icon={playerState.isMuted ? <IconMute /> : <IconVolume2 />}
                  onClick={() => {
                    globalAudioPlayer.setMuted(!playerState.isMuted);
                  }}
                />
                <input
                  className="player-volume-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={playerState.isMuted ? 0 : playerState.volume}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    globalAudioPlayer.setVolume(next);
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </AsmrViewerWrapper>
  );
};

export default AsmrViewer;
