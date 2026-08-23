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
  uploadLocalPathAndCreateNode,
} from '@/features/file-explorer/services/file.api';
import {
  extractAgentMediaAudio,
  inspectAgentMedia,
  releaseAgentMediaArtifact,
  reportAgentToolExecutionProgress,
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

interface MediaExtractAudioExecutionInput {
  conflictPolicy: 'auto_rename';
  libraryId: number;
  mimeType?: string;
  nodeId: number;
  outputFileName: string;
  outputFormat: 'm4a' | 'mp3' | 'wav';
  parentId: number;
  sourceFileName: string;
}

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
  signal?: AbortSignal;
  uploadLocalFile?: typeof uploadLocalPathAndCreateNode;
}

function abortError(): Error {
  const error = new Error('Agent Tool 已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (error instanceof Error && error.name === 'AbortError');
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
    || !Number.isFinite(parentId)
    || parentId <= 0
    || !Number.isFinite(nodeId)
    || nodeId <= 0
    || hasUnsafeFileName(sourceFileName)
    || hasUnsafeFileName(outputFileName)
    || !validFormat
    || !outputFileName.toLowerCase().endsWith(`.${outputFormat}`)
  ) {
    throw new Error('音频提取的执行参数无效');
  }
  if (
    libraryId !== Number(request.appContext.libraryId)
    || parentId !== Number(request.appContext.currentDirectory?.id)
  ) {
    throw new Error('音频提取的目标上下文已经变化');
  }
  return {
    conflictPolicy: 'auto_rename',
    libraryId,
    ...(mimeType ? { mimeType } : {}),
    nodeId,
    outputFileName,
    outputFormat,
    parentId,
    sourceFileName,
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
    await dependencies.onCommitted?.(committedResult);
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
  const uploadLocalFile = dependencies.uploadLocalFile || uploadLocalPathAndCreateNode;
  const reportProgress = dependencies.reportProgress || reportAgentToolExecutionProgress;
  let artifactId = '';
  let abortUpload: (() => Promise<void>) | null = null;
  let lastUploadPercent = -1;

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
  const handleAbort = () => {
    void abortUpload?.().catch(() => undefined);
  };
  signal?.addEventListener('abort', handleAbort, { once: true });

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
      || !String(artifact?.filePath || '').trim()
      || String(artifact?.fileName || '') !== input.outputFileName
      || !Number.isFinite(Number(artifact?.sizeBytes))
      || Number(artifact.sizeBytes) <= 0
    ) {
      throw new Error('音频提取返回了无效的临时产物');
    }
    throwIfAborted(signal);
    emitProgress({ message: '正在上传提取后的音频', percent: 65 });
    const created = await uploadLocalFile(
      artifact.filePath,
      input.parentId,
      input.libraryId,
      {
        conflictPolicy: input.conflictPolicy,
        contentType: artifact.mimeType,
        onProgress: (uploadedBytes) => {
          if (signal?.aborted) return;
          const ratio = Math.max(0, Math.min(1, uploadedBytes / artifact.sizeBytes));
          const percent = Math.floor(65 + ratio * 33);
          if (percent === lastUploadPercent) return;
          lastUploadPercent = percent;
          emitProgress({ message: `正在上传提取后的音频（${percent}%）`, percent });
        },
        setAbort: (aborter) => {
          abortUpload = aborter;
          if (signal?.aborted) handleAbort();
        },
      },
    );
    const committedResult = buildMediaExtractAudioResult(created, input, false, false);
    await dependencies.onCommitted?.(committedResult);
    emitProgress({ message: '音频已上传，正在刷新目录', percent: 99 });
    return await finishMediaExtractAudioExecution(created, input, request, dependencies);
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    return {
      result: {
        message: error instanceof Error ? error.message : '音频提取失败',
        ok: false,
      },
    };
  } finally {
    signal?.removeEventListener('abort', handleAbort);
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
  created: Awaited<ReturnType<typeof uploadLocalPathAndCreateNode>>,
  input: MediaExtractAudioExecutionInput,
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
  created: Awaited<ReturnType<typeof uploadLocalPathAndCreateNode>>,
  input: MediaExtractAudioExecutionInput,
  verified: boolean,
  verificationFailed: boolean,
): AgentToolResult {
  const createdNode = resolveCreatedNode(created, input.outputFileName);
  return {
    data: {
      ...(createdNode.id ? { createdNodeId: createdNode.id } : {}),
      format: input.outputFormat,
      name: createdNode.name,
      parentId: input.parentId,
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
