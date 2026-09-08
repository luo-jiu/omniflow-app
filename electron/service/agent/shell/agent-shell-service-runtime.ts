import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BrowserWindow,
  dialog,
  webContents,
  type OpenDialogOptions,
  type WebContents,
} from 'electron';

import {
  AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
  AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
  AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
  AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
  AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND,
  AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION,
  type AgentFilePublishPreparedActionPublicV1,
  type AgentFileAuthorityNodeSnapshotV1,
  type AgentOwnerScope,
  type AgentPreparedActionPublic,
  type AgentToolResult,
} from '../../../../src/shared/agent/agent.types';
import {
  normalizeAgentFilePublishPreparedActionPublicV1,
  normalizeAgentFileStagePreparedActionPublicV1,
  normalizeAgentFileUploadPreparedActionPublicV1,
} from '../../../../src/shared/agent/agent-prepared-action';
import {
  normalizeAgentShellPreparedActionPublicV1,
  normalizeAgentShellRunInputV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import { getAIServiceRuntimeProfile } from '../../aiServiceStore';
import { saveAgentLocalFileAs } from '../agent-media-save-as';
import { agentFileAuthorityBroker } from '../agent-file-authority-broker';
import {
  createAgentMediaArtifactUploadManager,
  type AgentMediaArtifactUploadManager,
} from '../agent-media-artifact-upload';
import { createAgentMediaUploadControlPlane } from '../agent-media-upload-control-plane';
import type {
  AgentMediaArtifactOwner,
  AgentMediaOwnedFile,
} from '../agent-media-artifact-store';
import { downloadUrlToFile } from '../../fileTransfer';
import {
  agentToolRegistry,
  createAgentToolRegistry,
  type AgentToolExecutionContext,
} from '../agent-tool-registry';
import {
  createAgentFileBridgeTools,
  normalizeAgentFilePublishInputV1,
  normalizeAgentFileStageInputV1,
  normalizeAgentFileUploadInputV1,
  type AgentFilePublishInputV1,
  type AgentFileUploadInputV1,
} from '../tools/file-bridge-tools';
import {
  openAgentLocalFile,
  type AgentLocalFileSnapshot,
  type AgentOpenedLocalFile,
  verifyAgentLocalFileSnapshot,
  verifyOpenedAgentLocalFileUnchanged,
} from '../tools/agent-local-file';
import { createAgentShellRunTool } from '../tools/shell-run-tool';
import { createAgentShellBindingResolver } from './agent-shell-binding-resolver';
import { createAgentShellExecutionLeaseManager } from './agent-shell-execution-lease';
import {
  createAgentShellPreparationService,
  type AgentShellPreparationHostEnvironment,
} from './agent-shell-preparation-service';
import { createAgentShellProcessSupervisor } from './agent-shell-process-supervisor';
import {
  createAgentShellProviderRegistry,
  type AgentShellProviderRegistry,
  type AgentShellProviderRegistrySnapshot,
} from './agent-shell-provider-registry';
import {
  createAgentShellRuntime,
  type AgentShellRuntimeResult,
} from './agent-shell-runtime';
import { createAgentShellSpawnPreflight } from './agent-shell-spawn-preflight';
import type { AgentShellHostContextDependencies } from './agent-shell-host-context';
import {
  disposeAgentShellStorageRuntime,
  getAgentShellStorageRuntime,
  type AgentShellStorageRuntime,
} from './agent-shell-storage-runtime';
import type {
  AgentShellPermissionMode,
} from './agent-shell-policy-engine';
import { agentShellSettingsStore } from './agent-shell-settings-store';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspaceStore,
} from './agent-shell-workspace-store';
import {
  AGENT_SHELL_WORKSPACE_MAX_FILE_BYTES,
} from './agent-shell-workspace-content-scanner';

interface RunWorkspaceEntry {
  readonly owner: AgentShellWorkspaceOwner;
  readonly promise: ReturnType<AgentShellWorkspaceStore['create']>;
  readonly runId: string;
}

interface WorkspaceUploadGrant {
  kind: 'workspace';
  artifactId: string;
  contentHash: string;
  fileName: string;
  generation: number;
  logicalPath: string;
  owner: AgentShellWorkspaceOwner;
  ownerWebContentsId: number;
  runId: string;
  sessionId: string;
  sizeBytes: number;
  workspaceId: string;
}

interface LocalPathUploadGrant {
  artifactId: string;
  fileName: string;
  kind: 'local-path';
  openedFile: AgentOpenedLocalFile;
  owner: AgentShellWorkspaceOwner;
  ownerWebContentsId: number;
  runId: string;
  sessionId: string;
  sizeBytes: number;
}

type FileUploadGrant = LocalPathUploadGrant | WorkspaceUploadGrant;

interface ActiveFileBridgeOperation {
  readonly controller: AbortController;
  readonly promise: Promise<AgentToolResult>;
  readonly runId: string;
}

interface ActiveShellExecution {
  readonly controller: AbortController;
  readonly promise: Promise<AgentShellRuntimeResult>;
  readonly runId: string;
}

const DEFAULT_EXECUTION_GROWTH_BYTES = 512 * 1024 * 1024;
const DEFAULT_EXECUTION_QUOTA_POLL_INTERVAL_MS = 500;

export interface CreateAgentShellServiceRuntimeOptions {
  readonly additionalPathEntries?: readonly string[];
  readonly executionGrowthBytes?: number;
  readonly executionQuotaPollIntervalMs?: number;
  readonly getPermissionMode?: () => AgentShellPermissionMode;
  readonly hostEnvironment?: AgentShellPreparationHostEnvironment;
  readonly hostCwd?: string;
  readonly hostHome?: string;
  readonly hostContextDependencies?: AgentShellHostContextDependencies;
  readonly providerRegistry: AgentShellProviderRegistry;
  readonly resolveRuntimeProfile?: typeof getAIServiceRuntimeProfile;
  readonly storageRuntime: AgentShellStorageRuntime;
  readonly pickLocalFile?: (
    ownerWebContentsId: number,
    signal: AbortSignal,
  ) => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
  readonly saveLocalFileAs?: typeof saveAgentLocalFileAs;
  readonly requestFileAuthority?: typeof agentFileAuthorityBroker.request;
  readonly fileUploadManager?: Pick<AgentMediaArtifactUploadManager, 'upload'>;
  readonly downloadFile?: typeof downloadUrlToFile;
  readonly dependencies?: {
    readonly preparationService: Pick<
      ReturnType<typeof createAgentShellPreparationService>,
      'prepare'
    >;
    readonly processSupervisor: Pick<
      ReturnType<typeof createAgentShellProcessSupervisor>,
      'interruptAll'
    >;
    readonly runtime: Pick<ReturnType<typeof createAgentShellRuntime>, 'run'>;
  };
}

function sameOwner(left: AgentShellWorkspaceOwner, right: AgentShellWorkspaceOwner): boolean {
  return left.accountScope === right.accountScope
    && left.backendScope === right.backendScope
    && left.sessionId === right.sessionId;
}

function ownerFor(input: {
  readonly ownerScope: AgentOwnerScope;
  readonly sessionId: string;
}): AgentShellWorkspaceOwner {
  return Object.freeze({
    accountScope: input.ownerScope.accountScope,
    backendScope: input.ownerScope.backendScope,
    sessionId: input.sessionId,
  });
}

function fileAuthorityNodeIdentity(node: AgentFileAuthorityNodeSnapshotV1): string {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify({
    ext: node.ext || null,
    fileSize: node.fileSize,
    id: node.id,
    libraryId: node.libraryId,
    mimeType: node.mimeType || null,
    name: node.name,
    parentId: node.parentId,
    storageKey: node.storageKey || null,
    storageProvider: node.storageProvider || null,
    type: node.type,
    updatedAt: node.updatedAt || null,
    version: node.version,
  })).digest('hex')}`;
}

function resolveOwnerUserId(owner: AgentShellWorkspaceOwner): number {
  const match = /^user:([1-9]\d*)$/u.exec(owner.accountScope);
  const userId = Number(match?.[1]);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('Agent 文件发布缺少有效的账号环境');
  }
  return userId;
}

function shellProgressMessage(state: string): string | null {
  switch (state) {
    case 'starting':
      return '正在启动 Shell 进程';
    case 'running':
      return 'Shell 命令正在执行';
    case 'terminating':
      return '正在终止 Shell 进程';
    default:
      return null;
  }
}

function positiveInteger(input: number | undefined, fallback: number, label: string): number {
  const value = input === undefined ? fallback : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}无效`);
  return value;
}

function quotaFailureResult(result: AgentShellRuntimeResult): AgentShellRuntimeResult {
  if (!result.terminationConfirmed) return result;
  return Object.freeze({
    ...result,
    errorMessage: 'Agent Shell workspace 超过执行配额或无法可信计量',
    ok: false,
    status: 'failed' as const,
    terminationReason: 'quota_exceeded' as const,
  });
}

function createPollDelay(milliseconds: number): {
  readonly promise: Promise<void>;
  readonly wake: () => void;
} {
  let settled = false;
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    resolvePromise();
  }, milliseconds);
  timer.unref?.();
  return {
    promise,
    wake: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise();
    },
  };
}

function abortError(message = 'Agent 文件桥操作已取消'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function rethrowSafeFileBridgeError(error: unknown, fallback: string): never {
  if (error instanceof Error && error.name === 'AbortError') throw error;
  if (error && typeof error === 'object') {
    const source = error as Record<string, unknown>;
    if (typeof source.path === 'string' || typeof source.dest === 'string') {
      throw new Error(fallback);
    }
  }
  throw error;
}

function safeReadFlags(): number {
  const noFollow = process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number'
    ? 0
    : constants.O_NOFOLLOW;
  const nonBlocking = process.platform === 'win32' || typeof constants.O_NONBLOCK !== 'number'
    ? 0
    : constants.O_NONBLOCK;
  return constants.O_RDONLY | noFollow | nonBlocking;
}

async function copyOpenFileToPath(input: {
  destinationPath: string;
  sizeBytes: number;
  signal: AbortSignal;
  source: import('node:fs/promises').FileHandle;
}): Promise<void> {
  const destination = await open(
    input.destinationPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  try {
    while (offset < input.sizeBytes) {
      throwIfAborted(input.signal);
      const requested = Math.min(buffer.byteLength, input.sizeBytes - offset);
      const { bytesRead } = await input.source.read(buffer, 0, requested, offset);
      if (bytesRead <= 0) throw new Error('Agent workspace 输出文件读取提前结束');
      let written = 0;
      while (written < bytesRead) {
        throwIfAborted(input.signal);
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          offset + written,
        );
        if (result.bytesWritten <= 0) throw new Error('Agent 本机保存写入未取得进展');
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    await destination.sync();
    const finalStat = await destination.stat();
    if (!finalStat.isFile() || finalStat.size !== input.sizeBytes) {
      throw new Error('Agent 本机保存临时文件校验失败');
    }
  } finally {
    await destination.close();
  }
}

function bindingObject(
  context: AgentToolExecutionContext,
  expectedKind: 'file.publish' | 'file.stage' | 'file.upload',
): Record<string, unknown> {
  const binding = context.preparation?.binding;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw new Error('Agent 文件桥缺少 prepared binding');
  }
  const source = binding as Record<string, unknown>;
  if (source.kind !== expectedKind) throw new Error('Agent 文件桥 prepared binding 类型无效');
  return source;
}

function localFileSnapshotFromBinding(binding: Record<string, unknown>): AgentLocalFileSnapshot {
  const snapshot = binding.localFileSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Agent 本机文件 prepared binding 无效');
  }
  const source = snapshot as Record<string, unknown>;
  const stat = source.statIdentity;
  if (!stat || typeof stat !== 'object' || Array.isArray(stat)) {
    throw new Error('Agent 本机文件 prepared binding 无效');
  }
  const statSource = stat as Record<string, unknown>;
  if (
    typeof source.absolutePath !== 'string'
    || typeof source.canonicalPath !== 'string'
    || typeof source.displayPath !== 'string'
    || typeof source.fileName !== 'string'
    || typeof source.identityHash !== 'string'
    || (source.kind !== 'home-relative'
      && source.kind !== 'posix-absolute'
      && source.kind !== 'windows-drive-absolute')
    || typeof statSource.ctimeNs !== 'string'
    || typeof statSource.device !== 'string'
    || typeof statSource.inode !== 'string'
    || typeof statSource.mode !== 'number'
    || typeof statSource.mtimeNs !== 'string'
    || statSource.nlink !== 1
    || typeof statSource.sizeBytes !== 'number'
    || !Number.isSafeInteger(statSource.sizeBytes)
    || statSource.sizeBytes < 0
  ) {
    throw new Error('Agent 本机文件 prepared binding 无效');
  }
  return Object.freeze({
    absolutePath: source.absolutePath,
    canonicalPath: source.canonicalPath,
    displayPath: source.displayPath,
    fileName: source.fileName,
    identityHash: source.identityHash,
    kind: source.kind,
    statIdentity: Object.freeze({
      ctimeNs: statSource.ctimeNs,
      device: statSource.device,
      inode: statSource.inode,
      mode: statSource.mode,
      mtimeNs: statSource.mtimeNs,
      nlink: 1,
      sizeBytes: statSource.sizeBytes,
    }),
  });
}

type AgentLibraryPublishDestination = Exclude<
  AgentFilePublishInputV1['destination'],
  { kind: 'local-save-as' }
>;

type AgentLibraryUploadDestination = AgentFileUploadInputV1['destination'];

export function createAgentShellServiceRuntime(
  options: CreateAgentShellServiceRuntimeOptions,
) {
  if (!options?.providerRegistry) throw new Error('Agent Shell Service 缺少 Provider Registry');
  if (!options?.storageRuntime) throw new Error('Agent Shell Service 缺少存储运行时');
  const permissionMode = options.getPermissionMode || (() => 'ask' as const);
  const executionGrowthBytes = positiveInteger(
    options.executionGrowthBytes,
    DEFAULT_EXECUTION_GROWTH_BYTES,
    'Agent Shell execution growth bytes',
  );
  const executionQuotaPollIntervalMs = positiveInteger(
    options.executionQuotaPollIntervalMs,
    DEFAULT_EXECUTION_QUOTA_POLL_INTERVAL_MS,
    'Agent Shell execution quota poll interval',
  );
  const workspaceStore = options.storageRuntime.workspaceStore;
  const saveLocalFileAs = options.saveLocalFileAs || saveAgentLocalFileAs;
  const resolveSender = (ownerWebContentsId: number): WebContents => {
    const sender = webContents.fromId(ownerWebContentsId);
    if (!sender || sender.isDestroyed()) throw new Error('Agent 文件桥绑定窗口已经关闭');
    return sender;
  };
  const requestFileAuthority = options.requestFileAuthority || agentFileAuthorityBroker.request;
  const downloadFile = options.downloadFile || downloadUrlToFile;
  const pickLocalFile = options.pickLocalFile || (async (
    ownerWebContentsId: number,
    signal: AbortSignal,
  ): Promise<{ canceled: true } | { canceled: false; filePath: string }> => {
    throwIfAborted(signal);
    const sender = resolveSender(ownerWebContentsId);
    const ownerWindow = BrowserWindow.fromWebContents(sender);
    const dialogOptions: OpenDialogOptions = {
      properties: ['openFile'],
      title: '选择要交给 Agent 处理的文件',
    };
    const selected = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    throwIfAborted(signal);
    const selectedPath = selected.filePaths[0];
    return selected.canceled || !selectedPath
      ? { canceled: true }
      : { canceled: false, filePath: selectedPath };
  });
  const preparationService = options.dependencies?.preparationService
    || createAgentShellPreparationService({
      additionalPathEntries: options.additionalPathEntries,
      hostEnvironment: options.hostEnvironment,
      hostCwd: options.hostCwd,
      hostHome: options.hostHome,
      hostContextDependencies: options.hostContextDependencies,
      workspaceStore,
    });
  const processSupervisor = options.dependencies?.processSupervisor
    || createAgentShellProcessSupervisor();
  const runtime = options.dependencies?.runtime || (() => {
    const bindingResolver = createAgentShellBindingResolver({
      additionalPathEntries: options.additionalPathEntries,
      hostEnvironment: options.hostEnvironment,
      hostCwd: options.hostCwd,
      hostHome: options.hostHome,
      hostContextDependencies: options.hostContextDependencies,
      providerRegistry: options.providerRegistry,
      resolveRuntimeProfile: options.resolveRuntimeProfile || getAIServiceRuntimeProfile,
    });
    const providerSnapshot = options.providerRegistry.getSnapshot();
    const executionLeaseManager = createAgentShellExecutionLeaseManager({
      hostCwd: options.hostCwd,
      hostHome: options.hostHome,
      hostPlatform: providerSnapshot.platform,
      hostContextDependencies: options.hostContextDependencies,
      workspaceStore,
    });
    const spawnPreflight = createAgentShellSpawnPreflight({
      bindingResolver,
      hostCwd: options.hostCwd,
      hostHome: options.hostHome,
      hostContextDependencies: options.hostContextDependencies,
      workspaceStore,
    });
    return createAgentShellRuntime({
      executionLeaseManager,
      logStore: options.storageRuntime.logStore,
      processSupervisor: processSupervisor as ReturnType<typeof createAgentShellProcessSupervisor>,
      spawnPreflight,
    });
  })();
  const runWorkspaces = new Map<string, RunWorkspaceEntry>();
  const fileUploadGrants = new Map<string, FileUploadGrant>();
  const fileUploadManager = options.fileUploadManager || createAgentMediaArtifactUploadManager({
    artifactStore: {
      withOwnedFile: async <T>(
        artifactId: string,
        uploadOwner: AgentMediaArtifactOwner,
        consumer: (input: AgentMediaOwnedFile) => Promise<T>,
      ): Promise<T> => {
        const grant = fileUploadGrants.get(artifactId);
        if (
          !grant
          || grant.ownerWebContentsId !== uploadOwner.ownerWebContentsId
          || grant.runId !== uploadOwner.runId
          || grant.sessionId !== uploadOwner.sessionId
          || grant.owner.accountScope !== uploadOwner.ownerScope.accountScope
          || grant.owner.backendScope !== uploadOwner.ownerScope.backendScope
        ) {
          throw new Error('Agent workspace 文件上传授权不存在或已经失效');
        }
        if (grant.kind === 'local-path') {
          if (grant.sizeBytes !== grant.openedFile.snapshot.statIdentity.sizeBytes) {
            throw new Error('Agent 本机上传文件已经变化，请重新准备');
          }
          return consumer({
            artifact: {
              artifactId,
              directoryPath: path.dirname(grant.openedFile.snapshot.canonicalPath),
              fileName: grant.fileName,
              filePath: grant.openedFile.snapshot.canonicalPath,
              sizeBytes: grant.sizeBytes,
            },
            fileHandle: grant.openedFile.fileHandle,
            verifyUnchanged: () => verifyOpenedAgentLocalFileUnchanged(grant.openedFile),
          });
        }
        return workspaceStore.withOwnedFile(
          grant.workspaceId,
          grant.logicalPath,
          grant.runId,
          grant.owner,
          ownedFile => {
            if (
              ownedFile.contentHash !== grant.contentHash
              || ownedFile.generation !== grant.generation
              || ownedFile.sizeBytes !== grant.sizeBytes
            ) {
              throw new Error('Agent workspace 输出文件已经变化，请重新准备');
            }
            return consumer({
              artifact: {
                artifactId,
                directoryPath: ownedFile.managedRootPath,
                fileName: grant.fileName,
                filePath: path.join(ownedFile.managedRootPath, grant.logicalPath),
                sizeBytes: ownedFile.sizeBytes,
              },
              fileHandle: ownedFile.fileHandle,
              verifyUnchanged: ownedFile.verifyUnchanged,
            });
          },
        );
      },
    },
    controlPlane: createAgentMediaUploadControlPlane(),
  });
  const activeExecutionControllers = new Set<AbortController>();
  const activeExecutions = new Set<Promise<AgentShellRuntimeResult>>();
  const activeShellExecutions = new Set<ActiveShellExecution>();
  const activeFileBridgeOperations = new Set<ActiveFileBridgeOperation>();
  const releasedRunIds = new Set<string>();
  const runReleasePromises = new Map<string, Promise<void>>();
  let accepting = true;
  let closePromise: Promise<void> | null = null;

  function ensureWorkspace(
    runId: string,
    owner: AgentShellWorkspaceOwner,
  ): RunWorkspaceEntry {
    if (!accepting) throw new Error('Agent Shell Service 正在关闭');
    if (releasedRunIds.has(runId)) throw new Error('Agent Shell Run 已经释放');
    const current = runWorkspaces.get(runId);
    if (current) {
      if (!sameOwner(current.owner, owner)) {
        throw new Error('Agent Shell Run workspace owner 不匹配');
      }
      return current;
    }
    const entry: RunWorkspaceEntry = Object.freeze({
      owner,
      promise: workspaceStore.create(runId, owner),
      runId,
    });
    runWorkspaces.set(runId, entry);
    void entry.promise.catch(() => {
      if (runWorkspaces.get(runId) === entry) runWorkspaces.delete(runId);
    });
    return entry;
  }

  async function resolveLibraryDestination(
    destination: AgentLibraryPublishDestination | AgentLibraryUploadDestination,
    file: { fileName: string; sizeBytes: number },
    context: Parameters<NonNullable<ReturnType<typeof createAgentFileBridgeTools>[number]['prepareMain']>>[2],
  ) {
    const libraryId = context.preparationIdentity.libraryId;
    let parentId: number;
    let directoryPath: string | undefined;
    if (destination.kind === 'library-path') {
      directoryPath = destination.directoryPath;
      const resolved = await requestFileAuthority({
        libraryId,
        operation: {
          directoryPath,
          operation: 'resolve-library-directory',
        },
        ownerScope: context.ownerScope,
        runId: context.preparationIdentity.runId,
        sender: resolveSender(context.ownerWebContentsId),
        sessionId: context.preparationIdentity.sessionId,
        signal: context.signal,
        toolRunId: context.preparationIdentity.toolRunId,
      });
      if (
        resolved.operation !== 'resolve-library-directory'
        || resolved.parent.libraryId !== libraryId
        || resolved.parent.type !== 'dir'
      ) {
        throw new Error('资料库目录路径解析结果与 Agent 请求不匹配');
      }
      parentId = resolved.parent.id;
    } else {
      parentId = destination.parentId;
    }
    const authority = await requestFileAuthority({
      libraryId,
      operation: {
        contentType: 'application/octet-stream',
        fileName: file.fileName,
        fileSize: file.sizeBytes,
        includeCredentials: false,
        operation: 'publish-library-file',
        parentId,
        ...(destination.providerId ? { providerId: destination.providerId } : {}),
      },
      ownerScope: context.ownerScope,
      runId: context.preparationIdentity.runId,
      sender: resolveSender(context.ownerWebContentsId),
      sessionId: context.preparationIdentity.sessionId,
      signal: context.signal,
      toolRunId: context.preparationIdentity.toolRunId,
    });
    if (
      authority.operation !== 'publish-library-file'
      || authority.parent.id !== parentId
      || authority.parent.libraryId !== libraryId
    ) {
      throw new Error('资料库发布目标与 Agent 请求不匹配');
    }
    return Object.freeze({
      authority,
      ...(directoryPath ? { directoryPath } : {}),
      libraryId,
      targetLabel: directoryPath
        ? `资料库路径“${directoryPath}” / ${authority.providerLabel}`
        : `资料库目录“${authority.parent.name}” / ${authority.providerLabel}`,
    });
  }

  async function revalidateResolvedLibraryPath(input: {
    directoryPath?: string;
    identity: NonNullable<AgentToolExecutionContext['preparation']>['identity'];
    libraryId: number;
    parentId: number;
    signal: AbortSignal;
    targetIdentity: string;
  }): Promise<void> {
    if (!input.directoryPath) return;
    const resolved = await requestFileAuthority({
      libraryId: input.libraryId,
      operation: {
        directoryPath: input.directoryPath,
        operation: 'resolve-library-directory',
      },
      ownerScope: input.identity.ownerScope,
      runId: input.identity.runId,
      sender: resolveSender(input.identity.ownerWebContentsId),
      sessionId: input.identity.sessionId,
      signal: input.signal,
      toolRunId: input.identity.toolRunId,
    });
    if (
      resolved.operation !== 'resolve-library-directory'
      || resolved.parent.id !== input.parentId
      || resolved.parent.libraryId !== input.libraryId
      || fileAuthorityNodeIdentity(resolved.parent) !== input.targetIdentity
    ) {
      throw new Error('资料库目录路径在执行前已经变化，请重新准备');
    }
  }

  async function prepare(
    input: unknown,
    requestedAction: Parameters<typeof preparationService.prepare>[0]['requestedAction'],
    context: Parameters<NonNullable<ReturnType<typeof createAgentShellRunTool>['prepareMain']>>[2],
  ) {
    const normalizedInput = normalizeAgentShellRunInputV1(input);
    const requestedContext = requestedAction === undefined
      ? undefined
      : normalizeAgentShellPreparedActionPublicV1(requestedAction).cwd.kind;
    const inputContext = normalizedInput.executionContext || 'run-workspace';
    if (requestedContext !== undefined && requestedContext !== inputContext) {
      throw new Error('Agent Shell 执行上下文不能在审批后改变');
    }
    if (inputContext === 'host') {
      return preparationService.prepare({
        context,
        input: normalizedInput,
        requestedAction,
      });
    }
    const owner = ownerFor({
      ownerScope: context.ownerScope,
      sessionId: context.preparationIdentity.sessionId,
    });
    const entry = ensureWorkspace(context.preparationIdentity.runId, owner);
    const workspace = await entry.promise;
    return preparationService.prepare({
      context,
      input: normalizedInput,
      requestedAction,
      workspaceId: workspace.workspaceId,
    });
  }

  async function prepareFileStage(
    input: unknown,
    requestedAction: AgentPreparedActionPublic | undefined,
    context: Parameters<NonNullable<ReturnType<typeof createAgentFileBridgeTools>[number]['prepareMain']>>[2],
  ) {
    const normalizedInput = normalizeAgentFileStageInputV1(input);
    const owner = ownerFor({
      ownerScope: context.ownerScope,
      sessionId: context.preparationIdentity.sessionId,
    });
    const entry = ensureWorkspace(context.preparationIdentity.runId, owner);
    const workspace = await entry.promise;
    if (normalizedInput.source.kind === 'library-node') {
      const libraryId = context.preparationIdentity.libraryId;
      const authority = await requestFileAuthority({
        libraryId,
        operation: {
          includeDownloadUrl: false,
          nodeId: normalizedInput.source.nodeId,
          operation: 'stage-library-node',
        },
        ownerScope: context.ownerScope,
        runId: context.preparationIdentity.runId,
        sender: resolveSender(context.ownerWebContentsId),
        sessionId: context.preparationIdentity.sessionId,
        signal: context.signal,
        toolRunId: context.preparationIdentity.toolRunId,
      });
      if (
        authority.operation !== 'stage-library-node'
        || authority.node.id !== normalizedInput.source.nodeId
        || authority.node.libraryId !== libraryId
      ) {
        throw new Error('资料库来源文件与 Agent 请求不匹配');
      }
      const defaultAction = normalizeAgentFileStagePreparedActionPublicV1({
        kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
        libraryId,
        sourceDisplayName: authority.node.name,
        sourceIdentity: fileAuthorityNodeIdentity(authority.node),
        sourceKind: 'library-node',
        sourceNodeId: authority.node.id,
        sourceSizeBytes: authority.node.fileSize,
        targetLabel: '当前任务 input 目录',
        version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
      });
      if (defaultAction.sourceKind !== 'library-node') {
        throw new Error('Agent 资料库文件暂存动作归一化失败');
      }
      const action = requestedAction === undefined
        ? defaultAction
        : normalizeAgentFileStagePreparedActionPublicV1(requestedAction);
      if (JSON.stringify(action) !== JSON.stringify(defaultAction)) {
        throw new Error('Agent 资料库文件暂存来源或目标已经变化');
      }
      return {
        binding: {
          generation: workspace.generation,
          kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
          libraryId,
          sourceIdentity: defaultAction.sourceIdentity,
          sourceKind: 'library-node',
          sourceNodeId: authority.node.id,
          workspaceId: workspace.workspaceId,
        },
        decision: {
          behavior: 'ask' as const,
          preview: {
            description: `将把资料库文件“${authority.node.name}”复制到当前任务工作区。`,
            details: [
              { label: '来源', value: `资料库节点 #${authority.node.id}` },
              { label: '文件', value: authority.node.name },
              { label: '大小', value: `${authority.node.fileSize} bytes` },
              { label: '进入', value: defaultAction.targetLabel },
            ],
            risk: 'write' as const,
            title: '暂存资料库文件',
          },
          risk: 'write' as const,
        },
        publicAction: action,
        snapshotMaterial: {
          generation: workspace.generation,
          sourceIdentity: defaultAction.sourceIdentity,
          sourceNodeId: authority.node.id,
          workspaceId: workspace.workspaceId,
        },
      };
    }
    if (normalizedInput.source.kind === 'local-path') {
      let opened: AgentOpenedLocalFile | null = null;
      try {
        opened = await openAgentLocalFile(normalizedInput.source.path, context.signal);
        const { snapshot } = opened;
        const defaultAction = normalizeAgentFileStagePreparedActionPublicV1({
          kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
          sourceDisplayName: snapshot.fileName,
          sourceIdentity: snapshot.identityHash,
          sourceKind: 'local-path',
          sourcePath: snapshot.displayPath,
          sourceSizeBytes: snapshot.statIdentity.sizeBytes,
          targetLabel: '当前任务 input 目录',
          version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
        });
        if (defaultAction.sourceKind !== 'local-path') {
          throw new Error('Agent 本机路径暂存动作归一化失败');
        }
        const action = requestedAction === undefined
          ? defaultAction
          : normalizeAgentFileStagePreparedActionPublicV1(requestedAction);
        if (JSON.stringify(action) !== JSON.stringify(defaultAction)) {
          throw new Error('Agent 本机文件暂存来源或目标已经变化');
        }
        return {
          binding: {
            generation: workspace.generation,
            kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
            localFileSnapshot: snapshot,
            sourceKind: 'local-path',
            workspaceId: workspace.workspaceId,
          },
          decision: {
            behavior: 'ask' as const,
            preview: {
              description: `将把本机文件“${snapshot.fileName}”复制到当前任务工作区。`,
              details: [
                { label: '来源', value: snapshot.displayPath },
                { label: '文件', value: snapshot.fileName },
                { label: '大小', value: `${snapshot.statIdentity.sizeBytes} bytes` },
                { label: '进入', value: defaultAction.targetLabel },
              ],
              risk: 'write' as const,
              title: '暂存本机文件',
            },
            risk: 'write' as const,
          },
          publicAction: action,
          snapshotMaterial: {
            generation: workspace.generation,
            sourceIdentity: snapshot.identityHash,
            sourcePath: snapshot.displayPath,
            workspaceId: workspace.workspaceId,
          },
        };
      } catch (error) {
        rethrowSafeFileBridgeError(error, '无法读取指定的本机文件');
      } finally {
        await opened?.fileHandle.close().catch(() => undefined);
      }
    }
    const defaultAction = normalizeAgentFileStagePreparedActionPublicV1({
      kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
      sourceKind: 'local-picker',
      targetLabel: '当前任务 input 目录',
      version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    });
    const action = requestedAction === undefined
      ? defaultAction
      : normalizeAgentFileStagePreparedActionPublicV1(requestedAction);
    if (
      action.sourceKind !== 'local-picker'
      || action.targetLabel !== defaultAction.targetLabel
    ) {
      throw new Error('Agent 文件暂存目标已经变化');
    }
    return {
      binding: {
        generation: workspace.generation,
        kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
        sourceKind: 'local-picker',
        workspaceId: workspace.workspaceId,
      },
      decision: {
        behavior: 'ask' as const,
        preview: {
          description: '将打开系统文件选择器，并把你明确选择的一个普通文件复制到当前任务工作区。',
          details: [
            { label: '来源', value: '本机系统文件选择器' },
            { label: '进入', value: action.targetLabel },
          ],
          risk: 'write' as const,
          title: '选择并暂存文件',
        },
        risk: 'write' as const,
      },
      publicAction: action,
      snapshotMaterial: {
        generation: workspace.generation,
        sourceKind: action.sourceKind,
        workspaceId: workspace.workspaceId,
      },
    };
  }

  async function executeFileStageInternal(context: AgentToolExecutionContext): Promise<AgentToolResult> {
    const preparation = context.preparation;
    if (!preparation) throw new Error('Agent 文件暂存缺少 prepared execution');
    const action = normalizeAgentFileStagePreparedActionPublicV1(preparation.publicAction);
    const binding = bindingObject(context, AGENT_FILE_STAGE_PREPARED_ACTION_KIND);
    const owner = ownerFor({
      ownerScope: preparation.identity.ownerScope,
      sessionId: preparation.identity.sessionId,
    });
    if (action.sourceKind === 'library-node') {
      if (
        binding.sourceKind !== 'library-node'
        || binding.libraryId !== action.libraryId
        || binding.sourceNodeId !== action.sourceNodeId
        || binding.sourceIdentity !== action.sourceIdentity
        || typeof binding.workspaceId !== 'string'
        || typeof binding.generation !== 'number'
        || !Number.isSafeInteger(binding.generation)
        || binding.generation <= 0
      ) {
        throw new Error('Agent 资料库文件暂存 prepared binding 无效');
      }
      const sender = resolveSender(preparation.identity.ownerWebContentsId);
      context.onProgress({ message: '正在获取资料库文件' });
      const authority = await requestFileAuthority({
        libraryId: action.libraryId,
        operation: {
          includeDownloadUrl: true,
          nodeId: action.sourceNodeId,
          operation: 'stage-library-node',
        },
        ownerScope: preparation.identity.ownerScope,
        runId: preparation.identity.runId,
        sender,
        sessionId: preparation.identity.sessionId,
        signal: context.signal,
        toolRunId: preparation.identity.toolRunId,
      });
      if (
        authority.operation !== 'stage-library-node'
        || !authority.downloadUrl
        || authority.node.id !== action.sourceNodeId
        || authority.node.libraryId !== action.libraryId
        || authority.node.name !== action.sourceDisplayName
        || authority.node.fileSize !== action.sourceSizeBytes
        || fileAuthorityNodeIdentity(authority.node) !== action.sourceIdentity
      ) {
        throw new Error('资料库来源文件在执行前已经变化，请重新准备');
      }
      const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-stage-'));
      const temporaryPath = path.join(temporaryDirectory, 'source');
      let sourceFileHandle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        await downloadFile(
          authority.downloadUrl,
          temporaryPath,
          {},
          0,
          Math.min(AGENT_SHELL_WORKSPACE_MAX_FILE_BYTES, action.sourceSizeBytes),
          context.signal,
        );
        sourceFileHandle = await open(temporaryPath, safeReadFlags());
        const downloadedStat = await sourceFileHandle.stat();
        if (!downloadedStat.isFile() || downloadedStat.size !== action.sourceSizeBytes) {
          throw new Error('资料库文件下载结果与准备信息不匹配');
        }
        const verified = await requestFileAuthority({
          libraryId: action.libraryId,
          operation: {
            includeDownloadUrl: false,
            nodeId: action.sourceNodeId,
            operation: 'stage-library-node',
          },
          ownerScope: preparation.identity.ownerScope,
          runId: preparation.identity.runId,
          sender,
          sessionId: preparation.identity.sessionId,
          signal: context.signal,
          toolRunId: preparation.identity.toolRunId,
        });
        if (
          verified.operation !== 'stage-library-node'
          || fileAuthorityNodeIdentity(verified.node) !== action.sourceIdentity
        ) {
          throw new Error('资料库来源文件在下载期间已经变化，请重新准备');
        }
        context.onProgress({ message: '正在把资料库文件暂存到任务工作区' });
        const staged = await workspaceStore.stageFileFromHandle({
          displayName: action.sourceDisplayName,
          expectedGeneration: binding.generation,
          expectedRunId: preparation.identity.runId,
          owner,
          provenance: `library-node:${action.libraryId}:${action.sourceNodeId}`,
          signal: context.signal,
          sourceFileHandle,
          workspaceId: binding.workspaceId,
        });
        return {
          data: {
            contentHash: staged.contentHash,
            displayName: staged.displayName,
            logicalPath: staged.logicalPath,
            sizeBytes: staged.sizeBytes,
            sourceKind: 'library-node',
            sourceNodeId: action.sourceNodeId,
          },
          message: `已将“${staged.displayName}”暂存到 ${staged.logicalPath}`,
          ok: true,
        };
      } catch (error) {
        rethrowSafeFileBridgeError(error, '无法把资料库文件暂存到任务工作区');
      } finally {
        await sourceFileHandle?.close().catch(() => undefined);
        await rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined);
      }
    }
    if (action.sourceKind === 'local-path') {
      if (
        binding.sourceKind !== 'local-path'
        || typeof binding.workspaceId !== 'string'
        || typeof binding.generation !== 'number'
        || !Number.isSafeInteger(binding.generation)
        || binding.generation <= 0
      ) {
        throw new Error('Agent 本机文件暂存 prepared binding 无效');
      }
      const expectedSnapshot = localFileSnapshotFromBinding(binding);
      let opened: AgentOpenedLocalFile | null = null;
      try {
        context.onProgress({ message: '正在验证本机文件' });
        opened = await openAgentLocalFile(action.sourcePath, context.signal);
        await verifyAgentLocalFileSnapshot(opened, expectedSnapshot);
        context.onProgress({ message: '正在把本机文件暂存到任务工作区' });
        const staged = await workspaceStore.stageFileFromHandle({
          displayName: action.sourceDisplayName,
          expectedGeneration: binding.generation,
          expectedRunId: preparation.identity.runId,
          owner,
          provenance: `local-path:${preparation.identity.toolRunId}:${action.sourceIdentity}`,
          signal: context.signal,
          sourceFileHandle: opened.fileHandle,
          workspaceId: binding.workspaceId,
        });
        return {
          data: {
            contentHash: staged.contentHash,
            displayName: staged.displayName,
            logicalPath: staged.logicalPath,
            sizeBytes: staged.sizeBytes,
            sourceKind: 'local-path',
          },
          message: `已将“${staged.displayName}”暂存到 ${staged.logicalPath}`,
          ok: true,
        };
      } catch (error) {
        rethrowSafeFileBridgeError(error, '无法把指定的本机文件暂存到任务工作区');
      } finally {
        await opened?.fileHandle.close().catch(() => undefined);
      }
    }
    if (
      action.sourceKind !== 'local-picker'
      || binding.sourceKind !== 'local-picker'
      || typeof binding.workspaceId !== 'string'
      || typeof binding.generation !== 'number'
      || !Number.isSafeInteger(binding.generation)
      || binding.generation <= 0
    ) {
      throw new Error('Agent 文件暂存 prepared binding 无效');
    }
    context.onProgress({ message: '等待选择本机文件' });
    const selected = await pickLocalFile(preparation.identity.ownerWebContentsId, context.signal);
    if (selected.canceled) {
      return { data: { canceled: true }, message: '未选择文件', ok: false };
    }
    throwIfAborted(context.signal);
    let sourceFileHandle: Awaited<ReturnType<typeof open>>;
    try {
      sourceFileHandle = await open(selected.filePath, safeReadFlags());
    } catch (error) {
      rethrowSafeFileBridgeError(error, '无法打开所选本机文件');
    }
    try {
      context.onProgress({ message: '正在把文件暂存到任务工作区' });
      const staged = await workspaceStore.stageFileFromHandle({
        displayName: path.basename(selected.filePath),
        expectedGeneration: binding.generation,
        expectedRunId: preparation.identity.runId,
        owner,
        provenance: `local-picker:${preparation.identity.toolRunId}`,
        signal: context.signal,
        sourceFileHandle,
        workspaceId: binding.workspaceId,
      });
      return {
        data: {
          contentHash: staged.contentHash,
          displayName: staged.displayName,
          logicalPath: staged.logicalPath,
          sizeBytes: staged.sizeBytes,
          sourceKind: 'local-picker',
        },
        message: `已将“${staged.displayName}”暂存到 ${staged.logicalPath}`,
        ok: true,
      };
    } catch (error) {
      rethrowSafeFileBridgeError(error, '无法把所选文件暂存到任务工作区');
    } finally {
      await sourceFileHandle.close().catch(() => undefined);
    }
  }

  async function prepareFilePublish(
    input: unknown,
    requestedAction: AgentPreparedActionPublic | undefined,
    context: Parameters<NonNullable<ReturnType<typeof createAgentFileBridgeTools>[number]['prepareMain']>>[2],
  ) {
    const normalizedInput = normalizeAgentFilePublishInputV1(input);
    const owner = ownerFor({
      ownerScope: context.ownerScope,
      sessionId: context.preparationIdentity.sessionId,
    });
    const entry = ensureWorkspace(context.preparationIdentity.runId, owner);
    const workspace = await entry.promise;
    const metadata = await workspaceStore.withOwnedFile(
      workspace.workspaceId,
      normalizedInput.sourcePath,
      context.preparationIdentity.runId,
      owner,
      async ownedFile => ({
        contentHash: ownedFile.contentHash,
        displayName: ownedFile.displayName,
        generation: ownedFile.generation,
        sizeBytes: ownedFile.sizeBytes,
      }),
      context.signal,
    );
    if (normalizedInput.destination.kind !== 'local-save-as') {
      const fileName = normalizedInput.destination.fileName || metadata.displayName;
      const resolvedTarget = await resolveLibraryDestination(normalizedInput.destination, {
        fileName,
        sizeBytes: metadata.sizeBytes,
      }, context);
      const { authority, libraryId } = resolvedTarget;
      if (authority.operation !== 'publish-library-file') {
        throw new Error('Agent 资料库文件发布目标解析失败');
      }
      const defaultAction = normalizeAgentFilePublishPreparedActionPublicV1({
        conflictPolicy: normalizedInput.destination.conflictPolicy || 'rename',
        contentHash: metadata.contentHash,
        destinationKind: 'library',
        displayName: metadata.displayName,
        kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
        libraryId,
        parentId: authority.parent.id,
        providerId: authority.providerId,
        sizeBytes: metadata.sizeBytes,
        sourcePath: normalizedInput.sourcePath,
        suggestedFileName: fileName,
        targetLabel: resolvedTarget.targetLabel,
        version: AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
      });
      if (defaultAction.destinationKind !== 'library') {
        throw new Error('Agent 资料库文件发布动作归一化失败');
      }
      const action = requestedAction === undefined
        ? defaultAction
        : normalizeAgentFilePublishPreparedActionPublicV1(requestedAction);
      if (
        action.destinationKind !== 'library'
        || JSON.stringify(action) !== JSON.stringify(defaultAction)
      ) {
        throw new Error('Agent 文件发布来源或资料库目标已经变化');
      }
      const targetIdentity = fileAuthorityNodeIdentity(authority.parent);
      return {
        binding: {
          conflictPolicy: action.conflictPolicy,
          contentHash: metadata.contentHash,
          displayName: metadata.displayName,
          generation: metadata.generation,
          kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
          libraryId,
          parentId: action.parentId,
          providerId: action.providerId,
          sizeBytes: metadata.sizeBytes,
          sourcePath: normalizedInput.sourcePath,
          suggestedFileName: action.suggestedFileName,
          targetIdentity,
          ...(resolvedTarget.directoryPath
            ? { targetDirectoryPath: resolvedTarget.directoryPath }
            : {}),
          workspaceId: workspace.workspaceId,
        },
        decision: {
          behavior: 'ask' as const,
          preview: {
            description: `将把工作区输出“${metadata.displayName}”上传到${action.targetLabel}。`,
            details: [
              { label: '来源', value: normalizedInput.sourcePath },
              { label: '文件名', value: action.suggestedFileName },
              { label: '大小', value: `${metadata.sizeBytes} bytes` },
              { label: '位置', value: action.targetLabel },
            ],
            risk: 'write' as const,
            title: '发布 Agent 输出到资料库',
          },
          risk: 'write' as const,
        },
        publicAction: action,
        snapshotMaterial: {
          contentHash: metadata.contentHash,
          generation: metadata.generation,
          providerId: action.providerId,
          sizeBytes: metadata.sizeBytes,
          sourcePath: normalizedInput.sourcePath,
          targetIdentity,
          ...(resolvedTarget.directoryPath
            ? { targetDirectoryPath: resolvedTarget.directoryPath }
            : {}),
          workspaceId: workspace.workspaceId,
        },
      };
    }
    const defaultAction: AgentFilePublishPreparedActionPublicV1 = {
      contentHash: metadata.contentHash,
      destinationKind: 'local-save-as',
      displayName: metadata.displayName,
      kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
      sizeBytes: metadata.sizeBytes,
      sourcePath: normalizedInput.sourcePath,
      suggestedFileName: normalizedInput.destination.suggestedFileName || metadata.displayName,
      targetLabel: '本机（执行时选择位置）',
      version: AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
    };
    const action = requestedAction === undefined
      ? normalizeAgentFilePublishPreparedActionPublicV1(defaultAction)
      : normalizeAgentFilePublishPreparedActionPublicV1(requestedAction);
    if (
      action.destinationKind !== 'local-save-as'
      || action.sourcePath !== defaultAction.sourcePath
      || action.displayName !== defaultAction.displayName
      || action.sizeBytes !== defaultAction.sizeBytes
      || action.contentHash !== defaultAction.contentHash
      || action.targetLabel !== defaultAction.targetLabel
    ) {
      throw new Error('Agent 文件发布来源或目标已经变化');
    }
    return {
      binding: {
        contentHash: metadata.contentHash,
        displayName: metadata.displayName,
        generation: metadata.generation,
        kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
        sizeBytes: metadata.sizeBytes,
        sourcePath: normalizedInput.sourcePath,
        suggestedFileName: action.suggestedFileName,
        workspaceId: workspace.workspaceId,
      },
      decision: {
        behavior: 'ask' as const,
        preview: {
          description: `将把工作区输出“${metadata.displayName}”保存到你执行时选择的本机位置。`,
          details: [
            { label: '来源', value: normalizedInput.sourcePath },
            { label: '文件名', value: action.suggestedFileName },
            { label: '大小', value: `${metadata.sizeBytes} bytes` },
            { label: '位置', value: action.targetLabel },
          ],
          risk: 'write' as const,
          title: '保存 Agent 输出',
        },
        risk: 'write' as const,
      },
      publicAction: action,
      snapshotMaterial: {
        contentHash: metadata.contentHash,
        generation: metadata.generation,
        sizeBytes: metadata.sizeBytes,
        sourcePath: normalizedInput.sourcePath,
        workspaceId: workspace.workspaceId,
      },
    };
  }

  async function executeFilePublishInternal(context: AgentToolExecutionContext): Promise<AgentToolResult> {
    const preparation = context.preparation;
    if (!preparation) throw new Error('Agent 文件发布缺少 prepared execution');
    const action = normalizeAgentFilePublishPreparedActionPublicV1(preparation.publicAction);
    const binding = bindingObject(context, AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND);
    const owner = ownerFor({
      ownerScope: preparation.identity.ownerScope,
      sessionId: preparation.identity.sessionId,
    });
    if (action.destinationKind === 'library') {
      if (
        binding.libraryId !== action.libraryId
        || binding.parentId !== action.parentId
        || binding.providerId !== action.providerId
        || binding.conflictPolicy !== action.conflictPolicy
        || typeof binding.targetIdentity !== 'string'
        || typeof binding.workspaceId !== 'string'
        || binding.sourcePath !== action.sourcePath
        || binding.displayName !== action.displayName
        || binding.sizeBytes !== action.sizeBytes
        || binding.contentHash !== action.contentHash
        || binding.suggestedFileName !== action.suggestedFileName
        || typeof binding.generation !== 'number'
        || (binding.targetDirectoryPath !== undefined
          && typeof binding.targetDirectoryPath !== 'string')
      ) {
        throw new Error('Agent 资料库文件发布 prepared binding 无效');
      }
      const sender = resolveSender(preparation.identity.ownerWebContentsId);
      await revalidateResolvedLibraryPath({
        ...(typeof binding.targetDirectoryPath === 'string'
          ? { directoryPath: binding.targetDirectoryPath }
          : {}),
        identity: preparation.identity,
        libraryId: action.libraryId,
        parentId: action.parentId,
        signal: context.signal,
        targetIdentity: binding.targetIdentity,
      });
      const authority = await requestFileAuthority({
        libraryId: action.libraryId,
        operation: {
          contentType: 'application/octet-stream',
          fileName: action.suggestedFileName,
          fileSize: action.sizeBytes,
          includeCredentials: true,
          operation: 'publish-library-file',
          parentId: action.parentId,
          providerId: action.providerId,
        },
        ownerScope: preparation.identity.ownerScope,
        runId: preparation.identity.runId,
        sender,
        sessionId: preparation.identity.sessionId,
        signal: context.signal,
        toolRunId: preparation.identity.toolRunId,
      });
      if (
        authority.operation !== 'publish-library-file'
        || !authority.credentials
        || authority.parent.id !== action.parentId
        || authority.parent.libraryId !== action.libraryId
        || authority.providerId !== action.providerId
        || fileAuthorityNodeIdentity(authority.parent) !== binding.targetIdentity
      ) {
        throw new Error('资料库发布目标在执行前已经变化，请重新准备');
      }
      const artifactId = `file-publish-${crypto.createHash('sha256').update(
        `${preparation.identity.runId}\u0000${preparation.identity.toolRunId}`,
      ).digest('hex')}`;
      fileUploadGrants.set(artifactId, {
        artifactId,
        contentHash: action.contentHash,
        fileName: action.suggestedFileName,
        generation: binding.generation,
        kind: 'workspace',
        logicalPath: action.sourcePath,
        owner,
        ownerWebContentsId: preparation.identity.ownerWebContentsId,
        runId: preparation.identity.runId,
        sessionId: preparation.identity.sessionId,
        sizeBytes: action.sizeBytes,
        workspaceId: binding.workspaceId,
      });
      try {
        context.onProgress({ message: '正在上传 Agent 输出到资料库' });
        const uploaded = await fileUploadManager.upload({
          artifactId,
          credentials: authority.credentials,
          expectedUserId: resolveOwnerUserId(owner),
          onProgress: (uploadedBytes, totalBytes) => {
            if (totalBytes <= 0) return;
            context.onProgress({
              message: '正在上传 Agent 输出到资料库',
              percent: Math.max(1, Math.min(99, Math.floor((uploadedBytes / totalBytes) * 99))),
            });
          },
          owner: {
            executionId: preparation.identity.toolRunId,
            ownerScope: preparation.identity.ownerScope,
            ownerWebContentsId: preparation.identity.ownerWebContentsId,
            runId: preparation.identity.runId,
            sessionId: preparation.identity.sessionId,
          },
          signal: context.signal,
          target: {
            conflictPolicy: action.conflictPolicy === 'rename' ? 'auto_rename' : 'error',
            contentType: 'application/octet-stream',
            fileName: action.suggestedFileName,
            libraryId: action.libraryId,
            parentId: action.parentId,
            storageProvider: action.providerId,
          },
        });
        if (uploaded.commitState === 'commit_unknown') {
          return {
            data: {
              destination: { kind: 'library', parentId: action.parentId },
              uploadCommitState: 'commit_unknown',
            },
            message: '文件上传的提交状态暂时无法确认；请稍后检查目标目录，不要重复执行',
            ok: false,
          };
        }
        if (uploaded.commitState === 'uncommitted') {
          return {
            data: {
              destination: { kind: 'library', parentId: action.parentId },
              uploadCommitState: 'uncommitted',
            },
            message: '文件未能提交到资料库',
            ok: false,
          };
        }
        return {
          data: {
            contentHash: action.contentHash,
            destination: {
              kind: 'library',
              nodeId: uploaded.node.id,
              parentId: action.parentId,
            },
            displayName: uploaded.node.name,
            sizeBytes: action.sizeBytes,
            sourcePath: action.sourcePath,
            uploadCommitState: 'committed',
          },
          message: `已将“${uploaded.node.name}”发布到资料库`,
          ok: true,
        };
      } catch (error) {
        rethrowSafeFileBridgeError(error, '无法将 Agent 输出发布到资料库');
      } finally {
        fileUploadGrants.delete(artifactId);
      }
    }
    if (
      action.destinationKind !== 'local-save-as'
      || typeof binding.workspaceId !== 'string'
      || binding.sourcePath !== action.sourcePath
      || binding.displayName !== action.displayName
      || binding.sizeBytes !== action.sizeBytes
      || binding.contentHash !== action.contentHash
      || binding.suggestedFileName !== action.suggestedFileName
    ) {
      throw new Error('Agent 文件发布 prepared binding 无效');
    }
    const sender = resolveSender(preparation.identity.ownerWebContentsId);
    context.onProgress({ message: '等待选择本机保存位置' });
    let saved: Awaited<ReturnType<typeof saveLocalFileAs>>;
    try {
      saved = await workspaceStore.withOwnedFile(
        binding.workspaceId,
        action.sourcePath,
        preparation.identity.runId,
        owner,
        async (ownedFile) => {
          if (
            ownedFile.generation !== binding.generation
            || ownedFile.contentHash !== action.contentHash
            || ownedFile.sizeBytes !== action.sizeBytes
          ) {
            throw new Error('Agent workspace 输出文件已经变化，请重新准备');
          }
          return saveLocalFileAs({
            copySource: async (temporaryPath, signal) => {
              await copyOpenFileToPath({
                destinationPath: temporaryPath,
                signal,
                sizeBytes: ownedFile.sizeBytes,
                source: ownedFile.fileHandle,
              });
              await ownedFile.verifyUnchanged();
            },
            defaultFileName: action.suggestedFileName,
            dialogTitle: '保存 Agent 输出',
            internalRootPath: ownedFile.managedRootPath,
            sender,
            signal: context.signal,
            sourceFileName: ownedFile.displayName,
          });
        },
        context.signal,
      );
    } catch (error) {
      rethrowSafeFileBridgeError(error, '无法将 Agent 输出保存到本机');
    }
    if (saved.canceled) {
      return { data: { canceled: true }, message: '未选择保存位置', ok: false };
    }
    return {
      data: {
        contentHash: action.contentHash,
        destination: { kind: 'local-save-as', saved: true },
        displayName: saved.fileName,
        sizeBytes: action.sizeBytes,
        sourcePath: action.sourcePath,
      },
      message: `已将“${saved.fileName}”保存到本机`,
      ok: true,
    };
  }

  async function prepareFileUpload(
    input: unknown,
    requestedAction: AgentPreparedActionPublic | undefined,
    context: Parameters<NonNullable<ReturnType<typeof createAgentFileBridgeTools>[number]['prepareMain']>>[2],
  ) {
    const normalizedInput = normalizeAgentFileUploadInputV1(input);
    let opened: AgentOpenedLocalFile | null = null;
    try {
      opened = await openAgentLocalFile(normalizedInput.source.path, context.signal);
      const { snapshot } = opened;
      const outputFileName = normalizedInput.destination.fileName || snapshot.fileName;
      const resolvedTarget = await resolveLibraryDestination(normalizedInput.destination, {
        fileName: outputFileName,
        sizeBytes: snapshot.statIdentity.sizeBytes,
      }, context);
      if (resolvedTarget.authority.operation !== 'publish-library-file') {
        throw new Error('Agent 本机文件上传目标解析失败');
      }
      const authority = resolvedTarget.authority;
      const defaultAction = normalizeAgentFileUploadPreparedActionPublicV1({
        conflictPolicy: normalizedInput.destination.conflictPolicy || 'rename',
        kind: AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND,
        libraryId: resolvedTarget.libraryId,
        outputFileName,
        parentId: authority.parent.id,
        providerId: authority.providerId,
        sourceDisplayName: snapshot.fileName,
        sourceIdentity: snapshot.identityHash,
        sourceKind: 'local-path',
        sourcePath: snapshot.displayPath,
        sourceSizeBytes: snapshot.statIdentity.sizeBytes,
        targetLabel: resolvedTarget.targetLabel,
        version: AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION,
      });
      const action = requestedAction === undefined
        ? defaultAction
        : normalizeAgentFileUploadPreparedActionPublicV1(requestedAction);
      if (JSON.stringify(action) !== JSON.stringify(defaultAction)) {
        throw new Error('Agent 本机文件上传来源或目标已经变化');
      }
      const targetIdentity = fileAuthorityNodeIdentity(authority.parent);
      return {
        binding: {
          conflictPolicy: action.conflictPolicy,
          kind: AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND,
          libraryId: action.libraryId,
          localFileSnapshot: snapshot,
          outputFileName: action.outputFileName,
          parentId: action.parentId,
          providerId: action.providerId,
          targetIdentity,
          ...(resolvedTarget.directoryPath
            ? { targetDirectoryPath: resolvedTarget.directoryPath }
            : {}),
        },
        decision: {
          behavior: 'ask' as const,
          preview: {
            description: `将把本机文件“${snapshot.fileName}”原样上传到${action.targetLabel}。`,
            details: [
              { label: '来源', value: snapshot.displayPath },
              { label: '文件名', value: action.outputFileName },
              { label: '大小', value: `${snapshot.statIdentity.sizeBytes} bytes` },
              { label: '位置', value: action.targetLabel },
            ],
            risk: 'write' as const,
            title: '上传本机文件到资料库',
          },
          risk: 'write' as const,
        },
        publicAction: action,
        snapshotMaterial: {
          outputFileName: action.outputFileName,
          sourceIdentity: snapshot.identityHash,
          sourcePath: snapshot.displayPath,
          targetIdentity,
          ...(resolvedTarget.directoryPath
            ? { targetDirectoryPath: resolvedTarget.directoryPath }
            : {}),
        },
      };
    } catch (error) {
      rethrowSafeFileBridgeError(error, '无法准备本机文件上传');
    } finally {
      await opened?.fileHandle.close().catch(() => undefined);
    }
  }

  async function executeFileUploadInternal(
    context: AgentToolExecutionContext,
  ): Promise<AgentToolResult> {
    const preparation = context.preparation;
    if (!preparation) throw new Error('Agent 本机文件上传缺少 prepared execution');
    const action = normalizeAgentFileUploadPreparedActionPublicV1(preparation.publicAction);
    const binding = bindingObject(context, AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND);
    if (
      binding.libraryId !== action.libraryId
      || binding.parentId !== action.parentId
      || binding.providerId !== action.providerId
      || binding.conflictPolicy !== action.conflictPolicy
      || binding.outputFileName !== action.outputFileName
      || typeof binding.targetIdentity !== 'string'
      || (binding.targetDirectoryPath !== undefined
        && typeof binding.targetDirectoryPath !== 'string')
    ) {
      throw new Error('Agent 本机文件上传 prepared binding 无效');
    }
    const expectedSnapshot = localFileSnapshotFromBinding(binding);
    if (
      expectedSnapshot.displayPath !== action.sourcePath
      || expectedSnapshot.fileName !== action.sourceDisplayName
      || expectedSnapshot.identityHash !== action.sourceIdentity
      || expectedSnapshot.statIdentity.sizeBytes !== action.sourceSizeBytes
    ) {
      throw new Error('Agent 本机文件上传 prepared binding 无效');
    }
    await revalidateResolvedLibraryPath({
      ...(typeof binding.targetDirectoryPath === 'string'
        ? { directoryPath: binding.targetDirectoryPath }
        : {}),
      identity: preparation.identity,
      libraryId: action.libraryId,
      parentId: action.parentId,
      signal: context.signal,
      targetIdentity: binding.targetIdentity,
    });
    const authority = await requestFileAuthority({
      libraryId: action.libraryId,
      operation: {
        contentType: 'application/octet-stream',
        fileName: action.outputFileName,
        fileSize: action.sourceSizeBytes,
        includeCredentials: true,
        operation: 'publish-library-file',
        parentId: action.parentId,
        providerId: action.providerId,
      },
      ownerScope: preparation.identity.ownerScope,
      runId: preparation.identity.runId,
      sender: resolveSender(preparation.identity.ownerWebContentsId),
      sessionId: preparation.identity.sessionId,
      signal: context.signal,
      toolRunId: preparation.identity.toolRunId,
    });
    if (
      authority.operation !== 'publish-library-file'
      || !authority.credentials
      || authority.parent.id !== action.parentId
      || authority.parent.libraryId !== action.libraryId
      || authority.providerId !== action.providerId
      || fileAuthorityNodeIdentity(authority.parent) !== binding.targetIdentity
    ) {
      throw new Error('资料库上传目标在执行前已经变化，请重新准备');
    }
    const owner = ownerFor({
      ownerScope: preparation.identity.ownerScope,
      sessionId: preparation.identity.sessionId,
    });
    let opened: AgentOpenedLocalFile | null = null;
    const artifactId = `file-upload-${crypto.createHash('sha256').update(
      `${preparation.identity.runId}\u0000${preparation.identity.toolRunId}`,
    ).digest('hex')}`;
    try {
      context.onProgress({ message: '正在验证本机文件' });
      opened = await openAgentLocalFile(action.sourcePath, context.signal);
      await verifyAgentLocalFileSnapshot(opened, expectedSnapshot);
      fileUploadGrants.set(artifactId, {
        artifactId,
        fileName: action.outputFileName,
        kind: 'local-path',
        openedFile: opened,
        owner,
        ownerWebContentsId: preparation.identity.ownerWebContentsId,
        runId: preparation.identity.runId,
        sessionId: preparation.identity.sessionId,
        sizeBytes: action.sourceSizeBytes,
      });
      context.onProgress({ message: '正在上传本机文件到资料库' });
      const uploaded = await fileUploadManager.upload({
        artifactId,
        credentials: authority.credentials,
        expectedUserId: resolveOwnerUserId(owner),
        onProgress: (uploadedBytes, totalBytes) => {
          if (totalBytes <= 0) return;
          context.onProgress({
            message: '正在上传本机文件到资料库',
            percent: Math.max(1, Math.min(99, Math.floor((uploadedBytes / totalBytes) * 99))),
          });
        },
        owner: {
          executionId: preparation.identity.toolRunId,
          ownerScope: preparation.identity.ownerScope,
          ownerWebContentsId: preparation.identity.ownerWebContentsId,
          runId: preparation.identity.runId,
          sessionId: preparation.identity.sessionId,
        },
        signal: context.signal,
        target: {
          conflictPolicy: action.conflictPolicy === 'rename' ? 'auto_rename' : 'error',
          contentType: 'application/octet-stream',
          fileName: action.outputFileName,
          libraryId: action.libraryId,
          parentId: action.parentId,
          storageProvider: action.providerId,
        },
      });
      if (uploaded.commitState === 'commit_unknown') {
        return {
          data: {
            destination: { kind: 'library', parentId: action.parentId },
            uploadCommitState: 'commit_unknown',
          },
          message: '文件上传的提交状态暂时无法确认；请稍后检查目标目录，不要重复执行',
          ok: false,
        };
      }
      if (uploaded.commitState === 'uncommitted') {
        return {
          data: {
            destination: { kind: 'library', parentId: action.parentId },
            uploadCommitState: 'uncommitted',
          },
          message: '文件未能提交到资料库',
          ok: false,
        };
      }
      return {
        data: {
          destination: {
            kind: 'library',
            nodeId: uploaded.node.id,
            parentId: action.parentId,
          },
          displayName: uploaded.node.name,
          sizeBytes: action.sourceSizeBytes,
          uploadCommitState: 'committed',
        },
        message: `已将“${uploaded.node.name}”上传到资料库`,
        ok: true,
      };
    } catch (error) {
      return rethrowSafeFileBridgeError(error, '无法将指定的本机文件上传到资料库');
    } finally {
      fileUploadGrants.delete(artifactId);
      await opened?.fileHandle.close().catch(() => undefined);
    }
  }

  async function executeRun(
    context: AgentToolExecutionContext,
    executionController: AbortController,
  ): Promise<AgentShellRuntimeResult> {
    const preparation = context.preparation;
    if (!preparation) throw new Error('Agent Shell Service 缺少 prepared execution');
    const owner = ownerFor({
      ownerScope: preparation.identity.ownerScope,
      sessionId: preparation.identity.sessionId,
    });
    const action = preparation.publicAction;
    if (action.kind !== 'shell.run') throw new Error('Agent Shell prepared action 类型无效');
    if (action.cwd.kind === 'host') {
      // A host run deliberately bypasses the virtual workspace lifecycle. It
      // still uses the same lease, preflight, supervisor, log and cancellation
      // boundaries, but must never acquire workspace quota or cleanup rights.
      const forwardAbort = () => executionController.abort();
      if (context.signal.aborted) forwardAbort();
      else context.signal.addEventListener('abort', forwardAbort, { once: true });
      try {
        return await runtime.run({
          onEvent: (event) => {
            if (event.kind !== 'state') return;
            const message = shellProgressMessage(event.state);
            if (message) context.onProgress({ message });
          },
          owner,
          preparation,
          runCapabilityIdentity: preparation.identity.runCapabilityIdentity,
          signal: executionController.signal,
          toolRunId: preparation.identity.toolRunId,
          workspaceId: undefined,
        });
      } finally {
        context.signal.removeEventListener('abort', forwardAbort);
      }
    }
    const entry = runWorkspaces.get(preparation.identity.runId);
    if (!entry || !sameOwner(entry.owner, owner)) {
      throw new Error('Agent Shell Run workspace 不存在或已释放');
    }
    const workspace = await entry.promise;
    if (executionController.signal.aborted) {
      const error = new Error('Agent Shell Service 执行已取消');
      error.name = 'AbortError';
      throw error;
    }
    const executionQuota = await workspaceStore.beginExecutionQuota(
      workspace.workspaceId,
      executionGrowthBytes,
      owner,
      action.timeoutMs + 60_000,
    );
    const monitorController = new AbortController();
    let quotaFailure: unknown;
    let monitorStopped = false;
    let pollDelay: ReturnType<typeof createPollDelay> | null = null;
    const forwardAbort = () => executionController.abort();
    if (context.signal.aborted) forwardAbort();
    else context.signal.addEventListener('abort', forwardAbort, { once: true });
    const stopMonitor = (): void => {
      monitorStopped = true;
      monitorController.abort();
      pollDelay?.wake();
    };
    const monitorPromise = (async () => {
      while (!monitorStopped) {
        pollDelay = createPollDelay(executionQuotaPollIntervalMs);
        await pollDelay.promise;
        pollDelay = null;
        if (monitorStopped) return;
        try {
          await workspaceStore.scanExecutionQuotaUsage(
            workspace.workspaceId,
            executionQuota.quotaId,
            owner,
            monitorController.signal,
          );
        } catch (error) {
          if (monitorStopped) return;
          quotaFailure = error;
          executionController.abort();
          return;
        }
      }
    })();
    let result: AgentShellRuntimeResult;
    try {
      result = await runtime.run({
        onEvent: (event) => {
          if (event.kind !== 'state') return;
          const message = shellProgressMessage(event.state);
          if (message) context.onProgress({ message });
        },
        owner,
        preparation,
        runCapabilityIdentity: preparation.identity.runCapabilityIdentity,
        signal: executionController.signal,
        toolRunId: preparation.identity.toolRunId,
        workspaceId: workspace.workspaceId,
      });
    } catch (error) {
      stopMonitor();
      await monitorPromise;
      await workspaceStore.cancelExecutionQuota(
        workspace.workspaceId,
        executionQuota.quotaId,
        owner,
      ).catch(() => undefined);
      throw error;
    } finally {
      context.signal.removeEventListener('abort', forwardAbort);
    }
    stopMonitor();
    await monitorPromise;
    if (!result.terminationConfirmed) {
      await workspaceStore.requestCleanup(workspace.workspaceId, owner).catch(() => undefined);
      return result;
    }
    if (quotaFailure) {
      await workspaceStore.requestCleanup(workspace.workspaceId, owner).catch(() => undefined);
      await workspaceStore.cancelExecutionQuota(
        workspace.workspaceId,
        executionQuota.quotaId,
        owner,
      );
      await workspaceStore.requestCleanup(workspace.workspaceId, owner).catch(() => undefined);
      if (runWorkspaces.get(preparation.identity.runId) === entry) {
        runWorkspaces.delete(preparation.identity.runId);
      }
      return quotaFailureResult(result);
    }
    try {
      await workspaceStore.resolveExecutionResultContext(
        workspace.workspaceId,
        action.cwd.path,
        preparation.identity.runId,
        owner,
        executionQuota.quotaId,
        new AbortController().signal,
      );
    } catch {
      await workspaceStore.requestCleanup(workspace.workspaceId, owner).catch(() => undefined);
      await workspaceStore.cancelExecutionQuota(
        workspace.workspaceId,
        executionQuota.quotaId,
        owner,
      ).catch(() => undefined);
      await workspaceStore.requestCleanup(workspace.workspaceId, owner).catch(() => undefined);
      if (runWorkspaces.get(preparation.identity.runId) === entry) {
        runWorkspaces.delete(preparation.identity.runId);
      }
      if (result.ok) {
        throw new Error('Agent Shell 执行后无法可信确认 workspace 与配额');
      }
    }
    return result;
  }

  function execute(context: AgentToolExecutionContext): Promise<AgentShellRuntimeResult> {
    if (!accepting) return Promise.reject(new Error('Agent Shell Service 正在关闭'));
    const runId = String(context.preparation?.identity.runId || '');
    if (!runId) return Promise.reject(new Error('Agent Shell execution 缺少 Run 身份'));
    if (releasedRunIds.has(runId)) return Promise.reject(new Error('Agent Shell Run 已经释放'));
    const executionController = new AbortController();
    activeExecutionControllers.add(executionController);
    const operation = executeRun(context, executionController);
    const activeExecution = Object.freeze({
      controller: executionController,
      promise: operation,
      runId,
    });
    activeShellExecutions.add(activeExecution);
    activeExecutions.add(operation);
    void operation.then(
      () => {
        activeExecutionControllers.delete(executionController);
        activeShellExecutions.delete(activeExecution);
        activeExecutions.delete(operation);
      },
      () => {
        activeExecutionControllers.delete(executionController);
        activeShellExecutions.delete(activeExecution);
        activeExecutions.delete(operation);
      },
    );
    return operation;
  }

  function executeFileBridge(
    context: AgentToolExecutionContext,
    implementation: (boundContext: AgentToolExecutionContext) => Promise<AgentToolResult>,
  ): Promise<AgentToolResult> {
    if (!accepting) return Promise.reject(new Error('Agent Shell Service 正在关闭'));
    const runId = String(context.preparation?.identity.runId || '');
    if (!runId) return Promise.reject(new Error('Agent 文件桥缺少 Run 身份'));
    if (releasedRunIds.has(runId)) return Promise.reject(new Error('Agent Shell Run 已经释放'));
    const controller = new AbortController();
    const handleAbort = () => controller.abort();
    if (context.signal.aborted) controller.abort();
    else context.signal.addEventListener('abort', handleAbort, { once: true });
    const operation = Promise.resolve().then(() => implementation({
      ...context,
      signal: controller.signal,
    })).finally(() => {
      context.signal.removeEventListener('abort', handleAbort);
      for (const current of activeFileBridgeOperations) {
        if (current.promise === operation) activeFileBridgeOperations.delete(current);
      }
    });
    const record = Object.freeze({ controller, promise: operation, runId });
    activeFileBridgeOperations.add(record);
    return operation;
  }

  function executeFileStage(context: AgentToolExecutionContext): Promise<AgentToolResult> {
    return executeFileBridge(context, executeFileStageInternal);
  }

  function executeFilePublish(context: AgentToolExecutionContext): Promise<AgentToolResult> {
    return executeFileBridge(context, executeFilePublishInternal);
  }

  function executeFileUpload(context: AgentToolExecutionContext): Promise<AgentToolResult> {
    return executeFileBridge(context, executeFileUploadInternal);
  }

  function releaseRun(runId: string): Promise<void> {
    const normalizedRunId = String(runId || '');
    if (!normalizedRunId) return Promise.resolve();
    const currentRelease = runReleasePromises.get(normalizedRunId);
    if (currentRelease) return currentRelease;
    releasedRunIds.add(normalizedRunId);
    const release = (async () => {
      const executions = Array.from(activeShellExecutions).filter(
        execution => execution.runId === normalizedRunId,
      );
      executions.forEach(execution => execution.controller.abort());
      await Promise.allSettled(executions.map(execution => execution.promise));
      const operations = Array.from(activeFileBridgeOperations).filter(
        operation => operation.runId === normalizedRunId,
      );
      operations.forEach(operation => operation.controller.abort());
      await Promise.allSettled(operations.map(operation => operation.promise));
      const entry = runWorkspaces.get(normalizedRunId);
      if (!entry) return;
      runWorkspaces.delete(entry.runId);
      const workspace = await entry.promise.catch(() => null);
      if (!workspace) return;
      await workspaceStore.requestCleanup(workspace.workspaceId, entry.owner);
    })();
    runReleasePromises.set(normalizedRunId, release);
    return release;
  }

  async function close(): Promise<void> {
    if (closePromise) return closePromise;
    accepting = false;
    closePromise = (async () => {
      activeExecutionControllers.forEach(controller => controller.abort());
      activeFileBridgeOperations.forEach(operation => operation.controller.abort());
      await processSupervisor.interruptAll();
      await Promise.allSettled(Array.from(activeExecutions));
      await Promise.allSettled(Array.from(activeFileBridgeOperations, operation => operation.promise));
      fileUploadGrants.clear();
      const releases = Array.from(runWorkspaces.keys()).map(runId => releaseRun(runId));
      await Promise.allSettled(releases);
    })();
    return closePromise;
  }

  return Object.freeze({
    close,
    execute,
    executeFilePublish,
    executeFileStage,
    executeFileUpload,
    getPermissionMode: permissionMode,
    getProviderSnapshot: () => options.providerRegistry.getSnapshot(),
    prepare,
    prepareFilePublish,
    prepareFileStage,
    prepareFileUpload,
    releaseRun,
  });
}

export type AgentShellServiceRuntime = ReturnType<typeof createAgentShellServiceRuntime>;

let serviceRuntime: AgentShellServiceRuntime | null = null;
let initialization: Promise<boolean> | null = null;

export function getAgentShellProviderSnapshotForRun(): AgentShellProviderRegistrySnapshot | null {
  return serviceRuntime?.getProviderSnapshot() || null;
}

export function getAgentShellPermissionModeForRun(): AgentShellPermissionMode {
  return serviceRuntime?.getPermissionMode() || agentShellSettingsStore.load().permissionMode;
}

export async function initializeAgentShellServiceRuntime(): Promise<boolean> {
  if (serviceRuntime) return true;
  if (initialization) return initialization;
  initialization = (async () => {
    const providerRegistry = createAgentShellProviderRegistry();
    const providerSnapshot = await providerRegistry.refresh();
    const defaultProvider = providerSnapshot.defaultProviderRegistrationIdentity
      ? providerSnapshot.getProvider(providerSnapshot.defaultProviderRegistrationIdentity)
      : undefined;
    if (!defaultProvider?.publicIdentity.executionReady) return false;
    const storageRuntime = await getAgentShellStorageRuntime();
    const runtime = createAgentShellServiceRuntime({
      getPermissionMode: () => agentShellSettingsStore.load().permissionMode,
      providerRegistry,
      storageRuntime,
    });
    const tool = createAgentShellRunTool({
      execute: (context) => {
        if (!serviceRuntime) throw new Error('Agent Shell Service 尚未初始化');
        return serviceRuntime.execute(context);
      },
      prepare: (input, requestedAction, context) => {
        if (!serviceRuntime) throw new Error('Agent Shell Service 尚未初始化');
        return serviceRuntime.prepare(input, requestedAction, context);
      },
    });
    const fileBridgeTools = createAgentFileBridgeTools({
      executePublish: context => runtime.executeFilePublish(context),
      executeStage: context => runtime.executeFileStage(context),
      executeUpload: context => runtime.executeFileUpload(context),
      preparePublish: (input, requestedAction, context) => (
        runtime.prepareFilePublish(input, requestedAction, context)
      ),
      prepareStage: (input, requestedAction, context) => (
        runtime.prepareFileStage(input, requestedAction, context)
      ),
      prepareUpload: (input, requestedAction, context) => (
        runtime.prepareFileUpload(input, requestedAction, context)
      ),
    });
    const tools = [tool, ...fileBridgeTools];
    createAgentToolRegistry(tools);
    for (const candidate of tools) {
      const existing = agentToolRegistry.get(candidate.name);
      if (existing && existing.registrationId !== candidate.registrationId) {
        await runtime.close();
        throw new Error(`Agent Shell Tool registration identity 冲突：${candidate.name}`);
      }
    }
    serviceRuntime = runtime;
    try {
      for (const candidate of tools) {
        if (!agentToolRegistry.get(candidate.name)) agentToolRegistry.register(candidate);
      }
    } catch (error) {
      serviceRuntime = null;
      await runtime.close();
      throw error;
    }
    return true;
  })();
  try {
    return await initialization;
  } finally {
    initialization = null;
  }
}

export async function releaseAgentShellRun(runId: string): Promise<void> {
  await serviceRuntime?.releaseRun(runId);
}

export async function disposeAgentShellServiceRuntime(): Promise<void> {
  const runtime = serviceRuntime;
  serviceRuntime = null;
  await runtime?.close();
  await disposeAgentShellStorageRuntime();
}
