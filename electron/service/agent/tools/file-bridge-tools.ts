import {
  type AgentPreparedActionPublic,
  type AgentToolResult,
} from '../../../../src/shared/agent/agent.types';
import {
  AGENT_LIBRARY_DIRECTORY_PATH_MAX_BYTES,
  normalizeAgentLibraryDirectoryPath,
} from '../../../../src/shared/agent/agent-library-path';
import { normalizeAgentShellLogicalPath } from '../../../../src/shared/agent/shell/agent-shell.types';
import {
  AGENT_LOCAL_PATH_MAX_BYTES,
  normalizeAgentLocalPathExpression,
} from './agent-local-file';
import { toAgentProviderToolName } from '../agent-provider-tool-name';
import type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolMainPreparationContext,
  AgentToolMainPreparationResult,
} from '../agent-tool-registry';

const FILE_STAGE_REGISTRATION_ID = 'file.stage@1';
const FILE_PUBLISH_REGISTRATION_ID = 'file.publish@1';
const FILE_UPLOAD_REGISTRATION_ID = 'file.upload@1';
const MAX_LOGICAL_PATH_BYTES = 1_024;
const MAX_FILE_NAME_BYTES = 240;

export interface AgentFileBridgeToolRuntime {
  readonly executePublish: (context: AgentToolExecutionContext) => Promise<AgentToolResult>;
  readonly executeStage: (context: AgentToolExecutionContext) => Promise<AgentToolResult>;
  readonly executeUpload: (context: AgentToolExecutionContext) => Promise<AgentToolResult>;
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
  readonly prepareUpload: (
    input: unknown,
    requestedAction: AgentPreparedActionPublic | undefined,
    context: AgentToolMainPreparationContext,
  ) => Promise<AgentToolMainPreparationResult>;
}

export interface AgentFileStageInputV1 {
  source:
    | { kind: 'library-node'; nodeId: number }
    | { kind: 'local-path'; path: string }
    | { kind: 'local-picker' };
}

interface AgentLibraryDestinationOptions {
  conflictPolicy?: 'fail' | 'rename';
  fileName?: string;
  providerId?: string;
}

export interface AgentFilePublishInputV1 {
  destination:
    | (AgentLibraryDestinationOptions & {
        kind: 'library';
        parentId: number;
      })
    | (AgentLibraryDestinationOptions & {
        directoryPath: string;
        kind: 'library-path';
      })
    | { kind: 'local-save-as'; suggestedFileName?: string };
  sourcePath: string;
}

export interface AgentFileUploadInputV1 {
  destination:
    | (AgentLibraryDestinationOptions & {
        kind: 'library';
        parentId: number;
      })
    | (AgentLibraryDestinationOptions & {
        directoryPath: string;
        kind: 'library-path';
      });
  source: { kind: 'local-path'; path: string };
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
    source.kind === 'local-path'
    && exactKeys(source, ['kind', 'path'])
  ) {
    const localPath = normalizeAgentLocalPathExpression(source.path);
    return { source: { kind: 'local-path', path: localPath.displayPath } };
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

function normalizeLibraryDestination(
  input: Record<string, unknown>,
): AgentFileUploadInputV1['destination'] {
  const commonValid = (input.conflictPolicy === undefined
      || input.conflictPolicy === 'rename'
      || input.conflictPolicy === 'fail')
    && (input.providerId === undefined
      || (typeof input.providerId === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.providerId)));
  if (!commonValid) throw new Error('资料库文件目标无效');
  const options = {
    ...(input.conflictPolicy ? { conflictPolicy: input.conflictPolicy as 'fail' | 'rename' } : {}),
    ...(safeFileName(input.fileName, '发布文件名')
      ? { fileName: safeFileName(input.fileName, '发布文件名') }
      : {}),
    ...(input.providerId ? { providerId: input.providerId as string } : {}),
  };
  if (
    input.kind === 'library'
    && exactKeys(input, ['conflictPolicy', 'fileName', 'kind', 'parentId', 'providerId'])
    && typeof input.parentId === 'number'
    && Number.isSafeInteger(input.parentId)
    && input.parentId > 0
  ) {
    return { kind: 'library', parentId: input.parentId, ...options };
  }
  if (
    input.kind === 'library-path'
    && exactKeys(input, ['conflictPolicy', 'directoryPath', 'fileName', 'kind', 'providerId'])
  ) {
    return {
      directoryPath: normalizeAgentLibraryDirectoryPath(input.directoryPath),
      kind: 'library-path',
      ...options,
    };
  }
  throw new Error('资料库文件目标无效');
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
  return { destination: normalizeLibraryDestination(destination), sourcePath };
}

export function normalizeAgentFileUploadInputV1(input: unknown): AgentFileUploadInputV1 {
  if (
    !isStrictObject(input)
    || !exactKeys(input, ['destination', 'source'])
    || !isStrictObject(input.destination)
    || !isStrictObject(input.source)
    || input.source.kind !== 'local-path'
    || !exactKeys(input.source, ['kind', 'path'])
  ) {
    throw new Error('文件上传参数无效');
  }
  const localPath = normalizeAgentLocalPathExpression(input.source.path);
  return {
    destination: normalizeLibraryDestination(input.destination),
    source: { kind: 'local-path', path: localPath.displayPath },
  };
}

const stageInputSchema = {
  additionalProperties: false,
  properties: {
    source: {
      description: '要进入当前 Run input 目录的单个普通文件来源。用户已经给出本机路径时使用 local-path；没有路径且需要用户选择时才使用 local-picker。',
      oneOf: [{
        additionalProperties: false,
        description: '当前 OmniFlow 资料库中已知节点 ID 对应的普通文件。',
        properties: {
          kind: { const: 'library-node', type: 'string' },
          nodeId: { minimum: 1, type: 'integer' },
        },
        required: ['kind', 'nodeId'],
        type: 'object',
      }, {
        additionalProperties: false,
        description: '用户在当前请求中明确给出的当前平台绝对路径或 ~/ 路径。',
        properties: {
          kind: { const: 'local-path', type: 'string' },
          path: {
            description: '当前平台绝对路径或 ~/ 路径；不能是相对路径或目录。',
            maxLength: AGENT_LOCAL_PATH_MAX_BYTES,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['kind', 'path'],
        type: 'object',
      }, {
        additionalProperties: false,
        description: '仅当用户没有提供本机路径时，执行阶段打开系统文件选择器。',
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
      description: '工作区输出文件的落点；资料库可用已知目录节点 ID 或从根开始的绝对逻辑路径，本机位置由系统 Save As 选择。',
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
        description: '从当前资料库根开始的已存在目录逻辑路径。',
        properties: {
          conflictPolicy: { enum: ['rename', 'fail'], type: 'string' },
          directoryPath: {
            description: '以 / 开头的资料库目录路径，不是本机文件系统路径。',
            maxLength: AGENT_LIBRARY_DIRECTORY_PATH_MAX_BYTES,
            minLength: 1,
            type: 'string',
          },
          fileName: { maxLength: MAX_FILE_NAME_BYTES, minLength: 1, type: 'string' },
          kind: { const: 'library-path', type: 'string' },
          providerId: {
            maxLength: 128,
            minLength: 1,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
            type: 'string',
          },
        },
        required: ['kind', 'directoryPath'],
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

const uploadInputSchema = {
  additionalProperties: false,
  properties: {
    destination: {
      description: '当前资料库中已存在的目标目录。',
      oneOf: publishInputSchema.properties.destination.oneOf.slice(0, 2),
    },
    source: {
      additionalProperties: false,
      description: '要保持原字节传输的单个本机普通文件；必须使用用户已经给出的路径，不打开系统文件选择器。',
      properties: {
        kind: { const: 'local-path', type: 'string' },
        path: {
          description: '当前平台绝对路径或 ~/ 路径；不能是相对路径或目录。',
          maxLength: AGENT_LOCAL_PATH_MAX_BYTES,
          minLength: 1,
          type: 'string',
        },
      },
      required: ['kind', 'path'],
      type: 'object',
    },
  },
  required: ['destination', 'source'],
  type: 'object',
} as const;

export function createAgentFileBridgeTools(runtime: AgentFileBridgeToolRuntime): readonly AgentTool[] {
  if (
    !runtime?.prepareStage
    || !runtime.executeStage
    || !runtime.preparePublish
    || !runtime.executePublish
    || !runtime.prepareUpload
    || !runtime.executeUpload
  ) {
    throw new Error('Agent 文件桥 Tool 缺少生产运行时');
  }
  const providerToolName = toAgentProviderToolName;
  const stageTool: AgentTool = {
    cancellationSettleTimeoutMs: 45_000,
    description: `把一个本机普通文件或当前资料库中的普通文件暂存到当前 Run 的 input 目录，返回逻辑路径、大小和 SHA-256。本机来源可使用用户明确给出的绝对路径或 ~/ 路径；只有用户没有给路径时才使用系统文件选择器。此 Tool 只用于需要工作副本的修改、转换或生成流程；仅查看、概括或分析用户明确给出的宿主绝对路径时，应使用 ${providerToolName('shell.run')} 直接读取原路径，不要暂存。原样传输应使用 ${providerToolName('file.upload')}。`,
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
    description: `把当前 Run 的 output 目录中的一个普通文件发布到资料库目录或通过系统 Save As 保存到本机。资料库目标既可使用目录节点 ID，也可使用从当前资料库根开始的绝对目录路径；不要用 ${providerToolName('file.list')} 猜测嵌套目录。`,
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
  const uploadTool: AgentTool = {
    cancellationSettleTimeoutMs: 45_000,
    description: `原样传输一个用户明确给出绝对路径或 ~/ 路径的本机普通文件到当前 OmniFlow 资料库。资料库目标可用目录节点 ID 或从根开始的绝对目录路径；此 Tool 直接完成传输，不需要先 ${providerToolName('file.stage')}，也不会打开系统文件选择器。需要先查看或检查原文件时，使用 ${providerToolName('shell.run')} 直接读取原路径，确认无需修改后仍可使用本 Tool；只有需要工作副本来修改、转换或生成新文件时，才使用 ${providerToolName('file.stage')}、${providerToolName('shell.run')} 和 ${providerToolName('file.publish')}。`,
    execute: async (_input, context) => runtime.executeUpload(context),
    executor: 'main',
    inputSchema: uploadInputSchema,
    name: 'file.upload',
    prepareMain: (input, requestedAction, context) => runtime.prepareUpload(
      input,
      requestedAction,
      context,
    ),
    registrationId: FILE_UPLOAD_REGISTRATION_ID,
    risk: 'write',
    timeoutMs: 30 * 60 * 1_000,
    validate(input) {
      try {
        normalizeAgentFileUploadInputV1(input);
        return { ok: true as const };
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : '文件上传参数无效',
          ok: false as const,
        };
      }
    },
  };
  return Object.freeze([
    Object.freeze(stageTool),
    Object.freeze(publishTool),
    Object.freeze(uploadTool),
  ]);
}

export const __agentFileBridgeToolTestOnly = Object.freeze({
  normalizeFilePublishInput: normalizeAgentFilePublishInputV1,
  normalizeFileStageInput: normalizeAgentFileStageInputV1,
  normalizeFileUploadInput: normalizeAgentFileUploadInputV1,
});
