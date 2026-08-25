import type { AgentPreparedActionPublic } from './agent.types';

const MAX_OUTPUT_FILE_NAME_CHARACTERS = 255;
const MAX_OUTPUT_FORMAT_CHARACTERS = 32;
const MAX_TARGET_LABEL_CHARACTERS = 500;

function positiveId(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${label}无效`);
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

export function normalizeAgentPreparedActionPublic(
  input: unknown,
): AgentPreparedActionPublic {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Agent prepared action 无效');
  }
  const source = input as Record<string, unknown>;
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
  const parentId = source.parentId === undefined
    ? undefined
    : positiveId(source.parentId, '目标目录');
  if (destination === 'library' && !parentId) {
    throw new Error('资料库目标目录无效');
  }
  return {
    conflictPolicy,
    destination,
    fallbackPolicy: destination === 'local' ? 'none' : fallbackPolicy,
    libraryId: positiveId(source.libraryId, '资料库'),
    outputFileName: safeFileName(source.outputFileName),
    outputFormat: boundedText(source.outputFormat, '输出格式', MAX_OUTPUT_FORMAT_CHARACTERS)
      .toLowerCase(),
    ...(destination === 'library' && parentId ? { parentId } : {}),
    sourceNodeId: positiveId(source.sourceNodeId, '源文件'),
    targetLabel: boundedText(source.targetLabel, '目标位置', MAX_TARGET_LABEL_CHARACTERS),
  };
}

export function equalAgentPreparedActionPublic(
  left: AgentPreparedActionPublic,
  right: AgentPreparedActionPublic,
): boolean {
  return left.conflictPolicy === right.conflictPolicy
    && left.destination === right.destination
    && left.fallbackPolicy === right.fallbackPolicy
    && left.libraryId === right.libraryId
    && left.outputFileName === right.outputFileName
    && left.outputFormat === right.outputFormat
    && left.parentId === right.parentId
    && left.sourceNodeId === right.sourceNodeId
    && left.targetLabel === right.targetLabel;
}
