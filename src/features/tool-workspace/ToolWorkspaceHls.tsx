import React from 'react';
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Select,
  Tag,
} from '@douyinfe/semi-ui';

import {
  describeEmbeddedBrowserHlsKeyVerificationResult,
  getEmbeddedBrowserHlsKeyVerificationTone,
  type EmbeddedBrowserHlsKeyVerificationResult,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-key-verifier';
import { formatResourceTitle } from '@/features/embedded-browser/resources/model/embedded-browser-resource-display';

import type {
  ToolWorkspaceMediaHlsRequest,
} from './types';
import {
  ActionRow,
  Panel,
} from './styles';

type HlsTaskStage = 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'ffmpeg' | 'completed' | 'error';

type HlsTaskLogEntry = {
  createdAt: number;
  id: string;
  level: 'error' | 'info' | 'success';
  mode?: 'direct-manifest' | 'local-plan';
  stage?: HlsTaskStage;
  text: string;
};

type HlsTaskStatus = {
  bytesReceived?: number;
  bytesTotal?: number;
  completedFragments: number;
  durationSeconds?: number;
  error?: string;
  etaSeconds?: number;
  ffmpegSpeedText?: string;
  failedFragments?: number[];
  lastOutputPath?: string;
  logs: HlsTaskLogEntry[];
  mode?: 'direct-manifest' | 'local-plan';
  processedSeconds?: number;
  requestId?: string;
  speedBps?: number;
  stage?: HlsTaskStage;
  state: 'idle' | 'running' | 'success' | 'error';
  totalFragments: number;
};

type HlsVariantOption = {
  label: string;
  value: string;
};

type HlsRenditionOption = {
  groupId?: string;
  label: string;
  value: string;
};

type ToolWorkspaceHlsProps = {
  canSelectVariant: boolean;
  canTuneLocalDownloader: boolean;
  hlsAes128KeyCount: number;
  hlsAudioRenditions: ToolWorkspaceMediaHlsRequest['plan']['renditions'];
  hlsAudioRenditionOptions: HlsRenditionOption[];
  hlsKeyVerificationResult: EmbeddedBrowserHlsKeyVerificationResult | null;
  hlsManualKeyDraft: string;
  hlsManualKeyInputMode: string;
  hlsManualKeyInvalid: boolean;
  hlsNonAesKeyCount: number;
  hlsRangeEnd: number;
  hlsRangeStart: number;
  hlsRequest: ToolWorkspaceMediaHlsRequest | null;
  hlsSelectedAudioRendition: ToolWorkspaceMediaHlsRequest['plan']['renditions'][number] | null;
  hlsSelectedSubtitleRendition: ToolWorkspaceMediaHlsRequest['plan']['renditions'][number] | null;
  hlsSelectedVariant: ToolWorkspaceMediaHlsRequest['plan']['variants'][number] | null;
  hlsSelectedVariantLabel: string;
  hlsSubtitleRenditions: ToolWorkspaceMediaHlsRequest['plan']['renditions'];
  hlsSubtitleRenditionOptions: HlsRenditionOption[];
  hlsTaskProgressPercent: number;
  hlsTaskProgressSummary: string;
  hlsTaskStatus: HlsTaskStatus;
  hlsThreadCount: number;
  hlsUsingCustomThreadCount: boolean;
  hlsUsingFragmentRange: boolean;
  hlsVariantOptions: HlsVariantOption[];
  normalizedHlsManualKey: string;
  savingHls: boolean;
  selectedHlsAudioRenditionUrl: string;
  selectedHlsSubtitleRenditionUrl: string;
  selectedHlsVariantUrl: string;
  verifyingHlsKey: boolean;
  onCopyFailedFragments: () => void;
  onCopyPlan: () => void;
  onDownloadSelectedSubtitle: () => void;
  onRetryFailed: () => void;
  onSaveHls: () => void;
  onSetSelectedHlsAudioRenditionUrl: (value: string) => void;
  onSetSelectedHlsSubtitleRenditionUrl: (value: string) => void;
  onSetHlsManualKeyDraft: (value: string) => void;
  onSetHlsRangeEnd: (value: number) => void;
  onSetHlsRangeStart: (value: number) => void;
  onSetHlsThreadCount: (value: number) => void;
  onSetSelectedHlsVariantUrl: (value: string) => void;
  onVerifyHlsKey: () => void;
};

function formatHlsRenditionLabel(rendition: {
  autoselect?: boolean;
  default?: boolean;
  forced?: boolean;
  groupId?: string;
  language?: string;
  name?: string;
  type?: string;
}) {
  const parts: string[] = [];
  if (rendition.name) {
    parts.push(rendition.name);
  }
  if (rendition.language) {
    parts.push(rendition.language);
  }
  if (rendition.groupId) {
    parts.push(`group:${rendition.groupId}`);
  }
  if (rendition.default) {
    parts.push('default');
  }
  if (rendition.autoselect) {
    parts.push('autoselect');
  }
  if (rendition.forced) {
    parts.push('forced');
  }
  return parts.join(' · ') || rendition.type || '未命名轨道';
}

function formatHlsTaskStageLabel(stage?: HlsTaskStage) {
  switch (stage) {
    case 'preparing':
      return '准备任务';
    case 'downloading-fragments':
      return '下载分片';
    case 'rewriting-playlist':
      return '重写本地播放列表';
    case 'ffmpeg':
      return 'ffmpeg 合成';
    case 'completed':
      return '已完成';
    case 'error':
      return '执行失败';
    default:
      return '尚未开始';
  }
}

function formatHlsTaskModeLabel(mode?: HlsTaskStatus['mode']) {
  switch (mode) {
    case 'local-plan':
      return '本地 downloader';
    case 'direct-manifest':
      return 'ffmpeg 直拉';
    default:
      return '-';
  }
}

function formatHlsTaskLogTime(timestamp: number) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function formatFailedFragmentList(failedFragments: number[]) {
  return failedFragments.map((value) => `#${value}`).join(', ');
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let nextValue = value;
  while (nextValue >= 1024 && index < units.length - 1) {
    nextValue /= 1024;
    index += 1;
  }
  return `${nextValue >= 10 || index === 0 ? nextValue.toFixed(0) : nextValue.toFixed(1)} ${units[index]}`;
}

function formatEtaSeconds(seconds?: number) {
  if (!seconds || seconds <= 0) {
    return '';
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) {
    return remainSeconds ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours}h ${remainMinutes}m` : `${hours}h`;
}

const ToolWorkspaceHls: React.FC<ToolWorkspaceHlsProps> = ({
  canSelectVariant,
  canTuneLocalDownloader,
  hlsAes128KeyCount,
  hlsAudioRenditions,
  hlsAudioRenditionOptions,
  hlsKeyVerificationResult,
  hlsManualKeyDraft,
  hlsManualKeyInputMode,
  hlsManualKeyInvalid,
  hlsNonAesKeyCount,
  hlsRangeEnd,
  hlsRangeStart,
  hlsRequest,
  hlsSelectedAudioRendition,
  hlsSelectedSubtitleRendition,
  hlsSelectedVariant,
  hlsSelectedVariantLabel,
  hlsSubtitleRenditions,
  hlsSubtitleRenditionOptions,
  hlsTaskProgressPercent,
  hlsTaskProgressSummary,
  hlsTaskStatus,
  hlsThreadCount,
  hlsUsingCustomThreadCount,
  hlsUsingFragmentRange,
  hlsVariantOptions,
  normalizedHlsManualKey,
  onCopyFailedFragments,
  onCopyPlan,
  onDownloadSelectedSubtitle,
  onRetryFailed,
  onSaveHls,
  onSetSelectedHlsAudioRenditionUrl,
  onSetSelectedHlsSubtitleRenditionUrl,
  onSetHlsManualKeyDraft,
  onSetHlsRangeEnd,
  onSetHlsRangeStart,
  onSetHlsThreadCount,
  onSetSelectedHlsVariantUrl,
  onVerifyHlsKey,
  savingHls,
  selectedHlsAudioRenditionUrl,
  selectedHlsSubtitleRenditionUrl,
  selectedHlsVariantUrl,
  verifyingHlsKey,
}) => {
  if (!hlsRequest) {
    return (
      <Panel>
        <Empty
          title="还没有 HLS 计划"
          description="先回到资源面板解析 HLS，然后点击“送到工具页”。"
        />
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="panel-title">HLS 计划摘要</div>
      <div className="panel-desc">
        这里显示从资源面板解析后送来的 HLS 下载计划。网络 manifest 继续走 ffmpeg 主链；
        blob 或页内内存 manifest 现在会走本地 downloader + 本地 playlist + ffmpeg。
      </div>
      <ActionRow>
        <Tag color="light-blue">{hlsRequest.plan.isMaster ? 'Master playlist' : 'Media playlist'}</Tag>
        <Tag color={hlsRequest.plan.isLive ? 'orange' : 'green'}>{hlsRequest.plan.isLive ? '直播' : '点播'}</Tag>
        <Tag color="cyan">{hlsRequest.plan.fragmentCount} 个分片</Tag>
        <Tag color="grey">keys {hlsRequest.plan.keys.length}</Tag>
        <Tag color="grey">maps {hlsRequest.plan.maps.length}</Tag>
        <Tag color="grey">parts {hlsRequest.plan.partCount}</Tag>
        <Tag color="grey">建议线程 {hlsRequest.plan.suggestedThreadCount}</Tag>
      </ActionRow>
      <ActionRow>
        <Tag color="white">来源：{formatResourceTitle(hlsRequest.resource)}</Tag>
        <Tag color="white">{Math.round(hlsRequest.plan.durationSeconds)}s</Tag>
      </ActionRow>
      <ActionRow>
        <Tag color={hlsAes128KeyCount > 0 ? 'orange' : 'green'}>
          {hlsAes128KeyCount > 0 ? `AES-128 key ${hlsAes128KeyCount}` : '无 AES-128 key'}
        </Tag>
        <Tag color={hlsRequest.plan.maps.length > 0 ? 'blue' : 'grey'}>
          {hlsRequest.plan.maps.length > 0 ? '含 init segment / map' : '无 map'}
        </Tag>
        {hlsNonAesKeyCount > 0 ? (
          <Tag color="red">存在 {hlsNonAesKeyCount} 个非 AES-128 key，当前主链未完整覆盖</Tag>
        ) : null}
        {hlsKeyVerificationResult?.mediaAlreadyReadable ? (
          <Tag color="green">片段本身可读</Tag>
        ) : null}
        {hlsKeyVerificationResult?.ok && hlsKeyVerificationResult.candidate ? (
          <Tag color="green">已验证可用 key</Tag>
        ) : hlsKeyVerificationResult?.reason === 'no-candidates' ? (
          <Tag color="orange">还没有 key 候选</Tag>
        ) : hlsKeyVerificationResult?.reason === 'no-match' ? (
          <Tag color="orange">候选 key 未命中</Tag>
        ) : hlsKeyVerificationResult?.reason === 'no-aes-segment' ? (
          <Tag color="grey">不需要验证 key</Tag>
        ) : null}
      </ActionRow>
      {canSelectVariant ? (
        <>
          <div className="panel-desc" style={{ marginBottom: 10 }}>
            这是一个网络 master playlist。默认保持“自动”让 ffmpeg 自己选；如果你想明确锁到某个清晰度，可以在这里指定变体。
          </div>
          <ActionRow>
            <Select
              value={selectedHlsVariantUrl || undefined}
              placeholder="自动（沿用原始 manifest）"
              onChange={(value) => onSetSelectedHlsVariantUrl(String(value || ''))}
              style={{ minWidth: 320 }}
            >
              <Select.Option value="">自动（沿用原始 manifest）</Select.Option>
              {hlsVariantOptions.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
            {selectedHlsVariantUrl ? (
              <Tag color="blue">已锁定变体</Tag>
            ) : (
              <Tag color="grey">自动选清晰度</Tag>
            )}
          </ActionRow>
        </>
      ) : null}
      {(hlsAudioRenditions.length || hlsSubtitleRenditions.length || hlsSelectedVariant) ? (
        <>
          <div className="panel-desc" style={{ marginBottom: 10 }}>
            这块是 `master playlist` 里的轨道视图。现在可以在这里锁定独立音轨，并把字幕轨单独下载；音轨选择会尽量跟着当前变体的 group 关系走。
          </div>
          {hlsSelectedVariant ? (
            <ActionRow>
              {hlsSelectedVariant.audioGroupId ? (
                <Tag color="blue">音轨组：{hlsSelectedVariant.audioGroupId}</Tag>
              ) : (
                <Tag color="grey">当前变体未声明音轨组</Tag>
              )}
              {hlsSelectedVariant.subtitlesGroupId ? (
                <Tag color="purple">字幕组：{hlsSelectedVariant.subtitlesGroupId}</Tag>
              ) : (
                <Tag color="grey">当前变体未声明字幕组</Tag>
              )}
            </ActionRow>
          ) : null}
          {hlsAudioRenditions.length ? (
            <>
              <div className="panel-desc" style={{ marginBottom: 8 }}>音轨候选</div>
              {hlsAudioRenditionOptions.length ? (
                <ActionRow>
                  <Select
                    value={selectedHlsAudioRenditionUrl || undefined}
                    placeholder="自动（沿用默认音轨）"
                    onChange={(value) => onSetSelectedHlsAudioRenditionUrl(String(value || ''))}
                    style={{ minWidth: 320 }}
                  >
                    <Select.Option value="">自动（沿用默认音轨）</Select.Option>
                    {hlsAudioRenditionOptions.map((option) => (
                      <Select.Option key={option.value} value={option.value}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                  {hlsSelectedAudioRendition ? (
                    <Tag color="blue">已选独立音轨</Tag>
                  ) : (
                    <Tag color="grey">默认音轨策略</Tag>
                  )}
                </ActionRow>
              ) : null}
              <ActionRow>
                {hlsAudioRenditions.map((rendition, index) => (
                  <Tag
                    key={`audio-${rendition.groupId || 'none'}-${rendition.name || index}`}
                    color={hlsSelectedAudioRendition?.url === rendition.url
                      ? 'blue'
                      : hlsSelectedVariant?.audioGroupId && rendition.groupId === hlsSelectedVariant.audioGroupId
                        ? 'cyan'
                        : 'white'}
                  >
                    {formatHlsRenditionLabel(rendition)}
                  </Tag>
                ))}
              </ActionRow>
            </>
          ) : null}
          {hlsSubtitleRenditions.length ? (
            <>
              <div className="panel-desc" style={{ marginBottom: 8 }}>字幕候选</div>
              {hlsSubtitleRenditionOptions.length ? (
                <ActionRow>
                  <Select
                    value={selectedHlsSubtitleRenditionUrl || undefined}
                    placeholder="不下载字幕轨"
                    onChange={(value) => onSetSelectedHlsSubtitleRenditionUrl(String(value || ''))}
                    style={{ minWidth: 320 }}
                  >
                    <Select.Option value="">不下载字幕轨</Select.Option>
                    {hlsSubtitleRenditionOptions.map((option) => (
                      <Select.Option key={option.value} value={option.value}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                  {hlsSelectedSubtitleRendition ? (
                    <Button onClick={onDownloadSelectedSubtitle}>下载字幕轨</Button>
                  ) : (
                    <Tag color="grey">未选择字幕轨</Tag>
                  )}
                </ActionRow>
              ) : null}
              <ActionRow>
                {hlsSubtitleRenditions.map((rendition, index) => (
                  <Tag
                    key={`sub-${rendition.groupId || 'none'}-${rendition.name || index}`}
                    color={hlsSelectedSubtitleRendition?.url === rendition.url
                      ? 'purple'
                      : hlsSelectedVariant?.subtitlesGroupId && rendition.groupId === hlsSelectedVariant.subtitlesGroupId
                        ? 'violet'
                        : 'white'}
                  >
                    {formatHlsRenditionLabel(rendition)}
                  </Tag>
                ))}
              </ActionRow>
            </>
          ) : null}
        </>
      ) : null}
      {canTuneLocalDownloader ? (
        <>
          <div className="panel-desc" style={{ marginBottom: 10 }}>
            这是 Cat Catch 那套最常用的下载控制。当前先补线程数和分片范围；一旦改了这里，就会切到本地 downloader 主链，不再让 ffmpeg 直接拉整条 manifest。
          </div>
          <ActionRow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 16, color: 'var(--app-text-muted)' }}>线程数</div>
              <InputNumber
                min={1}
                max={32}
                step={1}
                value={hlsThreadCount}
                onNumberChange={(value) => onSetHlsThreadCount(Number(value || 1))}
                style={{ width: 140 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 16, color: 'var(--app-text-muted)' }}>起始分片</div>
              <InputNumber
                min={1}
                max={Math.max(1, hlsRequest.plan.fragmentCount)}
                step={1}
                value={hlsRangeStart}
                onNumberChange={(value) => onSetHlsRangeStart(Number(value || 1))}
                style={{ width: 140 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 16, color: 'var(--app-text-muted)' }}>结束分片</div>
              <InputNumber
                min={1}
                max={Math.max(1, hlsRequest.plan.fragmentCount)}
                step={1}
                value={hlsRangeEnd}
                onNumberChange={(value) => onSetHlsRangeEnd(Number(value || 1))}
                style={{ width: 140 }}
              />
            </div>
            <Tag color={hlsUsingCustomThreadCount ? 'blue' : 'grey'}>
              线程 {hlsThreadCount}
            </Tag>
            <Tag color={hlsUsingFragmentRange ? 'orange' : 'grey'}>
              范围 #{hlsRangeStart}-#{hlsRangeEnd}
            </Tag>
          </ActionRow>
        </>
      ) : null}
      <div className="panel-desc" style={{ marginBottom: 10 }}>
        如果站点的 AES-128 key 没被自动识别，可以在这里手动粘贴 16 字节 key。
        支持 32 位 hex，或 16 字节 base64。填写后会自动切到本地 downloader 主链。
        目前 master playlist 还不支持直接带手动 key 落本地主链，需要先收敛到具体媒体 playlist。
      </div>
      <ActionRow>
        <Input
          value={hlsManualKeyDraft}
          placeholder="可选：输入 16 字节 AES-128 key（hex / base64）"
          onChange={(value) => onSetHlsManualKeyDraft(value)}
        />
        {hlsManualKeyDraft ? (
          <Button onClick={() => onSetHlsManualKeyDraft('')}>
            清空 key
          </Button>
        ) : null}
        {normalizedHlsManualKey ? (
          <Tag color="green">已识别自定义 key（{hlsManualKeyInputMode || 'base64'}）</Tag>
        ) : hlsManualKeyInvalid ? (
          <Tag color="red">key 格式无效</Tag>
        ) : null}
      </ActionRow>
      <ActionRow>
        <Button
          disabled={hlsAes128KeyCount === 0}
          loading={verifyingHlsKey}
          onClick={onVerifyHlsKey}
        >
          {verifyingHlsKey ? '验证中' : '验证 key'}
        </Button>
        <Button loading={savingHls} type="primary" onClick={onSaveHls}>
          下载&保存
        </Button>
        <Button
          disabled={savingHls || hlsTaskStatus.state === 'running'}
          onClick={onRetryFailed}
        >
          {hlsTaskStatus.state === 'error'
            && hlsTaskStatus.mode === 'local-plan'
            && hlsTaskStatus.failedFragments?.length
            ? '重试失败分片'
            : hlsTaskStatus.state === 'error'
              ? '重试失败任务'
              : '重新执行'}
        </Button>
        <Button onClick={onCopyPlan}>
          复制计划
        </Button>
        {hlsTaskStatus.failedFragments?.length ? (
          <Button onClick={onCopyFailedFragments}>
            复制失败分片
          </Button>
        ) : null}
        <Tag color={!/^https?:\/\//i.test(selectedHlsVariantUrl || hlsRequest.plan.manifestUrl) || normalizedHlsManualKey || hlsUsingCustomThreadCount || hlsUsingFragmentRange ? 'orange' : 'green'}>
          {!/^https?:\/\//i.test(selectedHlsVariantUrl || hlsRequest.plan.manifestUrl) || normalizedHlsManualKey || hlsUsingCustomThreadCount || hlsUsingFragmentRange ? '本地 downloader 主链' : '网络 manifest 主链'}
        </Tag>
        {selectedHlsVariantUrl ? (
          <Tag color="white">
            <span title={hlsSelectedVariantLabel || selectedHlsVariantUrl}>
              变体：{hlsSelectedVariantLabel || selectedHlsVariantUrl}
            </span>
          </Tag>
        ) : null}
        {hlsSelectedAudioRendition ? (
          <Tag color="blue">音轨：{formatHlsRenditionLabel(hlsSelectedAudioRendition)}</Tag>
        ) : null}
        {hlsSelectedSubtitleRendition ? (
          <Tag color="purple">字幕：{formatHlsRenditionLabel(hlsSelectedSubtitleRendition)}</Tag>
        ) : null}
      </ActionRow>
      <ActionRow>
        <Tag color={hlsTaskStatus.state === 'success' ? 'green' : hlsTaskStatus.state === 'error' ? 'red' : hlsTaskStatus.state === 'running' ? 'blue' : 'grey'}>
          {hlsTaskStatus.state === 'success'
            ? '执行成功'
            : hlsTaskStatus.state === 'error'
              ? '执行失败'
              : hlsTaskStatus.state === 'running'
                ? '执行中'
                : '尚未执行'}
        </Tag>
        {hlsTaskStatus.stage ? (
          <Tag color="white">阶段：{formatHlsTaskStageLabel(hlsTaskStatus.stage)}</Tag>
        ) : null}
        {hlsTaskStatus.totalFragments > 0 ? (
          <Tag color="white">
            分片：{Math.min(hlsTaskStatus.completedFragments, hlsTaskStatus.totalFragments)} / {hlsTaskStatus.totalFragments}
          </Tag>
        ) : null}
        {typeof hlsTaskStatus.processedSeconds === 'number' && hlsTaskStatus.processedSeconds > 0 ? (
          <Tag color="white">
            ffmpeg：{hlsTaskStatus.processedSeconds.toFixed(1)}s
            {typeof hlsTaskStatus.durationSeconds === 'number' && hlsTaskStatus.durationSeconds > 0
              ? ` / ${hlsTaskStatus.durationSeconds.toFixed(1)}s`
              : ''}
          </Tag>
        ) : null}
        {typeof hlsTaskStatus.bytesReceived === 'number' && hlsTaskStatus.bytesReceived > 0 ? (
          <Tag color="white">
            已收：{formatBytes(hlsTaskStatus.bytesReceived)}
            {typeof hlsTaskStatus.bytesTotal === 'number' && hlsTaskStatus.bytesTotal > 0
              ? ` / ${formatBytes(hlsTaskStatus.bytesTotal)}`
              : ''}
          </Tag>
        ) : null}
        {typeof hlsTaskStatus.speedBps === 'number' && hlsTaskStatus.speedBps > 0 ? (
          <Tag color="white">速度：{formatBytes(hlsTaskStatus.speedBps)}/s</Tag>
        ) : null}
        {hlsTaskStatus.ffmpegSpeedText ? (
          <Tag color="white">ffmpeg：{hlsTaskStatus.ffmpegSpeedText}</Tag>
        ) : null}
        {typeof hlsTaskStatus.etaSeconds === 'number' && hlsTaskStatus.etaSeconds > 0 ? (
          <Tag color="white">预计剩余：{formatEtaSeconds(hlsTaskStatus.etaSeconds)}</Tag>
        ) : null}
        <Tag color="white">执行链：{formatHlsTaskModeLabel(hlsTaskStatus.mode)}</Tag>
      </ActionRow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 17, color: 'var(--app-text)' }}>
            {hlsTaskProgressSummary}
          </div>
          <div style={{ fontSize: 16, color: 'var(--app-text-muted)' }}>
            阶段进度 {hlsTaskProgressPercent}%
          </div>
        </div>
        <div
          aria-hidden
          style={{
            width: '100%',
            height: 10,
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--app-border) 72%, transparent)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${hlsTaskProgressPercent}%`,
              height: '100%',
              borderRadius: 999,
              background: hlsTaskStatus.state === 'error'
                ? 'color-mix(in srgb, var(--semi-color-danger) 72%, transparent)'
                : hlsTaskStatus.state === 'success'
                  ? 'color-mix(in srgb, #1f9d63 78%, transparent)'
                  : 'color-mix(in srgb, var(--semi-color-primary) 78%, transparent)',
              transition: 'width 180ms ease',
            }}
          />
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--app-text-muted)' }}>
          这里显示的是阶段进度；本地 downloader 会补充当前下载速度和预计剩余时间，ffmpeg 阶段会额外显示处理秒数和速度，但仍以阶段状态为主。
        </div>
      </div>
      <div style={{
        border: '1px solid var(--app-border)',
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        {(hlsTaskStatus.logs.length
          ? hlsTaskStatus.logs
          : [{
            createdAt: 0,
            id: 'waiting',
            level: 'info' as const,
            text: '等待执行 HLS 任务',
          }]
        ).map((entry, index, array) => (
          <div
            key={entry.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) 112px 120px 144px',
              gap: 12,
              alignItems: 'center',
              padding: '12px 14px',
              borderBottom: index === array.length - 1 ? 'none' : '1px solid color-mix(in srgb, var(--app-border) 72%, transparent)',
            }}
          >
            <div style={{ minWidth: 0, fontSize: 16, fontWeight: 700, color: 'var(--app-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.text}>
              {entry.text}
            </div>
            <div style={{ fontSize: 14, color: 'var(--app-text-muted)' }}>{formatHlsTaskModeLabel(entry.mode)}</div>
            <div style={{ fontSize: 14, color: 'var(--app-text-muted)' }}>{formatHlsTaskStageLabel(entry.stage)}</div>
            <div style={{ fontSize: 14, color: 'var(--app-text-muted)' }}>{formatHlsTaskLogTime(entry.createdAt) || (index === array.length - 1 ? 'latest' : '')}</div>
          </div>
        ))}
      </div>
      {hlsTaskStatus.error ? (
        <div className="panel-desc" style={{ color: 'var(--semi-color-danger)' }}>
          最近错误：{hlsTaskStatus.error}
        </div>
      ) : null}
      {hlsTaskStatus.failedFragments?.length ? (
        <div className="panel-desc" style={{ color: 'var(--app-text-muted)' }}>
          失败分片：{formatFailedFragmentList(hlsTaskStatus.failedFragments.slice(0, 12))}
          {hlsTaskStatus.failedFragments.length > 12 ? ` 等 ${hlsTaskStatus.failedFragments.length} 个` : ''}
        </div>
      ) : null}
      {hlsKeyVerificationResult ? (
        <div
          className="panel-desc"
          style={{
            color: getEmbeddedBrowserHlsKeyVerificationTone(hlsKeyVerificationResult) === 'success'
              ? 'var(--semi-color-success)'
              : getEmbeddedBrowserHlsKeyVerificationTone(hlsKeyVerificationResult) === 'warning'
                ? 'var(--semi-color-warning)'
                : 'var(--semi-color-danger)',
          }}
        >
          key 验证： {describeEmbeddedBrowserHlsKeyVerificationResult(hlsKeyVerificationResult)}
          {typeof hlsKeyVerificationResult.testedCandidateCount === 'number'
            || typeof hlsKeyVerificationResult.testedSegmentCount === 'number'
            ? `（已试 ${hlsKeyVerificationResult.testedCandidateCount ?? 0} 个候选，抽查 ${hlsKeyVerificationResult.testedSegmentCount ?? 0} 个分片）`
            : ''}
        </div>
      ) : null}
      {hlsTaskStatus.lastOutputPath ? (
        <div className="panel-desc">
          最近产物：{hlsTaskStatus.lastOutputPath}
        </div>
      ) : null}
    </Panel>
  );
};

export default ToolWorkspaceHls;
