import type {
  AgentPresentationBlock,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';

type ToolPresenter = (
  activity: AgentToolActivitySnapshot,
  libraryId: number,
) => AgentPresentationBlock[];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function formatDuration(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function artifactPresenter(
  activity: AgentToolActivitySnapshot,
  libraryId: number,
): AgentPresentationBlock[] {
  const data = asRecord(activity.result?.data);
  const nodeId = positiveId(data?.createdNodeId);
  const name = textValue(data?.name);
  if (!data || !nodeId || !name) return [];
  const isDirectory = activity.call.name === 'directory.create';
  const format = textValue(data.format).toLowerCase();
  const kind = isDirectory
    ? 'directory' as const
    : format === 'm4a' || format === 'mp3' || format === 'wav'
      ? 'audio' as const
      : 'file' as const;
  return [{
    actions: [{
      action: 'tree.revealNode',
      label: '在目录树中定位',
      libraryId,
      nodeId,
    }],
    artifact: {
      id: `library:${libraryId}:node:${nodeId}`,
      kind,
      libraryId,
      name,
      nodeId,
    },
    type: 'artifact',
  }];
}

function mediaInspectPresenter(activity: AgentToolActivitySnapshot): AgentPresentationBlock[] {
  const data = asRecord(activity.result?.data);
  const file = asRecord(data?.file);
  const format = asRecord(data?.format);
  if (!data || !file || !format) return [];
  const entries = [
    { label: '文件', value: textValue(file.name) },
    { label: '格式', value: textValue(format.longName) || textValue(format.name) },
    { label: '时长', value: formatDuration(format.durationSeconds) },
    { label: '大小', value: formatBytes(format.sizeBytes) },
    { label: '码率', value: textValue(format.bitRate) ? `${textValue(format.bitRate)} bps` : '' },
    { label: '媒体流', value: textValue(data.streamCount) },
  ].filter(entry => entry.value);
  return entries.length > 0 ? [{ entries, title: '媒体信息', type: 'details' }] : [];
}

const TOOL_TITLES: Record<string, string> = {
  'directory.create': '创建文件夹',
  'file.list': '读取目录',
  'file.stat': '读取文件信息',
  'interaction.request': '用户输入',
  'media.extractAudio': '提取音频',
  'media.inspect': '检查媒体',
};

const TOOL_PRESENTERS: Record<string, ToolPresenter> = {
  'directory.create': artifactPresenter,
  'media.extractAudio': artifactPresenter,
  'media.inspect': mediaInspectPresenter,
};

export function getAgentToolTitle(activity: AgentToolActivitySnapshot): string {
  return getAgentToolNameTitle(activity.call.name);
}

export function getAgentToolNameTitle(toolName: string): string {
  return TOOL_TITLES[toolName] || toolName;
}

export function buildAgentToolPresentation(
  activity: AgentToolActivitySnapshot,
  libraryId: number,
): AgentPresentationBlock[] {
  if (activity.interaction) {
    const { interaction } = activity;
    const request = interaction.request;
    if (request.kind === 'choice') {
      return [{
        interactionId: interaction.interactionId,
        ...(request.multiple ? { multiple: true } : {}),
        options: request.options,
        prompt: request.prompt,
        ...(interaction.response?.kind === 'choice' ? { response: interaction.response } : {}),
        status: interaction.status,
        ...(request.submitLabel ? { submitLabel: request.submitLabel } : {}),
        ...(request.title ? { title: request.title } : {}),
        type: 'choice',
      }];
    }
    return [{
      fields: request.fields,
      interactionId: interaction.interactionId,
      prompt: request.prompt,
      ...(interaction.response?.kind === 'form' ? { response: interaction.response } : {}),
      status: interaction.status,
      ...(request.submitLabel ? { submitLabel: request.submitLabel } : {}),
      ...(request.title ? { title: request.title } : {}),
      type: 'form',
    }];
  }
  if (activity.status === 'awaiting_approval' && activity.approval?.status === 'pending') {
    return [{ approvalId: activity.approval.approvalId, type: 'approval' }];
  }
  if (activity.status === 'preparing' || activity.status === 'running') {
    return activity.progress
      ? [{
          label: activity.progress.message,
          ...(activity.progress.percent === undefined ? {} : { percent: activity.progress.percent }),
          type: 'progress',
        }]
      : [{
          label: activity.status === 'preparing' ? '正在准备执行目标' : '正在执行',
          tone: 'info',
          type: 'status',
        }];
  }
  if (activity.status === 'completed') {
    const specific = TOOL_PRESENTERS[activity.call.name]?.(activity, libraryId) || [];
    return [
      ...specific,
      ...(specific.length === 0 && activity.result?.message
        ? [{ message: activity.result.message, tone: 'success' as const, type: 'notice' as const }]
        : []),
    ];
  }
  const fallbackMessage = activity.result?.message || (
    activity.status === 'interrupted'
      ? '上一轮工具执行已中断'
      : activity.status === 'cancelled'
        ? '工具执行已取消'
        : '工具执行失败'
  );
  return [{
    message: fallbackMessage,
    tone: activity.status === 'interrupted' || activity.status === 'cancelled' ? 'warning' : 'danger',
    type: 'notice',
  }];
}
