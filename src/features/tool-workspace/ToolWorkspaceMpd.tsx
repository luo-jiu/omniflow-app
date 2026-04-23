import React from 'react';
import styled from 'styled-components';
import {
  Button,
  Empty,
  Popover,
  Select,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/context-menu';
import type { EmbeddedBrowserExternalToolOption } from '@/features/embedded-browser/external-tools/model/embedded-browser-external-tools';

import { formatResourceTitle } from '@/features/embedded-browser/resources/model/embedded-browser-resource-display';
import { isHttpResource } from '@/features/embedded-browser/resources/services/embedded-browser-resource-request';

import type { ToolWorkspaceMediaMpdRequest } from './types';
import {
  ActionRow,
  Panel,
} from './styles';
import type { MpdRepresentationOption, MpdTaskStatus } from './hooks/useMpdDownloadTask';

const MpdMetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  .meta-item {
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 8px;
    padding: 14px;
    background: color-mix(in srgb, var(--app-bg) 84%, var(--app-bg-elevated));
  }

  .meta-label {
    font-size: 14px;
    color: var(--app-text-muted);
    margin-bottom: 6px;
  }

  .meta-value {
    font-size: 16px;
    line-height: 1.6;
    color: var(--app-text);
    word-break: break-word;
  }
`;

const TrackGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  .track-card {
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 8px;
    padding: 14px;
    background: color-mix(in srgb, var(--app-bg) 84%, var(--app-bg-elevated));
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .track-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--app-text);
  }

  .track-desc {
    font-size: 16px;
    line-height: 1.6;
    color: var(--app-text-muted);
  }

  .semi-select {
    width: 100%;
  }
`;

type ToolWorkspaceMpdProps = {
  audioRepresentationOptions: MpdRepresentationOption[];
  disableSaveAction?: boolean;
  mpdRequest: ToolWorkspaceMediaMpdRequest | null;
  mpdTaskStatus: MpdTaskStatus;
  saveActionLabel?: string;
  savingMpd: boolean;
  selectedAudioRepresentationId: string;
  selectedVideoRepresentationId: string;
  videoRepresentationOptions: MpdRepresentationOption[];
  externalToolOptions?: EmbeddedBrowserExternalToolOption[];
  onCopyPlan: () => void;
  onDispatchExternalTool?: (toolKey: EmbeddedBrowserExternalToolOption['key']) => Promise<void>;
  onSaveMpd: () => void;
  onSetSelectedAudioRepresentationId: (value: string) => void;
  onSetSelectedVideoRepresentationId: (value: string) => void;
};

function formatMpdDuration(durationSeconds?: number) {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) {
    return '未知'
  }
  if (durationSeconds < 60) {
    return `${Math.round(durationSeconds)} 秒`
  }
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = Math.round(durationSeconds % 60)
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
}

const ToolWorkspaceMpd: React.FC<ToolWorkspaceMpdProps> = ({
  audioRepresentationOptions,
  disableSaveAction = false,
  mpdRequest,
  mpdTaskStatus,
  saveActionLabel = '下载&保存',
  savingMpd,
  selectedAudioRepresentationId,
  selectedVideoRepresentationId,
  videoRepresentationOptions,
  externalToolOptions = [],
  onCopyPlan,
  onDispatchExternalTool,
  onSaveMpd,
  onSetSelectedAudioRepresentationId,
  onSetSelectedVideoRepresentationId,
}) => {
  const externalToolMenuItems = React.useMemo<ContextMenuItem[]>(() => (
    externalToolOptions.map((tool) => ({
      key: tool.key,
      label: tool.label,
      onClick: () => {
        if (!onDispatchExternalTool) {
          return;
        }
        void onDispatchExternalTool(tool.key).catch((error: any) => {
          Toast.error(error?.message || '发送到外部工具失败');
        });
      },
    }))
  ), [externalToolOptions, onDispatchExternalTool]);
  const canSendToExternalTools = Boolean(
    mpdRequest
    && isHttpResource(mpdRequest.resource)
    && externalToolOptions.length > 0
    && onDispatchExternalTool,
  );

  if (!mpdRequest) {
    return (
      <Panel>
        <Empty
          title="还没有 MPD 计划"
          description="回到资源面板，先对一条 MPD 执行“解析 MPD”，再送到工具页。"
        />
      </Panel>
    )
  }

  const audioCount = mpdRequest.plan.representations.filter((item) => item.contentType === 'audio').length
  const videoCount = mpdRequest.plan.representations.filter((item) => item.contentType === 'video').length
  const canSave = !disableSaveAction && !savingMpd && !mpdRequest.plan.hasDrm && (videoRepresentationOptions.length > 0 || audioRepresentationOptions.length > 0)

  return (
    <>
      <Panel>
        <div className="panel-title">MPD 概览</div>
        <div className="panel-desc">
          这条 MPD 已经展开成可选 Representation。第一版先走最直接的闭环：
          选轨道，落本地分片文件，再交给 ffmpeg 合并成最终产物。
        </div>
        <ActionRow>
          <Tag color="blue">{videoCount} 条视频轨</Tag>
          <Tag color="cyan">{audioCount} 条音轨</Tag>
          <Tag color={mpdRequest.plan.hasDrm ? 'red' : 'green'}>
            {mpdRequest.plan.hasDrm ? '检测到 DRM' : '未检测到 DRM'}
          </Tag>
          <Tag color="grey">{formatMpdDuration(mpdRequest.plan.durationSeconds)}</Tag>
        </ActionRow>
        <MpdMetaGrid>
          <div className="meta-item">
            <div className="meta-label">资源标题</div>
            <div className="meta-value">{formatResourceTitle(mpdRequest.resource)}</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">Manifest 地址</div>
            <div className="meta-value">{mpdRequest.plan.manifestUrl}</div>
          </div>
        </MpdMetaGrid>
      </Panel>

      <Panel>
        <div className="panel-title">轨道选择</div>
        <div className="panel-desc">
          视频轨决定清晰度，独立音轨可按需切换。没有独立音轨时，直接只下视频主轨就够了。
        </div>
        <TrackGrid>
          <div className="track-card">
            <div className="track-title">视频轨</div>
            <div className="track-desc">
              默认会帮你选带宽最高的一条。这里只显示对人有用的分辨率、码率和 codec，不把内部 id 端出来。
            </div>
            {videoRepresentationOptions.length ? (
              <Select
                value={selectedVideoRepresentationId}
                optionList={videoRepresentationOptions}
                placeholder="选择视频轨"
                onChange={(value) => onSetSelectedVideoRepresentationId(String(value || ''))}
              />
            ) : (
              <Tag color="orange">这条 MPD 没有独立视频轨</Tag>
            )}
          </div>

          <div className="track-card">
            <div className="track-title">音轨</div>
            <div className="track-desc">
              有独立音轨时会和视频一起合并；没有的话，就沿用主轨里已有的音频，或者只输出单轨文件。
            </div>
            {audioRepresentationOptions.length ? (
              <Select
                value={selectedAudioRepresentationId}
                optionList={[
                  { label: '不额外合并独立音轨', value: '' },
                  ...audioRepresentationOptions,
                ]}
                placeholder="选择音轨"
                onChange={(value) => onSetSelectedAudioRepresentationId(String(value || ''))}
              />
            ) : (
              <Tag color="grey">没有独立音轨</Tag>
            )}
          </div>
        </TrackGrid>
      </Panel>

      <Panel>
        <div className="panel-title">执行</div>
        <div className="panel-desc">
          这里先不做花哨状态机，就守住最关键的结果：轨道选对，下载完整，ffmpeg 合并成功。
        </div>
        <ActionRow>
          <Button type="primary" loading={savingMpd} disabled={!canSave} onClick={onSaveMpd}>
            {saveActionLabel}
          </Button>
          {canSendToExternalTools ? (
            <Popover
              trigger="click"
              showArrow={false}
              position="bottomLeft"
              content={(
                <ContextMenu
                  items={externalToolMenuItems}
                  className="directory-context-menu"
                />
              )}
            >
              <Button>发送到外部工具</Button>
            </Popover>
          ) : null}
          <Button onClick={onCopyPlan}>复制计划</Button>
          {mpdRequest.plan.hasDrm ? (
            <Tag color="red">DRM 先不处理</Tag>
          ) : null}
        </ActionRow>
        <MpdMetaGrid>
          <div className="meta-item">
            <div className="meta-label">当前状态</div>
            <div className="meta-value">{mpdTaskStatus.message}</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">最近结果</div>
            <div className="meta-value">
              {mpdTaskStatus.error
                ? `失败：${mpdTaskStatus.error}`
                : (mpdTaskStatus.lastOutputPath || '还没有产物路径')}
            </div>
          </div>
        </MpdMetaGrid>
      </Panel>
    </>
  )
}

export default ToolWorkspaceMpd
