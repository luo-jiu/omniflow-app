import type {
  AgentPresentationBlock,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import { normalizeAgentPreparedActionPublic } from '@/shared/agent/agent-prepared-action';
import { normalizeComputerElementOperations } from '@/shared/computer-use/computer-use-contract';
import { committedAgentFileParents, getPluginOperationPreparedAction } from './agent-published-file';

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

const COMPUTER_REFERENCE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const COMPUTER_AX_MAX_BYTES = 12 * 1024;

function computerElementText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= 200
    && new TextEncoder().encode(value).length <= 1024
    && !Array.from(value).some(character => {
      const code = character.codePointAt(0)!;
      return code < 32 || code >= 127 && code <= 159 || code >= 0x202a && code <= 0x202e
        || code >= 0x2066 && code <= 0x2069 || character.length === 1 && code >= 0xd800 && code <= 0xdfff;
    });
}

function computerElementDetails(data: Record<string, unknown>): AgentPresentationBlock[] {
  if (!Array.isArray(data.elements) || data.elements.length > 128) return [];
  const entries = data.elements.flatMap(value => {
    const element = asRecord(value);
    if (!element || typeof element.elementId !== 'string' || !COMPUTER_REFERENCE_ID.test(element.elementId)
      || !computerElementText(element.label) || !computerElementText(element.role)) return [];
    try {
      const operations = normalizeComputerElementOperations(element.operations);
      const actions = [
        ...(operations.includes('press') ? ['点击'] : []),
        ...(operations.includes('replaceText') ? ['替换文本'] : []),
        ...(operations.includes('insertText') ? ['插入文本'] : []),
        ...(operations.some(operation => operation.startsWith('scroll')) ? ['滚动'] : []),
      ];
      return [{ label: element.label, value: `${element.role} · ${actions.join('、')}` }];
    } catch { return []; }
  });
  return entries.length ? [{ type: 'details', title: data.elementsTruncated === true ? '控件 · 已截断' : '控件', entries }] : [];
}

function computerObservationScope(data: Record<string, unknown>): Pick<Extract<AgentPresentationBlock, { type: 'computer-ax' }>, 'scope' | 'scopeScanComplete'> | null {
  const scopeDescriptor = Object.getOwnPropertyDescriptor(data, 'scope');
  if (!scopeDescriptor) return Object.prototype.hasOwnProperty.call(data, 'scopeScanComplete') ? null : {};
  const completeDescriptor = Object.getOwnPropertyDescriptor(data, 'scopeScanComplete');
  if (!scopeDescriptor.enumerable || !('value' in scopeDescriptor) || !completeDescriptor?.enumerable
    || !('value' in completeDescriptor) || typeof completeDescriptor.value !== 'boolean') return null;
  const scope: unknown = scopeDescriptor.value;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(scope))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(scope);
  const keys = Reflect.ownKeys(scope);
  if (keys.some(key => typeof key !== 'string' || !['kind', 'ancestorLevels'].includes(key))
    || Object.values(descriptors).some(descriptor => !descriptor.enumerable || !('value' in descriptor))) return null;
  const kind = descriptors.kind?.value;
  if (kind === 'window' && keys.length === 1) return { scope: { kind }, scopeScanComplete: completeDescriptor.value };
  const levels: unknown = descriptors.ancestorLevels?.value;
  const candidateComplete = Object.getOwnPropertyDescriptor(data, 'candidateScanComplete');
  const coordinateReady = Object.getOwnPropertyDescriptor(data, 'coordinateClickReady');
  if (kind !== 'element-ancestor' || keys.length !== 2 || typeof levels !== 'number' || !Number.isSafeInteger(levels)
    || levels < 0 || levels > 3 || !candidateComplete?.enumerable || !('value' in candidateComplete) || candidateComplete.value !== false
    || !coordinateReady?.enumerable || !('value' in coordinateReady) || coordinateReady.value !== false) return null;
  return { scope: { kind, ancestorLevels: levels }, scopeScanComplete: completeDescriptor.value };
}

function builtInComputerAction(activity: AgentToolActivitySnapshot, libraryId?: number) {
  const operation = activity.toolMetadata?.builtinComputerTool;
  if (!operation || activity.pluginSource || activity.toolMetadata?.kind !== 'business'
    || activity.call.name !== `computer.${operation}`) return null;
  try {
    const action = normalizeAgentPreparedActionPublic(activity.preparation?.action);
    return (action.kind === 'computer.observe' || action.kind === 'computer.click'
      || action.kind === 'computer.setText' || action.kind === 'computer.scroll')
      && action.kind === activity.call.name && (libraryId === undefined || action.libraryId === libraryId) ? action : null;
  } catch {
    return null;
  }
}

function computerObservationPresenter(activity: AgentToolActivitySnapshot, libraryId: number): AgentPresentationBlock[] {
  const action = builtInComputerAction(activity, libraryId);
  const data = asRecord(activity.result?.data);
  if (action?.kind !== 'computer.observe' || activity.result?.ok !== true || !data
    || (action.version === 2 ? data.captureScope !== 'window' || data.targetId !== action.targetId
      : data.displayId !== action.displayId)
    || typeof data.observationId !== 'string' || !COMPUTER_REFERENCE_ID.test(data.observationId)) return [];
  const mode = action.version === 2 ? action.mode ?? 'both' : 'both';
  if (action.version === 2 && (mode === 'ax' ? data.observationSource !== 'ax'
    : data.observationSource !== undefined && data.observationSource !== 'screenshot')) return [];
  const blocks: AgentPresentationBlock[] = [];
  if (mode !== 'ax' && typeof data.imageId === 'string' && COMPUTER_REFERENCE_ID.test(data.imageId)
    && Number.isInteger(data.screenshotWidth) && Number(data.screenshotWidth) >= 1 && Number(data.screenshotWidth) <= 2048
    && Number.isInteger(data.screenshotHeight) && Number(data.screenshotHeight) >= 1 && Number(data.screenshotHeight) <= 2048) {
    blocks.push({ type: 'attachment-image', attachmentId: data.imageId,
      alt: action.version === 2 ? `${action.applicationLabel} · ${action.windowLabel}的窗口截图` : `${action.displayLabel}的屏幕截图` });
  }
  const observationScope = computerObservationScope(data);
  if (!observationScope) return blocks;
  if (action.version === 2 && mode !== 'screenshot' && typeof data.axTree === 'string' && data.axTree.trim()
    && data.axTree.length <= COMPUTER_AX_MAX_BYTES && new TextEncoder().encode(data.axTree).length <= COMPUTER_AX_MAX_BYTES
    && !Array.from(data.axTree).some(character => {
      const code = character.codePointAt(0)!;
      return code < 32 && code !== 10 || code >= 127 && code <= 159 || code >= 0x202a && code <= 0x202e
        || code >= 0x2066 && code <= 0x2069 || character.length === 1 && code >= 0xd800 && code <= 0xdfff;
    })
    && typeof data.axTreeTruncated === 'boolean') {
    blocks.push({ type: 'computer-ax', tree: data.axTree, truncated: data.axTreeTruncated, ...observationScope });
  }
  if (mode === 'ax') blocks.push(...computerElementDetails(data));
  return blocks;
}

function computerClickDispatched(activity: AgentToolActivitySnapshot, libraryId: number): boolean {
  const action = builtInComputerAction(activity, libraryId);
  const data = asRecord(activity.result?.data);
  return activity.status === 'completed' && activity.result?.ok === true && action?.kind === 'computer.click'
    && data?.operation === 'computer.click' && data.operationId === activity.id && data.dispatchState === 'dispatched'
    && data.mutationCommitState === 'committed' && data.observationId === action.observationId
    && (action.version === 1 ? data.displayId === action.displayId : data.targetId === action.targetId)
    && (action.version === 3 ? data.elementId === action.elementId
      && data.libraryId === action.libraryId && data.applicationLabel === action.applicationLabel
      && data.windowLabel === action.windowLabel && data.nextAction === 'observe' && data.retryAllowed === false
      : data.x === action.x && data.y === action.y);
}

function computerInputDispatched(activity: AgentToolActivitySnapshot, libraryId: number): boolean {
  const action = builtInComputerAction(activity, libraryId);
  const data = asRecord(activity.result?.data);
  if (activity.status !== 'completed' || activity.result?.ok !== true
    || (action?.kind !== 'computer.setText' && action?.kind !== 'computer.scroll')
    || data?.operation !== action.kind || data.operationId !== activity.id
    || data.dispatchState !== 'dispatched' || data.mutationCommitState !== 'committed'
    || data.libraryId !== action.libraryId || data.targetId !== action.targetId
    || data.applicationLabel !== action.applicationLabel || data.windowLabel !== action.windowLabel
    || data.observationId !== action.observationId || data.elementId !== action.elementId
    || data.nextAction !== 'observe' || data.retryAllowed !== false) return false;
  return action.kind === 'computer.setText'
    ? data.mode === action.mode && data.textLength === action.textLength && data.textBytes === action.textBytes
    : data.direction === action.direction && data.unit === action.unit;
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
  'agent.access.request': '目录访问确认',
  'skill.activate': '加载流程',
  'directory.create': '创建文件夹',
  'node.configure': '设置资源类型',
  'file.list': '读取目录',
  'file.search': '搜索资料库',
  'file.resolve': '定位路径',
  'file.publish': '发布 Agent 输出',
  'file.stage': '暂存文件',
  'file.stat': '读取文件信息',
  'file.read': '读取文件正文',
  'attachment.read': '读取附件',
  'attachment.inspect': '检查附件',
  'attachment.query': '查询工作表',
  'attachment.view': '查看附件页面',
  'computer.observe': '查看屏幕',
  'computer.click': '点击屏幕',
  'computer.setText': '输入文本',
  'computer.scroll': '滚动窗口',
  'file.write': '保存文件',
  'file.delete': '移入回收站',
  'file.rename': '重命名文件',
  'file.move': '移动文件',
  'file.copy': '复制文件',
  'recycle.list': '查询回收站',
  'recycle.restore': '恢复文件',
  'tag.list': '查询标签',
  'tag.update': '修改标签',
  'library.batch': '批量整理文件',
  'operation.verify': '核对操作结果',
  'file.grep': '搜索文件正文',
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
  if (activity.status === 'running' || activity.status === 'preparing') {
    const path = textValue(asRecord(activity.call.input)?.path);
    return { label: activity.call.name === 'file.read'
      ? (activity.status === 'running' ? '正在读取' : '准备读取')
      : `${activity.status === 'running' ? '正在' : '准备'}${getAgentToolTitle(activity)}`,
    ...(activity.call.name === 'file.read' ? { subject: path.replace(/\\/g, '/').split('/').pop() || undefined } : {}) };
  }
  if (activity.status !== 'completed') return { label: getAgentToolTitle(activity) };
  if (activity.call.name === 'computer.observe') return { label: builtInComputerAction(activity, libraryId)?.version === 2 ? '已查看窗口' : '已查看屏幕' };
  if (activity.call.name === 'computer.click') return { label: computerClickDispatched(activity, libraryId) ? '已发送点击' : getAgentToolTitle(activity) };
  if (activity.call.name === 'computer.setText' || activity.call.name === 'computer.scroll') return {
    label: computerInputDispatched(activity, libraryId)
      ? activity.call.name === 'computer.setText' ? '已发送文本输入' : '已发送滚动'
      : getAgentToolTitle(activity),
  };
  if (activity.call.name === 'file.write') return { label: '已保存', subject: textValue(data?.fileName) || undefined };
  if (activity.call.name === 'file.grep') return {
    label: data?.complete === false && !data?.hasMore ? '已搜索正文 · 结果不完整' : '已搜索正文',
    subject: textValue(data?.path) || undefined,
  };
  if (activity.call.name === 'file.read' || activity.call.name === 'attachment.read') {
    const path = textValue(data?.fileName) || textValue(data?.path) || textValue(asRecord(activity.call.input)?.path);
    return { label: '已读取', subject: path?.replace(/\\/g, '/').split('/').pop() || undefined };
  }
  if (data?.scope === 'host') {
    const node = asRecord(data.node) || asRecord(data.directory);
    return { label: '已读取本机', subject: textValue(node?.path) || undefined };
  }
  const file = activity.call.name === 'file.stat' || activity.call.name === 'file.resolve' ? data
    : activity.call.name === 'file.list' ? asRecord(data?.directory)
      : activity.call.name === 'media.inspect' ? asRecord(data?.file) : null;
  const name = textValue(file?.name);
  const fullName = name && file?.type !== 'dir' && activity.call.name !== 'file.list'
    ? buildFileFullName(name, textValue(file?.ext))
    : name;
  const subject = activity.call.name === 'file.resolve' ? textValue(file?.path) || fullName : fullName;
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
  return { label: `已完成 ${getAgentToolTitle(activity)}` };
}

const TOOL_PRESENTERS: Record<string, ToolPresenter> = {
  'computer.observe': computerObservationPresenter,
  'directory.create': artifactPresenter,
  'media.extractAudio': artifactPresenter,
  'media.inspect': mediaInspectPresenter,
};

export function getAgentToolTitle(activity: AgentToolActivitySnapshot): string {
  const computerAction = builtInComputerAction(activity);
  if (computerAction?.kind === 'computer.observe' && computerAction.version === 2) return '查看窗口';
  if (computerAction?.kind === 'computer.click' && computerAction.version !== 1) return '点击窗口';
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
  const pluginSourceBlocks: AgentPresentationBlock[] = activity.pluginSource ? [{ type: 'details', title: '插件来源', entries: [
    { label: '插件', value: activity.pluginSource.pluginId },
    { label: '版本', value: activity.pluginSource.pluginVersion },
    { label: '工具', value: activity.pluginSource.toolId },
    { label: '包指纹', value: activity.pluginSource.packageFingerprint },
  ] }] : [];
  const operationAction = getPluginOperationPreparedAction(activity, libraryId);
  if (operationAction) {
    const data = asRecord(activity.result?.data);
    const state = data?.operationId === operationAction.operationId ? textValue(operationAction.kind === 'plugin.rename' ? data?.mutationCommitState : data?.uploadCommitState) : '';
    const queryable = activity.approval?.status === 'approved' && !['committed', 'uncommitted'].includes(state)
      && ['failed', 'interrupted', 'cancelled', 'completed'].includes(activity.status);
    pluginSourceBlocks.push({ type: 'details', title: '提交回执', entries: [
      { label: '操作 ID', value: operationAction.operationId },
      { label: '提交状态', value: state === 'committed' && committedAgentFileParents(activity, libraryId).length ? '已提交'
        : state === 'uncommitted' && activity.result?.ok === false ? '未提交' : '尚不能确认，请查询回执' },
    ], ...(queryable ? { actions: [{ action: 'agent.operation.reconcile' as const, label: '查询回执', libraryId,
      sessionId: activity.sessionId, toolRunId: activity.id, expectedRevision: activity.revision }] } : {}) });
    const trace = asRecord(data?.reconciliation); const checks = Array.isArray(trace?.checks) ? trace.checks : [];
    if (checks.length) pluginSourceBlocks.push({ type: 'details', title: '核对记录', entries: checks.slice(-8).flatMap(raw => {
      const item = asRecord(raw);
      return typeof item?.checkedAt === 'string' && typeof item.state === 'string' ? [{ label: item.checkedAt,
        value: item.state === 'committed' ? '已提交' : item.state === 'uncommitted' ? '未提交' : '结果仍未知' }] : [];
    }) });
  }
  if (activity.status === 'completed') {
    if (computerClickDispatched(activity, libraryId) || computerInputDispatched(activity, libraryId)) return [];
    const specific = TOOL_PRESENTERS[activity.call.name]?.(activity, libraryId) || [];
    return [
      ...pluginSourceBlocks,
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
  return [...pluginSourceBlocks, {
    message: fallbackMessage,
    tone: activity.status === 'interrupted' || activity.status === 'cancelled' ? 'warning' : 'danger',
    type: 'notice',
  }];
}
