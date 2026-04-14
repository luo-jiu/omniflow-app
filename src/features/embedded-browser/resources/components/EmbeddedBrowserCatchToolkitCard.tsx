import { Toast } from '@douyinfe/semi-ui';
import React from 'react';
import type { EmbeddedBrowserCatchToolkitState } from '../types';

type EmbeddedBrowserCatchToolkitCardProps = {
  disabled: boolean;
  loading: boolean;
  state: EmbeddedBrowserCatchToolkitState;
  onClearCache: () => Promise<boolean>;
  onDownloadMedia: () => Promise<boolean>;
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
  onDownloadMedia,
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

  return (
  <section className="resource-toolkit-card">
    <div className="resource-toolkit-header">
      <div>
        <div className="resource-toolkit-title">当前页捕捉工具</div>
        <div className="resource-toolkit-description">
          这部分对应猫抓 `catch.js` 那类页内缓存捕捉能力，只作用在当前页。
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
        <span>捕获完成后自动导出</span>
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

    <div className="resource-toolkit-actions">
      <button
        type="button"
        className="resource-card-btn"
        disabled={disabled || loading}
        onClick={() => {
          void onDownloadMedia().then((success) => {
            if (success) {
              Toast.success('已触发当前页捕捉导出');
            }
          }).catch((error: any) => {
            Toast.error(error?.message || '导出捕捉结果失败');
          });
        }}
      >
        导出当前捕捉
      </button>
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
  </section>
  );
};

export default EmbeddedBrowserCatchToolkitCard;
