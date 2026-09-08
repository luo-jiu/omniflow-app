import { describe, expect, it, vi } from 'vitest';

import type { AgentToolPrepareRequest } from '@/shared/agent/agent.types';
import { prepareAgentRendererTool } from './agent-tool-preparer';

vi.mock('./agent-library.api', () => ({
  resolveAgentLibraryDirectoryTarget: async () => ({ id: 10, libraryId: 3, parentId: 2, name: '视频', type: 'dir', path: '/视频' }),
}));
const targetDirectory = { id: 10, libraryId: 3, parentId: 2, name: '视频', type: 'dir', path: '/视频' };

function request(): AgentToolPrepareRequest {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin',
      selectedNodeIds: [8],
    },
    callId: 'call-1',
    input: {
      fileSize: 100,
      libraryId: 3,
      mimeType: 'video/mp4',
      nodeId: 8,
      outputFormat: 'mp3',
    },
    inputHash: 'a'.repeat(64),
    ownerScope: {
      accountScope: 'user:7',
      backendScope: 'https://example.com/api',
    },
    prepareId: 'prepare-1',
    runId: 'run-1',
    sessionId: 'session-1',
    toolRunId: 'tool-run-1',
    toolName: 'media.extractAudio',
  };
}

function providers() {
  return {
    defaultProvider: 'default-minio',
    providers: [
      { alias: 'source-minio', label: '源 MinIO' },
      { alias: 'routed-minio', label: '路由 MinIO' },
      { alias: 'default-minio', label: '默认 MinIO' },
    ],
  };
}

describe('Agent renderer tool preparer', () => {
  it('resolves a requested directory independently from the current UI directory', async () => {
    const resolveDirectory = vi.fn(async () => ({ ...targetDirectory, id: 20, path: '/音乐', name: '音乐', type: 'dir' as const }));
    const input = request(); input.input = { ...input.input as object, directoryPath: '/音乐', destination: 'library' };
    const result = await prepareAgentRendererTool(input, {
      fetchNodeDetail: vi.fn(async () => ({ id: 8, libraryId: 3, type: 'file', storageProvider: 'source-minio' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      verifyProvider: vi.fn(async () => ({ success: true })) as never,
      resolveDirectory,
    });
    expect(resolveDirectory).toHaveBeenCalledWith(3, { path: '/音乐', nodeId: undefined });
    expect(result).toMatchObject({ targetDirectory: { id: 20, path: '/音乐' } });
  });
  it('considers healthy providers beyond the default and routed candidates', async () => {
    const verifyProvider = vi.fn(async (alias: string) => ({ success: alias === 'source-minio' }));
    const result = await prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({ id: 8, libraryId: 3, type: 'file' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: vi.fn(async () => ({ providerAlias: 'routed-minio' })) as never,
      verifyProvider: verifyProvider as never,
    });
    expect(result).toMatchObject({ providerBindings: { m4a: { providerAlias: 'source-minio' } } });
    expect(verifyProvider).toHaveBeenCalledWith('source-minio');
  });
  it('inherits a known source provider before consulting routing', async () => {
    const resolveStorageTarget = vi.fn();
    const verifyProvider = vi.fn(async () => ({ success: true }));

    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({ id: 8, libraryId: 3, type: 'file', storageProvider: 'source-minio' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: resolveStorageTarget as never,
      verifyProvider: verifyProvider as never,
    })).resolves.toEqual({
      targetDirectory,
      providerBindings: {
        m4a: { providerAlias: 'source-minio', providerLabel: '源 MinIO' },
        mp3: { providerAlias: 'source-minio', providerLabel: '源 MinIO' },
        wav: { providerAlias: 'source-minio', providerLabel: '源 MinIO' },
      },
    });
    expect(resolveStorageTarget).not.toHaveBeenCalled();
    expect(verifyProvider).toHaveBeenCalledWith('source-minio');
  });

  it('uses the routed provider and passes normalized media facts', async () => {
    const resolveStorageTarget = vi.fn(async () => ({ providerAlias: 'routed-minio' }));

    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({ id: 8, libraryId: 3, type: 'file', storageProvider: 'retired-minio' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: resolveStorageTarget as never,
      verifyProvider: vi.fn(async () => ({ success: true })) as never,
    })).resolves.toMatchObject({
      providerBindings: {
        mp3: { providerAlias: 'routed-minio' },
      },
    });
    expect(resolveStorageTarget).toHaveBeenCalledWith(100, 'mp3', 'audio/mpeg');
  });

  it('reports an unavailable source instead of treating a healthy destination as readable input', async () => {
    const resolveStorageTarget = vi.fn(async () => ({ providerAlias: 'routed-minio' }));
    const verifyProvider = vi.fn(async (alias: string) => ({
      success: alias !== 'source-minio',
    }));

    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({ id: 8, libraryId: 3, type: 'file', storageProvider: 'source-minio' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: resolveStorageTarget as never,
      verifyProvider: verifyProvider as never,
    })).resolves.toMatchObject({
      sourceFailure: 'source_unreachable',
      providerBindings: {},
    });
    expect(verifyProvider).toHaveBeenCalledWith('source-minio');
    expect(resolveStorageTarget).not.toHaveBeenCalled();
  });

  it('falls back to the default provider and reports unavailable storage safely', async () => {
    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({ id: 8, libraryId: 3, type: 'file' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: vi.fn(async () => {
        throw new Error('routing unavailable');
      }) as never,
      verifyProvider: vi.fn(async () => ({ success: false })) as never,
    })).resolves.toEqual({ providerBindings: {}, targetDirectory });

    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => {
        throw new Error('private endpoint failed');
      }) as never,
      listProviders: vi.fn(async () => providers()) as never,
    })).resolves.toEqual({ sourceFailure: 'source_unknown', providerBindings: {} });
  });

  it('rejects unsupported tools, invalid scope and cancellation', async () => {
    await expect(prepareAgentRendererTool({ ...request(), toolName: 'file.list' }))
      .rejects.toThrow('不支持');
    await expect(prepareAgentRendererTool({
      ...request(),
      input: { ...request().input as object, libraryId: 4 },
    })).rejects.toThrow('准备参数无效');

    const controller = new AbortController();
    controller.abort();
    await expect(prepareAgentRendererTool(request(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
