import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Spin, Switch } from '@douyinfe/semi-ui';
import {
  IconBackward,
  IconForward,
  IconMute,
  IconPause,
  IconPlay,
  IconUpload,
  IconVolume1,
  IconVolume2,
} from '@douyinfe/semi-icons';
import { VideoViewerWrapper } from './style';
import { useRegisterMediaEntry } from '@/hooks/useMediaRegistry';
import { fetchNodeDetailById, updateNodeConfig } from '@/features/file-explorer/services/file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { findActiveSubtitleCue, parseVideoSubtitle, type VideoSubtitleCue } from './subtitle';

interface VideoViewerProps {
  nodeId?: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
  tabId: string;
}

interface VideoPlaybackProgress {
  currentTime: number;
  duration: number;
  updatedAt: string;
}

const SEEK_SECONDS = 5;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const PLACEHOLDER_TOOL_OPTIONS = ['同名字幕自动发现', '双语字幕', '片段标注', 'AI 字幕'];
const DEFAULT_SUBTITLE_FONT_SIZE = 44;
const MIN_SUBTITLE_FONT_SIZE = 28;
const MAX_SUBTITLE_FONT_SIZE = 72;
const DEFAULT_SUBTITLE_BOTTOM_OFFSET = 72;
const MIN_SUBTITLE_BOTTOM_OFFSET = 36;
const MAX_SUBTITLE_BOTTOM_OFFSET = 160;
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

const VideoViewer: React.FC<VideoViewerProps> = ({ nodeId, url, fileName, active = true, tabId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const rateControlRef = useRef<HTMLDivElement>(null);
  const subtitleLoadRequestIdRef = useRef(0);
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
  const isDraggingProgress = useRef(false);
  const thumbnailCaptureTimerRef = useRef<number>(0);
  const thumbnailCaptureAttemptRef = useRef(0);
  const thumbnailCaptureUrlRef = useRef('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
  const [volume, setVolume] = useState(0.75);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isConsoleOpen, setIsConsoleOpen] = useState(true);
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitleFileName, setSubtitleFileName] = useState('');
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<VideoSubtitleCue[]>([]);
  const [subtitleFontSize, setSubtitleFontSize] = useState(DEFAULT_SUBTITLE_FONT_SIZE);
  const [subtitleBottomOffset, setSubtitleBottomOffset] = useState(DEFAULT_SUBTITLE_BOTTOM_OFFSET);
  const [isVolumePanelOpen, setIsVolumePanelOpen] = useState(false);
  const [isRatePanelOpen, setIsRatePanelOpen] = useState(false);

  const progressCacheKey = useMemo(() => resolveVideoProgressCacheKey(url, nodeId), [nodeId, url]);

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

  useRegisterMediaEntry({
    enabled: hasStartedPlaying,
    entryId: `video:${tabId}`,
    kind: 'video',
    tabId,
    title: fileName || '视频',
    isPlaying,
    currentTime,
    duration,
    thumbnailUrl,
    previewUrl: url,
    play: () => {
      const video = videoRef.current;
      if (video) void video.play();
    },
    pause: () => {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
    },
    seek: (time) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(time)) return;
      const next = Math.min(Math.max(time, 0), duration || video.duration || 0);
      video.currentTime = next;
      setCurrentTime(next);
      persistVideoProgress(true);
    },
    dismiss: () => {
      const video = videoRef.current;
      if (video && !video.paused) {
        video.pause();
      }
      persistVideoProgress(true);
      setHasStartedPlaying(false);
    },
  });

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
      subtitleLoadRequestIdRef.current += 1;
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
      setHasStartedPlaying(true);
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
    subtitleLoadRequestIdRef.current += 1;
    remoteProgressRequestIdRef.current += 1;
    viewMetaBaseReadyRef.current = false;
    viewMetaBaseRef.current = {};
    pendingRemoteProgressRef.current = null;
    lastSyncedRemoteProgressSignatureRef.current = '';
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
    setSubtitleFileName('');
    setSubtitleError(null);
    setSubtitleCues([]);
    setSubtitleEnabled(true);
  }, [progressCacheKey, url]);

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

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((error) => {
        runtimeLogger.error('failed to start video playback:', error);
      });
    } else {
      video.pause();
    }
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(Math.max((video.currentTime || 0) + delta, 0), duration || 0);
    video.currentTime = next;
    setCurrentTime(next);
    persistVideoProgress(true);
  };

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
  }, []);

  const handleProgressMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    isDraggingProgress.current = true;
    seekToByClientX(event.clientX);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await containerRef.current?.requestFullscreen();
    } catch (error) {
      runtimeLogger.warn('切换全屏失败:', error);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const activeSubtitleCue = useMemo(() => {
    if (!subtitleEnabled) return null;
    return findActiveSubtitleCue(subtitleCues, currentTime);
  }, [currentTime, subtitleCues, subtitleEnabled]);

  const openSubtitlePicker = useCallback(() => {
    subtitleInputRef.current?.click();
  }, []);

  const clearSubtitle = useCallback(() => {
    subtitleLoadRequestIdRef.current += 1;
    setSubtitleFileName('');
    setSubtitleError(null);
    setSubtitleCues([]);
    setSubtitleEnabled(true);
  }, []);

  const handleSubtitleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const requestId = subtitleLoadRequestIdRef.current + 1;
    subtitleLoadRequestIdRef.current = requestId;

    try {
      const raw = await file.text();
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      const cues = parseVideoSubtitle(raw);
      if (cues.length === 0) {
        setSubtitleFileName('');
        setSubtitleCues([]);
        setSubtitleError('字幕文件没有解析出有效时间轴，当前先支持常见的 .srt / .vtt 格式。');
        return;
      }
      setSubtitleFileName(file.name);
      setSubtitleCues(cues);
      setSubtitleError(null);
      setSubtitleEnabled(true);
    } catch (error) {
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      runtimeLogger.error('读取字幕文件失败:', error);
      setSubtitleFileName('');
      setSubtitleCues([]);
      setSubtitleError('字幕文件读取失败，请重新选择。');
    } finally {
      event.target.value = '';
    }
  }, []);

  const displayedVolume = Math.round((isMuted ? 0 : volume) * 100);

  return (
    <VideoViewerWrapper>
      <div className="viewer-layout">
        <div className={`viewer-main ${isConsoleOpen ? 'console-open' : ''}`}>
          <input
            ref={subtitleInputRef}
            className="subtitle-file-input"
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={handleSubtitleFileChange}
          />

          <div className="video-stage">
            <div className="video-shell" ref={containerRef}>
              <video
                ref={videoRef}
                className="video-element"
                preload="metadata"
                playsInline
                onDoubleClick={toggleFullscreen}
              />
              {activeSubtitleCue && (
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
              {isBuffering && (
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

                <Button theme="borderless" onClick={() => setIsConsoleOpen(prev => !prev)}>
                  {isConsoleOpen ? '隐藏工具台' : '工具台'}
                </Button>

                <Button theme="borderless" onClick={toggleFullscreen}>
                  {isFullscreen ? '退出全屏' : '全屏'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <aside className={`console-panel ${isConsoleOpen ? 'open' : 'closed'}`}>
          <div className="console-body">
              <div className="console-section">
                <div className="section-header">
                  <span className="section-title">视频操作台</span>
                  <span className="section-meta">{fileName || '当前视频'}</span>
                </div>
                <p className="section-description">
                  这是视频专属的右侧控制区，后面可以继续往这里加字幕、标注、片段和更多播放能力。
                </p>
              </div>

              <div className="console-section">
                <div className="section-header">
                  <span className="section-title">字幕</span>
                  <Switch checked={subtitleEnabled} disabled={subtitleCues.length === 0} onChange={setSubtitleEnabled} />
                </div>
                <div className="section-actions">
                  <Button icon={<IconUpload />} onClick={openSubtitlePicker}>
                    加载字幕
                  </Button>
                  <Button disabled={subtitleCues.length === 0} onClick={clearSubtitle}>
                    清除字幕
                  </Button>
                </div>
                <div className="info-card">
                  <span className="info-label">当前文件</span>
                  <span className="info-value">{subtitleFileName || '未加载字幕文件'}</span>
                </div>
                {subtitleError && (
                  <div className="inline-alert error">{subtitleError}</div>
                )}
                {!subtitleError && subtitleCues.length > 0 && (
                  <>
                    <div className="info-grid">
                      <div className="info-card">
                        <span className="info-label">字幕片段</span>
                        <span className="info-value">{subtitleCues.length}</span>
                      </div>
                      <div className="info-card">
                        <span className="info-label">当前状态</span>
                        <span className="info-value">{activeSubtitleCue ? '跟随播放中' : '等待下一句'}</span>
                      </div>
                    </div>
                    <label className="slider-field">
                      <span>字号</span>
                      <div className="slider-row">
                        <input
                          type="range"
                          min={String(MIN_SUBTITLE_FONT_SIZE)}
                          max={String(MAX_SUBTITLE_FONT_SIZE)}
                          step="1"
                          value={subtitleFontSize}
                          onChange={event => setSubtitleFontSize(Number(event.target.value))}
                        />
                        <strong>{subtitleFontSize}px</strong>
                      </div>
                    </label>
                    <label className="slider-field">
                      <span>底部位置</span>
                      <div className="slider-row">
                        <input
                          type="range"
                          min={String(MIN_SUBTITLE_BOTTOM_OFFSET)}
                          max={String(MAX_SUBTITLE_BOTTOM_OFFSET)}
                          step="2"
                          value={subtitleBottomOffset}
                          onChange={event => setSubtitleBottomOffset(Number(event.target.value))}
                        />
                        <strong>{subtitleBottomOffset}px</strong>
                      </div>
                    </label>
                    <div className="subtitle-preview">
                      {activeSubtitleCue ? (
                        activeSubtitleCue.lines.map((line, index) => (
                          <span key={`${activeSubtitleCue.id}-preview-${index}`}>{line}</span>
                        ))
                      ) : (
                        <span>字幕已加载，播放到对应时间点后会固定显示在主画面底部。</span>
                      )}
                    </div>
                  </>
                )}
                {!subtitleError && subtitleCues.length === 0 && (
                  <div className="console-empty">
                    <Empty
                      title="还没有字幕"
                      description="先加载一个 .srt 或 .vtt 文件，字幕会固定显示在视频主内容区域。"
                    />
                  </div>
                )}
              </div>

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
