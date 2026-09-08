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
  'skill.activate': '加载流程',
  'directory.create': '创建文件夹',
  'file.list': '读取目录',
  'file.search': '搜索资料库',
  'file.resolve': '定位路径',
  'file.publish': '发布 Agent 输出',
  'file.stage': '暂存文件',
  'file.stat': '读取文件信息',
  'file.upload': '上传本机文件',
  'interaction.request': '用户输入',
  'media.extractAudio': '提取音频',
  'media.inspect': '检查媒体',
  'shell.run': '运行 Shell 命令',
};

export function buildAgentToolSummary(activity: AgentToolActivitySnapshot, libraryId: number): {
  label: string;
  subject?: string;
  action?: Extract<import('@/shared/agent/agent.types').AgentPresentationAction, { action: 'tree.revealNode' }>;
} {
  const data = asRecord(activity.result?.data);
  if (activity.status !== 'completed') return { label: getAgentToolTitle(activity) };
  const file = activity.call.name === 'file.stat' || activity.call.name === 'file.resolve' ? data
    : activity.call.name === 'file.list' ? asRecord(data?.directory)
      : activity.call.name === 'media.inspect' ? asRecord(data?.file) : null;
  const subject = activity.call.name === 'file.resolve' ? textValue(file?.path) || textValue(file?.name) : textValue(file?.name);
  const nodeId = positiveId(file?.id ?? file?.nodeId);
  if (subject) return {
    label: asRecord(file?.storage)?.availability === 'unavailable'
      ? '已读取元数据 · 源存储不可达' : activity.call.name === 'media.inspect' ? '已检查' : activity.call.name === 'file.resolve' ? '已定位' : '已读取',
    subject,
    ...(nodeId ? { action: { action: 'tree.revealNode', label: subject, libraryId, nodeId } } : {}),
  };
  if (activity.call.name === 'skill.activate') return { label: '已加载流程', subject: textValue(data?.skillId) || undefined };
  if ((activity.call.name === 'media.extractAudio' || activity.call.name === 'directory.create') && textValue(data?.name)) {
    const name = textValue(data?.name);
    const createdNodeId = positiveId(data?.createdNodeId);
    return {
      label: activity.call.name === 'directory.create' ? '已创建' : '已保存', subject: name,
      ...(createdNodeId ? { action: { action: 'tree.revealNode', label: name, libraryId, nodeId: createdNodeId } } : {}),
    };
  }
  return { label: `已完成${getAgentToolTitle(activity)}` };
}

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
