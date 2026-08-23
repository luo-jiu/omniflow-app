import { describe, expect, it, vi } from 'vitest';

import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
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
    const mediaRequest = request();
    mediaRequest.toolName = 'media.extractAudio';
    mediaRequest.input = {
      conflictPolicy: 'auto_rename',
      libraryId: 3,
      mimeType: 'video/mp4',
      nodeId: 8,
      outputFileName: 'movie-audio.m4a',
      outputFormat: 'm4a',
      parentId: 10,
      sourceFileName: 'movie.mp4',
    };
    const getMediaFileLink = vi.fn(async () => 'https://storage.example/signed?secret=value');
    const extractMediaAudio = vi.fn(async () => ({
      artifactId: 'artifact-1',
      fileName: 'movie-audio.m4a',
      filePath: '/tmp/agent-media/movie-audio.m4a',
      mimeType: 'audio/mp4',
      sizeBytes: 100,
    }));
    const uploadLocalFile = vi.fn(async (
      _filePath: string,
      _parentId: number,
      _libraryId: number,
      options?: { onProgress?: (uploadedBytes: number) => void },
    ) => {
      options?.onProgress?.(100);
      return { ext: 'm4a', id: 32, name: 'movie-audio (1)' };
    });
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
      uploadLocalFile: uploadLocalFile as never,
    });

    expect(extractMediaAudio).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'movie.mp4',
      outputFileName: 'movie-audio.m4a',
      sourceUrl: 'https://storage.example/signed?secret=value',
    }));
    expect(getMediaFileLink).toHaveBeenCalledWith(8, 3, 360);
    expect(uploadLocalFile).toHaveBeenCalledWith(
      '/tmp/agent-media/movie-audio.m4a',
      10,
      3,
      expect.objectContaining({ conflictPolicy: 'auto_rename', contentType: 'audio/mp4' }),
    );
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

  it('aborts an active upload and still releases the extracted artifact', async () => {
    const mediaRequest = request();
    mediaRequest.toolName = 'media.extractAudio';
    mediaRequest.input = {
      conflictPolicy: 'auto_rename',
      libraryId: 3,
      nodeId: 8,
      outputFileName: 'movie-audio.m4a',
      outputFormat: 'm4a',
      parentId: 10,
      sourceFileName: 'movie.mp4',
    };
    const controller = new AbortController();
    const uploadAbort = vi.fn(async () => undefined);
    const releaseMediaArtifact = vi.fn(async () => true);
    const uploadLocalFile = vi.fn((
      _filePath: string,
      _parentId: number,
      _libraryId: number,
      options?: { setAbort?: (aborter: () => Promise<void>) => void },
    ) => new Promise<never>((_resolve, reject) => {
      options?.setAbort?.(async () => {
        await uploadAbort();
        reject(new Error('upload canceled'));
      });
    }));
    const running = executeAgentRendererTool(mediaRequest, {
      extractMediaAudio: vi.fn(async () => ({
        artifactId: 'artifact-cancel',
        fileName: 'movie-audio.m4a',
        filePath: '/tmp/agent-media/movie-audio.m4a',
        mimeType: 'audio/mp4',
        sizeBytes: 100,
      })),
      getMediaFileLink: vi.fn(async () => 'https://storage.example/source'),
      releaseMediaArtifact,
      reportProgress: vi.fn(async () => true),
      signal: controller.signal,
      uploadLocalFile: uploadLocalFile as never,
    });
    await vi.waitFor(() => expect(uploadLocalFile).toHaveBeenCalled());

    controller.abort();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(uploadAbort).toHaveBeenCalledOnce();
    expect(releaseMediaArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-cancel',
    }));
  });
});
