import {
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  AGENT_SHELL_PREPARED_ACTION_VERSION,
  AGENT_SHELL_RUN_TOOL_NAME,
  type AgentMediaExtractAudioOutputFormat,
  type AgentMediaExtractAudioPreparedActionPublicV1,
  type AgentPreparedActionPublic,
} from './agent.types';
import { normalizeAgentShellPreparedActionPublicV1 } from './shell/agent-shell.types';

const MAX_OUTPUT_FILE_NAME_CHARACTERS = 255;
const MAX_TARGET_LABEL_CHARACTERS = 500;
const MEDIA_EXTRACT_AUDIO_FIELDS = new Set([
  'conflictPolicy',
  'destination',
  'fallbackPolicy',
  'kind',
  'libraryId',
  'outputFileName',
  'outputFormat',
  'parentId',
  'sourceNodeId',
  'targetLabel',
  'version',
]);
const MEDIA_EXTRACT_AUDIO_OUTPUT_FORMATS = new Set<AgentMediaExtractAudioOutputFormat>([
  'm4a',
  'mp3',
  'wav',
]);

function strictObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Agent prepared action 无效');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Agent prepared action 无效');
  }
  return input as Record<string, unknown>;
}

function assertExactFields(source: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new Error('Agent prepared action 包含未知字段');
  }
}

function positiveId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label}无效`);
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > maximum) throw new Error(`${label}无效`);
  return normalized;
}

function safeFileName(value: unknown): string {
  const normalized = boundedText(value, '输出文件名', MAX_OUTPUT_FILE_NAME_CHARACTERS);
  if (
    normalized === '.'
    || normalized === '..'
    || Array.from(normalized).some(character => (
      character === '/'
      || character === '\\'
      || character.charCodeAt(0) < 32
    ))
  ) {
    throw new Error('输出文件名无效');
  }
  return normalized;
}

function safeTargetLabel(value: unknown): string {
  const normalized = boundedText(value, '目标位置', MAX_TARGET_LABEL_CHARACTERS);
  if (Array.from(normalized).some(character => character.charCodeAt(0) < 32)) {
    throw new Error('目标位置无效');
  }
  return normalized;
}

function outputFormat(value: unknown): AgentMediaExtractAudioOutputFormat {
  const normalized = boundedText(value, '输出格式', 32).toLowerCase();
  if (!MEDIA_EXTRACT_AUDIO_OUTPUT_FORMATS.has(normalized as AgentMediaExtractAudioOutputFormat)) {
    throw new Error('输出格式无效');
  }
  return normalized as AgentMediaExtractAudioOutputFormat;
}

export function normalizeAgentMediaExtractAudioPreparedActionPublicV1(
  input: unknown,
): AgentMediaExtractAudioPreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND
    || source.version !== AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  assertExactFields(source, MEDIA_EXTRACT_AUDIO_FIELDS);
  const destination = source.destination === 'library' || source.destination === 'local'
    ? source.destination
    : null;
  const fallbackPolicy = source.fallbackPolicy === 'prompt_local' || source.fallbackPolicy === 'none'
    ? source.fallbackPolicy
    : null;
  const conflictPolicy = source.conflictPolicy === 'auto_rename'
    || source.conflictPolicy === 'error'
    || source.conflictPolicy === 'replace'
    ? source.conflictPolicy
    : null;
  if (!destination || !fallbackPolicy || !conflictPolicy) {
    throw new Error('Agent prepared action 策略无效');
  }
  const hasParentId = Object.prototype.hasOwnProperty.call(source, 'parentId');
  const parentId = !hasParentId
    ? undefined
    : positiveId(source.parentId, '目标目录');
  if (destination === 'library' && !parentId) {
    throw new Error('资料库目标目录无效');
  }
  if (destination === 'local' && hasParentId) {
    throw new Error('本机目标不能包含资料库目录');
  }
  return {
    conflictPolicy,
    destination,
    fallbackPolicy: destination === 'local' ? 'none' : fallbackPolicy,
    kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
    libraryId: positiveId(source.libraryId, '资料库'),
    outputFileName: safeFileName(source.outputFileName),
    outputFormat: outputFormat(source.outputFormat),
    ...(destination === 'library' && parentId ? { parentId } : {}),
    sourceNodeId: positiveId(source.sourceNodeId, '源文件'),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  };
}

export function normalizeAgentPreparedActionPublic(
  input: unknown,
): AgentPreparedActionPublic {
  const source = strictObject(input);
  if (
    source.kind === AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND
    && source.version === AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentMediaExtractAudioPreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_SHELL_RUN_TOOL_NAME
    && source.version === AGENT_SHELL_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentShellPreparedActionPublicV1(source);
  }
  throw new Error('Agent prepared action 类型或版本不受支持');
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(source[key])}`
    )).join(',')}}`;
  }
  return 'null';
}

export function equalAgentPreparedActionPublic(
  left: unknown,
  right: unknown,
): boolean {
  try {
    const normalizedLeft = normalizeAgentPreparedActionPublic(left);
    const normalizedRight = normalizeAgentPreparedActionPublic(right);
    return stableSerialize(normalizedLeft) === stableSerialize(normalizedRight);
  } catch {
    return false;
  }
}
