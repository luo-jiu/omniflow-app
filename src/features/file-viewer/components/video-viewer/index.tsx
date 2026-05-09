import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Spin, Toast } from '@douyinfe/semi-ui';
import {
  IconBackward,
  IconForward,
  IconFullScreenStroked,
  IconMiniPlayer,
  IconMute,
  IconPause,
  IconPlay,
  IconShrinkScreenStroked,
  IconVideoListStroked,
  IconVolume1,
  IconVolume2,
} from '@douyinfe/semi-icons';
import { VideoViewerWrapper } from './style';
import { useLibraryWorkspaceControls } from '@/contexts/library-workspace-controls.context';
import {
  fetchArchiveCardsPage,
  fetchNodeDetailById,
  getChildrenByNodeId,
  getFileLink,
  updateNodeConfig,
  type ArchiveCardDTO,
} from '@/features/file-explorer/services/file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  isTextEditingKeyboardTarget,
  isViewerInteractiveKeyboardTarget,
  releaseExternalKeyboardFocus,
} from '@/features/file-viewer/utils/media-keyboard-target';
import type {
  FileViewerReturnTarget,
  FileViewerSubtitleSource,
  FileViewerVideoPlaylist,
  FileViewerVideoPlaylistItem,
} from '@/contexts/file-viewer.context';
import VideoSubtitlePanel from './VideoSubtitlePanel';
import { useTimedText } from '@/features/file-viewer/timed-text/useTimedText';
import { useFileViewer } from '@/hooks/useFileViewer';
import {
  buildVideoSubtitleSources,
  type VideoSubtitleSourceNode,
} from '@/features/file-viewer/utils/video-subtitle-sources';
import {
  getGlobalVideoElement,
  mountGlobalVideoElement,
  parkGlobalVideoElement,
} from '@/features/file-viewer/services/global-video-elements';
import { floatingVideoService } from '@/features/file-viewer/services/floating-video.service';
import { isLibraryWorkspaceRoute } from '@/features/file-viewer/utils/media-route';
import { useParams } from 'react-router-dom';

interface VideoViewerProps {
  nodeId?: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
  tabId: string;
  returnTarget?: FileViewerReturnTarget | null;
  subtitleSources?: FileViewerSubtitleSource[];
  playlist?: FileViewerVideoPlaylist | null;
  autoPlay?: boolean;
}

interface VideoPlaybackProgress {
  currentTime: number;
  duration: number;
  updatedAt: string;
}

const SEEK_SECONDS = 5;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const PLACEHOLDER_TOOL_OPTIONS = ['同名字幕自动发现', '双语字幕', '片段标注', 'AI 字幕'];
const VIDEO_PROGRESS_CACHE_MAX_ENTRIES = 48;
const VIDEO_PROGRESS_REMOTE_SYNC_INTERVAL_MS = 8000;
const RESTORE_MIN_SECONDS = 2;
const RESTORE_END_GUARD_SECONDS = 5;
const RESTORE_END_GUARD_RATIO = 0.98;
const VIDEO_THUMBNAIL_MAX_WIDTH = 96;
const VIDEO_THUMBNAIL_MAX_HEIGHT = 72;
const VIDEO_THUMBNAIL_CAPTURE_DELAY_MS = 160;
const VIDEO_THUMBNAIL_CAPTURE_MAX_ATTEMPTS = 5;
const VIDEO_THUMBNAIL_MIN_LUMA = 8;
const VIEW_META_VIEWER_STATE_KEY = '__omniflowViewerStateV1';
const VIEW_META_VIEWER_STATE_LEGACY_KEY = '__omniflow_viewer_state_v1';
const VIEW_META_VIDEO_PLAYER_KEY = 'videoPlayer';
const VIEW_META_VIDEO_PLAYER_LEGACY_KEY = 'video_player';
const KEYBOARD_SEEK_SECONDS = 10;
const KEYBOARD_FAST_SEEK_SECONDS = 30;
const KEYBOARD_VOLUME_STEP = 0.05;
const PLAYLIST_LINK_EXPIRY_MINUTES = 120;
const PLAYLIST_PAGE_SIZE = 80;

const RightToolPanelIcon: React.FC = () => (
  <svg className="video-control-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden focusable="false">
    <path
      d="M4.5 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M14.5 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M14.5 6h4.5a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4.5V6Z" fill="currentColor" opacity="0.28" />
  </svg>
);

const WideModeEnterIcon: React.FC = () => (
  <svg className="video-control-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden focusable="false">
    <path
      d="M3 6h18v12H3V6Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M10 12H5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    <path d="M7.5 9.25 4.75 12l2.75 2.75" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 12h5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    <path d="M16.5 9.25 19.25 12l-2.75 2.75" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WideModeExitIcon: React.FC = () => (
  <svg className="video-control-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden focusable="false">
    <path
      d="M3 6h18v12H3V6Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M4.75 12h5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    <path d="M7.5 9.25 10.25 12 7.5 14.75" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19.25 12h-5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    <path d="M16.5 9.25 13.75 12l2.75 2.75" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const videoProgressCache = new Map<string, VideoPlaybackProgress>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseViewMetaObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveVideoProgressCacheKey(url: string, nodeId?: number | null): string {
  if (nodeId !== null && nodeId !== undefined && Number.isFinite(nodeId)) {
    return `node:${nodeId}`;
  }
  return `url:${String(url || '').trim()}`;
}

function setVideoProgressSnapshot(cacheKey: string, progress: VideoPlaybackProgress) {
  if (videoProgressCache.has(cacheKey)) {
    videoProgressCache.delete(cacheKey);
  }
  videoProgressCache.set(cacheKey, progress);
  if (videoProgressCache.size > VIDEO_PROGRESS_CACHE_MAX_ENTRIES) {
    const oldestKey = videoProgressCache.keys().next().value;
    if (oldestKey) {
      videoProgressCache.delete(oldestKey);
    }
  }
}

function mapArchiveCardToPlaylistItem(item: ArchiveCardDTO, libraryId: number): FileViewerVideoPlaylistItem | null {
  if (String(item.cardKind || '').trim().toLowerCase() === 'collection') {
    return null;
  }
  const cardId = Number(item.id);
  const mediaNodeId = Number.isFinite(Number(item.mediaNodeId)) && Number(item.mediaNodeId) > 0
    ? Number(item.mediaNodeId)
    : cardId;
  if (!Number.isFinite(mediaNodeId) || mediaNodeId <= 0 || !Number.isFinite(libraryId) || libraryId <= 0) {
    return null;
  }
  const subtitleCount = Number(item.subtitleCount ?? 0);
  const cardOwnsMediaFolder = mediaNodeId !== cardId;
  return {
    nodeId: mediaNodeId,
    libraryId,
    title: String(item.name || ''),
    sortOrder: Number(item.sortOrder ?? 0),
    durationSeconds: Number(item.durationSeconds ?? 0) > 0 ? Number(item.durationSeconds) : null,
    subtitleCardNodeId: cardOwnsMediaFolder && subtitleCount > 0 ? cardId : null,
  };
}

function parseVideoRemoteProgress(viewMetaRaw: string | null | undefined): VideoPlaybackProgress | null {
  const meta = parseViewMetaObject(viewMetaRaw);
  const viewerState = meta[VIEW_META_VIEWER_STATE_KEY] ?? meta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  if (!isPlainObject(viewerState)) return null;

  const videoState = viewerState[VIEW_META_VIDEO_PLAYER_KEY] ?? viewerState[VIEW_META_VIDEO_PLAYER_LEGACY_KEY];
  if (!isPlainObject(videoState)) return null;

  const currentTime = parseFiniteNumber(videoState.currentTime);
  const duration = parseFiniteNumber(videoState.duration);
  if (currentTime === null || duration === null || currentTime < 0 || duration <= 0) {
    return null;
  }

  return {
    currentTime,
    duration,
    updatedAt: String(videoState.updatedAt || ''),
  };
}

function buildNextViewMetaWithVideoProgress(
  baseMeta: Record<string, unknown>,
  progress: VideoPlaybackProgress,
): Record<string, unknown> {
  const nextMeta: Record<string, unknown> = { ...baseMeta };
  const viewerStateCandidate = nextMeta[VIEW_META_VIEWER_STATE_KEY] ?? nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  const currentViewerState = isPlainObject(viewerStateCandidate)
    ? { ...(viewerStateCandidate as Record<string, unknown>) }
    : {};
  delete currentViewerState[VIEW_META_VIDEO_PLAYER_LEGACY_KEY];
  delete nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  nextMeta[VIEW_META_VIEWER_STATE_KEY] = {
    ...currentViewerState,
    [VIEW_META_VIDEO_PLAYER_KEY]: {
      currentTime: progress.currentTime,
      duration: progress.duration,
      updatedAt: progress.updatedAt,
    },
  };
  return nextMeta;
}

function resolveRestorableTime(progress: VideoPlaybackProgress | null | undefined): number | null {
  if (!progress) return null;
  const currentTime = parseFiniteNumber(progress.currentTime);
  const duration = parseFiniteNumber(progress.duration);
  if (currentTime === null || duration === null || duration <= 0) return null;
  if (currentTime < RESTORE_MIN_SECONDS) return null;
  if (currentTime >= duration - RESTORE_END_GUARD_SECONDS) return null;
  if (currentTime / duration >= RESTORE_END_GUARD_RATIO) return null;
  return Math.min(Math.max(currentTime, 0), duration);
}

function isProgressNewer(
  candidate: VideoPlaybackProgress,
  current: VideoPlaybackProgress | null | undefined,
): boolean {
  if (!current) return true;
  const candidateTime = Date.parse(candidate.updatedAt || '');
  const currentTime = Date.parse(current.updatedAt || '');
  if (!Number.isFinite(candidateTime)) return false;
  if (!Number.isFinite(currentTime)) return true;
  return candidateTime > currentTime;
}

const VideoViewer: React.FC<VideoViewerProps> = ({
  nodeId,
  url,
  fileName,
  active = true,
  tabId,
  returnTarget,
  subtitleSources,
  playlist,
  autoPlay = false,
}) => {
  const { setFileUrl } = useFileViewer();
  const { id: libraryIdParam } = useParams<{ id: string }>();
  const libraryId = useMemo(() => {
    const parsed = Number(libraryIdParam);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [libraryIdParam]);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoHostRef = useRef<HTMLDivElement>(null);
  const viewerRootRef = useRef<HTMLDivElement>(null);
  const videoElementKey = useMemo(() => `video:${tabId}`, [tabId]);
  const videoRef = useRef<HTMLVideoElement>(getGlobalVideoElement(videoElementKey));
  const videoMountTokenRef = useRef<number | null>(null);
  const floatingVideoState = useSyncExternalStore(
    floatingVideoService.subscribe,
    floatingVideoService.getState,
    floatingVideoService.getState,
  );
  const progressRef = useRef<HTMLDivElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const rateControlRef = useRef<HTMLDivElement>(null);
  const playlistControlRef = useRef<HTMLDivElement>(null);
  const remoteProgressRequestIdRef = useRef(0);
  const remoteProgressSyncTimerRef = useRef<number>(0);
  const remoteProgressSyncInFlightRef = useRef(false);
  const viewMetaBaseReadyRef = useRef(false);
  const viewMetaBaseRef = useRef<Record<string, unknown>>({});
  const pendingRemoteProgressRef = useRef<VideoPlaybackProgress | null>(null);
  const pendingRestoreTimeRef = useRef<number | null>(null);
  const lastSyncedRemoteProgressSignatureRef = useRef('');
  const isMountedRef = useRef(true);
  const activeRef = useRef(active);
  const persistVideoProgressRef = useRef<(forceRemoteSync?: boolean) => void>(() => {});
  const isDraggingProgress = useRef(false);
  const thumbnailCaptureTimerRef = useRef<number>(0);
  const thumbnailCaptureAttemptRef = useRef(0);
  const thumbnailCaptureUrlRef = useRef('');
  const consoleOpenRef = useRef(false);
  const consoleOpenBeforeWideModeRef = useRef<boolean | null>(null);
  const wideModeAppliedRef = useRef(false);
  const { setVideoWideMode } = useLibraryWorkspaceControls();

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
  const [volume, setVolume] = useState(0.75);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isWideMode, setIsWideMode] = useState(false);
  const [isVolumePanelOpen, setIsVolumePanelOpen] = useState(false);
  const [isRatePanelOpen, setIsRatePanelOpen] = useState(false);
  const [isPlaylistPanelOpen, setIsPlaylistPanelOpen] = useState(false);
  const [isLoadingPlaylistMore, setIsLoadingPlaylistMore] = useState(false);

  const isVideoHostedOutsideInline = floatingVideoState.key === videoElementKey
    && floatingVideoState.hostMode !== 'inline';

  const progressCacheKey = useMemo(() => resolveVideoProgressCacheKey(url, nodeId), [nodeId, url]);
  const playlistItems = useMemo(() => playlist?.items ?? [], [playlist]);
  const hasPlaylist = playlistItems.length > 0;
  const playlistCountText = useMemo(() => {
    const total = Number(playlist?.total);
    if (Number.isFinite(total) && total > playlistItems.length) {
      return `${playlistItems.length}/${total} 集`;
    }
    return `${playlistItems.length} 集`;
  }, [playlist?.total, playlistItems.length]);
  const canLoadPlaylistMore = Boolean(
    playlist?.source?.kind === 'video_archive_collection'
    && playlist.hasMore
    && playlist.source.nodeId > 0
    && playlist.source.libraryId > 0,
  );
  const {
    activeSubtitleCue,
    clearSubtitle,
    handleSubtitleFileChange,
    librarySubtitleSources,
    loadLibrarySubtitle,
    loadedSubtitleSourceId,
    openSubtitlePicker,
    setSubtitleBottomOffset,
    setSubtitleEnabled,
    setSubtitleFontSize,
    subtitleBottomOffset,
    subtitleCues,
    subtitleEnabled,
    subtitleError,
    subtitleFileName,
    subtitleFontSize,
    subtitleInputRef,
  } = useTimedText({
    currentTime,
    subtitleSources,
    url,
  });

  const captureVideoThumbnail = useCallback((): boolean => {
    const video = videoRef.current;
    if (!video || thumbnailUrl || video.videoWidth <= 0 || video.videoHeight <= 0) return false;

    const ratio = Math.min(
      VIDEO_THUMBNAIL_MAX_WIDTH / video.videoWidth,
      VIDEO_THUMBNAIL_MAX_HEIGHT / video.videoHeight,
      1,
    );
    const width = Math.max(1, Math.round(video.videoWidth * ratio));
    const height = Math.max(1, Math.round(video.videoHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    try {
      ctx.drawImage(video, 0, 0, width, height);
      const sample = ctx.getImageData(0, 0, width, height).data;
      let lumaTotal = 0;
      const pixelCount = Math.max(width * height, 1);
      for (let index = 0; index < sample.length; index += 4) {
        lumaTotal += (sample[index] * 0.2126) + (sample[index + 1] * 0.7152) + (sample[index + 2] * 0.0722);
      }
      if (lumaTotal / pixelCount < VIDEO_THUMBNAIL_MIN_LUMA) {
        return false;
      }
      setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.72));
      return true;
    } catch (error) {
      runtimeLogger.debug('视频缩略图生成失败，媒体中心将回退默认图标:', error);
      return false;
    }
  }, [thumbnailUrl]);

  const scheduleVideoThumbnailCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || thumbnailUrl) return;
    if (thumbnailCaptureTimerRef.current) {
      window.clearTimeout(thumbnailCaptureTimerRef.current);
    }
    thumbnailCaptureTimerRef.current = window.setTimeout(() => {
      thumbnailCaptureTimerRef.current = 0;
      const currentVideo = videoRef.current;
      if (!currentVideo || thumbnailUrl) return;
      if (currentVideo.currentSrc && thumbnailCaptureUrlRef.current !== currentVideo.currentSrc) {
        thumbnailCaptureAttemptRef.current = 0;
        thumbnailCaptureUrlRef.current = currentVideo.currentSrc;
      }

      const captured = captureVideoThumbnail();
      if (captured || thumbnailCaptureAttemptRef.current >= VIDEO_THUMBNAIL_CAPTURE_MAX_ATTEMPTS) {
        return;
      }
      thumbnailCaptureAttemptRef.current += 1;
      if (!currentVideo.paused || currentVideo.currentTime >= 0.05) {
        scheduleVideoThumbnailCapture();
      }
    }, VIDEO_THUMBNAIL_CAPTURE_DELAY_MS);
  }, [captureVideoThumbnail, thumbnailUrl]);

  // MediaHub 注册由 floatingVideoService 服务层完成；详见 docs/media-hub-contract.md。
  // 关闭视频 tab 时由 FileViewerContext.releaseForTab 释放，不依赖组件卸载。

  const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return '00:00';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    consoleOpenRef.current = isConsoleOpen;
  }, [isConsoleOpen]);

  const flushRemoteVideoProgress = useCallback(async (force = false) => {
    if (!nodeId || !Number.isFinite(nodeId)) {
      pendingRemoteProgressRef.current = null;
      return;
    }
    if (!activeRef.current && !force) {
      return;
    }
    if (!viewMetaBaseReadyRef.current || remoteProgressSyncInFlightRef.current) {
      return;
    }

    const pending = pendingRemoteProgressRef.current;
    if (!pending) return;

    const signature = [
      pending.currentTime.toFixed(1),
      pending.duration.toFixed(1),
    ].join('|');
    if (signature === lastSyncedRemoteProgressSignatureRef.current) {
      pendingRemoteProgressRef.current = null;
      return;
    }

    remoteProgressSyncInFlightRef.current = true;
    try {
      const nextMeta = buildNextViewMetaWithVideoProgress(viewMetaBaseRef.current, pending);
      await updateNodeConfig({
        id: nodeId,
        viewMeta: JSON.stringify(nextMeta),
      });
      viewMetaBaseRef.current = nextMeta;
      lastSyncedRemoteProgressSignatureRef.current = signature;
      pendingRemoteProgressRef.current = null;
    } catch (error) {
      runtimeLogger.warn('同步视频观看进度失败:', error);
    } finally {
      remoteProgressSyncInFlightRef.current = false;
      if (pendingRemoteProgressRef.current && (activeRef.current || force)) {
        if (remoteProgressSyncTimerRef.current) {
          window.clearTimeout(remoteProgressSyncTimerRef.current);
        }
        remoteProgressSyncTimerRef.current = window.setTimeout(() => {
          remoteProgressSyncTimerRef.current = 0;
          void flushRemoteVideoProgress(force);
        }, VIDEO_PROGRESS_REMOTE_SYNC_INTERVAL_MS);
      }
    }
  }, [nodeId]);

  const queueRemoteVideoProgressSync = useCallback((progress: VideoPlaybackProgress, force = false) => {
    pendingRemoteProgressRef.current = progress;
    if (force) {
      if (remoteProgressSyncTimerRef.current) {
        window.clearTimeout(remoteProgressSyncTimerRef.current);
        remoteProgressSyncTimerRef.current = 0;
      }
      void flushRemoteVideoProgress(true);
      return;
    }
    if (!activeRef.current || remoteProgressSyncTimerRef.current || remoteProgressSyncInFlightRef.current) {
      return;
    }
    remoteProgressSyncTimerRef.current = window.setTimeout(() => {
      remoteProgressSyncTimerRef.current = 0;
      void flushRemoteVideoProgress();
    }, VIDEO_PROGRESS_REMOTE_SYNC_INTERVAL_MS);
  }, [flushRemoteVideoProgress]);

  const persistVideoProgress = useCallback((forceRemoteSync = false) => {
    const video = videoRef.current;
    if (!video) return;
    const durationValue = Number.isFinite(video.duration) ? video.duration : 0;
    if (durationValue <= 0) return;

    const currentValue = video.ended ? 0 : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
    const progress: VideoPlaybackProgress = {
      currentTime: Math.min(Math.max(currentValue, 0), durationValue),
      duration: durationValue,
      updatedAt: new Date().toISOString(),
    };
    setVideoProgressSnapshot(progressCacheKey, progress);
    queueRemoteVideoProgressSync(progress, forceRemoteSync);
  }, [progressCacheKey, queueRemoteVideoProgressSync]);

  useEffect(() => {
    persistVideoProgressRef.current = persistVideoProgress;
  }, [persistVideoProgress]);

  useEffect(() => {
    const host = videoHostRef.current;
    if (!host) return undefined;
    const mounted = mountGlobalVideoElement(videoElementKey, host);
    videoMountTokenRef.current = mounted.mountToken;
    videoRef.current = mounted.element;
    floatingVideoService.bindInline({
      key: videoElementKey,
      libraryId,
      tabId,
      nodeId: nodeId ?? null,
      fileName: fileName ?? '',
      thumbnailUrl,
      forceInline: true,
    });

    return () => {
      const elBefore = videoRef.current;
      const inLibrary = isLibraryWorkspaceRoute(window.location.hash);
      console.log('[video-viewer] cleanup.start', {
        key: videoElementKey,
        hash: window.location.hash,
        isLibrary: inLibrary,
        paused: elBefore?.paused,
        ct: elBefore?.currentTime,
        connected: elBefore?.isConnected,
      });
      persistVideoProgressRef.current(true);
      const mountToken = videoMountTokenRef.current ?? mounted.mountToken;
      if (inLibrary) {
        const floatingState = floatingVideoService.getState();
        const isHostedOutsideInline = floatingState.key === videoElementKey
          && floatingState.hostMode !== 'inline';
        if (isHostedOutsideInline) {
          console.log('[video-viewer] cleanup.keep-external-host', {
            key: videoElementKey,
            hostMode: floatingState.hostMode,
            paused: elBefore?.paused,
            connected: elBefore?.isConnected,
          });
          return;
        }
        parkGlobalVideoElement(videoElementKey, mountToken);
        console.log('[video-viewer] cleanup.parked', { key: videoElementKey, paused: elBefore?.paused, connected: elBefore?.isConnected });
        return;
      }
      floatingVideoService.handoffToFloating(videoElementKey, mountToken);
      console.log('[video-viewer] cleanup.handed-off', { key: videoElementKey, paused: elBefore?.paused, connected: elBefore?.isConnected });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoElementKey]);

  // metadata 后续变化（如异步加载到的封面、文件名修正、libraryId 切换）也要同步给浮窗 service。
  useEffect(() => {
    floatingVideoService.bindInline({
      key: videoElementKey,
      libraryId,
      tabId,
      nodeId: nodeId ?? null,
      fileName: fileName ?? '',
      thumbnailUrl,
    });
  }, [videoElementKey, libraryId, tabId, nodeId, fileName, thumbnailUrl]);

  const applyPendingRestoreTime = useCallback(() => {
    const video = videoRef.current;
    const pendingTime = pendingRestoreTimeRef.current;
    if (!video || pendingTime === null) return;

    const durationValue = Number.isFinite(video.duration) ? video.duration : 0;
    const nextTime = resolveRestorableTime({
      currentTime: pendingTime,
      duration: durationValue,
      updatedAt: '',
    });
    pendingRestoreTimeRef.current = null;
    if (nextTime === null) return;

    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const seekToByClientX = useCallback((clientX: number) => {
    const video = videoRef.current;
    const progress = progressRef.current;
    if (!video || !progress || !duration) return;

    const rect = progress.getBoundingClientRect();
    const offsetX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const next = (offsetX / rect.width) * duration;
    video.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
    if (!isDraggingProgress.current) return;
    seekToByClientX(event.clientX);
  }, [seekToByClientX]);

  const handleGlobalMouseUp = useCallback((event: MouseEvent) => {
    if (!isDraggingProgress.current) return;
    seekToByClientX(event.clientX);
    isDraggingProgress.current = false;
    persistVideoProgress(true);
    window.removeEventListener('mousemove', handleGlobalMouseMove);
    window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseMove, persistVideoProgress, seekToByClientX]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      if (thumbnailCaptureTimerRef.current) {
        window.clearTimeout(thumbnailCaptureTimerRef.current);
        thumbnailCaptureTimerRef.current = 0;
      }
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      setDuration(video.duration || 0);
      applyPendingRestoreTime();
      setCurrentTime(video.currentTime || 0);
      setIsBuffering(false);
      scheduleVideoThumbnailCapture();
    };
    const onTimeUpdate = () => {
      if (!isDraggingProgress.current) {
        setCurrentTime(video.currentTime || 0);
      }
      persistVideoProgress(false);
    };
    const onPlay = () => {
      setIsPlaying(true);
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      persistVideoProgress(true);
    };
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => {
      setIsBuffering(false);
      scheduleVideoThumbnailCapture();
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onCanPlay);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onCanPlay);
    };
  }, [applyPendingRestoreTime, persistVideoProgress, scheduleVideoThumbnailCapture]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const isSameSource = video.getAttribute('src') === url;
    remoteProgressRequestIdRef.current += 1;
    viewMetaBaseReadyRef.current = false;
    viewMetaBaseRef.current = {};
    pendingRemoteProgressRef.current = null;
    lastSyncedRemoteProgressSignatureRef.current = '';

    if (isSameSource) {
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setIsPlaying(!video.paused && !video.ended);
      setIsBuffering(!video.paused && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA);
      scheduleVideoThumbnailCapture();
      return;
    }

    pendingRestoreTimeRef.current = resolveRestorableTime(videoProgressCache.get(progressCacheKey));
    if (thumbnailCaptureTimerRef.current) {
      window.clearTimeout(thumbnailCaptureTimerRef.current);
      thumbnailCaptureTimerRef.current = 0;
    }
    thumbnailCaptureAttemptRef.current = 0;
    thumbnailCaptureUrlRef.current = '';
    video.src = url;
    video.load();
    setThumbnailUrl(undefined);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsBuffering(true);
  }, [progressCacheKey, scheduleVideoThumbnailCapture, url]);

  useEffect(() => {
    if (!autoPlay) return;
    const video = videoRef.current;
    if (!video) return;

    const play = () => {
      video.play().catch((error) => {
        runtimeLogger.warn('自动播放合集视频失败:', error);
      });
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const timer = window.setTimeout(play, 0);
      return () => window.clearTimeout(timer);
    }

    video.addEventListener('canplay', play, { once: true });
    return () => video.removeEventListener('canplay', play);
  }, [autoPlay, url]);

  useEffect(() => {
    remoteProgressRequestIdRef.current += 1;
    const requestId = remoteProgressRequestIdRef.current;

    if (!nodeId || !Number.isFinite(nodeId)) {
      viewMetaBaseReadyRef.current = true;
      viewMetaBaseRef.current = {};
      return;
    }

    fetchNodeDetailById(nodeId)
      .then((detail) => {
        if (!isMountedRef.current || requestId !== remoteProgressRequestIdRef.current) return;
        const baseMeta = parseViewMetaObject(detail.viewMeta);
        viewMetaBaseRef.current = baseMeta;
        viewMetaBaseReadyRef.current = true;

        const remoteProgress = parseVideoRemoteProgress(detail.viewMeta);
        if (remoteProgress) {
          const cachedProgress = videoProgressCache.get(progressCacheKey);
          const shouldUseRemoteProgress = isProgressNewer(remoteProgress, cachedProgress);
          if (shouldUseRemoteProgress) {
            setVideoProgressSnapshot(progressCacheKey, remoteProgress);
            const pendingTime = resolveRestorableTime(remoteProgress);
            if (pendingTime !== null) {
              pendingRestoreTimeRef.current = pendingTime;
              applyPendingRestoreTime();
            }
          }
          lastSyncedRemoteProgressSignatureRef.current = [
            remoteProgress.currentTime.toFixed(1),
            remoteProgress.duration.toFixed(1),
          ].join('|');
        }

        if (pendingRemoteProgressRef.current) {
          void flushRemoteVideoProgress();
        }
      })
      .catch((error) => {
        if (!isMountedRef.current || requestId !== remoteProgressRequestIdRef.current) return;
        runtimeLogger.warn('加载视频观看进度失败:', error);
      });
  }, [applyPendingRestoreTime, flushRemoteVideoProgress, nodeId, progressCacheKey]);

  useEffect(() => {
    if (active) return;
    persistVideoProgress(true);
  }, [active, persistVideoProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
  }, [volume, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
  }, [isMuted, url]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (volumeControlRef.current && !volumeControlRef.current.contains(target)) {
        setIsVolumePanelOpen(false);
      }
      if (rateControlRef.current && !rateControlRef.current.contains(target)) {
        setIsRatePanelOpen(false);
      }
      if (playlistControlRef.current && !playlistControlRef.current.contains(target)) {
        setIsPlaylistPanelOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    return () => {
      persistVideoProgress(true);
      if (remoteProgressSyncTimerRef.current) {
        window.clearTimeout(remoteProgressSyncTimerRef.current);
        remoteProgressSyncTimerRef.current = 0;
      }
    };
  }, [persistVideoProgress]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((error) => {
        runtimeLogger.error('failed to start video playback:', error);
      });
    } else {
      video.pause();
    }
  }, []);

  const restoreVideoInline = useCallback(() => {
    const host = videoHostRef.current;
    if (!host) return;
    const mounted = mountGlobalVideoElement(videoElementKey, host);
    videoMountTokenRef.current = mounted.mountToken;
    videoRef.current = mounted.element;
    floatingVideoService.bindInline({
      key: videoElementKey,
      libraryId,
      tabId,
      nodeId: nodeId ?? null,
      fileName: fileName ?? '',
      thumbnailUrl,
      forceInline: true,
    });
  }, [fileName, libraryId, nodeId, tabId, thumbnailUrl, videoElementKey]);

  const requestFloatingVideo = useCallback(() => {
    if (isVideoHostedOutsideInline) {
      restoreVideoInline();
      return;
    }
    void floatingVideoService.requestSystemFloating();
  }, [isVideoHostedOutsideInline, restoreVideoInline]);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(Math.max((video.currentTime || 0) + delta, 0), duration || 0);
    video.currentTime = next;
    setCurrentTime(next);
    persistVideoProgress(true);
  }, [duration, persistVideoProgress]);

  const adjustVolumeBy = useCallback((delta: number) => {
    setVolume((current) => {
      const next = Math.min(Math.max(current + delta, 0), 1);
      setIsMuted(next === 0);
      return next;
    });
  }, []);

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setVolume(next);
    setIsMuted(next === 0);
  };

  const toggleVolumePanel = useCallback(() => {
    setIsVolumePanelOpen(prev => !prev);
    setIsRatePanelOpen(false);
  }, []);

  const toggleRatePanel = useCallback(() => {
    setIsRatePanelOpen(prev => !prev);
    setIsVolumePanelOpen(false);
    setIsPlaylistPanelOpen(false);
  }, []);

  const togglePlaylistPanel = useCallback(() => {
    setIsPlaylistPanelOpen(prev => !prev);
    setIsVolumePanelOpen(false);
    setIsRatePanelOpen(false);
  }, []);

  const resolvePlaylistItemSubtitleSources = useCallback(async (
    item: FileViewerVideoPlaylistItem,
  ): Promise<FileViewerSubtitleSource[] | undefined> => {
    if (item.subtitleSources && item.subtitleSources.length > 0) {
      return item.subtitleSources;
    }
    if (!item.subtitleCardNodeId) {
      return undefined;
    }

    try {
      const children = (await getChildrenByNodeId(item.subtitleCardNodeId, item.libraryId)) as VideoSubtitleSourceNode[];
      const sources = buildVideoSubtitleSources(children, item.libraryId);
      return sources.length > 0 ? sources : undefined;
    } catch (error) {
      runtimeLogger.warn('加载合集视频字幕失败:', error);
      return undefined;
    }
  }, []);

  const openPlaylistItem = useCallback(async (item: FileViewerVideoPlaylistItem) => {
    if (!playlist) return;
    if (item.nodeId === nodeId) {
      setIsPlaylistPanelOpen(false);
      return;
    }
    try {
      persistVideoProgress(true);
      const [nextUrl, nextSubtitleSources] = await Promise.all([
        getFileLink(item.nodeId, item.libraryId, PLAYLIST_LINK_EXPIRY_MINUTES),
        resolvePlaylistItemSubtitleSources(item),
      ]);
      if (!nextUrl) {
        throw new Error('未获取到视频访问链接');
      }
      const nextPlaylist = nextSubtitleSources
        ? {
          ...playlist,
          items: playlist.items.map(playlistItem => (
            playlistItem.nodeId === item.nodeId && playlistItem.libraryId === item.libraryId
              ? { ...playlistItem, subtitleSources: nextSubtitleSources }
              : playlistItem
          )),
        }
        : playlist;
      setIsPlaylistPanelOpen(false);
      setFileUrl(
        nextUrl,
        item.title,
        'video',
        item.nodeId,
        {
          tabTypeLabel: 'VIDEO',
          returnTarget,
          replaceTabId: tabId,
          videoSubtitleSources: nextSubtitleSources,
          videoPlaylist: nextPlaylist,
          videoAutoPlay: true,
        },
      );
    } catch (error: any) {
      runtimeLogger.error('切换合集视频失败:', error);
      Toast.error(error?.message || '切换视频失败');
    }
  }, [nodeId, persistVideoProgress, playlist, resolvePlaylistItemSubtitleSources, returnTarget, setFileUrl, tabId]);

  const loadMorePlaylistItems = useCallback(async () => {
    const source = playlist?.source;
    if (
      !playlist
      || source?.kind !== 'video_archive_collection'
      || !playlist.hasMore
      || isLoadingPlaylistMore
    ) {
      return;
    }

    const nextOffset = Number.isFinite(Number(playlist.nextOffset))
      ? Number(playlist.nextOffset)
      : playlist.items.length;
    setIsLoadingPlaylistMore(true);
    try {
      const page = await fetchArchiveCardsPage({
        nodeId: source.nodeId,
        libraryId: source.libraryId,
        builtInType: 'VIDEO',
        offset: Math.max(Math.floor(nextOffset), 0),
        limit: PLAYLIST_PAGE_SIZE,
      });
      const known = new Set(playlist.items.map(item => `${item.libraryId}:${item.nodeId}`));
      const moreItems = page.items
        .map(item => mapArchiveCardToPlaylistItem(item, source.libraryId))
        .filter((item): item is FileViewerVideoPlaylistItem => {
          if (!item) return false;
          const key = `${item.libraryId}:${item.nodeId}`;
          if (known.has(key)) return false;
          known.add(key);
          return true;
        });
      const resolvedNextOffset = page.items.length > 0
        ? page.offset + page.items.length
        : nextOffset;
      const nextPlaylist: FileViewerVideoPlaylist = {
        ...playlist,
        items: [...playlist.items, ...moreItems],
        total: page.total,
        nextOffset: resolvedNextOffset,
        hasMore: page.items.length > 0 && page.hasMore,
      };
      setFileUrl(
        url,
        fileName ?? null,
        'video',
        nodeId,
        {
          tabTypeLabel: 'VIDEO',
          returnTarget,
          replaceTabId: tabId,
          videoSubtitleSources: subtitleSources,
          videoPlaylist: nextPlaylist,
          videoAutoPlay: false,
        },
      );
    } catch (error: any) {
      runtimeLogger.error('加载更多合集视频失败:', error);
      Toast.error(error?.message || '加载更多失败');
    } finally {
      setIsLoadingPlaylistMore(false);
    }
  }, [
    fileName,
    isLoadingPlaylistMore,
    nodeId,
    playlist,
    returnTarget,
    setFileUrl,
    subtitleSources,
    tabId,
    url,
  ]);

  const toggleConsole = useCallback(() => {
    if (isWideMode) {
      setIsWideMode(false);
      return;
    }
    setIsConsoleOpen(prev => !prev);
  }, [isWideMode]);

  const handleProgressMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    isDraggingProgress.current = true;
    seekToByClientX(event.clientX);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await containerRef.current?.requestFullscreen();
    } catch (error) {
      runtimeLogger.warn('切换全屏失败:', error);
    }
  }, []);

  const toggleWideMode = useCallback(() => {
    setIsWideMode(prev => !prev);
  }, []);

  useEffect(() => {
    if (isWideMode) {
      if (consoleOpenBeforeWideModeRef.current === null) {
        consoleOpenBeforeWideModeRef.current = consoleOpenRef.current;
      }
      setIsConsoleOpen(false);
      wideModeAppliedRef.current = true;
      setVideoWideMode?.(true);
      return;
    }

    if (!wideModeAppliedRef.current) {
      return;
    }
    wideModeAppliedRef.current = false;
    setVideoWideMode?.(false);
    const restoreConsoleOpen = consoleOpenBeforeWideModeRef.current;
    consoleOpenBeforeWideModeRef.current = null;
    if (restoreConsoleOpen !== null) {
      setIsConsoleOpen(restoreConsoleOpen);
    }
  }, [isWideMode, setVideoWideMode]);

  useEffect(() => {
    if (active || !isWideMode) return;
    setIsWideMode(false);
  }, [active, isWideMode]);

  useEffect(() => () => {
    if (wideModeAppliedRef.current) {
      setVideoWideMode?.(false);
    }
  }, [setVideoWideMode]);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEditingKeyboardTarget(event.target)) return;
      if (isViewerInteractiveKeyboardTarget(event.target, viewerRootRef.current)) return;
      let handled = true;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          if (!event.repeat) {
            togglePlay();
          }
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seekBy(event.shiftKey ? -KEYBOARD_FAST_SEEK_SECONDS : -KEYBOARD_SEEK_SECONDS);
          break;
        case 'ArrowRight':
          event.preventDefault();
          seekBy(event.shiftKey ? KEYBOARD_FAST_SEEK_SECONDS : KEYBOARD_SEEK_SECONDS);
          break;
        case 'j':
        case 'J':
          event.preventDefault();
          seekBy(-KEYBOARD_SEEK_SECONDS);
          break;
        case 'l':
        case 'L':
          event.preventDefault();
          seekBy(KEYBOARD_SEEK_SECONDS);
          break;
        case 'ArrowUp':
          event.preventDefault();
          adjustVolumeBy(KEYBOARD_VOLUME_STEP);
          break;
        case 'ArrowDown':
          event.preventDefault();
          adjustVolumeBy(-KEYBOARD_VOLUME_STEP);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          if (!event.repeat) {
            setIsMuted(prev => !prev);
          }
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          if (!event.repeat) {
            void toggleFullscreen();
          }
          break;
        default:
          handled = false;
          break;
      }
      if (handled) {
        event.stopPropagation();
        releaseExternalKeyboardFocus(event.target, viewerRootRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [active, adjustVolumeBy, seekBy, toggleFullscreen, togglePlay]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayedVolume = Math.round((isMuted ? 0 : volume) * 100);
  const detachedPosterUrl = floatingVideoState.thumbnailUrl || thumbnailUrl;
  const detachedPosterStyle = useMemo<React.CSSProperties | undefined>(() => (
    detachedPosterUrl
      ? { backgroundImage: `url(${JSON.stringify(detachedPosterUrl)})` }
      : undefined
  ), [detachedPosterUrl]);

  return (
    <VideoViewerWrapper ref={viewerRootRef}>
      <div className="viewer-layout">
        <div className={`viewer-main ${isConsoleOpen ? 'console-open' : ''}`}>
          <input
            ref={subtitleInputRef}
            className="subtitle-file-input"
            type="file"
            accept=".srt,.vtt,.ass,.ssa,.lrc,text/vtt,application/x-subrip"
            onChange={handleSubtitleFileChange}
          />

          <div className="video-stage">
            <div className="video-shell" ref={containerRef}>
              <div
                ref={videoHostRef}
                className={`video-element-host ${isVideoHostedOutsideInline ? 'detached' : ''}`}
                onDoubleClick={toggleFullscreen}
              />
              {isVideoHostedOutsideInline && (
                <div className="video-detached-placeholder">
                  {detachedPosterUrl && (
                    <div
                      className="video-detached-poster"
                      style={detachedPosterStyle}
                    />
                  )}
                  <div className="video-detached-card">
                    <span className="video-detached-title">视频正在小窗播放</span>
                    <span className="video-detached-desc">画面已移到浮窗，播放进度会继续保留。</span>
                    <Button
                      icon={<IconShrinkScreenStroked />}
                      type="primary"
                      theme="solid"
                      onClick={restoreVideoInline}
                    >
                      收回 inline
                    </Button>
                  </div>
                </div>
              )}
              {!isVideoHostedOutsideInline && activeSubtitleCue && (
                <div
                  className="subtitle-overlay"
                  style={{
                    bottom: `${subtitleBottomOffset}px`,
                    fontSize: `${subtitleFontSize}px`,
                  }}
                >
                  {activeSubtitleCue.lines.map((line, index) => (
                    <span key={`${activeSubtitleCue.id}-${index}`} className="subtitle-line">
                      {line}
                    </span>
                  ))}
                </div>
              )}
              {!isVideoHostedOutsideInline && isBuffering && (
                <div className="buffering-overlay">
                  <Spin size="large" tip="视频加载中..." />
                </div>
              )}
            </div>
          </div>

          <div className="controls-panel">
            <div className="timeline-hitbox" onMouseDown={handleProgressMouseDown}>
              <div className="timeline-rail" ref={progressRef}>
                <div className="timeline-track" style={{ width: `${progressPercent}%` }} />
                <div className="timeline-thumb" style={{ left: `${progressPercent}%` }} />
              </div>
            </div>

            <div className="controls-row">
              <div className="left-controls">
                <Button icon={<IconBackward />} theme="borderless" onClick={() => seekBy(-SEEK_SECONDS)} />
                <Button
                  icon={isPlaying ? <IconPause /> : <IconPlay />}
                  theme="solid"
                  type="primary"
                  onClick={togglePlay}
                />
                <Button icon={<IconForward />} theme="borderless" onClick={() => seekBy(SEEK_SECONDS)} />
                <span className="time-text">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>

              <div className="right-controls">
                {hasPlaylist && (
                  <div className="control-popover-box" ref={playlistControlRef}>
                    <Button
                      icon={<IconVideoListStroked />}
                      theme={isPlaylistPanelOpen ? 'solid' : 'borderless'}
                      type={isPlaylistPanelOpen ? 'primary' : 'tertiary'}
                      onClick={togglePlaylistPanel}
                      title="播放列表"
                      aria-label="播放列表"
                    />
                    {isPlaylistPanelOpen && (
                      <div className="floating-control-panel playlist-panel">
                        <div className="playlist-panel-header">
                          <span className="playlist-panel-title" title={playlist?.title || ''}>
                            {playlist?.title || '合集'}
                          </span>
                          <span className="playlist-panel-count">{playlistCountText}</span>
                        </div>
                        <div className="playlist-panel-list">
                          {playlistItems.map((item, index) => {
                            const current = item.nodeId === nodeId;
                            return (
                              <button
                                key={`${item.libraryId}:${item.nodeId}`}
                                type="button"
                                className={`playlist-panel-item ${current ? 'active' : ''}`}
                                onClick={() => {
                                  void openPlaylistItem(item);
                                }}
                                title={item.title}
                              >
                                <span className="playlist-panel-index">{index + 1}</span>
                                <span className="playlist-panel-name">{item.title}</span>
                                <span className="playlist-panel-duration">
                                  {item.durationSeconds ? formatTime(item.durationSeconds) : '--:--'}
                                </span>
                              </button>
                            );
                          })}
                          {canLoadPlaylistMore && (
                            <button
                              type="button"
                              className="playlist-panel-load-more"
                              disabled={isLoadingPlaylistMore}
                              onClick={() => {
                                void loadMorePlaylistItems();
                              }}
                            >
                              {isLoadingPlaylistMore ? '加载中...' : '加载更多'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="control-popover-box" ref={volumeControlRef}>
                  <Button
                    icon={isMuted ? <IconMute /> : volume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
                    theme="borderless"
                    onClick={toggleVolumePanel}
                  />
                  {isVolumePanelOpen && (
                    <div className="floating-control-panel volume-panel">
                      <input
                        className="volume-slider-vertical"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                      />
                      <button
                        type="button"
                        className="floating-action-chip"
                        onClick={() => setIsMuted(prev => !prev)}
                      >
                        {displayedVolume}%
                      </button>
                    </div>
                  )}
                </div>

                <div className="control-popover-box" ref={rateControlRef}>
                  <Button theme="borderless" onClick={toggleRatePanel}>
                    {playbackRate}x
                  </Button>
                  {isRatePanelOpen && (
                    <div className="floating-control-panel rate-panel">
                      {PLAYBACK_RATES.map(rate => (
                        <button
                          type="button"
                          key={rate}
                          className={`floating-action-chip ${playbackRate === rate ? 'active' : ''}`}
                          onClick={() => {
                            setPlaybackRate(rate);
                            setIsRatePanelOpen(false);
                          }}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  icon={<span className="video-control-icon"><RightToolPanelIcon /></span>}
                  theme="borderless"
                  onClick={toggleConsole}
                  title={isConsoleOpen ? '隐藏工具台' : '显示工具台'}
                  aria-label={isConsoleOpen ? '隐藏工具台' : '显示工具台'}
                />

                <Button
                  icon={<span className="video-control-icon"><IconMiniPlayer /></span>}
                  theme={isVideoHostedOutsideInline ? 'solid' : 'borderless'}
                  type={isVideoHostedOutsideInline ? 'primary' : 'tertiary'}
                  onClick={requestFloatingVideo}
                  title={isVideoHostedOutsideInline ? '收回播放器' : '桌面小窗'}
                  aria-label={isVideoHostedOutsideInline ? '收回播放器' : '桌面小窗'}
                />

                <Button
                  icon={<span className="video-control-icon">{isWideMode ? <WideModeExitIcon /> : <WideModeEnterIcon />}</span>}
                  theme={isWideMode ? 'solid' : 'borderless'}
                  type={isWideMode ? 'primary' : 'tertiary'}
                  onClick={toggleWideMode}
                  title={isWideMode ? '退出宽屏模式' : '宽屏模式'}
                  aria-label={isWideMode ? '退出宽屏模式' : '宽屏模式'}
                />

                <Button
                  icon={(
                    <span className="video-control-icon">
                      {isFullscreen ? <IconShrinkScreenStroked /> : <IconFullScreenStroked />}
                    </span>
                  )}
                  theme="borderless"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? '退出全屏' : '全屏'}
                  aria-label={isFullscreen ? '退出全屏' : '全屏'}
                />
              </div>
            </div>
          </div>
        </div>

        <aside className={`console-panel ${isConsoleOpen ? 'open' : 'closed'}`}>
          <div className="console-body">
            <VideoSubtitlePanel
              activeSubtitleCue={activeSubtitleCue}
              clearSubtitle={clearSubtitle}
              librarySubtitleSources={librarySubtitleSources}
              loadLibrarySubtitle={(source) => {
                void loadLibrarySubtitle(source);
              }}
              loadedSubtitleSourceId={loadedSubtitleSourceId}
              openSubtitlePicker={openSubtitlePicker}
              setSubtitleBottomOffset={setSubtitleBottomOffset}
              setSubtitleEnabled={setSubtitleEnabled}
              setSubtitleFontSize={setSubtitleFontSize}
              subtitleBottomOffset={subtitleBottomOffset}
              subtitleCues={subtitleCues}
              subtitleEnabled={subtitleEnabled}
              subtitleError={subtitleError}
              subtitleFileName={subtitleFileName}
              subtitleFontSize={subtitleFontSize}
            />

            <div className="console-section">
              <div className="section-header">
                <span className="section-title">播放状态</span>
                <span className="section-meta">{isPlaying ? '播放中' : '已暂停'}</span>
              </div>
              <div className="info-grid">
                <div className="info-card">
                  <span className="info-label">播放速率</span>
                  <span className="info-value">{playbackRate}x</span>
                </div>
                <div className="info-card">
                  <span className="info-label">音量</span>
                  <span className="info-value">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
                </div>
              </div>
              <p className="section-description">
                基础播放控制仍然放在底部控制条；右侧操作台主要承接视频扩展能力，避免和其他 viewer 混在一起。
              </p>
            </div>

            <div className="console-section">
              <div className="section-header">
                <span className="section-title">预留能力</span>
                <span className="section-meta">后续扩展</span>
              </div>
              <div className="placeholder-grid">
                {PLACEHOLDER_TOOL_OPTIONS.map(item => (
                  <span key={item} className="placeholder-chip">{item}</span>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </VideoViewerWrapper>
  );
};

export default VideoViewer;
