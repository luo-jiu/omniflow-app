import {
  AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
  AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
  AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
  AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
  AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND,
  AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  AGENT_SHELL_PREPARED_ACTION_VERSION,
  AGENT_SHELL_RUN_TOOL_NAME,
  type AgentFilePublishPreparedActionPublicV1,
  type AgentFileStagePreparedActionPublicV1,
  type AgentFileUploadPreparedActionPublicV1,
  type AgentMediaExtractAudioOutputFormat,
  type AgentMediaExtractAudioPreparedActionPublicV1,
  type AgentPreparedActionPublic,
} from './agent.types';
import { normalizeAgentShellPreparedActionPublicV1 } from './shell/agent-shell.types';

const MAX_OUTPUT_FILE_NAME_CHARACTERS = 255;
const MAX_TARGET_LABEL_CHARACTERS = 500;
const MAX_LOGICAL_PATH_UTF8_BYTES = 1_024;
const UTF8_ENCODER = new TextEncoder();
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FILE_STAGE_LOCAL_FIELDS = new Set(['kind', 'sourceKind', 'targetLabel', 'version']);
const FILE_STAGE_LOCAL_PATH_FIELDS = new Set([
  'kind', 'sourceDisplayName', 'sourceIdentity', 'sourceKind', 'sourcePath',
  'sourceSizeBytes', 'targetLabel', 'version',
]);
const FILE_STAGE_LIBRARY_FIELDS = new Set([
  'kind', 'libraryId', 'sourceDisplayName', 'sourceIdentity', 'sourceKind',
  'sourceNodeId', 'sourceSizeBytes', 'targetLabel', 'version',
]);
const FILE_PUBLISH_FIELDS = new Set([
  'conflictPolicy',
  'contentHash',
  'destinationKind',
  'displayName',
  'kind',
  'libraryId',
  'parentId',
  'providerId',
  'sizeBytes',
  'sourcePath',
  'suggestedFileName',
  'targetLabel',
  'version',
]);
const FILE_UPLOAD_FIELDS = new Set([
  'conflictPolicy', 'kind', 'libraryId', 'outputFileName', 'parentId', 'providerId',
  'sourceDisplayName', 'sourceIdentity', 'sourceKind', 'sourcePath', 'sourceSizeBytes',
  'targetLabel', 'version',
]);
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

function safeLocalPathLabel(value: unknown): string {
  const normalized = boundedText(value, '本机文件路径', 4_096);
  if (
    UTF8_ENCODER.encode(normalized).byteLength > 4_096
    || Array.from(normalized).some(character => character.charCodeAt(0) < 32)
  ) {
    throw new Error('本机文件路径无效');
  }
  return normalized;
}

function safeLogicalOutputPath(value: unknown): string {
  const normalized = boundedText(value, '工作区输出路径', MAX_LOGICAL_PATH_UTF8_BYTES);
  if (
    UTF8_ENCODER.encode(normalized).byteLength > MAX_LOGICAL_PATH_UTF8_BYTES
    || !normalized.startsWith('output/')
    || normalized.includes('\\')
    || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
    || Array.from(normalized).some(character => character.charCodeAt(0) < 32)
  ) {
    throw new Error('工作区输出路径无效');
  }
  return normalized;
}

function safeContentHash(value: unknown): string {
  const normalized = boundedText(value, '文件内容摘要', 80);
  if (!CONTENT_HASH_PATTERN.test(normalized)) throw new Error('文件内容摘要无效');
  return normalized;
}

function safeSizeBytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('文件大小无效');
  }
  return value;
}

export function normalizeAgentFileStagePreparedActionPublicV1(
  input: unknown,
): AgentFileStagePreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_FILE_STAGE_PREPARED_ACTION_KIND
    || source.version !== AGENT_FILE_STAGE_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  if (source.sourceKind === 'local-picker') {
    assertExactFields(source, FILE_STAGE_LOCAL_FIELDS);
    return {
      kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
      sourceKind: 'local-picker',
      targetLabel: safeTargetLabel(source.targetLabel),
      version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    };
  }
  if (source.sourceKind === 'local-path') {
    assertExactFields(source, FILE_STAGE_LOCAL_PATH_FIELDS);
    return {
      kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
      sourceDisplayName: safeFileName(source.sourceDisplayName),
      sourceIdentity: safeContentHash(source.sourceIdentity),
      sourceKind: 'local-path',
      sourcePath: safeLocalPathLabel(source.sourcePath),
      sourceSizeBytes: safeSizeBytes(source.sourceSizeBytes),
      targetLabel: safeTargetLabel(source.targetLabel),
      version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    };
  }
  if (source.sourceKind !== 'library-node') throw new Error('文件来源无效');
  assertExactFields(source, FILE_STAGE_LIBRARY_FIELDS);
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    libraryId: positiveId(source.libraryId, '资料库'),
    sourceDisplayName: safeFileName(source.sourceDisplayName),
    sourceIdentity: safeContentHash(source.sourceIdentity),
    sourceKind: 'library-node',
    sourceNodeId: positiveId(source.sourceNodeId, '资料库节点'),
    sourceSizeBytes: safeSizeBytes(source.sourceSizeBytes),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
  };
}

export function normalizeAgentFileUploadPreparedActionPublicV1(
  input: unknown,
): AgentFileUploadPreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND
    || source.version !== AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  assertExactFields(source, FILE_UPLOAD_FIELDS);
  const conflictPolicy = source.conflictPolicy === 'fail' || source.conflictPolicy === 'rename'
    ? source.conflictPolicy
    : null;
  const providerId = boundedText(source.providerId, '存储服务', 128);
  if (
    !conflictPolicy
    || source.sourceKind !== 'local-path'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(providerId)
  ) {
    throw new Error('本机文件上传动作无效');
  }
  return {
    conflictPolicy,
    kind: AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND,
    libraryId: positiveId(source.libraryId, '资料库'),
    outputFileName: safeFileName(source.outputFileName),
    parentId: positiveId(source.parentId, '目标目录'),
    providerId,
    sourceDisplayName: safeFileName(source.sourceDisplayName),
    sourceIdentity: safeContentHash(source.sourceIdentity),
    sourceKind: 'local-path',
    sourcePath: safeLocalPathLabel(source.sourcePath),
    sourceSizeBytes: safeSizeBytes(source.sourceSizeBytes),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION,
  };
}

export function normalizeAgentFilePublishPreparedActionPublicV1(
  input: unknown,
): AgentFilePublishPreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND
    || source.version !== AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  assertExactFields(source, FILE_PUBLISH_FIELDS);
  if (source.destinationKind !== 'local-save-as' && source.destinationKind !== 'library') {
    throw new Error('文件发布目标无效');
  }
  const base = {
    contentHash: safeContentHash(source.contentHash),
    displayName: safeFileName(source.displayName),
    kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
    sizeBytes: safeSizeBytes(source.sizeBytes),
    sourcePath: safeLogicalOutputPath(source.sourcePath),
    suggestedFileName: safeFileName(source.suggestedFileName),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
  };
  if (source.destinationKind === 'local-save-as') {
    if (
      source.conflictPolicy !== undefined
      || source.libraryId !== undefined
      || source.parentId !== undefined
      || source.providerId !== undefined
    ) {
      throw new Error('本机文件发布目标包含资料库字段');
    }
    return { ...base, destinationKind: 'local-save-as' };
  }
  const conflictPolicy = source.conflictPolicy === 'fail' || source.conflictPolicy === 'rename'
    ? source.conflictPolicy
    : null;
  const providerId = boundedText(source.providerId, '存储服务', 128);
  if (!conflictPolicy || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(providerId)) {
    throw new Error('资料库文件发布目标无效');
  }
  return {
    ...base,
    conflictPolicy,
    destinationKind: 'library',
    libraryId: positiveId(source.libraryId, '资料库'),
    parentId: positiveId(source.parentId, '目标目录'),
    providerId,
  };
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
    source.kind === AGENT_FILE_STAGE_PREPARED_ACTION_KIND
    && source.version === AGENT_FILE_STAGE_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentFileStagePreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND
    && source.version === AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentFilePublishPreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND
    && source.version === AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentFileUploadPreparedActionPublicV1(source);
  }
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
