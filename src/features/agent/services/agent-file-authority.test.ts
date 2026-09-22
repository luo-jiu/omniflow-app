import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentFileAuthorityRequestV1 } from '@/shared/agent/agent.types';

const mocks = vi.hoisted(() => ({
  fetchNodeDetailById: vi.fn(),
  getChildrenByNodeId: vi.fn(),
  getFileLink: vi.fn(),
  getLibraryRootNodeId: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ getToken: vi.fn(), getUsername: vi.fn(), getUserInfo: vi.fn() }));
const storageMocks = vi.hoisted(() => ({ fetchProviders: vi.fn(), resolveTarget: vi.fn(), testProvider: vi.fn() }));

vi.mock('@/features/file-explorer/services/file.api', () => mocks);
vi.mock('@/features/storage-config/services/storage-config.api', () => storageMocks);
vi.mock('@/utils/auth', () => ({ auth: authMocks }));
vi.mock('@/config/api', () => ({ API_CONFIG: { BASE_URL: 'https://example.com/api' } }));

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

function renameRequest(nodeIds = [8, 9], includeCredentials = false): AgentFileAuthorityRequestV1 {
  const base = request();
  return { authorityId: base.authorityId, libraryId: base.libraryId, ownerScope: base.ownerScope,
    runId: base.runId, sessionId: base.sessionId, toolRunId: base.toolRunId, version: 1,
    operation: 'rename-library-files', nodeIds, includeCredentials };
}
function file(id: number) {
  return { id, libraryId: 3, parentId: 2, type: 'file' as const, name: `image-${id}`, ext: 'jpg', fileSize: 42,
    updatedAt: '2026-09-22T10:30:00Z' };
}

describe('resolveAgentFileAuthority rename metadata', () => {
  beforeEach(() => {
    [...Object.values(mocks), ...Object.values(storageMocks), ...Object.values(authMocks)].forEach(mock => mock.mockReset());
    authMocks.getUserInfo.mockReturnValue({ id: 7 });
    authMocks.getToken.mockReturnValue('current-token'); authMocks.getUsername.mockReturnValue('current-user');
    mocks.fetchNodeDetailById.mockImplementation(async (id: number) => file(id));
  });

  it('returns ordered file metadata without touching storage, file bodies or credentials', async () => {
    const result = await resolveAgentFileAuthority(renameRequest([9, 8]));
    expect(result).toEqual({ operation: 'rename-library-files', version: 1, nodes: [{ ...file(9), version: 1 }, { ...file(8), version: 1 }] });
    expect(mocks.fetchNodeDetailById.mock.calls).toEqual([[9], [8]]);
    expect(mocks.getFileLink).not.toHaveBeenCalled(); expect(mocks.getChildrenByNodeId).not.toHaveBeenCalled();
    expect(mocks.getLibraryRootNodeId).not.toHaveBeenCalled();
    Object.values(storageMocks).forEach(mock => expect(mock).not.toHaveBeenCalled());
    expect(authMocks.getToken).not.toHaveBeenCalled(); expect(authMocks.getUsername).not.toHaveBeenCalled();
  });

  it('acquires current credentials only when requested after metadata validation', async () => {
    await expect(resolveAgentFileAuthority(renameRequest([8], true))).resolves.toMatchObject({ credentials: { token: 'current-token', username: 'current-user' } });
    expect(authMocks.getToken).toHaveBeenCalledOnce();
    expect(mocks.getFileLink).not.toHaveBeenCalled(); Object.values(storageMocks).forEach(mock => expect(mock).not.toHaveBeenCalled());
    authMocks.getToken.mockReturnValue('');
    await expect(resolveAgentFileAuthority(renameRequest([8], true))).rejects.toThrow('登录状态已失效');
  });

  it('rejects malformed selections and foreign owners before any metadata query', async () => {
    for (const ids of [[], [8, 8], [0], ['8'], new Array(1), Array.from({ length: 51 }, (_, i) => i + 1)]) {
      await expect(resolveAgentFileAuthority(renameRequest(ids as number[]))).rejects.toThrow();
    }
    await expect(resolveAgentFileAuthority({ ...renameRequest(), ownerScope: { accountScope: 'user:9', backendScope: 'https://example.com/api' } })).rejects.toThrow('账号环境已变化');
    await expect(resolveAgentFileAuthority({ ...renameRequest(), ownerScope: { accountScope: 'user:7', backendScope: 'https://other.example/api' } })).rejects.toThrow('账号环境已变化');
    expect(mocks.fetchNodeDetailById).not.toHaveBeenCalled();
  });

  it.each([{ id: 19 }, { libraryId: 4 }, { type: 'dir' }, { parentId: 0 }, { name: '' }, { name: ' padded.jpg' }, { fileSize: '42' }, { fileSize: -1 }])('rejects invalid or changed file metadata %j', patch => {
    mocks.fetchNodeDetailById.mockResolvedValue({ ...file(8), ...patch });
    return expect(resolveAgentFileAuthority(renameRequest([8], true))).rejects.toThrow('目标文件已经变化');
  });

  it('rechecks current owner after asynchronous reads before delivering data or credentials', async () => {
    mocks.fetchNodeDetailById.mockImplementationOnce(async (id: number) => {
      authMocks.getUserInfo.mockReturnValue({ id: 9 }); return file(id);
    });
    await expect(resolveAgentFileAuthority(renameRequest([8, 9], true))).rejects.toThrow('账号环境已变化');
    expect(mocks.fetchNodeDetailById).toHaveBeenCalledOnce();
    expect(authMocks.getToken).not.toHaveBeenCalled();
  });
});
