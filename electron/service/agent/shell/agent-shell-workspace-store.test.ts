import { access, lstat, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAgentLocalStorageQuotaManager } from '../storage/agent-local-storage-quota-manager';
import {
  createAgentShellWorkspaceStore,
  type AgentShellWorkspaceOwner,
} from './agent-shell-workspace-store';

const OWNER: AgentShellWorkspaceOwner = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
};

const OTHER_OWNER: AgentShellWorkspaceOwner = {
  accountScope: 'user:8',
  backendScope: 'https://example.com/api',
  sessionId: 'session-2',
};

describe('Agent shell workspace store', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
  });

  async function createStore(options: { createId?: () => string } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-test-'));
    roots.push(root);
    const manager = createAgentLocalStorageQuotaManager({
      maxTotalBytes: 1_000,
      maxSingleResourceBytes: 500,
    });
    let id = 0;
    const store = createAgentShellWorkspaceStore({
      createId: options.createId || (() => `workspace-${id++}`),
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    return { manager, root, store };
  }

  it('creates isolated logical roots without exposing a physical path', async () => {
    const { root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    expect(workspace.logicalRoots).toEqual(['input', 'work', 'output', 'tmp', 'home']);
    (workspace.logicalRoots as unknown as string[]).push('input');
    expect(store.get(workspace.workspaceId, OWNER)?.logicalRoots).toEqual([
      'input',
      'work',
      'output',
      'tmp',
      'home',
    ]);
    expect(workspace.manifest.entries.map(entry => entry.logicalPath)).toEqual([
      'home',
      'input',
      'output',
      'tmp',
      'work',
    ]);
    expect(workspace).not.toHaveProperty('rootPath');
    for (const logicalRoot of workspace.logicalRoots) {
      await expect(access(path.join(root, `workspace-${workspace.workspaceId}`, logicalRoot)))
        .resolves.toBeUndefined();
    }
  });

  it('does not delete a pre-existing directory when workspace creation collides', async () => {
    const { root, store } = await createStore({ createId: () => 'fixed-id' });
    const existingRoot = path.join(root, 'workspace-fixed-id');
    await mkdir(existingRoot);
    await writeFile(path.join(existingRoot, 'keep.txt'), 'keep');

    await expect(store.create('run-1', OWNER)).rejects.toThrow();
    await expect(access(path.join(existingRoot, 'keep.txt'))).resolves.toBeUndefined();
  });

  it('rejects access from a different owner or session', async () => {
    const { store } = await createStore();
    const workspace = await store.create('run-1', OWNER);

    expect(() => store.get(workspace.workspaceId, OTHER_OWNER)).toThrow('无权');
    await expect(store.resolveLogicalPath(workspace.workspaceId, 'work/file.txt', OTHER_OWNER))
      .rejects.toThrow('无权');
    await expect(store.requestCleanup(workspace.workspaceId, OTHER_OWNER))
      .rejects.toThrow('无权');
  });

  it('does not delete a workspace still managed by another quota owner', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-owner-test-'));
    roots.push(root);
    const workspaceId = 'owner-conflict';
    const workspaceRoot = path.join(root, `workspace-${workspaceId}`);
    await mkdir(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'keep.txt'), 'keep');
    const manager = createAgentLocalStorageQuotaManager({
      persistence: {
        load: async () => [{
          accountScope: OTHER_OWNER.accountScope,
          actualBytes: 4,
          adapterId: 'shell-workspace',
          backendScope: OTHER_OWNER.backendScope,
          category: 'workspace',
          createdAt: 1,
          expectedBytes: 4,
          expiresAt: Date.now() + 60_000,
          id: 'reservation-owner-conflict',
          lastTouchedAt: 1,
          resourceRef: `workspace:${workspaceId}`,
          runId: 'run-owner-conflict',
          state: 'committed',
        }],
        replace: async () => undefined,
      },
    });
    const store = createAgentShellWorkspaceStore({
      adapterId: 'shell-workspace',
      persistence: {
        load: async () => [{
          generation: 1,
          manifest: {
            entries: [],
            generation: 1,
            provenance: [],
            workspaceId,
          },
          owner: OWNER,
          quotaResourceRef: `workspace:${workspaceId}`,
          runId: 'run-owner-conflict',
          status: 'active',
          workspaceId,
        }],
        replace: async () => undefined,
      },
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });

    await store.ready;

    expect(store.get(workspaceId, OWNER)).toBeNull();
    await expect(access(path.join(workspaceRoot, 'keep.txt'))).resolves.toBeUndefined();
    expect(manager.getResource(`workspace:${workspaceId}`, OTHER_OWNER)).toMatchObject({
      state: 'committed',
    });
  });

  it('bounds manifest update batches before resolving filesystem paths', async () => {
    const { store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const entries = Array.from({ length: 1_001 }, (_, index) => ({
      kind: 'file' as const,
      logicalPath: `work/file-${index}.txt`,
      sizeBytes: 1,
    }));

    await expect(store.updateManifest(workspace.workspaceId, { entries }, OWNER))
      .rejects.toThrow('条目过多');
  });

  it('resolves only canonical logical paths and rejects traversal or platform paths', async () => {
    const { store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    await expect(store.resolveLogicalPath(workspace.workspaceId, 'work/output.txt', OWNER))
      .resolves.toEqual({ logicalPath: 'work/output.txt', workspaceId: workspace.workspaceId });
    for (const logicalPath of [
      '../outside',
      'work/../output.txt',
      '/work/output.txt',
      'C:/work/output.txt',
      'work\\output.txt',
      'unknown/output.txt',
      'work//output.txt',
    ]) {
      await expect(store.resolveLogicalPath(workspace.workspaceId, logicalPath, OWNER)).rejects.toThrow();
    }
  });

  it('resolves a main-only preparation context bound to the current Run and generation', async () => {
    const { root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const resolved = await store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );

    expect(resolved).toMatchObject({
      generation: 1,
      logicalCwd: 'work',
      runId: 'run-1',
      workspaceId: workspace.workspaceId,
    });
    expect(resolved.workspaceMetadataIdentity).toMatch(/^v1:[a-f0-9]{64}$/u);
    expect(resolved.physicalCwdPath).toContain(path.join(root, `workspace-${workspace.workspaceId}`));
    expect(resolved.physicalHomePath).toContain(path.join(root, `workspace-${workspace.workspaceId}`));
    expect(resolved.physicalTempPath).toContain(path.join(root, `workspace-${workspace.workspaceId}`));
    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-other',
      OWNER,
    )).rejects.toThrow('Run 不匹配');
  });

  it('requires the preparation cwd to exist as a real directory', async () => {
    const { root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const workspaceRoot = path.join(root, `workspace-${workspace.workspaceId}`);
    await writeFile(path.join(workspaceRoot, 'work', 'file.txt'), 'content');

    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work/missing',
      'run-1',
      OWNER,
    )).rejects.toThrow('不存在');
    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work/file.txt',
      'run-1',
      OWNER,
    )).rejects.toThrow('不是目录');
  });

  it('rejects symlink escape even when the logical path remains inside a root', async () => {
    const { root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const workspaceRoot = path.join(root, `workspace-${workspace.workspaceId}`);
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(workspaceRoot, 'work', 'linked'));

    await expect(store.resolveLogicalPath(workspace.workspaceId, 'work/linked/secret.txt', OWNER))
      .rejects.toThrow('symlink');
  });

  it.each(['home', 'tmp'])('rejects a redirected fixed %s root during preparation', async (rootName) => {
    const { root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const workspaceRoot = path.join(root, `workspace-${workspace.workspaceId}`);
    await rm(path.join(workspaceRoot, rootName), { recursive: true });
    await symlink(path.join(workspaceRoot, 'input'), path.join(workspaceRoot, rootName));

    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    )).rejects.toThrow('受控目录');
  });

  it('updates the manifest with optimistic generation and cumulative provenance', async () => {
    const { store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const hash = `sha256:${'a'.repeat(64)}`;
    await expect(store.updateManifest(workspace.workspaceId, {
      entries: [{
        contentHash: hash,
        kind: 'file',
        logicalPath: 'output/result.txt',
        sizeBytes: 12,
      }],
      expectedGeneration: workspace.generation,
      provenance: ['stage:library-node:42'],
    }, OWNER)).resolves.toMatchObject({
      generation: workspace.generation + 1,
      provenance: ['stage:library-node:42'],
    });
    await expect(store.updateManifest(workspace.workspaceId, {
      expectedGeneration: workspace.generation,
    }, OWNER)).rejects.toThrow('generation');
    const updated = await store.updateManifest(workspace.workspaceId, {
      entries: [{
        kind: 'file',
        logicalPath: 'work/derived.txt',
        sizeBytes: 4,
      }],
      expectedGeneration: workspace.generation + 1,
      provenance: ['derived:run-1'],
      remove: ['output/result.txt'],
    }, OWNER);
    expect(updated.provenance).toEqual(['derived:run-1', 'stage:library-node:42']);
    expect(updated.entries.map(entry => entry.logicalPath)).not.toContain('output/result.txt');
  });

  it('rejects a stale concurrent manifest update instead of overwriting a newer generation', async () => {
    const { store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const updates = await Promise.allSettled([
      store.updateManifest(workspace.workspaceId, {
        entries: [{ kind: 'file', logicalPath: 'work/first.txt', sizeBytes: 1 }],
        expectedGeneration: workspace.generation,
      }, OWNER),
      store.updateManifest(workspace.workspaceId, {
        entries: [{ kind: 'file', logicalPath: 'work/second.txt', sizeBytes: 1 }],
        expectedGeneration: workspace.generation,
      }, OWNER),
    ]);
    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('reports real usage through the shared quota manager and delegates cleanup', async () => {
    const { manager, root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    await expect(store.reportUsage(workspace.workspaceId, 120, OWNER)).resolves.toMatchObject({
      generation: workspace.generation + 1,
    });
    expect(manager.getUsage().totalBytes).toBe(120);
    await expect(store.requestCleanup(workspace.workspaceId, OWNER)).resolves.toEqual({
      released: true,
      state: 'released',
    });
    expect(store.get(workspace.workspaceId, OWNER)).toBeNull();
    await expect(lstat(path.join(root, `workspace-${workspace.workspaceId}`))).rejects.toThrow();
  });
});
