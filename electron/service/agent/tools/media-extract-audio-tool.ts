import path from 'node:path';

import { STAGED_FILE_NAME_MAX_BYTES } from '../../stagedFilePolicy';
import type { AgentTool } from '../agent-tool-registry';
import { AGENT_CAPABILITY_MEDIA_FFMPEG } from '../capabilities/agent-capability-runtime';
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

export const mediaExtractAudioTool: AgentTool = {
  availability: {
    requiredCapabilities: [AGENT_CAPABILITY_MEDIA_FFMPEG],
  },
  description: '从当前可见的单个媒体文件中提取第一条音轨，并将结果上传到 OmniFlow 当前目录。支持 m4a、mp3、wav，默认 m4a；目标目录和输出文件名由安全上下文确定，每次执行前必须由用户确认。',
  executor: 'renderer',
  inputSchema: {
    additionalProperties: false,
    properties: {
      format: {
        default: 'm4a',
        description: '输出音频格式，默认 m4a。',
        enum: [...AGENT_AUDIO_OUTPUT_FORMATS],
        type: 'string',
      },
      nodeId: {
        description: '当前选中项或当前目录直属文件的节点 ID；只有一个选中节点时可以省略。',
        type: 'integer',
      },
    },
    type: 'object',
  },
  name: 'media.extractAudio',
  risk: 'write',
  timeoutMs: 6 * 60 * 60 * 1_000,
  validate(input, context) {
    try {
      resolveAgentMediaNode(input, context);
      normalizeAgentAudioOutputFormat(input);
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '音频提取参数无效',
        ok: false,
      };
    }
    const libraryId = Number(context.appContext.libraryId);
    const parentId = Number(context.appContext.currentDirectory?.id);
    if (!Number.isFinite(libraryId) || libraryId <= 0 || !Number.isFinite(parentId) || parentId <= 0) {
      return { message: '当前没有可写入的目录上下文', ok: false };
    }
    return { ok: true };
  },
  assess(input, context) {
    const node = resolveAgentMediaNode(input, context);
    const format = normalizeAgentAudioOutputFormat(input);
    const sourceFileName = buildAgentMediaFileName(node);
    const outputFileName = deriveAgentAudioOutputFileName(sourceFileName, format);
    const directoryName = String(context.appContext.currentDirectory?.name || '当前目录');
    return {
      behavior: 'ask',
      preview: {
        description: `将从“${sourceFileName}”提取音频，并上传到“${directoryName}”。`,
        details: [
          { label: '源文件', value: sourceFileName },
          { label: '输出', value: outputFileName },
          { label: '格式', value: FORMAT_LABELS[format] },
          { label: '位置', value: directoryName },
        ],
        risk: 'write',
        title: '提取音频',
      },
      risk: 'write',
    };
  },
  createRendererRequest(input, context) {
    const node = resolveAgentMediaNode(input, context);
    const outputFormat = normalizeAgentAudioOutputFormat(input);
    const sourceFileName = buildAgentMediaFileName(node);
    return {
      conflictPolicy: 'auto_rename',
      libraryId: Number(context.appContext.libraryId),
      ...(node.mimeType ? { mimeType: node.mimeType } : {}),
      nodeId: node.id,
      outputFileName: deriveAgentAudioOutputFileName(sourceFileName, outputFormat),
      outputFormat,
      parentId: Number(context.appContext.currentDirectory?.id),
      sourceFileName,
    };
  },
};
