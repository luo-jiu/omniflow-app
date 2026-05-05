import React from 'react';
import { Button, Empty, Switch } from '@douyinfe/semi-ui';
import { IconUpload } from '@douyinfe/semi-icons';
import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';
import type { VideoSubtitleCue } from './subtitle';
import {
  MAX_SUBTITLE_BOTTOM_OFFSET,
  MAX_SUBTITLE_FONT_SIZE,
  MIN_SUBTITLE_BOTTOM_OFFSET,
  MIN_SUBTITLE_FONT_SIZE,
} from './useVideoSubtitles';

interface VideoSubtitlePanelProps {
  activeSubtitleCue: VideoSubtitleCue | null;
  clearSubtitle: () => void;
  librarySubtitleSources: FileViewerSubtitleSource[];
  loadLibrarySubtitle: (source: FileViewerSubtitleSource) => void;
  loadedSubtitleSourceId: string | null;
  openSubtitlePicker: () => void;
  setSubtitleBottomOffset: (value: number) => void;
  setSubtitleEnabled: (value: boolean) => void;
  setSubtitleFontSize: (value: number) => void;
  subtitleBottomOffset: number;
  subtitleCues: VideoSubtitleCue[];
  subtitleEnabled: boolean;
  subtitleError: string | null;
  subtitleFileName: string;
  subtitleFontSize: number;
}

const VideoSubtitlePanel: React.FC<VideoSubtitlePanelProps> = ({
  activeSubtitleCue,
  clearSubtitle,
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
}) => (
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
    {librarySubtitleSources.length > 0 && (
      <div className="subtitle-source-list">
        <div className="subtitle-source-title">
          <span>库内字幕</span>
          <strong>{librarySubtitleSources.length}</strong>
        </div>
        {librarySubtitleSources.map(source => (
          <button
            key={source.id}
            type="button"
            className={`subtitle-source-item ${loadedSubtitleSourceId === source.id ? 'active' : ''}`}
            title={source.fileName}
            onClick={() => loadLibrarySubtitle(source)}
          >
            <span>{source.fileName}</span>
          </button>
        ))}
      </div>
    )}
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
);

export default VideoSubtitlePanel;
