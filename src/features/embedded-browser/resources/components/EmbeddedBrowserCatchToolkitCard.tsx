import { Toast } from '@douyinfe/semi-ui';
import React from 'react';
import type { EmbeddedBrowserCatchToolkitState } from '../types';

type EmbeddedBrowserCatchToolkitCardProps = {
  disabled: boolean;
  loading: boolean;
  state: EmbeddedBrowserCatchToolkitState;
  onClearCache: () => Promise<boolean>;
  onMergeCapturedMedia: () => Promise<{
    cancelled?: boolean;
    error?: string;
    ok: boolean;
    outputPath?: string;
  } | null>;
  onSaveCapturedMedia: () => Promise<{
    cancelled?: boolean;
    error?: string;
    ok: boolean;
    outputPath?: string;
  } | null>;
  onRestartCapture: () => Promise<boolean>;
  onUpdateState: (payload: Partial<EmbeddedBrowserCatchToolkitState>) => Promise<EmbeddedBrowserCatchToolkitState>;
};

function formatCaptureBytes(value: number) {
  if (!value || value <= 0) {
    return '0 KB';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

const EmbeddedBrowserCatchToolkitCard: React.FC<EmbeddedBrowserCatchToolkitCardProps> = ({
  disabled,
  loading,
  state,
  onClearCache,
  onMergeCapturedMedia,
  onSaveCapturedMedia,
  onRestartCapture,
  onUpdateState,
}) => {
  const [manualNameDraft, setManualNameDraft] = React.useState(state.manualFileName);
  const [selectorDraft, setSelectorDraft] = React.useState(state.selectorRule);
  const [regexDraft, setRegexDraft] = React.useState(state.regexRule);

  React.useEffect(() => {
    setManualNameDraft(state.manualFileName);
  }, [state.manualFileName]);

  React.useEffect(() => {
    setSelectorDraft(state.selectorRule);
  }, [state.selectorRule]);

  React.useEffect(() => {
    setRegexDraft(state.regexRule);
  }, [state.regexRule]);

  const canMergeCapturedMedia = Boolean(state.videoResourceKey && state.audioResourceKey);
  const canDownloadCapturedMedia = state.capturedMediaSizeBytes > 0;
  const primaryActionText = canMergeCapturedMedia
    ? '合并并下载'
    : '下载捕捉文件';
  const captureProgressText = state.capturedMediaSizeBytes > 0
    ? `${formatCaptureBytes(state.capturedMediaSizeBytes)} 已捕捉`
    : '等待播放器产生缓存数据';

  return (
  <section className="resource-toolkit-card">
    <div className="resource-toolkit-recorder">
      <div className="resource-toolkit-recorder-main">
        <div className="resource-toolkit-status">
          <span className={`resource-toolkit-status-dot ${state.isCaptureComplete ? 'is-complete' : 'is-recording'}`} />
          <span>{state.isCaptureComplete ? '捕捉完成' : '正在缓存捕捉'}</span>
        </div>
        <div className="resource-toolkit-size">{formatCaptureBytes(state.capturedMediaSizeBytes)}</div>
        <div className="resource-toolkit-progress" aria-label={captureProgressText}>
          <div
            className="resource-toolkit-progress-bar"
            style={{
              width: state.capturedMediaSizeBytes > 0 ? '100%' : '0%',
            }}
          />
        </div>
        <div className="resource-toolkit-track-summary">
          <span>视频 {state.videoSizeBytes ? formatCaptureBytes(state.videoSizeBytes) : '等待中'}</span>
          <span>音频 {state.audioSizeBytes ? formatCaptureBytes(state.audioSizeBytes) : '等待中'}</span>
          <span>{state.streamCount} 条流</span>
          <span>{state.diagnostics.frameCount || 0} 个 frame</span>
          <span>SourceBuffer {state.diagnostics.sourceBufferCount}</span>
          <span>append {state.diagnostics.appendBufferCount}</span>
        </div>
        <div className="resource-toolkit-track-summary">
          <span>MediaSource {state.diagnostics.mediaSourceAvailable ? '存在' : '未见'}</span>
          <span>hook {state.diagnostics.mediaSourceHooked ? '已触发' : '未触发'}</span>
          {state.diagnostics.hookErrors ? <span>hook 错误 {state.diagnostics.hookErrors}</span> : null}
        </div>
        {state.diagnostics.lastError ? (
          <div className="resource-toolkit-warning">{state.diagnostics.lastError}</div>
        ) : null}
      </div>
      <div className="resource-toolkit-primary-actions">
        <button
          type="button"
          className="resource-card-btn primary"
          disabled={disabled || loading || !canDownloadCapturedMedia}
          onClick={() => {
            if (canMergeCapturedMedia) {
              void onMergeCapturedMedia().then((result) => {
                if (!result || result.cancelled) {
                  return;
                }
                if (!result.ok) {
                  Toast.error(result.error || '合并下载失败');
                  return;
                }
                Toast.success('已合并并保存捕捉文件');
              }).catch((error: any) => {
                Toast.error(error?.message || '合并下载失败');
              });
              return;
            }
            void onSaveCapturedMedia().then((result) => {
              if (!result || result.cancelled) {
                return;
              }
              if (!result.ok) {
                Toast.error(result.error || '保存捕捉文件失败');
                return;
              }
              Toast.success('已保存捕捉文件');
            }).catch((error: any) => {
              Toast.error(error?.message || '保存捕捉文件失败');
            });
          }}
        >
          {primaryActionText}
        </button>
        <button
          type="button"
          className="resource-card-btn"
          disabled={disabled || loading}
          onClick={() => {
            void onRestartCapture().then((success) => {
              if (success) {
                Toast.success('已从头重启当前页捕捉');
              }
            }).catch((error: any) => {
              Toast.error(error?.message || '从头重捕失败');
            });
          }}
        >
          从头重捕
        </button>
      </div>
    </div>

    <div className="resource-toolkit-header">
      <div>
        <div className="resource-toolkit-title">当前页捕捉工具</div>
        <div className="resource-toolkit-description">
          播放器播放时会把缓存片段收进这里，大小会随捕捉增长；完成后优先合并音视频并弹出保存位置。
        </div>
      </div>
      <div className="resource-toolkit-badges">
        <span className="resource-chip">{state.streamCount} 条流</span>
        <span className="resource-chip">{formatCaptureBytes(state.capturedMediaSizeBytes)}</span>
        <span className="resource-chip">{state.isCaptureComplete ? '已捕获完成' : '捕获进行中'}</span>
      </div>
    </div>

    <div className="resource-toolkit-meta">
      <div className="resource-toolkit-meta-label">文件名</div>
      <div className="resource-toolkit-meta-value">
        {state.currentFileName || '当前先按页面标题推断，后面再接文件名提取规则。'}
      </div>
    </div>

    <details className="resource-toolkit-advanced">
      <summary>捕捉设置</summary>
    <div className="resource-toolkit-settings">
      <label className="resource-toolkit-toggle">
        <input
          type="checkbox"
          checked={state.autoSeekToBufferedEnd}
          disabled={disabled || loading}
          onChange={(event) => {
            void onUpdateState({
              autoSeekToBufferedEnd: event.target.checked,
            }).catch((error: any) => {
              Toast.error(error?.message || '更新自动跳缓冲尾失败');
            });
          }}
        />
        <span>自动跳到缓冲尾</span>
      </label>
      <label className="resource-toolkit-toggle">
        <input
          type="checkbox"
          checked={state.autoDownloadOnComplete}
          disabled={disabled || loading}
          onChange={(event) => {
            void onUpdateState({
              autoDownloadOnComplete: event.target.checked,
            }).catch((error: any) => {
              Toast.error(error?.message || '更新自动导出设置失败');
            });
          }}
        />
        <span>捕获完成后自动合并下载</span>
      </label>
      <label className="resource-toolkit-toggle">
        <input
          type="checkbox"
          checked={state.saveEveryGigabyte}
          disabled={disabled || loading}
          onChange={(event) => {
            void onUpdateState({
              saveEveryGigabyte: event.target.checked,
            }).catch((error: any) => {
              Toast.error(error?.message || '更新每 GB 自动保存设置失败');
            });
          }}
        />
        <span>每累计 1 GB 自动保存并清理缓存</span>
      </label>
      <label className="resource-toolkit-toggle">
        <input
          type="checkbox"
          checked={state.trimExtraMediaHeaders}
          disabled={disabled || loading}
          onChange={(event) => {
            void onUpdateState({
              trimExtraMediaHeaders: event.target.checked,
            }).catch((error: any) => {
              Toast.error(error?.message || '更新头部清理设置失败');
            });
          }}
        />
        <span>自动去除多余文件头</span>
      </label>
      <label className="resource-toolkit-toggle">
        <input
          type="checkbox"
          checked={state.restartAlwaysFromBeginning}
          disabled={disabled || loading}
          onChange={(event) => {
            void onUpdateState({
              restartAlwaysFromBeginning: event.target.checked,
            }).catch((error: any) => {
              Toast.error(error?.message || '更新始终从头捕获设置失败');
            });
          }}
        />
        <span>始终从头捕获</span>
      </label>
      <label className="resource-toolkit-toggle">
        <input
          type="checkbox"
          checked={state.clearCacheOnComplete}
          disabled={disabled || loading}
          onChange={(event) => {
            void onUpdateState({
              clearCacheOnComplete: event.target.checked,
            }).catch((error: any) => {
              Toast.error(error?.message || '更新完成后清缓存设置失败');
            });
          }}
        />
        <span>捕获完成后清空缓存</span>
      </label>
    </div>

    <div className="resource-toolkit-settings">
      <label className="resource-toolkit-input-group">
        <span>手动文件名</span>
        <input
          className="resource-toolkit-input"
          value={manualNameDraft}
          disabled={disabled || loading}
          placeholder="直接指定导出文件名，不带扩展名"
          onChange={(event) => {
            setManualNameDraft(event.target.value);
          }}
        />
      </label>
      <label className="resource-toolkit-input-group">
        <span>选择器规则</span>
        <input
          className="resource-toolkit-input"
          value={selectorDraft}
          disabled={disabled || loading}
          placeholder="例如 h1 / .video-title"
          onChange={(event) => {
            setSelectorDraft(event.target.value);
          }}
        />
        {state.selectorWarning ? (
          <span className="resource-toolkit-warning">{state.selectorWarning}</span>
        ) : null}
      </label>
      <label className="resource-toolkit-input-group">
        <span>正则规则</span>
        <input
          className="resource-toolkit-input"
          value={regexDraft}
          disabled={disabled || loading}
          placeholder="例如 第(.+?)集"
          onChange={(event) => {
            setRegexDraft(event.target.value);
          }}
        />
        {state.regexWarning ? (
          <span className="resource-toolkit-warning">{state.regexWarning}</span>
        ) : null}
      </label>
      <div className="resource-toolkit-actions">
        <button
          type="button"
          className="resource-card-btn"
          disabled={disabled || loading}
          onClick={() => {
            void onUpdateState({
              manualFileName: manualNameDraft,
              regexRule: regexDraft,
              selectorRule: selectorDraft,
            }).then(() => {
              Toast.success('已更新文件名规则');
            }).catch((error: any) => {
              Toast.error(error?.message || '更新文件名规则失败');
            });
          }}
        >
          应用规则
        </button>
        <button
          type="button"
          className="resource-card-btn"
          disabled={disabled || loading}
          onClick={() => {
            setManualNameDraft('');
            setSelectorDraft('');
            setRegexDraft('');
            void onUpdateState({
              manualFileName: '',
              regexRule: '',
              selectorRule: '',
            }).then(() => {
              Toast.success('已清空文件名规则');
            }).catch((error: any) => {
              Toast.error(error?.message || '清空文件名规则失败');
            });
          }}
        >
          清空规则
        </button>
      </div>
    </div>
    </details>

    <div className="resource-toolkit-actions">
      <button
        type="button"
        className="resource-card-btn"
        disabled={disabled || loading}
        onClick={() => {
          void onClearCache().then((success) => {
            if (success) {
              Toast.success('已清理当前页捕捉缓存');
            }
          }).catch((error: any) => {
            Toast.error(error?.message || '清理缓存失败');
          });
        }}
      >
        清理页内缓存
      </button>
    </div>
  </section>
  );
};

export default EmbeddedBrowserCatchToolkitCard;
