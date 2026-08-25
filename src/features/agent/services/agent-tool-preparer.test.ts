import { describe, expect, it, vi } from 'vitest';

import type { AgentToolPrepareRequest } from '@/shared/agent/agent.types';
import { prepareAgentRendererTool } from './agent-tool-preparer';

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
  it('inherits a known source provider before consulting routing', async () => {
    const resolveStorageTarget = vi.fn();
    const verifyProvider = vi.fn(async () => ({ success: true }));

    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({ storageProvider: 'source-minio' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: resolveStorageTarget as never,
      verifyProvider: verifyProvider as never,
    })).resolves.toEqual({
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
      fetchNodeDetail: vi.fn(async () => ({ storageProvider: 'retired-minio' })) as never,
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

  it('routes to another healthy provider when the known source provider is unavailable', async () => {
    const resolveStorageTarget = vi.fn(async () => ({ providerAlias: 'routed-minio' }));
    const verifyProvider = vi.fn(async (alias: string) => ({
      success: alias !== 'source-minio',
    }));

    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({ storageProvider: 'source-minio' })) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: resolveStorageTarget as never,
      verifyProvider: verifyProvider as never,
    })).resolves.toMatchObject({
      providerBindings: {
        mp3: { providerAlias: 'routed-minio' },
      },
    });
    expect(verifyProvider).toHaveBeenCalledWith('source-minio');
    expect(resolveStorageTarget).toHaveBeenCalledWith(100, 'mp3', 'audio/mpeg');
  });

  it('falls back to the default provider and reports unavailable storage safely', async () => {
    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => ({})) as never,
      listProviders: vi.fn(async () => providers()) as never,
      resolveStorageTarget: vi.fn(async () => {
        throw new Error('routing unavailable');
      }) as never,
      verifyProvider: vi.fn(async () => ({ success: false })) as never,
    })).resolves.toEqual({ providerBindings: {} });

    await expect(prepareAgentRendererTool(request(), {
      fetchNodeDetail: vi.fn(async () => {
        throw new Error('private endpoint failed');
      }) as never,
      listProviders: vi.fn(async () => providers()) as never,
    })).resolves.toEqual({ providerBindings: {} });
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
