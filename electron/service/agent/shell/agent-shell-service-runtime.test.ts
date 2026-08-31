import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentFileAuthorityNodeSnapshotV1,
  AgentFileAuthorityResultV1,
  AgentMediaArtifactUploadResult,
} from '@/shared/agent/agent.types';

import type {
  AgentToolExecutionContext,
  AgentToolMainPreparationContext,
} from '../agent-tool-registry';
import {
  createAgentShellServiceRuntime,
} from './agent-shell-service-runtime';
import type {
  AgentShellRuntimeResult,
  AgentShellRuntimeRunInput,
} from './agent-shell-runtime';
import type {
  AgentShellWorkspaceOwnedFile,
  AgentShellWorkspaceOwner,
} from './agent-shell-workspace-store';

type RequestFileAuthority = NonNullable<
  Parameters<typeof createAgentShellServiceRuntime>[0]['requestFileAuthority']
>;
type RequestFileAuthorityInput = Parameters<RequestFileAuthority>[0];

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  webContents: {
    fromId: vi.fn(() => ({ isDestroyed: () => false })),
  },
}));

const OWNER: AgentShellWorkspaceOwner = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});

function runtimeResult(): AgentShellRuntimeResult {
  return Object.freeze({
    droppedDetailedBytes: 0,
    droppedOutputBytes: 0,
    durationMs: 5,
    executionId: 'execution-1',
    exitCode: 0,
    logRef: 'log:v1:ref',
    ok: true,
    outputBytes: 0,
    outputTail: Object.freeze({
      executionId: 'execution-1',
      firstSequence: null,
      frames: Object.freeze([]),
      lastSequence: null,
      truncatedBefore: null,
    }),
    processStatus: 'completed',
    status: 'completed',
    terminationConfirmed: true,
    terminationSignal: null,
  });
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

function ownedFile(overrides: Record<string, unknown> = {}) {
  return {
    contentHash: `sha256:${'a'.repeat(64)}`,
    displayName: 'result.txt',
    fileHandle: {},
    generation: 1,
    logicalPath: 'output/result.txt',
    managedRootPath: '/managed/agent/workspace',
    sizeBytes: 8,
    verifyUnchanged: vi.fn(async () => undefined),
    workspaceId: 'workspace-1',
    ...overrides,
  } as unknown as AgentShellWorkspaceOwnedFile;
}

function authorityNode(
  overrides: Partial<AgentFileAuthorityNodeSnapshotV1> = {},
): AgentFileAuthorityNodeSnapshotV1 {
  return {
    fileSize: 12,
    id: 8,
    libraryId: 3,
    name: 'source.txt',
    parentId: 9,
    storageKey: 'libraries/3/source.txt',
    storageProvider: 'local',
    type: 'file',
    updatedAt: '2026-08-31T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

function createFixture(options: {
  downloadFile?: NonNullable<Parameters<typeof createAgentShellServiceRuntime>[0]['downloadFile']>;
  fileUploadManager?: NonNullable<
    Parameters<typeof createAgentShellServiceRuntime>[0]['fileUploadManager']
  >;
  pickLocalFile?: (ownerWebContentsId: number, signal: AbortSignal) => Promise<
    { canceled: true } | { canceled: false; filePath: string }
  >;
  pollIntervalMs?: number;
  saveLocalFileAs?: NonNullable<
    Parameters<typeof createAgentShellServiceRuntime>[0]['saveLocalFileAs']
  >;
  requestFileAuthority?: NonNullable<
    Parameters<typeof createAgentShellServiceRuntime>[0]['requestFileAuthority']
  >;
} = {}) {
  const workspace = {
    generation: 1,
    logicalRoots: ['input', 'work', 'output', 'tmp', 'home'],
    manifest: { entries: [], generation: 1, provenance: [], workspaceId: 'workspace-1' },
    owner: OWNER,
    runId: 'run-1',
    workspaceId: 'workspace-1',
  } as const;
  const workspaceStore = {
    beginExecutionQuota: vi.fn(async () => ({
      baselineBytes: 0,
      maximumBytes: 1024,
      quotaId: 'quota-1',
      reservedGrowthBytes: 1024,
      workspaceId: 'workspace-1',
    })),
    cancelExecutionQuota: vi.fn(async () => true),
    create: vi.fn(async () => workspace),
    requestCleanup: vi.fn(async () => ({ released: true, state: 'released' as const })),
    resolveExecutionResultContext: vi.fn(async () => ({
      generation: 1,
      logicalCwd: 'work',
      owner: OWNER,
      physicalCwdPath: '/tmp/work',
      physicalHomePath: '/tmp/home',
      physicalTempPath: '/tmp/tmp',
      runId: 'run-1',
      workspaceContentIdentity: 'content',
      workspaceContentScannerRevision: 'workspace-content-scanner-v3' as const,
      workspaceEntryCount: 5,
      workspaceId: 'workspace-1',
      workspaceMetadataIdentity: 'metadata',
      workspaceTotalBytes: 0,
    })),
    scanExecutionQuotaUsage: vi.fn(async () => ({ entryCount: 5, totalBytes: 0 })),
    stageFileFromHandle: vi.fn(async () => ({
      contentHash: `sha256:${'b'.repeat(64)}`,
      displayName: 'selected.txt',
      generation: 2,
      logicalPath: 'input/selected.txt',
      sizeBytes: 13,
      workspaceId: 'workspace-1',
    })),
    withOwnedFile: vi.fn(async (
      _workspaceId: string,
      _logicalPath: string,
      _runId: string,
      _owner: AgentShellWorkspaceOwner,
      consumer: (file: ReturnType<typeof ownedFile>) => Promise<unknown>,
    ) => consumer(ownedFile())),
  };
  const prepare = vi.fn(async () => ({}) as never);
  const run = vi.fn(async (
    input: AgentShellRuntimeRunInput,
  ): Promise<AgentShellRuntimeResult> => {
    void input;
    return runtimeResult();
  });
  const interruptAll = vi.fn(async () => undefined);
  const pickLocalFile = options.pickLocalFile || vi.fn(async () => ({ canceled: true as const }));
  const saveLocalFileAs = options.saveLocalFileAs || vi.fn(async () => ({
    canceled: false as const,
    fileName: 'result.txt',
  }));
  const requestFileAuthority = options.requestFileAuthority || vi.fn(async (
    input: RequestFileAuthorityInput,
  ): Promise<AgentFileAuthorityResultV1> => {
    if (input.operation.operation === 'stage-library-node') {
      return {
        ...(input.operation.includeDownloadUrl
          ? { downloadUrl: 'https://example.com/signed-source' }
          : {}),
        node: authorityNode(),
        operation: 'stage-library-node',
        version: 1,
      };
    }
    return {
      ...(input.operation.includeCredentials
        ? { credentials: { token: 'private-token', username: 'user-7' } }
        : {}),
      operation: 'publish-library-file',
      parent: authorityNode({ fileSize: 0, id: 9, name: 'Output', parentId: 0, type: 'dir' }),
      providerId: 'local',
      providerLabel: '本机存储',
      version: 1,
    };
  }) as NonNullable<Parameters<typeof createAgentShellServiceRuntime>[0]['requestFileAuthority']>;
  const downloadFile = options.downloadFile || vi.fn(async (
    _url: string,
    destinationPath: string,
  ) => {
    await writeFile(destinationPath, 'hello stage!', 'utf8');
  }) as NonNullable<Parameters<typeof createAgentShellServiceRuntime>[0]['downloadFile']>;
  const fileUploadManager = options.fileUploadManager || {
    upload: vi.fn(async (): Promise<AgentMediaArtifactUploadResult> => ({
      commitState: 'committed',
      node: { id: 31, name: 'result.txt' },
    })),
  };
  const service = createAgentShellServiceRuntime({
    dependencies: {
      preparationService: { prepare },
      processSupervisor: { interruptAll },
      runtime: { run },
    },
    executionGrowthBytes: 1024,
    executionQuotaPollIntervalMs: options.pollIntervalMs ?? 60_000,
    downloadFile,
    fileUploadManager,
    pickLocalFile,
    providerRegistry: {
      getSnapshot: vi.fn(() => ({ identity: 'providers' })),
    } as never,
    storageRuntime: {
      logStore: {},
      workspaceStore,
    } as never,
    saveLocalFileAs,
    requestFileAuthority,
  });
  const preparationContext = {
    ownerScope: {
      accountScope: OWNER.accountScope,
      backendScope: OWNER.backendScope,
    },
    preparationIdentity: {
      aiDestinationIdentity: 'ai-destination-1',
      callId: 'call-1',
      libraryId: 3,
      ownerScope: {
        accountScope: OWNER.accountScope,
        backendScope: OWNER.backendScope,
      },
      ownerWebContentsId: 7,
      preparedActionId: 'prepared-1',
      runCapabilityIdentity: 'v1:capability',
      runId: 'run-1',
      sessionId: OWNER.sessionId,
      toolInputHash: 'input-hash',
      toolName: 'file.stage',
      toolRegistrationId: 'file.stage@1',
      toolRunId: 'tool-run-1',
    },
    signal: new AbortController().signal,
  } as unknown as AgentToolMainPreparationContext;
  return {
    downloadFile,
    fileUploadManager,
    interruptAll,
    preparationContext,
    pickLocalFile,
    prepare,
    run,
    requestFileAuthority,
    service,
    saveLocalFileAs,
    workspaceStore,
  };
}

describe('Agent Shell service runtime', () => {
  it('treats a canceled local picker as a bounded file.stage result', async () => {
    const fixture = createFixture();
    const prepared = await fixture.service.prepareFileStage({
      source: { kind: 'local-picker' },
    }, undefined, fixture.preparationContext);

    await expect(fixture.service.executeFileStage({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: fixture.preparationContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext)).resolves.toEqual({
      data: { canceled: true },
      message: '未选择文件',
      ok: false,
    });
    expect(fixture.workspaceStore.stageFileFromHandle).not.toHaveBeenCalled();
  });

  it('stages one explicitly selected local file without exposing its physical path', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-stage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'selected.txt');
    await writeFile(filePath, 'hello stage', 'utf8');
    const fixture = createFixture({
      pickLocalFile: vi.fn(async () => ({ canceled: false, filePath })),
    });
    const prepared = await fixture.service.prepareFileStage({
      source: { kind: 'local-picker' },
    }, undefined, fixture.preparationContext);

    const result = await fixture.service.executeFileStage({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: fixture.preparationContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext);

    expect(result).toMatchObject({
      data: {
        displayName: 'selected.txt',
        logicalPath: 'input/selected.txt',
        sourceKind: 'local-picker',
      },
      ok: true,
    });
    expect(JSON.stringify(result)).not.toContain(directory);
    expect(fixture.workspaceStore.stageFileFromHandle).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'selected.txt',
      expectedGeneration: 1,
      expectedRunId: 'run-1',
      owner: OWNER,
      workspaceId: 'workspace-1',
    }));
  });

  it('publishes a verified output through Save As and returns only the basename', async () => {
    const fixture = createFixture({
      saveLocalFileAs: vi.fn(async () => ({
        canceled: false,
        fileName: 'renamed.txt',
      })),
    });
    const publishContext = {
      ...fixture.preparationContext,
      preparationIdentity: {
        ...fixture.preparationContext.preparationIdentity,
        toolName: 'file.publish',
        toolRegistrationId: 'file.publish@1',
      },
    } as AgentToolMainPreparationContext;
    const prepared = await fixture.service.prepareFilePublish({
      destination: { kind: 'local-save-as', suggestedFileName: 'renamed.txt' },
      sourcePath: 'output/result.txt',
    }, undefined, publishContext);

    const result = await fixture.service.executeFilePublish({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: publishContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext);

    expect(result).toEqual({
      data: {
        contentHash: `sha256:${'a'.repeat(64)}`,
        destination: { kind: 'local-save-as', saved: true },
        displayName: 'renamed.txt',
        sizeBytes: 8,
        sourcePath: 'output/result.txt',
      },
      message: '已将“renamed.txt”保存到本机',
      ok: true,
    });
    expect(fixture.saveLocalFileAs).toHaveBeenCalledWith(expect.objectContaining({
      defaultFileName: 'renamed.txt',
      internalRootPath: '/managed/agent/workspace',
      sourceFileName: 'result.txt',
    }));
  });

  it('rejects publish when the owned output drifts after preparation', async () => {
    const fixture = createFixture();
    const publishContext = {
      ...fixture.preparationContext,
      preparationIdentity: {
        ...fixture.preparationContext.preparationIdentity,
        toolName: 'file.publish',
        toolRegistrationId: 'file.publish@1',
      },
    } as AgentToolMainPreparationContext;
    const prepared = await fixture.service.prepareFilePublish({
      destination: { kind: 'local-save-as' },
      sourcePath: 'output/result.txt',
    }, undefined, publishContext);
    fixture.workspaceStore.withOwnedFile.mockImplementationOnce(async (
      _workspaceId: string,
      _logicalPath: string,
      _runId: string,
      _owner: AgentShellWorkspaceOwner,
      consumer: (file: ReturnType<typeof ownedFile>) => Promise<unknown>,
    ) => consumer(ownedFile({ contentHash: `sha256:${'d'.repeat(64)}` })));

    await expect(fixture.service.executeFilePublish({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: publishContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext)).rejects.toThrow('已经变化');
    expect(fixture.saveLocalFileAs).not.toHaveBeenCalled();
  });

  it('stages a stable library file without exposing its signed URL or physical path', async () => {
    const fixture = createFixture();
    const prepared = await fixture.service.prepareFileStage({
      source: { kind: 'library-node', nodeId: 8 },
    }, undefined, fixture.preparationContext);
    expect(fixture.requestFileAuthority).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ includeDownloadUrl: false }),
    }));

    const result = await fixture.service.executeFileStage({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: fixture.preparationContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext);

    expect(result).toMatchObject({
      data: { logicalPath: 'input/selected.txt', sourceKind: 'library-node', sourceNodeId: 8 },
      ok: true,
    });
    expect(fixture.downloadFile).toHaveBeenCalledWith(
      'https://example.com/signed-source',
      expect.any(String),
      {},
      0,
      12,
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(result)).not.toContain('signed-source');
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(fixture.workspaceStore.stageFileFromHandle).toHaveBeenCalledOnce();
  });

  it('rejects a library stage when the source identity drifts during download', async () => {
    let requestCount = 0;
    const requestFileAuthority = vi.fn(async (
      input: RequestFileAuthorityInput,
    ): Promise<AgentFileAuthorityResultV1> => {
      requestCount += 1;
      return {
        ...(input.operation.operation === 'stage-library-node' && input.operation.includeDownloadUrl
          ? { downloadUrl: 'https://example.com/signed-source' }
          : {}),
        node: authorityNode(requestCount === 3 ? { updatedAt: '2026-09-01T00:00:00Z' } : {}),
        operation: 'stage-library-node',
        version: 1,
      };
    }) as NonNullable<Parameters<typeof createAgentShellServiceRuntime>[0]['requestFileAuthority']>;
    const fixture = createFixture({ requestFileAuthority });
    const prepared = await fixture.service.prepareFileStage({
      source: { kind: 'library-node', nodeId: 8 },
    }, undefined, fixture.preparationContext);

    await expect(fixture.service.executeFileStage({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: fixture.preparationContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext)).rejects.toThrow('下载期间已经变化');
    expect(fixture.workspaceStore.stageFileFromHandle).not.toHaveBeenCalled();
  });

  it.each([
    ['committed', { commitState: 'committed', node: { id: 31, name: 'result.txt' } }, true],
    ['uncommitted', { commitState: 'uncommitted' }, false],
    ['commit_unknown', { commitState: 'commit_unknown' }, false],
  ] as const)('publishes to a stable library target and preserves %s settlement', async (
    _label,
    uploadResult,
    expectedOk,
  ) => {
    const upload = vi.fn(async () => uploadResult as AgentMediaArtifactUploadResult);
    const fixture = createFixture({ fileUploadManager: { upload } });
    const publishContext = {
      ...fixture.preparationContext,
      preparationIdentity: {
        ...fixture.preparationContext.preparationIdentity,
        toolName: 'file.publish',
        toolRegistrationId: 'file.publish@1',
      },
    } as AgentToolMainPreparationContext;
    const prepared = await fixture.service.prepareFilePublish({
      destination: { kind: 'library', parentId: 9 },
      sourcePath: 'output/result.txt',
    }, undefined, publishContext);
    expect(fixture.requestFileAuthority).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ includeCredentials: false }),
    }));

    const result = await fixture.service.executeFilePublish({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: publishContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext);

    expect(result.ok).toBe(expectedOk);
    expect(result.data).toMatchObject({ uploadCommitState: uploadResult.commitState });
    expect(fixture.requestFileAuthority).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ includeCredentials: true }),
    }));
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      expectedUserId: 7,
      target: expect.objectContaining({ libraryId: 3, parentId: 9, storageProvider: 'local' }),
    }));
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('creates one workspace per Run and releases it exactly once while closing', async () => {
    const fixture = createFixture();

    await fixture.service.prepare({}, undefined, fixture.preparationContext);
    await fixture.service.prepare({}, undefined, fixture.preparationContext);
    expect(fixture.workspaceStore.create).toHaveBeenCalledOnce();

    const firstClose = fixture.service.close();
    const secondClose = fixture.service.close();
    await Promise.all([firstClose, secondClose]);
    expect(fixture.interruptAll).toHaveBeenCalledOnce();
    expect(fixture.workspaceStore.requestCleanup).toHaveBeenCalledOnce();
    await expect(fixture.service.prepare({}, undefined, fixture.preparationContext))
      .rejects.toThrow('正在关闭');
  });

  it('holds execution headroom until the authoritative post-run scan settles it', async () => {
    const fixture = createFixture();
    await fixture.service.prepare({}, undefined, fixture.preparationContext);
    const preparation = {
      identity: {
        ownerScope: {
          accountScope: OWNER.accountScope,
          backendScope: OWNER.backendScope,
        },
        runCapabilityIdentity: 'capability-1',
        runId: 'run-1',
        sessionId: OWNER.sessionId,
        toolRunId: 'tool-run-1',
      },
      publicAction: {
        cwd: { kind: 'run-workspace', path: 'work' },
        kind: 'shell.run',
        timeoutMs: 1,
        version: 1,
      },
    };
    const context = {
      onProgress: vi.fn(),
      preparation,
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext;

    await expect(fixture.service.execute(context)).resolves.toMatchObject({
      ok: true,
      status: 'completed',
    });
    expect(fixture.workspaceStore.beginExecutionQuota).toHaveBeenCalledWith(
      'workspace-1',
      1024,
      OWNER,
      60_001,
    );
    expect(fixture.workspaceStore.resolveExecutionResultContext).toHaveBeenCalledWith(
      'workspace-1',
      'work',
      'run-1',
      OWNER,
      'quota-1',
      expect.any(AbortSignal),
    );
    expect(fixture.workspaceStore.cancelExecutionQuota).not.toHaveBeenCalled();
  });

  it('fails closed and cleans the workspace when execution-time accounting cannot continue', async () => {
    const fixture = createFixture({ pollIntervalMs: 1 });
    await fixture.service.prepare({}, undefined, fixture.preparationContext);
    fixture.workspaceStore.scanExecutionQuotaUsage.mockRejectedValueOnce(
      new Error('Agent workspace 用量超过执行预留额度'),
    );
    fixture.run.mockImplementationOnce(async (
      input: AgentShellRuntimeRunInput,
    ): Promise<AgentShellRuntimeResult> => new Promise<AgentShellRuntimeResult>((resolve) => {
      input.signal.addEventListener('abort', () => resolve(Object.freeze({
        ...runtimeResult(),
        exitCode: null,
        ok: false,
        processStatus: 'cancelled' as const,
        status: 'cancelled' as const,
        terminationReason: 'cancelled' as const,
      })), { once: true });
    }));
    const preparation = {
      identity: {
        ownerScope: {
          accountScope: OWNER.accountScope,
          backendScope: OWNER.backendScope,
        },
        runCapabilityIdentity: 'capability-1',
        runId: 'run-1',
        sessionId: OWNER.sessionId,
        toolRunId: 'tool-run-1',
      },
      publicAction: {
        cwd: { kind: 'run-workspace', path: 'work' },
        kind: 'shell.run',
        timeoutMs: 1,
        version: 1,
      },
    };

    await expect(fixture.service.execute({
      onProgress: vi.fn(),
      preparation,
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext)).resolves.toMatchObject({
      ok: false,
      status: 'failed',
      terminationReason: 'quota_exceeded',
    });
    expect(fixture.workspaceStore.cancelExecutionQuota).toHaveBeenCalledWith(
      'workspace-1',
      'quota-1',
      OWNER,
    );
    expect(fixture.workspaceStore.requestCleanup).toHaveBeenCalledTimes(2);
    expect(fixture.workspaceStore.resolveExecutionResultContext).not.toHaveBeenCalled();
  });

  it('waits for the full execution settlement before releasing workspaces during close', async () => {
    const fixture = createFixture();
    await fixture.service.prepare({}, undefined, fixture.preparationContext);
    let resolveRuntime!: (result: AgentShellRuntimeResult) => void;
    let executionSignal: AbortSignal | undefined;
    fixture.run.mockImplementationOnce((input: AgentShellRuntimeRunInput) => {
      executionSignal = input.signal;
      return new Promise<AgentShellRuntimeResult>((resolve) => {
        resolveRuntime = resolve;
      });
    });
    const preparation = {
      identity: {
        ownerScope: {
          accountScope: OWNER.accountScope,
          backendScope: OWNER.backendScope,
        },
        runCapabilityIdentity: 'capability-1',
        runId: 'run-1',
        sessionId: OWNER.sessionId,
        toolRunId: 'tool-run-1',
      },
      publicAction: {
        cwd: { kind: 'run-workspace', path: 'work' },
        kind: 'shell.run',
        timeoutMs: 1,
        version: 1,
      },
    };
    const execution = fixture.service.execute({
      onProgress: vi.fn(),
      preparation,
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext);
    await vi.waitFor(() => expect(fixture.run).toHaveBeenCalledOnce());

    const closing = fixture.service.close();
    await vi.waitFor(() => expect(executionSignal?.aborted).toBe(true));
    expect(fixture.workspaceStore.requestCleanup).not.toHaveBeenCalled();
    resolveRuntime(Object.freeze({
      ...runtimeResult(),
      exitCode: null,
      ok: false,
      processStatus: 'cancelled',
      status: 'cancelled',
      terminationReason: 'cancelled',
    }));

    await expect(execution).resolves.toMatchObject({ status: 'cancelled' });
    await closing;
    expect(fixture.workspaceStore.resolveExecutionResultContext).toHaveBeenCalledOnce();
    expect(fixture.workspaceStore.requestCleanup).toHaveBeenCalledOnce();
  });

  it('waits for library upload settlement before releasing its Run workspace', async () => {
    let uploadSignal: AbortSignal | undefined;
    let resolveUpload!: (result: AgentMediaArtifactUploadResult) => void;
    const upload = vi.fn((input: { signal: AbortSignal }) => {
      uploadSignal = input.signal;
      return new Promise<AgentMediaArtifactUploadResult>((resolve) => {
        resolveUpload = resolve;
      });
    });
    const fixture = createFixture({ fileUploadManager: { upload: upload as never } });
    const publishContext = {
      ...fixture.preparationContext,
      preparationIdentity: {
        ...fixture.preparationContext.preparationIdentity,
        toolName: 'file.publish',
        toolRegistrationId: 'file.publish@1',
      },
    } as AgentToolMainPreparationContext;
    const prepared = await fixture.service.prepareFilePublish({
      destination: { kind: 'library', parentId: 9 },
      sourcePath: 'output/result.txt',
    }, undefined, publishContext);
    const execution = fixture.service.executeFilePublish({
      onProgress: vi.fn(),
      preparation: {
        binding: prepared.binding,
        identity: publishContext.preparationIdentity,
        preparedActionId: 'prepared-1',
        publicAction: prepared.publicAction,
        snapshotHash: 'a'.repeat(64),
      },
      signal: new AbortController().signal,
    } as unknown as AgentToolExecutionContext);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());

    const closing = fixture.service.close();
    await vi.waitFor(() => expect(uploadSignal?.aborted).toBe(true));
    expect(fixture.workspaceStore.requestCleanup).not.toHaveBeenCalled();
    resolveUpload({ commitState: 'uncommitted' });

    await expect(execution).resolves.toMatchObject({
      data: { uploadCommitState: 'uncommitted' },
      ok: false,
    });
    await closing;
    expect(fixture.workspaceStore.requestCleanup).toHaveBeenCalledOnce();
  });
});
