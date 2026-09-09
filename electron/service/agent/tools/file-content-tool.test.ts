import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { assessFileScope, fileContentTool } from './file-content-tool';
import { projectAgentToolResultForProvider } from '../agent-tool-result-projection';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
function context(): AgentToolExecutionContext {
  return { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] }, onProgress() {}, signal: new AbortController().signal };
}
describe('file.read', () => {
  it('reads more than 2000 lines in one call when they fit and uses the actual output budget', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agent-read-budget-'));
    const file = path.join(directory, 'large.txt');
    await writeFile(file, 'x\n'.repeat(3000));
    const complete = await fileContentTool.execute!({ scope: 'host', path: file }, context());
    expect(complete.data).toMatchObject({ hasMore: false, endLine: 3000, fileName: 'large.txt' });
    expect(complete.data).not.toHaveProperty('lines');
    expect(projectAgentToolResultForProvider(complete, 10000).truncated).toBe(false);
    await writeFile(file, 'a'.repeat(120000));
    const large = await fileContentTool.execute!({ scope: 'host', path: file, maxOutputTokens: 100000 }, context());
    expect((large.data as { content: string }).content.length).toBeGreaterThan(20000);
    expect(projectAgentToolResultForProvider(large, 10000).truncated).toBe(false);
    const small = await fileContentTool.execute!({ scope: 'host', path: file }, { ...context(), readOutputTokenBudget: 1000 });
    expect(small.data).toMatchObject({ hasMore: true, nextOffset: 1 });
    expect(projectAgentToolResultForProvider(small, 1000).truncated).toBe(false);
  });
  it('uses the same line contract for host and library paths', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agent-read-'));
    const file = path.join(directory, 'read.txt');
    await writeFile(file, 'hello\nworld');
    const host = await fileContentTool.execute!({ scope: 'host', path: file, limit: 1 }, context());
    const node = { id: 10, libraryId: 3, parentId: 20, name: 'read.txt', type: 'file' as const, path: '/read.txt' };
    const ctx = { ...context(), readLibraryMetadata: vi.fn(async () => ({ libraryId: 3, node })), readLibraryText: vi.fn(async () => Buffer.from('hello\nworld')) };
    const library = await fileContentTool.execute!({ path: '/read.txt', limit: 1 }, ctx);
    expect(host.data).toMatchObject({ content: 'L1: hello', fileName: 'read.txt', nextOffset: 2 });
    expect(library.data).toMatchObject({ content: 'L1: hello', fileName: 'read.txt', nextOffset: 2 });
    expect(ctx.readLibraryText).toHaveBeenCalledWith(10, ctx.signal);
    await symlink(file, path.join(directory, 'link'));
    await expect(fileContentTool.execute!({ scope: 'host', path: path.join(directory, 'link') }, context())).rejects.toThrow('符号链接');
  });
  it('requires approval for host reads outside full access', () => {
    expect(assessFileScope({ scope: 'host', path: '/tmp/a' }, context()).behavior).toBe('ask');
    expect(assessFileScope({ path: '/a' }, context()).behavior).toBe('allow');
    const ctx = { ...context(), runCapabilitySnapshot: { shellPermissionMode: 'full-access' } } as AgentToolExecutionContext;
    expect(assessFileScope({ scope: 'host', path: '/tmp/a' }, ctx).behavior).toBe('allow');
  });
});
