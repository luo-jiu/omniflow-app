import {
  type AgentPreparedActionPublic,
  type AgentToolResult,
} from '../../../../src/shared/agent/agent.types';
import { normalizeAgentShellLogicalPath } from '../../../../src/shared/agent/shell/agent-shell.types';
import type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolMainPreparationContext,
  AgentToolMainPreparationResult,
} from '../agent-tool-registry';

const FILE_STAGE_REGISTRATION_ID = 'file.stage@1';
const FILE_PUBLISH_REGISTRATION_ID = 'file.publish@1';
const MAX_LOGICAL_PATH_BYTES = 1_024;
const MAX_FILE_NAME_BYTES = 240;

export interface AgentFileBridgeToolRuntime {
  readonly executePublish: (context: AgentToolExecutionContext) => Promise<AgentToolResult>;
  readonly executeStage: (context: AgentToolExecutionContext) => Promise<AgentToolResult>;
  readonly preparePublish: (
    input: unknown,
    requestedAction: AgentPreparedActionPublic | undefined,
    context: AgentToolMainPreparationContext,
  ) => Promise<AgentToolMainPreparationResult>;
  readonly prepareStage: (
    input: unknown,
    requestedAction: AgentPreparedActionPublic | undefined,
    context: AgentToolMainPreparationContext,
  ) => Promise<AgentToolMainPreparationResult>;
}

export interface AgentFileStageInputV1 {
  source: { kind: 'library-node'; nodeId: number } | { kind: 'local-picker' };
}

export interface AgentFilePublishInputV1 {
  destination:
    | {
        conflictPolicy?: 'fail' | 'rename';
        fileName?: string;
        kind: 'library';
        parentId: number;
        providerId?: string;
      }
    | { kind: 'local-save-as'; suggestedFileName?: string };
  sourcePath: string;
}

function isStrictObject(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  const fields = new Set(allowed);
  return Object.keys(input).every(key => fields.has(key));
}

export function normalizeAgentFileStageInputV1(input: unknown): AgentFileStageInputV1 {
  if (!isStrictObject(input) || !exactKeys(input, ['source']) || !isStrictObject(input.source)) {
    throw new Error('文件暂存参数无效');
  }
  const source = input.source;
  if (source.kind === 'local-picker' && exactKeys(source, ['kind'])) {
    return { source: { kind: 'local-picker' } };
  }
  if (
    source.kind === 'library-node'
    && exactKeys(source, ['kind', 'nodeId'])
    && typeof source.nodeId === 'number'
    && Number.isSafeInteger(source.nodeId)
    && source.nodeId > 0
  ) {
    return { source: { kind: 'library-node', nodeId: source.nodeId } };
  }
  throw new Error('文件暂存来源无效');
}

function safeFileName(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${label}无效`);
  const normalized = value.trim();
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || Buffer.byteLength(normalized, 'utf8') > MAX_FILE_NAME_BYTES
    || Array.from(normalized).some(character => (
      character === '/'
      || character === '\\'
      || character.charCodeAt(0) < 32
    ))
  ) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

export function normalizeAgentFilePublishInputV1(input: unknown): AgentFilePublishInputV1 {
  if (
    !isStrictObject(input)
    || !exactKeys(input, ['destination', 'sourcePath'])
    || typeof input.sourcePath !== 'string'
    || Buffer.byteLength(input.sourcePath, 'utf8') > MAX_LOGICAL_PATH_BYTES
    || !isStrictObject(input.destination)
  ) {
    throw new Error('文件发布参数无效');
  }
  const sourcePath = normalizeAgentShellLogicalPath(input.sourcePath);
  if (!sourcePath.startsWith('output/')) {
    throw new Error('文件发布只接受 output 下的逻辑路径');
  }
  const destination = input.destination;
  if (destination.kind === 'local-save-as' && exactKeys(destination, ['kind', 'suggestedFileName'])) {
    return {
      destination: {
        kind: 'local-save-as',
        ...(safeFileName(destination.suggestedFileName, '建议文件名')
          ? { suggestedFileName: safeFileName(destination.suggestedFileName, '建议文件名') }
          : {}),
      },
      sourcePath,
    };
  }
  if (
    destination.kind === 'library'
    && exactKeys(destination, ['conflictPolicy', 'fileName', 'kind', 'parentId', 'providerId'])
    && typeof destination.parentId === 'number'
    && Number.isSafeInteger(destination.parentId)
    && destination.parentId > 0
    && (destination.conflictPolicy === undefined
      || destination.conflictPolicy === 'rename'
      || destination.conflictPolicy === 'fail')
    && (destination.providerId === undefined
      || (typeof destination.providerId === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(destination.providerId)))
  ) {
    return {
      destination: {
        kind: 'library',
        parentId: destination.parentId,
        ...(destination.conflictPolicy ? { conflictPolicy: destination.conflictPolicy } : {}),
        ...(safeFileName(destination.fileName, '发布文件名')
          ? { fileName: safeFileName(destination.fileName, '发布文件名') }
          : {}),
        ...(destination.providerId ? { providerId: destination.providerId } : {}),
      },
      sourcePath,
    };
  }
  throw new Error('文件发布目标无效');
}

const stageInputSchema = {
  additionalProperties: false,
  properties: {
    source: {
      oneOf: [{
        additionalProperties: false,
        properties: {
          kind: { const: 'library-node', type: 'string' },
          nodeId: { minimum: 1, type: 'integer' },
        },
        required: ['kind', 'nodeId'],
        type: 'object',
      }, {
        additionalProperties: false,
        properties: { kind: { const: 'local-picker', type: 'string' } },
        required: ['kind'],
        type: 'object',
      }],
    },
  },
  required: ['source'],
  type: 'object',
} as const;

const publishInputSchema = {
  additionalProperties: false,
  properties: {
    destination: {
      oneOf: [{
        additionalProperties: false,
        properties: {
          conflictPolicy: { enum: ['rename', 'fail'], type: 'string' },
          fileName: { maxLength: MAX_FILE_NAME_BYTES, minLength: 1, type: 'string' },
          kind: { const: 'library', type: 'string' },
          parentId: { minimum: 1, type: 'integer' },
          providerId: {
            maxLength: 128,
            minLength: 1,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
            type: 'string',
          },
        },
        required: ['kind', 'parentId'],
        type: 'object',
      }, {
        additionalProperties: false,
        properties: {
          kind: { const: 'local-save-as', type: 'string' },
          suggestedFileName: { maxLength: MAX_FILE_NAME_BYTES, minLength: 1, type: 'string' },
        },
        required: ['kind'],
        type: 'object',
      }],
    },
    sourcePath: { maxLength: MAX_LOGICAL_PATH_BYTES, minLength: 8, type: 'string' },
  },
  required: ['destination', 'sourcePath'],
  type: 'object',
} as const;

export function createAgentFileBridgeTools(runtime: AgentFileBridgeToolRuntime): readonly AgentTool[] {
  if (
    !runtime?.prepareStage
    || !runtime.executeStage
    || !runtime.preparePublish
    || !runtime.executePublish
  ) {
    throw new Error('Agent 文件桥 Tool 缺少生产运行时');
  }
  const stageTool: AgentTool = {
    cancellationSettleTimeoutMs: 45_000,
    description: '把一个本机普通文件或当前资料库中的普通文件暂存到当前 Run 的 input 目录，返回逻辑路径、大小和 SHA-256。资料库文件需指定节点 ID；本机文件由用户通过系统文件选择器确认。',
    execute: async (_input, context) => runtime.executeStage(context),
    executor: 'main',
    inputSchema: stageInputSchema,
    name: 'file.stage',
    prepareMain: (input, requestedAction, context) => runtime.prepareStage(
      input,
      requestedAction,
      context,
    ),
    registrationId: FILE_STAGE_REGISTRATION_ID,
    risk: 'write',
    timeoutMs: 30 * 60 * 1_000,
    validate(input) {
      try {
        normalizeAgentFileStageInputV1(input);
        return { ok: true as const };
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : '文件暂存参数无效',
          ok: false as const,
        };
      }
    },
  };
  const publishTool: AgentTool = {
    cancellationSettleTimeoutMs: 45_000,
    description: '把当前 Run 的 output 目录中的一个普通文件发布到资料库目录或通过系统 Save As 保存到本机，返回安全的文件名、大小和 SHA-256。',
    execute: async (_input, context) => runtime.executePublish(context),
    executor: 'main',
    inputSchema: publishInputSchema,
    name: 'file.publish',
    prepareMain: (input, requestedAction, context) => runtime.preparePublish(
      input,
      requestedAction,
      context,
    ),
    registrationId: FILE_PUBLISH_REGISTRATION_ID,
    risk: 'write',
    timeoutMs: 30 * 60 * 1_000,
    validate(input) {
      try {
        normalizeAgentFilePublishInputV1(input);
        return { ok: true as const };
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : '文件发布参数无效',
          ok: false as const,
        };
      }
    },
  };
  return Object.freeze([
    Object.freeze(stageTool),
    Object.freeze(publishTool),
  ]);
}

export const __agentFileBridgeToolTestOnly = Object.freeze({
  normalizeFilePublishInput: normalizeAgentFilePublishInputV1,
  normalizeFileStageInput: normalizeAgentFileStageInputV1,
});
