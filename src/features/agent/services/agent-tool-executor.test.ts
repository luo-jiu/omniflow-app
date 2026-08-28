import { describe, expect, it, vi } from 'vitest';

import type {
  AgentMediaArtifactSaveResult,
  AgentToolExecutionRequest,
} from '@/shared/agent/agent.types';
import { executeAgentRendererTool } from './agent-tool-executor';

function request(): AgentToolExecutionRequest {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin',
      selectedNodeIds: [],
    },
    executionId: 'execution-1',
    input: {
      conflictPolicy: 'error',
      libraryId: 3,
      name: '测试',
      parentId: 10,
    },
    ownerScope: {
      accountScope: 'user:7',
      backendScope: 'https://example.com/api',
    },
    runId: 'run-1',
    sessionId: 'session-1',
    toolName: 'directory.create',
  };
}

function mediaExtractRequest(
  input: Record<string, unknown> = {},
): AgentToolExecutionRequest {
  const mediaRequest = request();
  mediaRequest.toolName = 'media.extractAudio';
  mediaRequest.input = {
    conflictPolicy: 'auto_rename',
    destination: 'library',
    fallbackPolicy: 'prompt_local',
    libraryId: 3,
    mimeType: 'video/mp4',
    nodeId: 8,
    outputFileName: 'movie-audio.m4a',
    outputFormat: 'm4a',
    parentId: 10,
    preparedActionId: 'prepared-1',
    snapshotHash: 'snapshot-1',
    sourceFileName: 'movie.mp4',
    storageProvider: 'local-minio',
    ...input,
  };
  return mediaRequest;
}

function extractedArtifact() {
  return {
    artifactId: 'artifact-1',
    fileName: 'movie-audio.m4a',
    mimeType: 'audio/mp4',
    sizeBytes: 100,
  };
}

describe('Agent renderer tool executor', () => {
  it('creates a directory, refreshes the tree and returns a fresh perception', async () => {
    const createDirectory = vi.fn(async () => ({ id: 22 }));
    const onRefreshDirectory = vi.fn(async () => undefined);
    const perception = {
      collectedAt: '2026-08-23T00:00:00.000Z',
      currentDirectory: {
        entries: [{ id: 22, name: '测试', type: 'dir' as const }],
        entryCount: 1,
        id: 10,
        name: '视频',
      },
      selectedNodes: [],
    };
    const readPerception = vi.fn(async () => perception);
    const onCommitted = vi.fn(async () => undefined);

    const outcome = await executeAgentRendererTool(request(), {
      createDirectory: createDirectory as never,
      onCommitted,
      onRefreshDirectory,
      readPerception,
    });

    expect(createDirectory).toHaveBeenCalledWith({
      conflictPolicy: 'error',
      libraryId: 3,
      name: '测试',
      parentId: 10,
      type: 'dir',
    });
    expect(onRefreshDirectory).toHaveBeenCalledWith(10);
    expect(readPerception).toHaveBeenCalledWith(request().appContext);
    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createdNodeId: 22, verified: false }),
      ok: true,
    }));
    expect(outcome).toEqual({
      committed: true,
      perception,
      result: {
        data: { createdNodeId: 22, name: '测试', parentId: 10, verified: true },
        message: '已创建文件夹“测试”',
        ok: true,
      },
    });
  });

  it('does not report a completed write as failed when refresh verification fails', async () => {
    const outcome = await executeAgentRendererTool(request(), {
      createDirectory: vi.fn(async () => ({ id: 22 })) as never,
      onRefreshDirectory: vi.fn(async () => {
        throw new Error('refresh failed');
      }),
      readPerception: vi.fn(async () => {
        throw new Error('read failed');
      }),
    });

    expect(outcome).toMatchObject({
      result: {
        data: { verified: false },
        message: expect.stringContaining('已创建文件夹'),
        ok: true,
      },
    });
  });

  it('rejects a request whose target differs from its safe app context', async () => {
    const createDirectory = vi.fn();
    const mismatched = request();
    mismatched.input = { ...mismatched.input as object, parentId: 11 };

    await expect(executeAgentRendererTool(mismatched, {
      createDirectory: createDirectory as never,
    })).resolves.toMatchObject({ result: { ok: false } });
    expect(createDirectory).not.toHaveBeenCalled();
  });

  it('resolves a short-lived media URL and keeps it out of the returned Tool result', async () => {
    const mediaRequest = request();
    mediaRequest.toolName = 'media.inspect';
    mediaRequest.input = {
      fileName: 'movie.mp4',
      libraryId: 3,
      mimeType: 'video/mp4',
      nodeId: 8,
    };
    const getMediaFileLink = vi.fn(async () => 'https://storage.example/signed?secret=value');
    const inspectMedia = vi.fn(async () => ({
      data: { streamCount: 2 },
      message: '已读取媒体信息',
      ok: true,
    }));

    const outcome = await executeAgentRendererTool(mediaRequest, {
      getMediaFileLink,
      inspectMedia,
    });

    expect(getMediaFileLink).toHaveBeenCalledWith(8, 3, 2);
    expect(inspectMedia).toHaveBeenCalledWith(expect.objectContaining({
      executionId: mediaRequest.executionId,
      nodeId: 8,
      ownerScope: mediaRequest.ownerScope,
      sourceUrl: 'https://storage.example/signed?secret=value',
    }));
    expect(outcome).toEqual({
      result: { data: { streamCount: 2 }, message: '已读取媒体信息', ok: true },
    });
    expect(JSON.stringify(outcome)).not.toContain('secret=value');
  });

  it('extracts audio, uploads it to the current directory and releases the local artifact', async () => {
    const mediaRequest = mediaExtractRequest();
    const getMediaFileLink = vi.fn(async () => 'https://storage.example/signed?secret=value');
    const extractMediaAudio = vi.fn(async () => extractedArtifact());
    const uploadMediaArtifact = vi.fn(async () => ({
      commitState: 'committed' as const,
      node: { ext: 'm4a', id: 32, name: 'movie-audio (1)' },
    }));
    const releaseMediaArtifact = vi.fn(async () => true);
    const reportProgress = vi.fn(async () => true);
    const onRefreshDirectory = vi.fn(async () => undefined);
    const perception = {
      collectedAt: '2026-08-23T00:00:01.000Z',
      currentDirectory: {
        entries: [{ ext: 'm4a', id: 32, name: 'movie-audio (1)', type: 'file' as const }],
        entryCount: 1,
        id: 10,
        name: '视频',
      },
      selectedNodes: [],
    };

    const outcome = await executeAgentRendererTool(mediaRequest, {
      extractMediaAudio,
      getMediaFileLink,
      onRefreshDirectory,
      onCommitted: vi.fn(async () => undefined),
      readPerception: vi.fn(async () => perception),
      releaseMediaArtifact,
      reportProgress,
      uploadMediaArtifact: uploadMediaArtifact as never,
    });

    expect(extractMediaAudio).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'movie.mp4',
      outputFileName: 'movie-audio.m4a',
      sourceUrl: 'https://storage.example/signed?secret=value',
    }));
    expect(getMediaFileLink).toHaveBeenCalledWith(8, 3, 360);
    expect(uploadMediaArtifact).toHaveBeenCalledWith({
      artifactId: 'artifact-1',
      executionId: mediaRequest.executionId,
      libraryId: 3,
      ownerScope: mediaRequest.ownerScope,
      runId: mediaRequest.runId,
      sessionId: mediaRequest.sessionId,
    });
    expect(onRefreshDirectory).toHaveBeenCalledWith(10);
    expect(releaseMediaArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-1',
      executionId: mediaRequest.executionId,
    }));
    expect(outcome).toMatchObject({
      committed: true,
      perception,
      result: {
        data: {
          createdNodeId: 32,
          format: 'm4a',
          name: 'movie-audio (1).m4a',
          verified: true,
        },
        ok: true,
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('secret=value');
    expect(JSON.stringify(outcome)).not.toContain('/tmp/agent-media');
    expect(JSON.stringify(outcome)).not.toContain('artifact-1');
    await vi.waitFor(() => expect(reportProgress).toHaveBeenCalled());
  });

  it('propagates cancellation from a Main-owned upload and still releases the artifact', async () => {
    const mediaRequest = mediaExtractRequest({
      preparedActionId: 'prepared-cancel',
      snapshotHash: 'snapshot-cancel',
    });
    const controller = new AbortController();
    const releaseMediaArtifact = vi.fn(async () => true);
    const uploadMediaArtifact = vi.fn(() => new Promise<never>((_resolve, reject) => {
      const rejectCancelled = () => reject(Object.assign(
        new Error('upload canceled'),
        { name: 'AbortError' },
      ));
      if (controller.signal.aborted) rejectCancelled();
      else controller.signal.addEventListener('abort', rejectCancelled, { once: true });
    }));
    const running = executeAgentRendererTool(mediaRequest, {
      extractMediaAudio: vi.fn(async () => ({
        artifactId: 'artifact-cancel',
        fileName: 'movie-audio.m4a',
        mimeType: 'audio/mp4',
        sizeBytes: 100,
      })),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact,
      reportProgress: vi.fn(async () => true),
      signal: controller.signal,
      uploadMediaArtifact: uploadMediaArtifact as never,
    });
    await vi.waitFor(() => expect(uploadMediaArtifact).toHaveBeenCalled());

    controller.abort();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(releaseMediaArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-cancel',
    }));
  });

  it('does not ask Renderer to recommit a Main-owned upload', async () => {
    const saveMediaArtifact = vi.fn();
    const onCommitted = vi.fn(async () => {
      throw new Error('renderer commit must not be used');
    });
    const outcome = await executeAgentRendererTool(mediaExtractRequest(), {
      extractMediaAudio: vi.fn(async () => extractedArtifact()),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      onCommitted,
      readPerception: vi.fn(async () => ({
        collectedAt: '2026-08-25T00:00:00.000Z',
        currentDirectory: { entries: [], entryCount: 0, id: 10, name: '视频' },
        selectedNodes: [],
      })),
      releaseMediaArtifact: vi.fn(async () => true),
      reportProgress: vi.fn(async () => true),
      saveMediaArtifact,
      uploadMediaArtifact: vi.fn(async () => ({
        commitState: 'committed',
        node: { ext: 'm4a', id: 32, name: 'movie-audio' },
      })) as never,
    });

    expect(saveMediaArtifact).not.toHaveBeenCalled();
    expect(onCommitted).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      committed: true,
      result: {
        data: {
          createdNodeId: 32,
          destination: 'library',
          uploadCommitState: 'committed',
        },
        ok: true,
      },
    });
  });

  it('saves a directly prepared local destination without uploading', async () => {
    const mediaRequest = mediaExtractRequest({
      destination: 'local',
      fallbackPolicy: 'none',
      parentId: undefined,
      storageProvider: undefined,
    });
    const uploadMediaArtifact = vi.fn();
    const saveMediaArtifact = vi.fn(async () => ({
      canceled: false as const,
      fileName: 'chosen-name.m4a',
    }));

    const outcome = await executeAgentRendererTool(mediaRequest, {
      extractMediaAudio: vi.fn(async () => extractedArtifact()),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact: vi.fn(async () => true),
      reportProgress: vi.fn(async () => true),
      saveMediaArtifact,
      uploadMediaArtifact: uploadMediaArtifact as never,
    });

    expect(uploadMediaArtifact).not.toHaveBeenCalled();
    expect(saveMediaArtifact).toHaveBeenCalledWith(expect.objectContaining({
      preparedActionId: 'prepared-1',
      purpose: 'destination',
      snapshotHash: 'snapshot-1',
    }));
    expect(outcome).toEqual({
      committed: true,
      result: {
        data: {
          destination: 'local',
          format: 'm4a',
          name: 'chosen-name.m4a',
          uploadCommitState: 'uncommitted',
        },
        message: '已提取并保存“chosen-name.m4a”到本机',
        ok: true,
      },
    });
  });

  it('falls back locally only after a definitively uncommitted upload failure', async () => {
    const saveMediaArtifact = vi.fn(async () => ({
      canceled: false as const,
      fileName: 'fallback.m4a',
    }));
    const outcome = await executeAgentRendererTool(mediaExtractRequest(), {
      extractMediaAudio: vi.fn(async () => extractedArtifact()),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact: vi.fn(async () => true),
      reportProgress: vi.fn(async () => true),
      saveMediaArtifact,
      uploadMediaArtifact: vi.fn(async () => ({ commitState: 'uncommitted' })) as never,
    });

    expect(saveMediaArtifact).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'upload_fallback',
    }));
    expect(outcome).toEqual({
      committed: true,
      result: {
        data: {
          destination: 'local',
          fallbackFrom: 'library',
          format: 'm4a',
          name: 'fallback.m4a',
          uploadCommitState: 'uncommitted',
        },
        message: '资料库上传未提交，已将“fallback.m4a”保存到本机',
        ok: true,
      },
    });
  });

  it('does not infer uncommitted state from an IPC transport error', async () => {
    const saveMediaArtifact = vi.fn();
    const outcome = await executeAgentRendererTool(mediaExtractRequest(), {
      extractMediaAudio: vi.fn(async () => extractedArtifact()),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact: vi.fn(async () => true),
      reportProgress: vi.fn(async () => true),
      saveMediaArtifact,
      uploadMediaArtifact: vi.fn(async () => {
        throw new Error('IPC response lost');
      }) as never,
    });

    expect(saveMediaArtifact).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      result: {
        message: 'IPC response lost',
        ok: false,
      },
    });
  });

  it('does not offer fallback when the prepared policy disables it', async () => {
    const saveMediaArtifact = vi.fn();
    const outcome = await executeAgentRendererTool(mediaExtractRequest({
      fallbackPolicy: 'none',
    }), {
      extractMediaAudio: vi.fn(async () => extractedArtifact()),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact: vi.fn(async () => true),
      reportProgress: vi.fn(async () => true),
      saveMediaArtifact,
      uploadMediaArtifact: vi.fn(async () => ({ commitState: 'uncommitted' })) as never,
    });

    expect(saveMediaArtifact).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      result: {
        data: {
          destination: 'library',
          parentId: 10,
          uploadCommitState: 'uncommitted',
        },
        ok: false,
      },
    });
  });

  it('never saves locally when upload commit state is unknown', async () => {
    const saveMediaArtifact = vi.fn();
    const outcome = await executeAgentRendererTool(mediaExtractRequest(), {
      extractMediaAudio: vi.fn(async () => extractedArtifact()),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact: vi.fn(async () => true),
      reportProgress: vi.fn(async () => true),
      saveMediaArtifact,
      uploadMediaArtifact: vi.fn(async () => ({ commitState: 'commit_unknown' })) as never,
    });

    expect(saveMediaArtifact).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      result: {
        data: { uploadCommitState: 'commit_unknown' },
        message: expect.stringContaining('不要重复执行'),
        ok: false,
      },
    });
  });

  it('reports Save As cancellation without exposing the artifact path', async () => {
    const outcome = await executeAgentRendererTool(mediaExtractRequest({
      destination: 'local',
      fallbackPolicy: 'none',
      parentId: undefined,
      storageProvider: undefined,
    }), {
      extractMediaAudio: vi.fn(async () => extractedArtifact()),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact: vi.fn(async () => true),
      reportProgress: vi.fn(async () => true),
      saveMediaArtifact: vi.fn(async (): Promise<AgentMediaArtifactSaveResult> => ({
        canceled: true,
      })),
    });

    expect(outcome).toMatchObject({
      result: {
        data: { destination: 'local', uploadCommitState: 'uncommitted' },
        message: '用户取消了本机保存',
        ok: false,
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('/tmp/agent-media');
  });
});
