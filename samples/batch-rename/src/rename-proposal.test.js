import { describe, expect, it, vi } from 'vitest';
import { createRenameProposal } from './rename-proposal.js';
import { runRenameTool } from './tool-runner.js';

const input = (parameters = {}, names = ['photo.JPG']) => ({ parameters, files: names.map((name, index) => ({ id: `file-${index}`, name })) });

describe('batch rename proposal', () => {
  it('adds prefix and suffix while preserving the final extension and source order', () => {
    expect(createRenameProposal(input({ prefix: '2026-', suffix: '-edited' }, ['photo.JPG', 'archive.tar.gz']))).toEqual({ changes: [
      { id: 'file-0', name: '2026-photo-edited.JPG' }, { id: 'file-1', name: '2026-archive.tar-edited.gz' },
    ] });
  });
  it('preserves Chinese names and handles extensionless and dotfiles explicitly', () => {
    expect(createRenameProposal(input({ prefix: '归档-', suffix: '-终稿' }, ['报告.pdf', '说明', '.env', '.config.json']))).toEqual({ changes: [
      { id: 'file-0', name: '归档-报告-终稿.pdf' }, { id: 'file-1', name: '归档-说明-终稿' },
      { id: 'file-2', name: '归档-.env-终稿' }, { id: 'file-3', name: '归档-.config-终稿.json' },
    ] });
  });
  it('returns no changes for empty affixes and accepts the file count boundary', () => {
    expect(createRenameProposal(input())).toEqual({ changes: [] });
    expect(createRenameProposal(input({ prefix: 'a' }, Array.from({ length: 50 }, (_, i) => `${i}.txt`))).changes).toHaveLength(50);
    expect(() => createRenameProposal(input({}, []))).toThrow();
    expect(() => createRenameProposal(input({}, Array.from({ length: 51 }, (_, i) => `${i}.txt`)))).toThrow();
  });
  it.each(['../', '\\', ':', '\u0000', '\n', '?', '*', '"', '<', '>', '|'])('rejects unsafe affix %j', prefix => {
    expect(() => createRenameProposal(input({ prefix }))).toThrow();
  });
  it.each(['', '.', '..', ' bad.txt', 'bad.txt ', 'bad.', 'a/b.txt', 'a\\b.txt', 'bad\u007f.txt'])('rejects unsafe source name %j', name => {
    expect(() => createRenameProposal(input({ prefix: 'a' }, [name]))).toThrow();
  });
  it('bounds affix characters and final UTF-8 bytes instead of merely JS string length', () => {
    expect(() => createRenameProposal(input({ prefix: 'x'.repeat(81) }))).toThrow();
    expect(createRenameProposal(input({ prefix: '中'.repeat(78) }, ['a.txt'])).changes[0].name).toHaveLength(83);
    expect(() => createRenameProposal(input({ prefix: '中'.repeat(79) }, ['a.txt']))).toThrow();
    expect(() => createRenameProposal(input({ suffix: '.' }, ['noextension']))).toThrow();
    expect(() => createRenameProposal(input({ prefix: ' ' }))).toThrow();
  });
  it('rejects duplicate tokens, real resource fields, extra keys and malformed parameters', () => {
    const duplicate = input({}, ['a.txt', 'b.txt']); duplicate.files[1].id = duplicate.files[0].id;
    const malformed = [duplicate, { ...input(), resources: [42] }, { ...input(), parameters: null },
      input({ regex: '.*' }), input({ suffix: 4 }), { ...input(), files: [{ id: 'opaque', name: 'file.txt', nodeId: 42 }] }];
    for (const value of malformed) expect(() => createRenameProposal(value)).toThrow();
  });
});

function clientFixture() {
  return {
    toolInvocation: vi.fn(async () => ({ invocationId: 'invocation', toolId: 'example.batch-rename.propose', input: input({ prefix: 'copy-' }) })),
    context: vi.fn(async () => ({ kind: 'tool', toolId: 'example.batch-rename.propose', resource: null })),
    read: vi.fn(), completeTool: vi.fn(async () => null), failTool: vi.fn(async () => null),
  };
}
describe('metadata-only Tool invocation', () => {
  it('completes a proposal without resource reads', async () => {
    const client = clientFixture(); await runRenameTool(client);
    expect(client.completeTool).toHaveBeenCalledWith('invocation', { changes: [{ id: 'file-0', name: 'copy-photo.JPG' }] });
    expect(client.read).not.toHaveBeenCalled(); expect(client.failTool).not.toHaveBeenCalled();
  });
  it('refuses an unexpected content resource and a mismatched context', async () => {
    for (const context of [{ kind: 'tool', toolId: 'wrong', resource: null }, { kind: 'tool', toolId: 'example.batch-rename.propose', resource: { handle: 'unexpected' } }]) {
      const client = clientFixture(); client.context.mockResolvedValue(context); await runRenameTool(client);
      expect(client.failTool).toHaveBeenCalledWith('invocation', 'FAILED'); expect(client.completeTool).not.toHaveBeenCalled(); expect(client.read).not.toHaveBeenCalled();
    }
  });
  it('does not send a second terminal reply after a rejected completion', async () => {
    const client = clientFixture(); client.completeTool.mockRejectedValue(new Error('cancelled'));
    await expect(runRenameTool(client)).rejects.toThrow('cancelled'); expect(client.failTool).not.toHaveBeenCalled();
  });
});
