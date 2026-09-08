import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentFileAuthorityRequestV1 } from '@/shared/agent/agent.types';

const mocks = vi.hoisted(() => ({
  fetchNodeDetailById: vi.fn(),
  getChildrenByNodeId: vi.fn(),
  getFileLink: vi.fn(),
  getLibraryRootNodeId: vi.fn(),
}));

vi.mock('@/features/file-explorer/services/file.api', () => mocks);
vi.mock('@/features/storage-config/services/storage-config.api', () => ({
  fetchProviders: vi.fn(),
  resolveTarget: vi.fn(),
  testProvider: vi.fn(),
}));
vi.mock('@/utils/auth', () => ({
  auth: { getToken: vi.fn(), getUsername: vi.fn() },
}));

import { resolveAgentFileAuthority } from './agent-file-authority';

function request(directoryPath = '/文档/提示词'): AgentFileAuthorityRequestV1 {
  return {
    authorityId: 'authority-1',
    directoryPath,
    libraryId: 3,
    operation: 'resolve-library-directory',
    ownerScope: {
      accountScope: 'user:7',
      backendScope: 'https://example.com/api',
    },
    runId: 'run-1',
    sessionId: 'session-1',
    toolRunId: 'tool-run-1',
    version: 1,
  };
}

function directory(id: number, name: string, parentId: number, libraryId = 3) {
  return {
    fileSize: 0,
    id,
    libraryId,
    name,
    parentId,
    type: 'dir' as const,
    updatedAt: '2026-08-31T00:00:00Z',
  };
}

describe('resolveAgentFileAuthority library directory paths', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getLibraryRootNodeId.mockResolvedValue(1);
  });

  it('traverses exact directory names from the library root and rechecks the target', async () => {
    mocks.getChildrenByNodeId
      .mockResolvedValueOnce([
        directory(10, '文档', 1),
        directory(12, '文档旧', 1),
      ])
      .mockResolvedValueOnce([directory(20, '提示词', 10)]);
    mocks.fetchNodeDetailById.mockResolvedValue(directory(20, '提示词', 10));

    await expect(resolveAgentFileAuthority(request())).resolves.toEqual({
      operation: 'resolve-library-directory',
      parent: {
        fileSize: 0,
        id: 20,
        libraryId: 3,
        name: '提示词',
        parentId: 10,
        type: 'dir',
        updatedAt: '2026-08-31T00:00:00Z',
        version: 1,
      },
      version: 1,
    });
    expect(mocks.getLibraryRootNodeId).toHaveBeenCalledWith(3);
    expect(mocks.getChildrenByNodeId).toHaveBeenNthCalledWith(1, 1, 3);
    expect(mocks.getChildrenByNodeId).toHaveBeenNthCalledWith(2, 10, 3);
    expect(mocks.fetchNodeDetailById).toHaveBeenCalledWith(20);
  });

  it('resolves the root without listing children and still rechecks its identity', async () => {
    mocks.fetchNodeDetailById.mockResolvedValue(directory(1, '资料库根目录', 0));

    await expect(resolveAgentFileAuthority(request('/'))).resolves.toMatchObject({
      parent: { id: 1, libraryId: 3, type: 'dir' },
    });
    expect(mocks.getChildrenByNodeId).not.toHaveBeenCalled();
    expect(mocks.fetchNodeDetailById).toHaveBeenCalledWith(1);
  });

  it('rejects a missing exact segment', async () => {
    mocks.getChildrenByNodeId.mockResolvedValue([directory(10, '文档旧', 1)]);

    await expect(resolveAgentFileAuthority(request())).rejects.toThrow('资料库目录不存在');
    expect(mocks.fetchNodeDetailById).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous exact segment', async () => {
    mocks.getChildrenByNodeId.mockResolvedValue([
      directory(10, '文档', 1),
      directory(11, '文档', 1),
    ]);

    await expect(resolveAgentFileAuthority(request())).rejects.toThrow('存在重名节点');
    expect(mocks.fetchNodeDetailById).not.toHaveBeenCalled();
  });

  it('rejects a file used as a directory segment', async () => {
    mocks.getChildrenByNodeId.mockResolvedValue([{
      ...directory(10, '文档', 1),
      type: 'file',
    }]);

    await expect(resolveAgentFileAuthority(request())).rejects.toThrow('包含文件');
    expect(mocks.fetchNodeDetailById).not.toHaveBeenCalled();
  });

  it('rejects a child from another library', async () => {
    mocks.getChildrenByNodeId.mockResolvedValue([directory(10, '文档', 1, 4)]);

    await expect(resolveAgentFileAuthority(request())).rejects.toThrow('跨越了当前资料库');
    expect(mocks.fetchNodeDetailById).not.toHaveBeenCalled();
  });

  it('rejects target identity drift after traversal', async () => {
    mocks.getChildrenByNodeId
      .mockResolvedValueOnce([directory(10, '文档', 1)])
      .mockResolvedValueOnce([directory(20, '提示词', 10)]);
    mocks.fetchNodeDetailById.mockResolvedValue(directory(20, '提示词', 11));

    await expect(resolveAgentFileAuthority(request())).rejects.toThrow('已经变化或不可用');
  });
});
