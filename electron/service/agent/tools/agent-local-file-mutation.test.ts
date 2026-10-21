import crypto from 'node:crypto';
import { mkdtemp, readFile, writeFile, realpath, rm, stat, link, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { normalizeAgentFileWriteInput, type AgentFileMutationSnapshot } from '../../../../src/shared/agent/agent-file-write';
import { normalizeAgentFilePatchInput } from '../../../../src/shared/agent/agent-file-patch';
import { executeAgentHostFileMutation } from './agent-local-file-mutation';
import { createAgentToolRegistry, type AgentToolDispatchContext } from '../agent-tool-registry';
import { createAgentToolBroker } from '../agent-tool-broker';
import { fileWriteTool } from './file-write-tool';
import { filePatchTool } from './file-patch-tool';

const digest = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
let directory: string;
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(tmpdir(), 'omniflow-mutation-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function runtime() {
  const controller = new AbortController();
  const hooks = { operationId: crypto.randomUUID(), prepare: vi.fn<(snapshot: AgentFileMutationSnapshot, signal: AbortSignal) => Promise<void>>(async () => undefined), settle: vi.fn(async () => undefined) };
  const commit = { begin: vi.fn(), settle: vi.fn() };
  const context = { appContext: { libraryId: 3 }, signal: controller.signal, fileMutation: hooks,
    commitSettlement: commit } as unknown as AgentToolExecutionContext;
  return { context, controller, hooks, commit };
}

describe('guarded host saved mutations', () => {
  it('creates and patches a real temporary file through Registry → Broker → main tool → private journal hooks', async () => {
    const registry = createAgentToolRegistry([fileWriteTool, filePatchTool]);
    const frozen = registry.createSnapshot();
    const broker = createAgentToolBroker({ toolRegistry: registry });
    const file = path.join(directory, 'a.txt');
    for (const [name, input, expected] of [
      ['file.write', { scope: 'host', path: file, content: 'old\n' }, 'old\n'],
      ['file.patch', { scope: 'host', path: file, revision: digest('old\n'), patch: '@@ -1 +1 @@\n-old\n+new\n' }, 'new\n'],
    ] as const) {
      const { context, hooks, commit } = runtime();
      const dispatch = { ...context, runCapabilitySnapshot: { getTool: (requested: string) => frozen.get(requested) } } as unknown as AgentToolDispatchContext;
      expect(await broker.executeMain(name, input, dispatch, 10_000, frozen)).toMatchObject({ ok: true, data: { writeCommitState: 'committed', revision: digest(expected) } });
      expect(await readFile(file, 'utf8')).toBe(expected);
      expect(hooks.prepare).toHaveBeenCalledOnce();
      expect(hooks.settle).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      expect(commit.begin).not.toHaveBeenCalled(); // Broker installs a fresh main-owned closure.
    }
  });
  it('creates exclusively with a private before/after hook and no raw body in the result', async () => {
    const { context, hooks, commit } = runtime();
    const file = path.join(directory, 'a.txt');
    const result = await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'private source' }), context);
    expect(result).toMatchObject({ ok: true, data: { writeCommitState: 'committed', revision: digest('private source') } });
    expect(await readFile(file, 'utf8')).toBe('private source');
    expect(hooks.prepare).toHaveBeenCalledWith(expect.objectContaining({ beforeBytes: null, afterBytes: expect.any(Uint8Array) }), context.signal);
    expect(commit.begin).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mutationCommitState: 'commit_unknown' }) }));
    expect(commit.settle).toHaveBeenCalledWith(result);
    expect(hooks.settle).toHaveBeenCalledWith(result);
    expect(JSON.stringify(result)).not.toContain('private source');
    expect(await readdir(directory)).toEqual(['a.txt']);
  });
  it('does not create or replace without journal/commit supervision', async () => {
    const { context } = runtime();
    const file = path.join(directory, 'a.txt');
    const result = await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'new' }), { ...context, fileMutation: undefined });
    expect(result).toMatchObject({ ok: false, data: { code: 'UNSUPPORTED_CAPABILITY' } });
    expect(await readdir(directory)).toEqual([]);
  });
  it('applies exact patch bytes, preserving BOM/newline/mode and private snapshots', async () => {
    const file = path.join(directory, 'a.txt');
    const before = '\uFEFFalpha\r\nbeta\r\n';
    await writeFile(file, before, { mode: 0o640 });
    const { context, hooks } = runtime();
    const result = await executeAgentHostFileMutation(normalizeAgentFilePatchInput({ scope: 'host', path: file,
      revision: digest(before), patch: '@@ -2 +2 @@\n-beta\n+中文😀\n' }), context);
    expect(result).toMatchObject({ ok: true, data: { additions: 1, deletions: 1, writeCommitState: 'committed' } });
    expect(await readFile(file, 'utf8')).toBe('\uFEFFalpha\r\n中文😀\r\n');
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(hooks.prepare.mock.calls[0][0].beforeBytes!)).toBe(before);
    expect(JSON.stringify(result)).not.toContain('alpha');
  });
  it('rejects stale versions and malformed patches without mutation', async () => {
    const file = path.join(directory, 'a.txt');
    await writeFile(file, 'old\n');
    const { context, hooks } = runtime();
    const stale = await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'new', revision: digest('stale') }), context);
    expect(stale).toMatchObject({ ok: false, data: { code: 'REVISION_CONFLICT', writeCommitState: 'uncommitted' } });
    const invalid = await executeAgentHostFileMutation(normalizeAgentFilePatchInput({ scope: 'host', path: file, revision: digest('old\n'), patch: '@@ -1 +1 @@\n-different\n+new\n' }), context);
    expect(invalid).toMatchObject({ ok: false, data: { code: 'PATCH_CONTEXT_MISMATCH' } });
    expect(hooks.prepare).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('old\n');
  });
  it('rechecks the authoritative target after the snapshot hook', async () => {
    const file = path.join(directory, 'a.txt');
    await writeFile(file, 'old');
    const { context, hooks, commit } = runtime();
    hooks.prepare.mockImplementationOnce(async () => { await writeFile(file, 'human change'); });
    const result = await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'agent change', revision: digest('old') }), context);
    expect(result).toMatchObject({ ok: false, data: { writeCommitState: 'uncommitted' } });
    expect(await readFile(file, 'utf8')).toBe('human change');
    expect(commit.begin).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(['a.txt']);
  });
  it('never replaces a concurrent creator and does not enter commit when preparation fails', async () => {
    const file = path.join(directory, 'a.txt');
    const { context, hooks } = runtime();
    hooks.prepare.mockImplementationOnce(async () => { await writeFile(file, 'human create'); });
    const result = await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'agent create' }), context);
    expect(result).toMatchObject({ ok: false, data: { writeCommitState: 'uncommitted', code: 'TARGET_EXISTS' } });
    expect(await readFile(file, 'utf8')).toBe('human create');
    const other = path.join(directory, 'b.txt');
    const second = runtime();
    second.hooks.prepare.mockRejectedValueOnce(new Error('quota exhausted'));
    expect((await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: other, content: 'new' }), second.context)).ok).toBe(false);
    expect(second.commit.begin).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(['a.txt']);
  });
  it('rejects symlink and hardlinked file targets', async () => {
    const file = path.join(directory, 'a.txt');
    const second = path.join(directory, 'b.txt');
    await writeFile(file, 'old');
    await symlink(file, second);
    const { context } = runtime();
    const write = (target: string) => executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: target, revision: digest('old'), content: 'new' }), context);
    expect((await write(second)).ok).toBe(false);
    await rm(second);
    await link(file, second);
    expect((await write(file)).ok).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('old');
  });
  it('cancels before mutation and preserves actual success when journal settlement fails', async () => {
    const file = path.join(directory, 'a.txt');
    const cancelled = runtime();
    cancelled.hooks.prepare.mockImplementationOnce(async () => { cancelled.controller.abort(); });
    expect((await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'new' }), cancelled.context)).data)
      .toMatchObject({ writeCommitState: 'uncommitted' });
    expect(await readdir(directory)).toEqual([]);
    const successful = runtime();
    successful.hooks.settle.mockRejectedValueOnce(new Error('sqlite unavailable'));
    expect(await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'new' }), successful.context))
      .toMatchObject({ ok: true, data: { writeCommitState: 'committed', changeRecordState: 'pending-recovery' } });
    expect(await readFile(file, 'utf8')).toBe('new');
  });
  it('serializes same-file writers so only one replacement of a given revision succeeds', async () => {
    const file = path.join(directory, 'a.txt');
    await writeFile(file, 'old');
    const contexts = [runtime(), runtime()];
    const results = await Promise.all(contexts.map(({ context }, index) => executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file,
      content: `new ${index}`, revision: digest('old') }), context)));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toHaveLength(1);
    expect(await readdir(directory)).toEqual(['a.txt']);
  });
  it('does not overwrite the journal unknown state with a filesystem receipt rejected by a sealed broker', async () => {
    const file = path.join(directory, 'a.txt');
    const { context, hooks, commit } = runtime();
    commit.settle.mockImplementationOnce(() => { throw new Error('提交回执已经结束'); });
    const result = await executeAgentHostFileMutation(normalizeAgentFileWriteInput({ scope: 'host', path: file, content: 'new' }), context);
    expect(await readFile(file, 'utf8')).toBe('new');
    expect(result).toMatchObject({ ok: false, data: { writeCommitState: 'commit_unknown', code: 'SETTLEMENT_EXPIRED' } });
    expect(hooks.settle).not.toHaveBeenCalled();
  });
});
