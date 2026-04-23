import React from 'react';
import styled from 'styled-components';
import {
  Button,
  Empty,
  Input,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';

import {
  LibraryNodePickerModal,
  type LibraryNodePickerSelection,
} from '@/features/file-explorer';
import type { EmbeddedBrowserCapturedResource } from '@/features/embedded-browser/resources/types';
import {
  createManualMergePair,
  formatBytes,
  formatResourceTitle,
  mergeCapturedResources,
  transcodeCapturedResource,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource-panel-actions';
import { uploadLocalPathAndCreateNode } from '@/features/file-explorer/services/file.api';
import {
  getDesktopDefaultDownloadDirectory,
  pickDownloadDirectoryFromDesktop,
} from '@/features/file-explorer/services/desktop-download.api';
import { findMergeableResourcePair } from '@/features/embedded-browser/resources/model/embedded-browser-resource.presentation';

import ToolWorkspaceHls from './ToolWorkspaceHls';
import ToolWorkspaceSaveTarget from './ToolWorkspaceSaveTarget';
import { useHlsDownloadTask } from './hooks/useHlsDownloadTask';
import type {
  ToolWorkspaceMediaHlsRequest,
  ToolWorkspaceMediaMode,
} from './types';
import {
  Panel,
  WorkspaceBody,
  WorkspaceHeader,
} from './styles';

const MediaResourceList = styled.div`
  border: 1px solid var(--app-border);
  border-radius: 14px;
  overflow: hidden;

  .media-row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 112px 120px 144px;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 72%, transparent);
  }

  .media-row:last-child {
    border-bottom: none;
  }

  .media-title {
    min-width: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--app-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .media-meta {
    font-size: 14px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ToolModeSwitch = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;

  .mode-btn {
    min-height: 42px;
    padding: 0 16px;
    border-radius: 10px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg) 88%, var(--app-bg-elevated));
    color: var(--app-text-muted);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
  }

  .mode-btn.is-active {
    border-color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 82%, var(--app-bg));
    color: var(--app-text);
  }

  .mode-btn:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const MediaActionComposer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;

  .operations-lane {
    display: grid;
    gap: 12px;
  }

  .operations-lane {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  }

  .action-cluster {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    min-height: 64px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
    background: color-mix(in srgb, var(--app-bg) 84%, var(--app-bg-elevated));
  }

  .merge-cluster {
    background: color-mix(in srgb, #f2a93a 8%, var(--app-bg));
  }

  .transcode-cluster {
    background: color-mix(in srgb, #2f6fed 8%, var(--app-bg));
    align-items: center;
  }

  .transcode-controls {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .cluster-label {
    display: inline-flex;
    align-items: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--app-text);
    white-space: nowrap;
  }

  .semi-button {
    min-height: 42px;
    font-size: 15px;
  }

  .semi-tag {
    font-size: 14px;
  }

  .transcode-type-block {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .transcode-format-label {
    font-size: 14px;
    color: var(--app-text-muted);
    white-space: nowrap;
  }

  .transcode-format-input {
    width: 140px;
  }

  .transcode-presets {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .transcode-pill {
    height: 32px;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 999px;
    padding: 0 12px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    background: color-mix(in srgb, var(--app-bg) 86%, var(--app-bg-elevated));
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
  }

  .transcode-pill:hover:not(:disabled) {
    color: var(--app-text);
    border-color: color-mix(in srgb, var(--semi-color-primary) 52%, var(--app-border));
  }

  .transcode-pill.active {
    background: color-mix(in srgb, var(--semi-color-primary) 20%, var(--app-bg-elevated));
    border-color: color-mix(in srgb, var(--semi-color-primary) 68%, transparent);
    color: color-mix(in srgb, var(--semi-color-primary) 86%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--semi-color-primary) 38%, transparent);
  }

  .transcode-pill:disabled {
    cursor: not-allowed;
    opacity: 0.56;
  }

  @media (max-width: 1400px) {
    .operations-lane {
      grid-template-columns: 1fr;
    }
  }
`;

type MediaProcessingToolProps = {
  activeMode: ToolWorkspaceMediaMode;
  hlsRequest: ToolWorkspaceMediaHlsRequest | null;
  libraryId: number;
  onModeChange: (mode: ToolWorkspaceMediaMode) => void;
  resources: EmbeddedBrowserCapturedResource[];
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
};

type MediaSaveTargetType = 'local' | 'internal';

function normalizeMediaTranscodeFormat(input: string) {
  const normalized = String(input || '').trim().replace(/^\.+/, '').toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

const ToolWorkspaceMedia: React.FC<MediaProcessingToolProps> = ({
  activeMode,
  hlsRequest,
  libraryId,
  onModeChange,
  onRefreshDirectory,
  resources,
}) => {
  const [merging, setMerging] = React.useState(false);
  const [transcoding, setTranscoding] = React.useState(false);
  const [transcodeFormatDraft, setTranscodeFormatDraft] = React.useState('m4a');
  const [saveTargetType, setSaveTargetType] = React.useState<MediaSaveTargetType>('local');
  const [localOutputDirectory, setLocalOutputDirectory] = React.useState('');
  const [defaultLocalOutputDirectory, setDefaultLocalOutputDirectory] = React.useState('');
  const [internalDirectory, setInternalDirectory] = React.useState<LibraryNodePickerSelection | null>(null);
  const [internalPickerVisible, setInternalPickerVisible] = React.useState(false);
  const [internalPathRequired, setInternalPathRequired] = React.useState(false);

  const mergePair = React.useMemo(() => (
    createManualMergePair(resources) || findMergeableResourcePair(resources)
  ), [resources]);

  const isLocalSaveTarget = saveTargetType === 'local';
  const internalTargetMissing = saveTargetType === 'internal' && !internalDirectory;
  const localOutputPathHint = localOutputDirectory || defaultLocalOutputDirectory || '默认下载目录';

  React.useEffect(() => {
    let cancelled = false;
    void getDesktopDefaultDownloadDirectory()
      .then((directoryPath) => {
        if (!cancelled && directoryPath) {
          setDefaultLocalOutputDirectory(directoryPath);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setInternalDirectory(null);
    setInternalPickerVisible(false);
    setInternalPathRequired(false);
  }, [libraryId]);

  React.useEffect(() => {
    if (saveTargetType !== 'internal' || internalDirectory) {
      setInternalPathRequired(false);
    }
  }, [internalDirectory, saveTargetType]);

  const persistMediaOutputBySaveTarget = React.useCallback(async (
    outputPath: string,
    actionName: '合并' | '转格式' | 'HLS 下载',
  ) => {
    if (saveTargetType === 'local') {
      Toast.success(`已完成${actionName}，文件已保存到本地：${localOutputPathHint}`);
      return;
    }
    if (!internalDirectory) {
      throw new Error('请选择内部保存目录');
    }
    try {
      await uploadLocalPathAndCreateNode(outputPath, internalDirectory.node.id, libraryId, {
        conflictPolicy: 'auto_rename',
      });
      try {
        await onRefreshDirectory?.(internalDirectory.node.id);
      } catch (error: any) {
        Toast.warning(error?.message || '目录刷新失败，请稍后手动刷新目录树');
      }
      Toast.success(`已完成${actionName}，并保存到内部目录：${internalDirectory.pathLabel}`);
    } catch (error: any) {
      Toast.error(
        error?.message
          ? `已完成${actionName}，但上传到库内失败：${error.message}`
          : `已完成${actionName}，但上传到库内失败`,
      );
    }
  }, [internalDirectory, libraryId, localOutputPathHint, onRefreshDirectory, saveTargetType]);

  const hlsTask = useHlsDownloadTask({
    hlsRequest,
    outputDirectoryPath: saveTargetType === 'local' && localOutputDirectory
      ? localOutputDirectory
      : undefined,
    onPersistOutput: async (outputPath) => persistMediaOutputBySaveTarget(outputPath, 'HLS 下载'),
  });

  const handlePickLocalOutputDirectory = React.useCallback(async () => {
    try {
      const result = await pickDownloadDirectoryFromDesktop();
      if (result.canceled || !result.directoryPath) {
        return;
      }
      setLocalOutputDirectory(result.directoryPath);
      Toast.success('已选择本地保存目录');
    } catch (error: any) {
      Toast.error(error?.message || '选择本地目录失败');
    }
  }, []);

  const handleMerge = React.useCallback(async () => {
    if (!mergePair) {
      Toast.warning('需要一条视频和一条音频，或可识别的 MSE 音视频流');
      return;
    }
    if (saveTargetType === 'internal' && !internalDirectory) {
      setInternalPathRequired(true);
      Toast.warning('内部保存路径必须选择');
      return;
    }
    setMerging(true);
    try {
      const result = await mergeCapturedResources(mergePair, {
        outputDirectoryPath: saveTargetType === 'local' && localOutputDirectory
          ? localOutputDirectory
          : undefined,
        suppressSuccessToast: true,
        useSystemSaveDialog: false,
      });
      if (result?.cancelled) {
        return;
      }
      if (!result?.outputPath) {
        throw new Error('合并已完成，但未返回输出路径');
      }
      await persistMediaOutputBySaveTarget(result.outputPath, '合并');
    } catch (error: any) {
      Toast.error(error?.message || '合并失败');
    } finally {
      setMerging(false);
    }
  }, [internalDirectory, localOutputDirectory, mergePair, persistMediaOutputBySaveTarget, saveTargetType]);

  const handleTranscode = React.useCallback(async () => {
    if (resources.length === 0) {
      Toast.warning('先从资源面板送入要处理的媒体');
      return;
    }
    if (resources.length > 1) {
      Toast.warning('转格式先支持单个媒体资源；多条资源请先只勾选一条');
      return;
    }
    const [resource] = resources;
    if (!resource) {
      return;
    }
    if (saveTargetType === 'internal' && !internalDirectory) {
      setInternalPathRequired(true);
      Toast.warning('内部保存路径必须选择');
      return;
    }
    const outputFormat = normalizeMediaTranscodeFormat(transcodeFormatDraft);
    if (!outputFormat) {
      Toast.warning('请输入 1-12 位字母或数字格式，例如 mp3、m4a、mp4');
      return;
    }
    setTranscoding(true);
    try {
      const result = await transcodeCapturedResource(resource, outputFormat, {
        outputDirectoryPath: saveTargetType === 'local' && localOutputDirectory
          ? localOutputDirectory
          : undefined,
        suppressSuccessToast: true,
        useSystemSaveDialog: false,
      });
      if (result?.cancelled) {
        return;
      }
      if (!result?.outputPath) {
        throw new Error('转格式已完成，但未返回输出路径');
      }
      await persistMediaOutputBySaveTarget(result.outputPath, '转格式');
    } catch (error: any) {
      Toast.error(error?.message || '转格式失败');
    } finally {
      setTranscoding(false);
    }
  }, [
    internalDirectory,
    localOutputDirectory,
    persistMediaOutputBySaveTarget,
    resources,
    saveTargetType,
    transcodeFormatDraft,
  ]);

  const handleTranscodeFormatChange = React.useCallback((value: string) => {
    setTranscodeFormatDraft(String(value || '').trimStart().replace(/^\.+/, '').slice(0, 12));
  }, []);

  const normalizedTranscodeFormat = React.useMemo(() => (
    normalizeMediaTranscodeFormat(transcodeFormatDraft) || ''
  ), [transcodeFormatDraft]);

  const toggleSaveTargetType = React.useCallback(() => {
    setSaveTargetType((current) => (current === 'local' ? 'internal' : 'local'));
  }, []);

  const handlePickSavePath = React.useCallback(() => {
    if (saveTargetType === 'local') {
      void handlePickLocalOutputDirectory();
      return;
    }
    setInternalPickerVisible(true);
  }, [handlePickLocalOutputDirectory, saveTargetType]);

  const savePathDisplay = saveTargetType === 'local'
    ? localOutputPathHint
    : (internalDirectory?.pathLabel || '');

  return (
    <>
      <WorkspaceHeader>
        <div className="header-copy">
          <div className="header-title">媒体处理</div>
          <div className="header-desc">
            侧边资源面板只负责发现和发起，真正的下载、合并、转格式这类重处理都收在这里。当前先接两条主线：
            直接资源处理，以及 HLS 计划处理。
          </div>
        </div>
        <div className="header-tags">
          <Tag color="blue">工作区模式</Tag>
          <Tag color="green">本地 ffmpeg</Tag>
          {activeMode === 'resources' ? (
            <Tag color="cyan">{resources.length} 条资源</Tag>
          ) : (
            <Tag color="cyan">{hlsRequest?.plan.fragmentCount || 0} 个分片</Tag>
          )}
        </div>
      </WorkspaceHeader>

      <WorkspaceBody>
        <Panel>
          <div className="panel-title">处理模式</div>
          <div className="panel-desc">
            同一个媒体处理壳里分两条路：直接资源保留现在的合并与转格式；HLS 计划承接 manifest 解析后的下载任务，
            后面 MPD 也会沿这条路继续长。
          </div>
          <ToolModeSwitch>
            <button
              type="button"
              className={`mode-btn ${activeMode === 'resources' ? 'is-active' : ''}`}
              disabled={resources.length === 0}
              onClick={() => onModeChange('resources')}
            >
              直接资源
            </button>
            <button
              type="button"
              className={`mode-btn ${activeMode === 'hls-download' ? 'is-active' : ''}`}
              disabled={!hlsRequest}
              onClick={() => onModeChange('hls-download')}
            >
              HLS 计划
            </button>
          </ToolModeSwitch>
        </Panel>

        <ToolWorkspaceSaveTarget
          internalPathRequired={internalPathRequired}
          internalTargetMissing={internalTargetMissing}
          isLocalSaveTarget={isLocalSaveTarget}
          onPickSavePath={handlePickSavePath}
          onToggleSaveTargetType={toggleSaveTargetType}
          savePathDisplay={savePathDisplay}
          saveTargetType={saveTargetType}
        />

        {activeMode === 'resources' ? (
          <>
            <Panel>
              <div className="panel-title">处理动作</div>
              <div className="panel-desc">
                这里先承接已经抓到的单个或成对媒体资源。类型输入仅支持 1-12 位字母或数字
                （例如 mp3、m4a、mp4）；ffmpeg 不支持时会直接报错。
              </div>
              <MediaActionComposer>
                <div className="operations-lane">
                  <div className="action-cluster merge-cluster">
                    <Button loading={merging} disabled={!mergePair} type="primary" onClick={() => void handleMerge()}>
                      合并&保存
                    </Button>
                    <span className={`merge-status ${mergePair ? 'ok' : ''}`}>
                      {mergePair ? '已识别可合并音视频' : '未识别到可合并组合'}
                    </span>
                  </div>
                  <div className="action-cluster transcode-cluster">
                    <span className="cluster-label">转格式</span>
                    <div className="transcode-controls">
                      <div className="transcode-type-block">
                        <span className="transcode-format-label">类型</span>
                        <Input
                          className="transcode-format-input"
                          value={transcodeFormatDraft}
                          placeholder="mp3 / m4a / mp4"
                          onChange={handleTranscodeFormatChange}
                        />
                      </div>
                      <div className="transcode-presets">
                        {['m4a', 'mp3', 'mp4'].map((format) => (
                          <button
                            key={format}
                            type="button"
                            className={`transcode-pill ${normalizedTranscodeFormat === format ? 'active' : ''}`}
                            disabled={transcoding}
                            onClick={() => setTranscodeFormatDraft(format)}
                          >
                            {format}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button loading={transcoding} disabled={resources.length === 0} onClick={() => void handleTranscode()}>
                      转换&保存
                    </Button>
                  </div>
                </div>
              </MediaActionComposer>
            </Panel>

            <Panel>
              <div className="panel-title">已送入资源</div>
              <div className="panel-desc">
                这里不重新筛选、不改后缀、不替换资源，只展示从抓包面板送来的原始条目。
              </div>
              {resources.length === 0 ? (
                <Empty
                  title="还没有媒体资源"
                  description="回到浏览器资源面板，勾选资源后点击“处理已选”。"
                />
              ) : (
                <MediaResourceList>
                  {resources.map((resource) => (
                    <div className="media-row" key={resource.id}>
                      <div className="media-title" title={resource.url}>{formatResourceTitle(resource)}</div>
                      <div className="media-meta">{resource.streamType || resource.kind}</div>
                      <div className="media-meta">{resource.contentLength ? formatBytes(resource.contentLength) : '未知大小'}</div>
                      <div className="media-meta">{resource.source}{resource.ext ? ` · .${resource.ext}` : ''}</div>
                    </div>
                  ))}
                </MediaResourceList>
              )}
            </Panel>
          </>
        ) : (
          <ToolWorkspaceHls
            canSelectVariant={hlsTask.canSelectVariant}
            canTuneLocalDownloader={hlsTask.canTuneLocalDownloader}
            hlsAes128KeyCount={hlsTask.hlsAes128KeyCount}
            hlsAudioRenditions={hlsTask.hlsAudioRenditions}
            hlsKeyVerificationResult={hlsTask.hlsKeyVerificationResult}
            hlsManualKeyDraft={hlsTask.hlsManualKeyDraft}
            hlsManualKeyInputMode={hlsTask.hlsManualKeyInputMode}
            hlsManualKeyInvalid={hlsTask.hlsManualKeyInvalid}
            hlsNonAesKeyCount={hlsTask.hlsNonAesKeyCount}
            hlsRangeEnd={hlsTask.hlsRangeEnd}
            hlsRangeStart={hlsTask.hlsRangeStart}
            hlsRequest={hlsTask.hlsRequest}
            hlsSelectedVariant={hlsTask.hlsSelectedVariant}
            hlsSelectedVariantLabel={hlsTask.hlsSelectedVariantLabel}
            hlsSubtitleRenditions={hlsTask.hlsSubtitleRenditions}
            hlsTaskProgressPercent={hlsTask.hlsTaskProgressPercent}
            hlsTaskProgressSummary={hlsTask.hlsTaskProgressSummary}
            hlsTaskStatus={hlsTask.hlsTaskStatus}
            hlsThreadCount={hlsTask.hlsThreadCount}
            hlsUsingCustomThreadCount={hlsTask.hlsUsingCustomThreadCount}
            hlsUsingFragmentRange={hlsTask.hlsUsingFragmentRange}
            hlsVariantOptions={hlsTask.hlsVariantOptions}
            normalizedHlsManualKey={hlsTask.normalizedHlsManualKey}
            savingHls={hlsTask.savingHls}
            selectedHlsVariantUrl={hlsTask.selectedHlsVariantUrl}
            verifyingHlsKey={hlsTask.verifyingHlsKey}
            onCopyFailedFragments={() => {
              void navigator.clipboard.writeText((hlsTask.hlsTaskStatus.failedFragments || []).map((value) => `#${value}`).join(', ')).then(() => {
                Toast.success('失败分片编号已复制');
              });
            }}
            onCopyPlan={() => {
              if (!hlsTask.hlsRequest) {
                return;
              }
              void navigator.clipboard.writeText(JSON.stringify(hlsTask.hlsRequest.plan, null, 2)).then(() => {
                Toast.success('HLS 计划 JSON 已复制');
              });
            }}
            onRetryFailed={hlsTask.handlers.onRetryFailed}
            onSaveHls={hlsTask.handlers.onSaveHls}
            onSetHlsManualKeyDraft={hlsTask.handlers.onSetHlsManualKeyDraft}
            onSetHlsRangeEnd={hlsTask.handlers.onSetHlsRangeEnd}
            onSetHlsRangeStart={hlsTask.handlers.onSetHlsRangeStart}
            onSetHlsThreadCount={hlsTask.handlers.onSetHlsThreadCount}
            onSetSelectedHlsVariantUrl={hlsTask.handlers.onSetSelectedHlsVariantUrl}
            onVerifyHlsKey={hlsTask.handlers.onVerifyHlsKey}
          />
        )}
      </WorkspaceBody>

      <LibraryNodePickerModal
        visible={internalPickerVisible}
        libraryId={libraryId}
        displayMode="folders"
        title="选择保存位置"
        confirmText="选择此位置"
        onCancel={() => setInternalPickerVisible(false)}
        onConfirm={(selection) => {
          setInternalDirectory(selection);
          setInternalPathRequired(false);
          setInternalPickerVisible(false);
        }}
      />
    </>
  );
};

export default ToolWorkspaceMedia;
