import path from 'node:path';

import { STAGED_FILE_NAME_MAX_BYTES } from '../../stagedFilePolicy';
import {
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  type AgentMediaExtractAudioPreparedActionPublicV1,
  type AgentPreparedActionPublic,
} from '../../../../src/shared/agent/agent.types';
import {
  normalizeAgentMediaExtractAudioPreparedActionPublicV1,
} from '../../../../src/shared/agent/agent-prepared-action';
import type { AgentTool } from '../agent-tool-registry';
import { AGENT_CAPABILITY_MEDIA_FFMPEG, AGENT_CAPABILITY_MEDIA_FFPROBE } from '../capabilities/agent-capability-runtime';
import { AgentMediaError } from '../../../../src/shared/agent/agent-media-error';
import { normalizeAgentLibraryDirectoryPath } from '../../../../src/shared/agent/agent-library-path';
import { normalizeAgentLibraryNode, type AgentLibraryNode } from '../../../../src/shared/agent/agent-library-query';
import { sanitizeAgentSensitiveText } from '../agent-sensitive-data';
import { buildAgentMediaFileName, resolveAgentMediaNode } from './media-tool-node';

export const AGENT_AUDIO_OUTPUT_FORMATS = ['m4a', 'mp3', 'wav'] as const;
export type AgentAudioOutputFormat = typeof AGENT_AUDIO_OUTPUT_FORMATS[number];

const FORMAT_LABELS: Record<AgentAudioOutputFormat, string> = {
  m4a: 'M4A（AAC 192 kb/s）',
  mp3: 'MP3（192 kb/s）',
  wav: 'WAV（PCM 16-bit）',
};
const INVALID_FILE_NAME_CHARACTER = /[<>:"/\\|?*]/u;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function normalizeAgentAudioOutputFormat(input: unknown): AgentAudioOutputFormat {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'm4a';
  const format = String((input as Record<string, unknown>).format || 'm4a')
    .trim()
    .toLowerCase();
  if (!AGENT_AUDIO_OUTPUT_FORMATS.includes(format as AgentAudioOutputFormat)) {
    throw new Error('音频格式只支持 m4a、mp3 或 wav');
  }
  return format as AgentAudioOutputFormat;
}

export function deriveAgentAudioOutputFileName(
  sourceFileName: string,
  format: AgentAudioOutputFormat,
): string {
  const sourceStem = path.parse(String(sourceFileName || '').trim()).name || 'media';
  let safeStem = sourceStem
    .split('')
    .map(character => (
      character.charCodeAt(0) < 32 || INVALID_FILE_NAME_CHARACTER.test(character)
        ? '_'
        : character
    ))
    .join('')
    .replace(/[. ]+$/u, '')
    .trim() || 'media';
  if (WINDOWS_RESERVED_NAME.test(safeStem)) safeStem = `_${safeStem}`;
  const suffix = `-audio.${format}`;
  const maximumStemBytes = STAGED_FILE_NAME_MAX_BYTES - Buffer.byteLength(suffix, 'utf8');
  let boundedStem = '';
  let boundedStemBytes = 0;
  for (const character of safeStem) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (boundedStemBytes + characterBytes > maximumStemBytes) break;
    boundedStem += character;
    boundedStemBytes += characterBytes;
  }
  return `${boundedStem || 'media'}${suffix}`;
}

function normalizeAgentAudioOutputFileName(
  value: unknown,
  format: AgentAudioOutputFormat,
): string {
  const fileName = String(value || '').trim();
  const parsed = path.parse(fileName);
  if (
    !fileName
    || fileName === '.'
    || fileName === '..'
    || Buffer.byteLength(fileName, 'utf8') > STAGED_FILE_NAME_MAX_BYTES
    || INVALID_FILE_NAME_CHARACTER.test(fileName)
    || Array.from(fileName).some(character => character.charCodeAt(0) < 32)
    || WINDOWS_RESERVED_NAME.test(parsed.name)
    || parsed.ext.toLowerCase() !== `.${format}`
  ) {
    throw new Error(`输出文件名必须是有效的 .${format} 文件名`);
  }
  return fileName;
}

interface MediaExtractAudioProviderBinding {
  providerAlias: string;
  providerLabel?: string;
}

interface MediaExtractAudioPreparationResult {
  targetDirectory?: AgentLibraryNode;
  providerBindings: Partial<Record<AgentAudioOutputFormat, MediaExtractAudioProviderBinding>>;
}

function normalizePreparationResult(input: unknown, libraryId: number): MediaExtractAudioPreparationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { providerBindings: {} };
  }
  const source = input as Record<string, unknown>;
  if (source.sourceFailure) {
    throw new AgentMediaError(source.sourceFailure === 'source_unreachable' ? 'source_unreachable' : 'source_unknown');
  }
  if (source.targetError) throw new Error(sanitizeAgentSensitiveText(String(source.targetError)).slice(0, 500));
  const bindings = source.providerBindings && typeof source.providerBindings === 'object'
    && !Array.isArray(source.providerBindings)
    ? source.providerBindings as Record<string, unknown>
    : {};
  const providerBindings: MediaExtractAudioPreparationResult['providerBindings'] = {};
  for (const format of AGENT_AUDIO_OUTPUT_FORMATS) {
    const value = bindings[format];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const binding = value as Record<string, unknown>;
    const providerAlias = String(binding.providerAlias || '').trim();
    const providerLabel = String(binding.providerLabel || '').trim().slice(0, 160);
    if (providerAlias && providerAlias.length <= 200) {
      providerBindings[format] = {
        providerAlias,
        ...(providerLabel ? { providerLabel } : {}),
      };
    }
  }
  return {
    ...(source.targetDirectory ? { targetDirectory: normalizeAgentLibraryNode(source.targetDirectory, libraryId) } : {}),
    providerBindings,
  };
}

function buildPreparedAction(
  input: unknown,
  context: Parameters<NonNullable<AgentTool['validate']>>[1],
  rendererResult: MediaExtractAudioPreparationResult,
  requestedAction?: AgentPreparedActionPublic,
) {
  const node = resolveAgentMediaNode(input, context);
  const normalizedRequestedAction = requestedAction === undefined
    ? undefined
    : normalizeAgentMediaExtractAudioPreparedActionPublicV1(requestedAction);
  const requestedFormat = normalizedRequestedAction?.outputFormat
    ? normalizeAgentAudioOutputFormat({ format: normalizedRequestedAction.outputFormat })
    : normalizeAgentAudioOutputFormat(input);
  const providerBinding = rendererResult.providerBindings[requestedFormat];
  const sourceFileName = buildAgentMediaFileName(node);
  const libraryId = Number(context.appContext.libraryId);
  const target = rendererResult.targetDirectory;
  const currentParentId = target?.id || Number(context.appContext.currentDirectory?.id);
  const currentDirectoryName = target?.path || target?.name || String(context.appContext.currentDirectory?.name || '当前目录');
  const requestedInput = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const defaultDestination = requestedInput.destination === 'local' ? 'local' : 'library';
  const defaultAction: AgentMediaExtractAudioPreparedActionPublicV1 = {
    conflictPolicy: 'auto_rename',
    destination: defaultDestination,
    fallbackPolicy: defaultDestination === 'library' ? 'prompt_local' : 'none',
    kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
    libraryId,
    outputFileName: requestedInput.fileName
      ? normalizeAgentAudioOutputFileName(requestedInput.fileName, requestedFormat)
      : deriveAgentAudioOutputFileName(sourceFileName, requestedFormat),
    outputFormat: requestedFormat,
    ...(defaultDestination === 'library' ? { parentId: currentParentId } : {}),
    sourceNodeId: node.id,
    targetLabel: defaultDestination === 'library'
      ? currentDirectoryName
      : '本机（执行时选择位置）',
    version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  };
  const action = normalizeAgentMediaExtractAudioPreparedActionPublicV1(
    normalizedRequestedAction || defaultAction,
  );
  if (action.libraryId !== libraryId || action.sourceNodeId !== node.id) {
    throw new Error('Agent prepared action 的资料库或源文件已经变化');
  }
  const outputFormat = normalizeAgentAudioOutputFormat({ format: action.outputFormat });
  const outputFileName = normalizeAgentAudioOutputFileName(action.outputFileName, outputFormat);
  if (action.destination === 'library' && !providerBinding) {
    throw new AgentMediaError('destination_unavailable');
  }
  if (action.destination === 'library') {
    if ((requestedInput.directoryPath || requestedInput.parentId || action.parentId !== Number(context.appContext.currentDirectory?.id)) && !target) {
      throw new Error('目标目录尚未解析，不能根据路径或节点 ID 猜测写入位置');
    }
    if (target && (target.type !== 'dir' || target.libraryId !== libraryId || target.id !== action.parentId)) {
      throw new Error('目标目录与准备好的写入位置不匹配');
    }
  }
  const targetLabel = action.destination === 'library'
    ? target?.path || target?.name || action.targetLabel
    : '本机（执行时选择位置）';
  const publicAction = normalizeAgentMediaExtractAudioPreparedActionPublicV1({
    ...action,
    fallbackPolicy: action.destination === 'library' ? action.fallbackPolicy : 'none',
    outputFileName,
    outputFormat,
    targetLabel,
  });
  const locationDescription = publicAction.destination === 'library'
    ? `上传到“${publicAction.targetLabel}”`
    : '保存到执行时选择的本机位置';
  return {
    decision: {
      behavior: 'ask' as const,
      preview: {
        description: `将从“${sourceFileName}”提取音频，并${locationDescription}。`,
        details: [
          { label: '源文件', value: sourceFileName },
          { label: '输出', value: publicAction.outputFileName },
          { label: '格式', value: FORMAT_LABELS[outputFormat] },
          { label: '位置', value: publicAction.targetLabel },
          ...(publicAction.destination === 'library'
            ? [{
                label: '上传失败',
                value: publicAction.fallbackPolicy === 'prompt_local'
                  ? '提交前失败时询问保存到本机'
                  : '不保存到本机',
              }]
            : []),
        ],
        risk: 'write' as const,
        title: '提取音频',
      },
      risk: 'write' as const,
    },
    executionInput: {
      conflictPolicy: publicAction.conflictPolicy,
      destination: publicAction.destination,
      fallbackPolicy: publicAction.fallbackPolicy,
      libraryId,
      ...(node.mimeType ? { mimeType: node.mimeType } : {}),
      nodeId: node.id,
      outputFileName: publicAction.outputFileName,
      outputFormat,
      ...(publicAction.parentId ? { parentId: publicAction.parentId } : {}),
      ...(publicAction.destination === 'library' && target?.path ? { targetDirectoryPath: target.path } : {}),
      ...(publicAction.destination === 'library' && providerBinding
        ? { storageProvider: providerBinding.providerAlias }
        : {}),
      sourceFileName,
    },
    publicAction,
    snapshotMaterial: publicAction.destination === 'library'
      ? { storageProviderBinding: providerBinding?.providerAlias }
      : { storageProviderBinding: null },
  };
}

export const mediaExtractAudioTool: AgentTool = {
  availability: {
    requiredCapabilities: [AGENT_CAPABILITY_MEDIA_FFMPEG, AGENT_CAPABILITY_MEDIA_FFPROBE],
  },
  description: '从已选中或通过资料库查询读取的媒体提取第一条音轨。可用 directoryPath 或 parentId 直接指定资料库目标，缺省当前目录；支持本机目标、格式和文件名。运行时检查源和目标，按权限执行，不需要为了其他目录绕经本机暂存。',
  executor: 'renderer',
  inputSchema: {
    additionalProperties: false,
    properties: {
      directoryPath: { type: 'string', minLength: 1, maxLength: 2048, description: '目标目录在当前资料库中的绝对路径，例如 /音乐；与 parentId 互斥，可直接指定，不必先存到本机。' },
      parentId: { type: 'integer', minimum: 1, description: '目标目录节点 ID，与 directoryPath 互斥。' },
      destination: { enum: ['library', 'local'], type: 'string', description: '默认 library；local 使用本机 Save As。内部优先是默认偏好，不限制为满足任务选择其他目标。' },
      fileName: { type: 'string', minLength: 1, maxLength: 240, description: '可选输出文件名，扩展名必须匹配 format。' },
      format: {
        default: 'm4a',
        description: '输出音频格式，默认 m4a。',
        enum: [...AGENT_AUDIO_OUTPUT_FORMATS],
        type: 'string',
      },
      nodeId: {
        description: '当前选中项或 file.stat/list/search/resolve 已读取的当前资料库文件 ID；唯一选中节点可省略。',
        type: 'integer',
      },
    },
    not: { properties: { parentId: {}, directoryPath: {} }, required: ['parentId', 'directoryPath'] },
    type: 'object',
  },
  name: 'media.extractAudio',
  risk: 'write',
  timeoutMs: 6 * 60 * 60 * 1_000,
  validate(input, context) {
    try {
      resolveAgentMediaNode(input, context);
      normalizeAgentAudioOutputFormat(input);
      const fields = input as Record<string, unknown>;
      if (fields.directoryPath !== undefined) normalizeAgentLibraryDirectoryPath(fields.directoryPath);
      if (fields.destination === 'local' && (fields.directoryPath !== undefined || fields.parentId !== undefined)) throw new Error('本机目标不能同时指定资料库目录');
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '音频提取参数无效',
        ok: false,
      };
    }
    const libraryId = Number(context.appContext.libraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      return { message: '当前没有可写入的目录上下文', ok: false };
    }
    return { ok: true };
  },
  createRendererPrepareRequest(input, context, requestedAction) {
    const node = resolveAgentMediaNode(input, context);
    const format = normalizeAgentAudioOutputFormat(input);
    const sourceFileName = buildAgentMediaFileName(node);
    const fields = input as Record<string, unknown>;
    const action = requestedAction ? normalizeAgentMediaExtractAudioPreparedActionPublicV1(requestedAction) : undefined;
    const destination = action?.destination || (fields.destination === 'local' ? 'local' : 'library');
    const directoryPath = !action && fields.directoryPath ? normalizeAgentLibraryDirectoryPath(fields.directoryPath) : undefined;
    return {
      fileSize: Number(node.fileSize || 0),
      libraryId: Number(context.appContext.libraryId),
      mimeType: node.mimeType,
      nodeId: node.id,
      outputFormat: format,
      destination,
      ...(directoryPath ? { directoryPath } : {}),
      ...(destination === 'library' && !directoryPath ? { parentId: action?.parentId || fields.parentId || context.appContext.currentDirectory?.id } : {}),
      sourceFileName,
    };
  },
  finalizeRendererPreparation(input, rendererResult, requestedAction, context) {
    return buildPreparedAction(
      input,
      context,
      normalizePreparationResult(rendererResult, Number(context.appContext.libraryId)),
      requestedAction,
    );
  },
};
