import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { UploadCommitUnknownError } from '@/modules/upload-center/services/upload-direct';
import { UploadSessionExpiredError, UploadSessionNotFoundError } from '@/modules/upload-center/services/upload-session.api';
import { executeAgentFileWrite } from './agent-file-write';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function request(revision?: string): AgentToolExecutionRequest {
  return { toolName: 'file.write', executionId: 'e', sessionId: 's', runId: 'r',
    ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' },
    appContext: { libraryId: 3, platform: 'darwin' },
    input: { libraryId: 3, path: '/docs/test.cpp', content: '// 中文\nint main() {}', ...(revision ? { revision } : {}) },
  } as AgentToolExecutionRequest;
}
function dependencies() {
  return {
    assertOwner: vi.fn(),
    beforeCommit: vi.fn(async () => undefined),
    selectProvider: vi.fn(async () => ({ id: 'reachable-provider', label: 'Online storage' })),
    resolvePath: vi.fn(async (_library: number, _path: string, type?: string) => ({ id: type === 'file' ? 9 : 8, parentId: 8, libraryId: 3, type: type || 'dir', name: 'test', path: '/docs/test.cpp' })) as any,
    detail: vi.fn(async () => ({ id: 9, parentId: 8, libraryId: 3, name: 'test', type: 'file', storageKey: 'old-binding', fileSize: 3 })) as any,
    readBytes: vi.fn(async () => new TextEncoder().encode('old')),
    stage: vi.fn(async () => ({ filePath: '/tmp/synthetic-stage.txt' })),
    cleanup: vi.fn(async () => true),
    upload: vi.fn(async () => ({ id: 9, parentId: 8, libraryId: 3 })) as any,
    update: vi.fn(async () => ({ id: 9, parentId: 8, libraryId: 3 })) as any,
    onCommitted: vi.fn(),
  };
}
describe('direct library file writes', () => {
  it('does not stage or upload when no storage provider is reachable', async () => {
    const deps = dependencies();
    deps.selectProvider.mockRejectedValueOnce(new Error('offline'));
    const output = await executeAgentFileWrite(request(), deps);
    expect(output.result).toMatchObject({ ok: false, data: { writeCommitState: 'uncommitted' } });
    expect(output.result.message).toContain('没有可用');
    expect(deps.stage).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
  });
  it('creates through the existing upload chain with exclusive name protection', async () => {
    const deps = dependencies();
    const output = await executeAgentFileWrite(request(), deps);
    expect(deps.stage).toHaveBeenCalledWith('test.cpp', '// 中文\nint main() {}');
    expect(deps.upload).toHaveBeenCalledWith('/tmp/synthetic-stage.txt', 8, 3, expect.objectContaining({ conflictPolicy: 'error', storageProvider: 'reachable-provider' }));
    expect(output).toMatchObject({ committed: true, result: { ok: true, data: { path: '/docs/test.cpp', writeCommitState: 'committed', revision: digest('// 中文\nint main() {}') } } });
    expect(deps.cleanup).toHaveBeenCalledOnce();
  });
  it('checks the read revision and sends the private storage token to conditional update', async () => {
    const deps = dependencies();
    const result = await executeAgentFileWrite(request(digest('old')), deps);
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 9, expectedStorageKey: 'old-binding' }));
    expect(result.result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('old-binding');
    expect(deps.upload).not.toHaveBeenCalled();
  });
  it('does not overwrite a changed revision or bypass a backend conflict', async () => {
    const deps = dependencies();
    const stale = await executeAgentFileWrite(request(digest('stale')), deps);
    expect(stale.result.message).toContain('已变化');
    expect(deps.update).not.toHaveBeenCalled();
    deps.update.mockRejectedValueOnce(new IpcRequestError('conflict', 409));
    const raced = await executeAgentFileWrite(request(digest('old')), deps);
    expect(raced.result).toMatchObject({ ok: false, data: { writeCommitState: 'uncommitted' } });
    expect(deps.update).toHaveBeenCalledOnce();
  });
  it('retains unknown commit state on transport failure and success on receipt delivery failure', async () => {
    const deps = dependencies();
    deps.upload.mockRejectedValueOnce(new UploadCommitUnknownError('upload', 'operation', new Error('connection closed')));
    expect((await executeAgentFileWrite(request(), deps)).result).toMatchObject({ ok: false, data: { writeCommitState: 'commit_unknown' } });
    deps.onCommitted.mockRejectedValueOnce(new Error('lost receipt'));
    expect(await executeAgentFileWrite(request(), deps)).toMatchObject({ committed: true, result: { ok: true } });
  });
  it('rejects wrong library and cancellation before any write', async () => {
    const deps = dependencies();
    const value = request();
    value.appContext.libraryId = 4;
    expect((await executeAgentFileWrite(value, deps)).result.ok).toBe(false);
    expect(deps.stage).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    expect((await executeAgentFileWrite(request(), { ...deps, signal: controller.signal })).result.data)
      .toMatchObject({ writeCommitState: 'uncommitted' });
  });
  it('does not fall back to an unconditional write on an old backend', async () => {
    const deps = dependencies();
    deps.update.mockRejectedValueOnce(new IpcRequestError('not found', 404));
    expect((await executeAgentFileWrite(request(digest('old')), deps)).result)
      .toMatchObject({ ok: false, data: { writeCommitState: 'uncommitted' } });
    expect(deps.update).toHaveBeenCalledOnce();
    expect(deps.upload).not.toHaveBeenCalled();
  });
  it('cleans staging when cancelled before upload and preserves a commit after cancellation', async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.stage.mockImplementationOnce(async () => { controller.abort(); return { filePath: '/tmp/test-stage' }; });
    expect((await executeAgentFileWrite(request(), { ...deps, signal: controller.signal })).result.data)
      .toMatchObject({ writeCommitState: 'uncommitted' });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.cleanup).toHaveBeenCalledWith('/tmp/test-stage');
    const afterCommit = new AbortController();
    deps.upload.mockImplementationOnce(async () => { afterCommit.abort(); return { id: 9, libraryId: 3 }; });
    expect(await executeAgentFileWrite(request(), { ...deps, signal: afterCommit.signal }))
      .toMatchObject({ committed: true, result: { ok: true } });
  });
  it.each([new Error('MinIO offline'), new UploadSessionExpiredError(), new UploadSessionNotFoundError()])(
    'reports pre-commit upload failure as uncommitted: %s', async error => {
      const deps = dependencies();
      deps.upload.mockRejectedValueOnce(error);
      expect((await executeAgentFileWrite(request(), deps)).result.data).toMatchObject({ writeCommitState: 'uncommitted' });
      expect(deps.beforeCommit).not.toHaveBeenCalled();
    },
  );
  it('enters commit settlement before PUT and never writes if the phase acknowledgment fails', async () => {
    const deps = dependencies();
    deps.beforeCommit.mockRejectedValueOnce(new Error('run cancelled'));
    expect((await executeAgentFileWrite(request(digest('old')), deps)).result.data).toMatchObject({ writeCommitState: 'uncommitted' });
    expect(deps.update).not.toHaveBeenCalled();
    deps.update.mockRejectedValueOnce(new Error('lost PUT receipt'));
    expect((await executeAgentFileWrite(request(digest('old')), deps)).result.data).toMatchObject({ writeCommitState: 'commit_unknown' });
  });
});
