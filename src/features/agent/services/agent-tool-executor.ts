import type {
  AgentAppContext,
  AgentMediaAudioExtractionRequest,
  AgentMediaInspectionRequest,
  AgentToolExecutionProgressRequest,
  AgentToolExecutionRequest,
  AgentToolProgress,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import {
  createNode,
  getFileLink,
} from '@/features/file-explorer/services/file.api';
import {
  extractAgentMediaAudio,
  inspectAgentMedia,
  releaseAgentMediaArtifact,
  reportAgentToolExecutionProgress,
  saveAgentMediaArtifact,
  uploadAgentMediaArtifact,
} from './agent.api';
import { readAgentPerception } from './agent-context.api';
import { buildFileFullName } from '@/utils/fileTreeSettings';

interface DirectoryCreateExecutionInput {
  conflictPolicy: 'error';
  libraryId: number;
  name: string;
  parentId: number;
}

interface MediaInspectExecutionInput {
  fileName: string;
  libraryId: number;
  mimeType?: string;
  nodeId: number;
}

interface MediaExtractAudioExecutionBase {
  conflictPolicy: 'auto_rename';
  libraryId: number;
  mimeType?: string;
  nodeId: number;
  outputFileName: string;
  outputFormat: 'm4a' | 'mp3' | 'wav';
  preparedActionId: string;
  snapshotHash: string;
  sourceFileName: string;
}

type MediaExtractAudioExecutionInput = MediaExtractAudioExecutionBase & (
  | {
      destination: 'library';
      fallbackPolicy: 'prompt_local' | 'none';
      parentId: number;
      storageProvider: string;
    }
  | {
      destination: 'local';
      fallbackPolicy: 'none';
      parentId?: never;
      storageProvider?: never;
    }
);

type LibraryMediaExtractAudioExecutionInput = Extract<
  MediaExtractAudioExecutionInput,
  { destination: 'library' }
>;

type AgentUploadCommitState = 'uncommitted' | 'commit_unknown' | 'committed';

export interface AgentRendererToolOutcome {
  committed?: boolean;
  perception?: Awaited<ReturnType<typeof readAgentPerception>>;
  result: AgentToolResult;
}

export interface AgentRendererToolExecutorDependencies {
  createDirectory?: typeof createNode;
  extractMediaAudio?: typeof extractAgentMediaAudio;
  getMediaFileLink?: typeof getFileLink;
  inspectMedia?: typeof inspectAgentMedia;
  onCommitted?: (result: AgentToolResult) => Promise<void> | void;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
  readPerception?: (appContext: AgentAppContext) => ReturnType<typeof readAgentPerception>;
  releaseMediaArtifact?: typeof releaseAgentMediaArtifact;
  reportProgress?: typeof reportAgentToolExecutionProgress;
  saveMediaArtifact?: typeof saveAgentMediaArtifact;
  signal?: AbortSignal;
  uploadMediaArtifact?: typeof uploadAgentMediaArtifact;
}

function abortError(): Error {
  const error = new Error('Agent Tool 已取消');
  error.name = 'AbortError';
  return error;
}

class AgentMediaArtifactUncommittedError extends Error {
  constructor() {
    super('Agent 媒体产物上传未提交');
    this.name = 'AgentMediaArtifactUncommittedError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (error instanceof Error && error.name === 'AbortError');
}

async function submitAuthoritativeCommit(
  callback: AgentRendererToolExecutorDependencies['onCommitted'],
  result: AgentToolResult,
): Promise<void> {
  try {
    await callback?.(result);
  } catch {
    // The business write is already authoritative; final completion gets one more delivery attempt.
  }
}

function resolveCreatedNode(input: unknown, fallbackName: string): {
  id?: number;
  name: string;
} {
  const source = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {};
  const id = Number(source.id);
  const baseName = String(source.name || '').trim();
  const ext = String(source.ext || '').trim();
  return {
    ...(Number.isFinite(id) && id > 0 ? { id } : {}),
    name: baseName ? buildFileFullName(baseName, ext) : fallbackName,
  };
}

function perceptionContainsNode(
  perception: AgentRendererToolOutcome['perception'],
  parentId: number,
  nodeId?: number,
): boolean {
  return Boolean(
    nodeId
    && perception?.currentDirectory?.id === parentId
    && perception.currentDirectory.entries.some(entry => entry.id === nodeId),
  );
}

function normalizeMediaInspectInput(
  request: AgentToolExecutionRequest,
): MediaInspectExecutionInput {
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) {
    throw new Error('媒体检查的执行参数无效');
  }
  const source = request.input as Record<string, unknown>;
  const libraryId = Number(source.libraryId);
  const nodeId = Number(source.nodeId);
  const fileName = String(source.fileName || '').trim();
  const mimeType = String(source.mimeType || '').trim() || undefined;
  if (
    !Number.isFinite(libraryId)
    || libraryId <= 0
    || libraryId !== Number(request.appContext.libraryId)
    || !Number.isFinite(nodeId)
    || nodeId <= 0
    || !fileName
  ) {
    throw new Error('媒体检查的执行参数无效');
  }
  return {
    fileName,
    libraryId,
    ...(mimeType ? { mimeType } : {}),
    nodeId,
  };
}

function normalizeDirectoryCreateInput(
  request: AgentToolExecutionRequest,
): DirectoryCreateExecutionInput {
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) {
    throw new Error('创建文件夹的执行参数无效');
  }
  const source = request.input as Record<string, unknown>;
  const libraryId = Number(source.libraryId);
  const parentId = Number(source.parentId);
  const name = String(source.name || '').trim();
  if (
    source.conflictPolicy !== 'error'
    || !Number.isFinite(libraryId)
    || libraryId <= 0
    || !Number.isFinite(parentId)
    || parentId <= 0
    || !name
  ) {
    throw new Error('创建文件夹的执行参数无效');
  }
  if (
    libraryId !== Number(request.appContext.libraryId)
    || parentId !== Number(request.appContext.currentDirectory?.id)
  ) {
    throw new Error('创建文件夹的目标上下文已经变化');
  }
  return { conflictPolicy: 'error', libraryId, name, parentId };
}

function normalizeMediaExtractAudioInput(
  request: AgentToolExecutionRequest,
): MediaExtractAudioExecutionInput {
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) {
    throw new Error('音频提取的执行参数无效');
  }
  const source = request.input as Record<string, unknown>;
  const libraryId = Number(source.libraryId);
  const parentId = Number(source.parentId);
  const nodeId = Number(source.nodeId);
  const sourceFileName = String(source.sourceFileName || '').trim();
  const outputFileName = String(source.outputFileName || '').trim();
  const outputFormat = String(source.outputFormat || '').trim().toLowerCase();
  const mimeType = String(source.mimeType || '').trim() || undefined;
  const destination = source.destination === 'library' || source.destination === 'local'
    ? source.destination
    : null;
  const fallbackPolicy = source.fallbackPolicy === 'prompt_local' || source.fallbackPolicy === 'none'
    ? source.fallbackPolicy
    : null;
  const preparedActionId = String(source.preparedActionId || '').trim();
  const snapshotHash = String(source.snapshotHash || '').trim();
  const storageProvider = String(source.storageProvider || '').trim() || undefined;
  const validFormat = outputFormat === 'm4a' || outputFormat === 'mp3' || outputFormat === 'wav';
  const hasUnsafeFileName = (value: string) => (
    !value
    || value === '.'
    || value === '..'
    || Array.from(value).some(character => (
      character === '/'
      || character === '\\'
      || character.charCodeAt(0) < 32
    ))
  );
  if (
    source.conflictPolicy !== 'auto_rename'
    || !Number.isFinite(libraryId)
    || libraryId <= 0
    || !destination
    || !fallbackPolicy
    || (destination === 'library' && (!Number.isFinite(parentId) || parentId <= 0))
    || (destination === 'library' && !storageProvider)
    || (destination === 'local' && fallbackPolicy !== 'none')
    || (destination === 'local' && (source.parentId !== undefined || source.storageProvider !== undefined))
    || !Number.isFinite(nodeId)
    || nodeId <= 0
    || hasUnsafeFileName(sourceFileName)
    || hasUnsafeFileName(outputFileName)
    || !validFormat
    || !outputFileName.toLowerCase().endsWith(`.${outputFormat}`)
    || !preparedActionId
    || !snapshotHash
  ) {
    throw new Error('音频提取的执行参数无效');
  }
  if (
    libraryId !== Number(request.appContext.libraryId)
  ) {
    throw new Error('音频提取的目标上下文已经变化');
  }
  const base: MediaExtractAudioExecutionBase = {
    conflictPolicy: 'auto_rename',
    libraryId,
    ...(mimeType ? { mimeType } : {}),
    nodeId,
    outputFileName,
    outputFormat,
    preparedActionId,
    snapshotHash,
    sourceFileName,
  };
  return destination === 'library'
    ? {
        ...base,
        destination,
        fallbackPolicy,
        parentId,
        storageProvider: storageProvider as string,
      }
    : { ...base, destination, fallbackPolicy: 'none' };
}

function buildUploadStateData(
  state: AgentUploadCommitState,
  input: MediaExtractAudioExecutionInput,
): Record<string, unknown> {
  return {
    destination: input.destination,
    format: input.outputFormat,
    name: input.outputFileName,
    ...(input.destination === 'library' ? { parentId: input.parentId } : {}),
    uploadCommitState: state,
  };
}

export async function executeAgentRendererTool(
  request: AgentToolExecutionRequest,
  dependencies: AgentRendererToolExecutorDependencies = {},
): Promise<AgentRendererToolOutcome> {
  throwIfAborted(dependencies.signal);
  if (request.toolName === 'media.inspect') {
    return executeMediaInspect(request, dependencies);
  }
  if (request.toolName === 'media.extractAudio') {
    return executeMediaExtractAudio(request, dependencies);
  }
  if (request.toolName !== 'directory.create') {
    return {
      result: { message: `不支持的 Renderer Agent Tool：${request.toolName}`, ok: false },
    };
  }

  let input: DirectoryCreateExecutionInput;
  try {
    input = normalizeDirectoryCreateInput(request);
  } catch (error) {
    if (isAbortError(error, dependencies.signal)) throw error;
    return {
      result: {
        message: error instanceof Error ? error.message : '创建文件夹的执行参数无效',
        ok: false,
      },
    };
  }

  const createDirectory = dependencies.createDirectory || createNode;
  try {
    const created = await createDirectory({
      conflictPolicy: input.conflictPolicy,
      libraryId: input.libraryId,
      name: input.name,
      parentId: input.parentId,
      type: 'dir',
    });
    const committedResult = buildDirectoryCreateResult(created, input, false, false);
    await submitAuthoritativeCommit(dependencies.onCommitted, committedResult);
    return await finishDirectoryCreateExecution(created, input, request, dependencies);
  } catch (error) {
    return {
      result: {
        message: error instanceof Error ? error.message : '创建文件夹失败',
        ok: false,
      },
    };
  }
}

async function executeMediaInspect(
  request: AgentToolExecutionRequest,
  dependencies: AgentRendererToolExecutorDependencies,
): Promise<AgentRendererToolOutcome> {
  let input: MediaInspectExecutionInput;
  try {
    input = normalizeMediaInspectInput(request);
  } catch (error) {
    return {
      result: {
        message: error instanceof Error ? error.message : '媒体检查的执行参数无效',
        ok: false,
      },
    };
  }

  try {
    const getMediaFileLink = dependencies.getMediaFileLink || getFileLink;
    const sourceUrl = String(await getMediaFileLink(input.nodeId, input.libraryId, 2) || '').trim();
    if (!sourceUrl) throw new Error('无法取得媒体文件的临时访问链接');
    const inspectMedia = dependencies.inspectMedia || inspectAgentMedia;
    const inspectionRequest: AgentMediaInspectionRequest = {
      executionId: request.executionId,
      fileName: input.fileName,
      libraryId: input.libraryId,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      nodeId: input.nodeId,
      ownerScope: request.ownerScope,
      runId: request.runId,
      sessionId: request.sessionId,
      sourceUrl,
    };
    return { result: await inspectMedia(inspectionRequest) };
  } catch (error) {
    if (isAbortError(error, dependencies.signal)) throw error;
    return {
      result: {
        message: error instanceof Error ? error.message : '媒体信息读取失败',
        ok: false,
      },
    };
  }
}

async function executeMediaExtractAudio(
  request: AgentToolExecutionRequest,
  dependencies: AgentRendererToolExecutorDependencies,
): Promise<AgentRendererToolOutcome> {
  let input: MediaExtractAudioExecutionInput;
  try {
    input = normalizeMediaExtractAudioInput(request);
  } catch (error) {
    return {
      result: {
        message: error instanceof Error ? error.message : '音频提取的执行参数无效',
        ok: false,
      },
    };
  }

  const signal = dependencies.signal;
  const getMediaFileLink = dependencies.getMediaFileLink || getFileLink;
  const extractMediaAudio = dependencies.extractMediaAudio || extractAgentMediaAudio;
  const releaseMediaArtifact = dependencies.releaseMediaArtifact || releaseAgentMediaArtifact;
  const saveMediaArtifact = dependencies.saveMediaArtifact || saveAgentMediaArtifact;
  const uploadMediaArtifact = dependencies.uploadMediaArtifact || uploadAgentMediaArtifact;
  const reportProgress = dependencies.reportProgress || reportAgentToolExecutionProgress;
  let artifactId = '';

  const emitProgress = (progress: AgentToolProgress) => {
    const payload: AgentToolExecutionProgressRequest = {
      executionId: request.executionId,
      libraryId: input.libraryId,
      ownerScope: request.ownerScope,
      progress,
      runId: request.runId,
      sessionId: request.sessionId,
    };
    void reportProgress(payload).catch(() => undefined);
  };
  try {
    throwIfAborted(signal);
    const sourceUrl = String(await getMediaFileLink(input.nodeId, input.libraryId, 360) || '').trim();
    throwIfAborted(signal);
    if (!sourceUrl) throw new Error('无法取得媒体文件的临时访问链接');

    const extractionRequest: AgentMediaAudioExtractionRequest = {
      executionId: request.executionId,
      fileName: input.sourceFileName,
      libraryId: input.libraryId,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      nodeId: input.nodeId,
      outputFileName: input.outputFileName,
      outputFormat: input.outputFormat,
      ownerScope: request.ownerScope,
      runId: request.runId,
      sessionId: request.sessionId,
      sourceUrl,
    };
    const artifact = await extractMediaAudio(extractionRequest);
    artifactId = String(artifact?.artifactId || '').trim();
    if (
      !artifactId
      || String(artifact?.fileName || '') !== input.outputFileName
      || !Number.isFinite(Number(artifact?.sizeBytes))
      || Number(artifact.sizeBytes) <= 0
    ) {
      throw new Error('音频提取返回了无效的临时产物');
    }
    throwIfAborted(signal);
    if (input.destination === 'local') {
      emitProgress({ message: '请选择本机保存位置', percent: 90 });
      let saved;
      try {
        saved = await saveMediaArtifact({
          artifactId,
          defaultFileName: input.outputFileName,
          executionId: request.executionId,
          libraryId: input.libraryId,
          ownerScope: request.ownerScope,
          preparedActionId: input.preparedActionId,
          purpose: 'destination',
          runId: request.runId,
          sessionId: request.sessionId,
          snapshotHash: input.snapshotHash,
        });
      } catch (saveError) {
        if (isAbortError(saveError, signal)) throw abortError();
        return {
          result: {
            data: buildUploadStateData('uncommitted', input),
            message: '本机保存未完成',
            ok: false,
          },
        };
      }
      if (saved.canceled) {
        return {
          result: {
            data: buildUploadStateData('uncommitted', input),
            message: '用户取消了本机保存',
            ok: false,
          },
        };
      }
      const committedResult: AgentToolResult = {
        data: {
          ...buildUploadStateData('uncommitted', input),
          name: saved.fileName,
        },
        message: `已提取并保存“${saved.fileName}”到本机`,
        ok: true,
      };
      await submitAuthoritativeCommit(dependencies.onCommitted, committedResult);
      return { committed: true, result: committedResult };
    }
    emitProgress({ message: '正在上传提取后的音频', percent: 65 });
    const uploadResult = await uploadMediaArtifact({
      artifactId,
      executionId: request.executionId,
      libraryId: input.libraryId,
      ownerScope: request.ownerScope,
      runId: request.runId,
      sessionId: request.sessionId,
    });
    if (uploadResult.commitState === 'commit_unknown') {
      return {
        result: {
          data: buildUploadStateData('commit_unknown', input),
          message: '音频上传的提交状态暂时无法确认；请稍后检查目标目录，不要重复执行',
          ok: false,
        },
      };
    }
    if (uploadResult.commitState === 'uncommitted') {
      throw new AgentMediaArtifactUncommittedError();
    }
    emitProgress({ message: '音频已上传，正在刷新目录', percent: 99 });
    return await finishMediaExtractAudioExecution(
      uploadResult.node,
      input,
      request,
      dependencies,
    );
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    if (
      error instanceof AgentMediaArtifactUncommittedError
      && artifactId
      && input.destination === 'library'
    ) {
      if (input.fallbackPolicy === 'prompt_local') {
        try {
          emitProgress({ message: '资料库上传未提交，请选择本机保存位置', percent: 90 });
          const saved = await saveMediaArtifact({
            artifactId,
            defaultFileName: input.outputFileName,
            executionId: request.executionId,
            libraryId: input.libraryId,
            ownerScope: request.ownerScope,
            preparedActionId: input.preparedActionId,
            purpose: 'upload_fallback',
            runId: request.runId,
            sessionId: request.sessionId,
            snapshotHash: input.snapshotHash,
          });
          if (saved.canceled) {
            return {
              result: {
                data: buildUploadStateData('uncommitted', input),
                message: '资料库上传未提交，用户取消了本机保存',
                ok: false,
              },
            };
          }
          const committedResult: AgentToolResult = {
            data: {
              destination: 'local',
              fallbackFrom: 'library',
              format: input.outputFormat,
              name: saved.fileName,
              uploadCommitState: 'uncommitted',
            },
            message: `资料库上传未提交，已将“${saved.fileName}”保存到本机`,
            ok: true,
          };
          await submitAuthoritativeCommit(dependencies.onCommitted, committedResult);
          return { committed: true, result: committedResult };
        } catch (saveError) {
          if (isAbortError(saveError, signal)) throw abortError();
          return {
            result: {
              data: buildUploadStateData('uncommitted', input),
              message: '资料库上传未提交，本机保存也未完成',
              ok: false,
            },
          };
        }
      }
      return {
        result: {
          data: buildUploadStateData('uncommitted', input),
          message: '音频已提取，但资料库上传未提交',
          ok: false,
        },
      };
    }
    return {
      result: {
        message: error instanceof Error ? error.message : '音频提取失败',
        ok: false,
      },
    };
  } finally {
    if (artifactId) {
      await releaseMediaArtifact({
        artifactId,
        executionId: request.executionId,
        libraryId: input.libraryId,
        ownerScope: request.ownerScope,
        runId: request.runId,
        sessionId: request.sessionId,
      }).catch(() => undefined);
    }
  }
}

async function finishMediaExtractAudioExecution(
  created: unknown,
  input: LibraryMediaExtractAudioExecutionInput,
  request: AgentToolExecutionRequest,
  dependencies: AgentRendererToolExecutorDependencies,
): Promise<AgentRendererToolOutcome> {
  let refreshFailed = false;
  try {
    await dependencies.onRefreshDirectory?.(input.parentId);
  } catch {
    refreshFailed = true;
  }

  let perception: AgentRendererToolOutcome['perception'];
  try {
    const readPerception = dependencies.readPerception || readAgentPerception;
    perception = await readPerception(request.appContext);
  } catch {
    refreshFailed = true;
  }

  const createdNode = resolveCreatedNode(created, input.outputFileName);
  const verified = perceptionContainsNode(perception, input.parentId, createdNode.id);

  return {
    committed: true,
    ...(perception ? { perception } : {}),
    result: buildMediaExtractAudioResult(created, input, verified, refreshFailed || !verified),
  };
}

function buildMediaExtractAudioResult(
  created: unknown,
  input: LibraryMediaExtractAudioExecutionInput,
  verified: boolean,
  verificationFailed: boolean,
): AgentToolResult {
  const createdNode = resolveCreatedNode(created, input.outputFileName);
  return {
    data: {
      ...buildUploadStateData('committed', input),
      ...(createdNode.id ? { createdNodeId: createdNode.id } : {}),
      name: createdNode.name,
      verified,
    },
    message: verificationFailed
      ? `已提取并上传“${createdNode.name}”，但目录刷新或结果校验失败`
      : `已提取并上传“${createdNode.name}”`,
    ok: true,
  };
}

async function finishDirectoryCreateExecution(
  created: Awaited<ReturnType<typeof createNode>>,
  input: DirectoryCreateExecutionInput,
  request: AgentToolExecutionRequest,
  dependencies: AgentRendererToolExecutorDependencies,
): Promise<AgentRendererToolOutcome> {
  let refreshFailed = false;
  try {
    await dependencies.onRefreshDirectory?.(input.parentId);
  } catch {
    refreshFailed = true;
  }

  let perception: AgentRendererToolOutcome['perception'];
  try {
    const readPerception = dependencies.readPerception || readAgentPerception;
    perception = await readPerception(request.appContext);
  } catch {
    refreshFailed = true;
  }

  const createdNode = resolveCreatedNode(created, input.name);
  const verified = perceptionContainsNode(perception, input.parentId, createdNode.id);

  return {
    committed: true,
    ...(perception ? { perception } : {}),
    result: buildDirectoryCreateResult(created, input, verified, refreshFailed || !verified),
  };
}

function buildDirectoryCreateResult(
  created: Awaited<ReturnType<typeof createNode>>,
  input: DirectoryCreateExecutionInput,
  verified: boolean,
  verificationFailed: boolean,
): AgentToolResult {
  const createdNode = resolveCreatedNode(created, input.name);
  return {
    data: {
      ...(createdNode.id ? { createdNodeId: createdNode.id } : {}),
      name: createdNode.name,
      parentId: input.parentId,
      verified,
    },
    message: verificationFailed
      ? `已创建文件夹“${createdNode.name}”，但目录刷新或结果校验失败`
      : `已创建文件夹“${createdNode.name}”`,
    ok: true,
  };
}
