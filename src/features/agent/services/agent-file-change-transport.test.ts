import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
import type { AgentFileMutationSnapshot } from '@/shared/agent/agent-file-write';
import type { AgentFileWriteDependencies } from './agent-file-write';

const mocks = vi.hoisted(() => ({ executeWrite: vi.fn(), prepare: vi.fn(), list: vi.fn(), diff: vi.fn(), cancel: vi.fn() }));
vi.mock('./agent-file-write', () => ({ executeAgentFileWrite: mocks.executeWrite }));
import { executeAgentRendererTool } from './agent-tool-executor';
import { listAgentFileChanges, readAgentFileDiff } from './agent.api';

const scope = { ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' }, libraryId: 3, sessionId: 'session' };
const after = new TextEncoder().encode('中文😀'.repeat(15_000));
const snapshot: AgentFileMutationSnapshot = { scope: 'library', libraryId: 3, nodeId: 9, parentId: 8,
  path: '/docs/a.txt', fileName: 'a.txt', beforeBytes: new Uint8Array([0xef, 0xbb, 0xbf, 65]), afterBytes: after,
  beforeRevision: 'a'.repeat(64), afterRevision: 'b'.repeat(64) };

function request(toolName: string): AgentToolExecutionRequest {
  return { ...scope, appContext: { libraryId: 3 }, runId: 'run', executionId: 'execution',
    toolName, input: {} } as unknown as AgentToolExecutionRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { electronAgent: { prepareFileChange: mocks.prepare, listFileChanges: mocks.list, readFileDiff: mocks.diff, cancelFileDiff: mocks.cancel } });
  mocks.prepare.mockResolvedValue(true);
  mocks.cancel.mockResolvedValue(true);
  mocks.executeWrite.mockImplementation(async (_request: AgentToolExecutionRequest, deps: AgentFileWriteDependencies) => {
    await deps.prepareMutation!(snapshot);
    return { result: { ok: true, data: { writeCommitState: 'committed' } } };
  });
});

describe('private controlled file change transport', () => {
  it.each(['file.write', 'file.patch'])('routes %s snapshots through the private bridge with exact bytes', async toolName => {
    const result = await executeAgentRendererTool(request(toolName));
    expect(result.result.ok).toBe(true);
    const input = mocks.prepare.mock.calls[0][0];
    expect(input).toMatchObject({ ...scope, executionId: 'execution', runId: 'run',
      snapshot: { path: snapshot.path, nodeId: 9, beforeRevision: snapshot.beforeRevision, afterRevision: snapshot.afterRevision } });
    expect(Buffer.from(input.snapshot.beforeBase64, 'base64')).toEqual(Buffer.from(snapshot.beforeBytes!));
    expect(Buffer.from(input.snapshot.afterBase64, 'base64')).toEqual(Buffer.from(after));
    expect(JSON.stringify(result)).not.toContain('中文');
  });
  it('keeps explicitly injected private hooks and refuses an unacknowledged snapshot', async () => {
    const custom = vi.fn(async () => undefined);
    await executeAgentRendererTool(request('file.patch'), { prepareMutation: custom });
    expect(custom).toHaveBeenCalledWith(snapshot);
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.prepare.mockResolvedValue(false);
    await expect(executeAgentRendererTool(request('file.write'))).rejects.toThrow('未提交');
  });
  it('exposes bounded local list/diff reads as separate bridge methods', async () => {
    mocks.list.mockResolvedValue({ changes: [], coverage: 'structured-file-writes', truncated: false });
    mocks.diff.mockResolvedValue({ patch: '@@ local only @@', available: true });
    await listAgentFileChanges({ ...scope, runIds: ['run'] });
    await readAgentFileDiff({ ...scope, changeId: 'change' });
    expect(mocks.list).toHaveBeenCalledWith({ ...scope, runIds: ['run'] });
    expect(mocks.diff).toHaveBeenCalledWith({ ...scope, changeId: 'change' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('binds cancellable reads to a unique request and rejects a late response after cancellation', async () => {
    let finish!: (result: unknown) => void;
    mocks.diff.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const reading = readAgentFileDiff({ ...scope, changeId: 'change', cursor: 'private-page-ref', pageLines: 200 }, controller.signal);
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    const request = mocks.diff.mock.calls[0][0];
    expect(request.requestId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(request).toMatchObject({ ...scope, cursor: 'private-page-ref', pageLines: 200 });
    controller.abort();
    expect(mocks.cancel).toHaveBeenCalledWith({ ...scope, requestId: request.requestId });
    finish({ patch: 'late private body' }); await rejected;
    const stopped = new AbortController(); stopped.abort();
    await expect(readAgentFileDiff({ ...scope, changeId: 'change' }, stopped.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.diff).toHaveBeenCalledOnce();
  });
});
