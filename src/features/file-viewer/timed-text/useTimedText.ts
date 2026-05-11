import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { getFileLink } from '@/features/file-explorer/services/file.api';
import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { findActiveTimedTextCue, parseTimedText, type TimedTextCue } from './subtitle';

interface IpcTextFetchResponse {
  status?: number;
  body?: unknown;
}

interface UseTimedTextOptions {
  currentTime: number;
  subtitleSources?: FileViewerSubtitleSource[];
  url: string;
}

export const DEFAULT_SUBTITLE_FONT_SIZE = 44;
export const MIN_SUBTITLE_FONT_SIZE = 28;
export const MAX_SUBTITLE_FONT_SIZE = 72;
export const DEFAULT_SUBTITLE_BOTTOM_OFFSET = 72;
export const MIN_SUBTITLE_BOTTOM_OFFSET = 36;
export const MAX_SUBTITLE_BOTTOM_OFFSET = 160;

const SUBTITLE_LINK_EXPIRY_MINUTES = 60;

function compareSubtitleSource(left: FileViewerSubtitleSource, right: FileViewerSubtitleSource): number {
  const leftOrder = Number(left.sortOrder ?? 0);
  const rightOrder = Number(right.sortOrder ?? 0);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.nodeId - right.nodeId;
}

function readTextResponseBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === null || body === undefined) return '';
  return String(body);
}

export function useTimedText({
  currentTime,
  subtitleSources,
  url,
}: UseTimedTextOptions) {
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const subtitleLoadRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitleFileName, setSubtitleFileName] = useState('');
  const [loadedSubtitleSourceId, setLoadedSubtitleSourceId] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<TimedTextCue[]>([]);
  const [subtitleFontSize, setSubtitleFontSize] = useState(DEFAULT_SUBTITLE_FONT_SIZE);
  const [subtitleBottomOffset, setSubtitleBottomOffset] = useState(DEFAULT_SUBTITLE_BOTTOM_OFFSET);

  const librarySubtitleSources = useMemo(() => (
    [...(subtitleSources ?? [])]
      .filter(source => source.sourceType === 'library' && source.nodeId > 0 && source.libraryId > 0)
      .sort(compareSubtitleSource)
  ), [subtitleSources]);

  const activeSubtitleCue = useMemo(() => {
    if (!subtitleEnabled) return null;
    return findActiveTimedTextCue(subtitleCues, currentTime);
  }, [currentTime, subtitleCues, subtitleEnabled]);

  const resetSubtitle = useCallback(() => {
    subtitleLoadRequestIdRef.current += 1;
    setSubtitleFileName('');
    setLoadedSubtitleSourceId(null);
    setSubtitleError(null);
    setSubtitleCues([]);
    setSubtitleEnabled(true);
  }, []);

  const openSubtitlePicker = useCallback(() => {
    subtitleInputRef.current?.click();
  }, []);

  const applySubtitleText = useCallback((raw: string, displayName: string): boolean => {
    const cues = parseTimedText(raw);
    if (cues.length === 0) {
      setSubtitleFileName('');
      setSubtitleCues([]);
      setSubtitleError('字幕文件没有解析出有效时间轴，当前支持常见的 .srt / .vtt / .ass / .ssa / .lrc / .qrc.xml 格式。');
      return false;
    }
    setSubtitleFileName(displayName);
    setSubtitleCues(cues);
    setSubtitleError(null);
    setSubtitleEnabled(true);
    return true;
  }, []);

  const loadLibrarySubtitle = useCallback(async (source: FileViewerSubtitleSource) => {
    const requestId = subtitleLoadRequestIdRef.current + 1;
    subtitleLoadRequestIdRef.current = requestId;

    try {
      const subtitleUrl = await getFileLink(source.nodeId, source.libraryId, SUBTITLE_LINK_EXPIRY_MINUTES);
      const response = await window.electronAPI.fetch(subtitleUrl, {
        method: 'GET',
      }) as IpcTextFetchResponse;
      const status = Number(response?.status ?? 0);
      if (status >= 400) {
        throw new Error(`HTTP ${status}`);
      }
      const raw = readTextResponseBody(response?.body);
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      const loaded = applySubtitleText(raw, source.fileName);
      setLoadedSubtitleSourceId(loaded ? source.id : null);
    } catch (error) {
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      runtimeLogger.error('加载库内字幕失败:', error);
      setSubtitleFileName('');
      setLoadedSubtitleSourceId(null);
      setSubtitleCues([]);
      setSubtitleError('库内字幕加载失败，请在操作台里手动选择其他字幕或加载本地字幕。');
    }
  }, [applySubtitleText]);

  const clearSubtitle = useCallback(() => {
    resetSubtitle();
  }, [resetSubtitle]);

  const handleSubtitleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const requestId = subtitleLoadRequestIdRef.current + 1;
    subtitleLoadRequestIdRef.current = requestId;

    try {
      const raw = await file.text();
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      applySubtitleText(raw, file.name);
      setLoadedSubtitleSourceId(null);
    } catch (error) {
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      runtimeLogger.error('读取字幕文件失败:', error);
      setSubtitleFileName('');
      setLoadedSubtitleSourceId(null);
      setSubtitleCues([]);
      setSubtitleError('字幕文件读取失败，请重新选择。');
    } finally {
      event.target.value = '';
    }
  }, [applySubtitleText]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      subtitleLoadRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    resetSubtitle();
  }, [resetSubtitle, url]);

  useEffect(() => {
    const firstSource = librarySubtitleSources[0];
    if (!firstSource) return;
    void loadLibrarySubtitle(firstSource);
  }, [librarySubtitleSources, loadLibrarySubtitle, url]);

  return {
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
  };
}
