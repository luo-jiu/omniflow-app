import { describe, expect, it, vi } from 'vitest';
import { resolveAgentLibraryFilePath } from '../../../src/shared/agent/agent-file-path';
import { normalizeAgentFileWriteInput } from '../../../src/shared/agent/agent-file-write';
import { applyAgentFilePatch } from '../../../src/shared/agent/agent-file-patch';
import { resolveAgentFileQuery, resolveAgentFileToolInput, resolveAgentHostFilePath } from './agent-file-path-resolver';
import type { AgentToolExecutionContext } from './agent-tool-registry';
import { fileWriteTool } from './tools/file-write-tool';
import { fileContentTool } from './tools/file-content-tool';
import { directoryCreateTool } from './tools/directory-create-tool';
import { fileListTool, fileResolveTool, fileSearchTool, fileStatTool } from './tools/file-read-tools';
import { filePatchTool } from './tools/file-patch-tool';
import { fileDeleteTool } from './tools/file-delete-tool';
import { libraryActionTools } from './tools/library-action-tools';
import { createAgentToolRegistry } from './agent-tool-registry';

function context() {
  return { appContext: { libraryId: 3, currentDirectory: { id: 10, name: 'docs' }, platform: 'darwin', selectedNodeIds: [] },
    signal: new AbortController().signal, onProgress: vi.fn(),
    readLibraryMetadata: vi.fn(async () => ({ libraryId: 3,
      node: { id: 10, libraryId: 3, parentId: 9, name: 'docs', type: 'dir', path: '/project/docs' } })),
    executeLibraryFileMutation: vi.fn(async () => ({ ok: true })) } as unknown as AgentToolExecutionContext;
}

describe('unified file path resolution', () => {
  it('resolves logical relative segments without crossing the library root or changing scope', () => {
    expect(resolveAgentLibraryFilePath('../src/./a.ts', '/project/docs')).toBe('/project/src/a.ts');
    expect(resolveAgentLibraryFilePath('.', '/')).toBe('/');
    expect(resolveAgentLibraryFilePath('/docs/a', '/other')).toBe('/docs/a');
    for (const target of ['../../a', '~/a', 'C:\\a', 'a\0b']) expect(() => resolveAgentLibraryFilePath(target, '/docs')).toThrow();
    expect(resolveAgentLibraryFilePath('./~/a', '/docs')).toBe('/docs/~/a');
    expect(resolveAgentLibraryFilePath('/~/a')).toBe('/~/a');
    expect(() => resolveAgentLibraryFilePath('a')).toThrow('当前目录');
    expect(() => resolveAgentLibraryFilePath('/a', 'relative')).toThrow();
  });

  it('requires an explicit host base on macOS and Windows and never uses process cwd', () => {
    expect(resolveAgentHostFilePath('../src/a.ts', '/project/docs', 'darwin', '/Users/me')).toBe('/project/src/a.ts');
    expect(resolveAgentHostFilePath('a.ts', '~/project', 'darwin', '/Users/me')).toBe('/Users/me/project/a.ts');
    expect(resolveAgentHostFilePath('..\\src\\a.ts', 'C:\\project\\docs', 'win32', 'C:\\Users\\me')).toBe('C:\\project\\src\\a.ts');
    for (const platform of ['darwin', 'win32'] as const) expect(() => resolveAgentHostFilePath('a.ts', undefined, platform)).toThrow('basePath');
    for (const target of ['C:relative', '\\rooted', '\\\\server\\share\\a', '\\\\?\\C:\\a']) {
      expect(() => resolveAgentHostFilePath(target, 'C:\\project', 'win32', 'C:\\Users\\me')).toThrow();
    }
    expect(() => resolveAgentHostFilePath('/a', 'relative', 'darwin')).toThrow();
  });

  it('uses authoritative current-directory metadata once and freezes the result for the call', async () => {
    const ctx = context();
    const input = { path: '../src/a.ts' };
    const first = await resolveAgentFileQuery(input, ctx);
    expect(first).toEqual({ path: '/project/src/a.ts' });
    expect(Object.isFrozen(first)).toBe(true);
    ctx.appContext.currentDirectory = { id: 20, name: 'moved' };
    vi.mocked(ctx.readLibraryMetadata!).mockRejectedValue(new Error('must not resolve again'));
    expect(await resolveAgentFileQuery(input, ctx)).toBe(first);
    expect(ctx.readLibraryMetadata).toHaveBeenCalledTimes(1);
    expect(input).toEqual({ path: '../src/a.ts' });
  });

  it('rejects missing or mismatched current-directory identity and does not retry in host scope', async () => {
    const ctx = context();
    vi.mocked(ctx.readLibraryMetadata!).mockResolvedValue({ libraryId: 3, node: { id: 20, libraryId: 3, parentId: 9, name: 'wrong', type: 'dir', path: '/wrong' } });
    await expect(resolveAgentFileQuery({ path: 'a.ts' }, ctx)).rejects.toThrow('身份');
    ctx.readLibraryMetadata = undefined;
    await expect(resolveAgentFileQuery({ path: 'a.ts' }, ctx)).rejects.toThrow('绝对 basePath');
    await expect(resolveAgentFileQuery({ path: '~/a.ts' }, ctx)).rejects.toThrow();
    await expect(resolveAgentFileQuery({ scope: 'host', path: 'a.ts' }, ctx)).rejects.toThrow('basePath');
  });

  it('leaves absolute paths independent of current directory and validates an explicit base', async () => {
    const ctx = context();
    expect(await resolveAgentFileQuery({ path: '/a.ts', basePath: '/docs' }, ctx)).toEqual({ path: '/a.ts' });
    expect(ctx.readLibraryMetadata).not.toHaveBeenCalled();
    await expect(resolveAgentFileQuery({ path: '/a.ts', basePath: 'bad' }, ctx)).rejects.toThrow();
    expect(await resolveAgentFileQuery({ path: 'a.ts', basePath: '/docs' }, ctx)).toEqual({ path: '/docs/a.ts' });
  });

  it('preserves whole-library search and freezes default list and create directories', async () => {
    const ctx = context();
    expect(await resolveAgentFileToolInput('file.search', {}, ctx)).toEqual({});
    expect(await resolveAgentFileToolInput('file.search', { basePath: '/docs' }, ctx)).toEqual({ path: '/docs' });
    expect(await resolveAgentFileToolInput('file.list', {}, ctx)).toEqual({ directoryId: 10 });
    expect(await resolveAgentFileToolInput('directory.create', { name: 'new' }, ctx)).toEqual({ name: 'new', parentId: 10 });
    expect(await resolveAgentFileToolInput('directory.create', { name: 'new', basePath: '/docs' }, ctx)).toEqual({ name: 'new', parentPath: '/docs' });
    ctx.appContext.currentDirectory = undefined;
    expect(await resolveAgentFileToolInput('file.list', {}, ctx)).toEqual({ path: '/' });
    expect(await resolveAgentFileToolInput('directory.create', { name: 'new' }, ctx)).toEqual({ name: 'new', parentPath: '/' });
    await expect(resolveAgentFileToolInput('directory.create', { scope: 'host', name: 'new' }, ctx)).rejects.toThrow('仅支持资料库');
  });

  it('binds write approval and execution to the same relative target', async () => {
    const ctx = context();
    const input = { path: 'a.ts', content: 'new' };
    expect(await fileWriteTool.assess!(input, ctx)).toMatchObject({ preview: { description: '/project/docs/a.ts' } });
    ctx.appContext.currentDirectory = { id: 20, name: 'other' };
    await fileWriteTool.execute!(input, ctx);
    expect(ctx.executeLibraryFileMutation).toHaveBeenCalledWith(expect.objectContaining({ path: '/project/docs/a.ts' }), ctx.signal, undefined);
    expect(ctx.readLibraryMetadata).toHaveBeenCalledTimes(1);
    expect(normalizeAgentFileWriteInput({ path: 'a.ts', basePath: '/docs', content: 'new' })).toMatchObject({ path: '/docs/a.ts' });
  });

  it('binds single-file patch headers to the original path before canonical execution', async () => {
    const ctx = context();
    for (const header of ['--- a/a.ts\n+++ b/a.ts', '--- a.ts\n+++ a.ts']) {
      const input = { path: 'a.ts', basePath: '/$&', revision: 'a'.repeat(64), patch: `${header}\n@@ -1 +1 @@\n-old\n+new\n` };
      const canonical = await resolveAgentFileToolInput('file.patch', input, ctx) as typeof input;
      expect(canonical).toMatchObject({ path: '/$&/a.ts', patch: '--- /$&/a.ts\n+++ /$&/a.ts\n@@ -1 +1 @@\n-old\n+new\n' });
      expect(new TextDecoder().decode(applyAgentFilePatch(Buffer.from('old\n'), canonical.patch, canonical.path).bytes)).toBe('new\n');
    }
    const bad = await resolveAgentFileToolInput('file.patch', { path: 'a.ts', basePath: '/docs', patch: '--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-old\n+new\n' }, ctx) as { path: string; patch: string };
    expect(() => applyAgentFilePatch(Buffer.from('old\n'), bad.patch, bad.path)).toThrow('header');
  });

  it('accepts relative targets in every affected frozen tool schema', () => {
    const registry = createAgentToolRegistry([fileListTool, fileStatTool, fileSearchTool, fileResolveTool, fileContentTool,
      fileWriteTool, filePatchTool, directoryCreateTool, fileDeleteTool, ...libraryActionTools]);
    const cases: Array<[string, unknown]> = [
      ['file.list', { path: '.', basePath: '/docs' }], ['file.stat', { path: 'a', basePath: '/docs' }],
      ['file.search', { path: '.', basePath: '/docs' }], ['file.resolve', { path: 'a', basePath: '/docs' }],
      ['file.read', { path: 'a', basePath: '/docs' }], ['file.write', { path: 'a', basePath: '/docs', content: '' }],
      ['file.patch', { path: 'a', basePath: '/docs', patch: '@@ -1 +1 @@\n-a\n+b\n', revision: 'a'.repeat(64) }],
      ['directory.create', { path: 'a', basePath: '/docs' }], ['file.delete', { path: 'a', basePath: '/docs' }],
      ['file.rename', { path: 'a', basePath: '/docs', name: 'b' }], ['file.move', { path: 'a', parentPath: '../out', basePath: '/docs' }],
      ['file.copy', { nodeId: 9, parentPath: '../out', basePath: '/docs' }],
    ];
    for (const [name, input] of cases) expect(registry.validateInput(name, input), name).toMatchObject({ ok: true });
  });
});
