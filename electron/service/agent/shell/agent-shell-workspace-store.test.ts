import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaPersistedRecord,
} from '../storage/agent-local-storage-quota-manager';
import {
  createAgentShellWorkspaceStore,
  type AgentShellWorkspaceOwner,
  type AgentShellWorkspacePersistedRecord,
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

const verifiedIdentityIt = process.platform === 'win32' ? it.skip : it;
const symlinkRootIt = process.platform === 'win32' ? it.skip : it;

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((currentResolve) => {
    resolve = currentResolve;
  });
  return { promise, resolve };
}

describe('Agent shell workspace store', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
  });

  async function createStore(options: {
    createId?: () => string;
    maxSingleResourceBytes?: number;
    maxTotalBytes?: number;
  } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-test-'));
    roots.push(root);
    const manager = createAgentLocalStorageQuotaManager({
      maxTotalBytes: options.maxTotalBytes ?? 128 * 1024,
      maxSingleResourceBytes: options.maxSingleResourceBytes ?? 64 * 1024,
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
    await store.ready;
    const existingRoot = path.join(root, 'workspace-fixed-id');
    await mkdir(existingRoot);
    await writeFile(path.join(existingRoot, 'keep.txt'), 'keep');

    await expect(store.create('run-1', OWNER)).rejects.toThrow();
    await expect(access(path.join(existingRoot, 'keep.txt'))).resolves.toBeUndefined();
  });

  it('removes an unmanaged workspace directory left before quota binding', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-residue-'));
    roots.push(root);
    const orphanRoot = path.join(root, 'workspace-crash-residue');
    await mkdir(orphanRoot);
    await writeFile(path.join(orphanRoot, 'sentinel.txt'), 'incomplete workspace');
    const manager = createAgentLocalStorageQuotaManager();
    const store = createAgentShellWorkspaceStore({
      adapterId: 'workspace-residue-test',
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });

    await store.ready;
    await expect(access(orphanRoot)).rejects.toThrow();
  });

  symlinkRootIt('rejects a managed root replaced by a symlink without reading or deleting its target', async () => {
    const { root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const originalRoot = `${root}-original`;
    const outsideRoot = `${root}-outside`;
    roots.push(originalRoot, outsideRoot);
    await rename(root, originalRoot);
    await mkdir(path.join(
      outsideRoot,
      `workspace-${workspace.workspaceId}`,
      'input',
    ), { recursive: true });
    for (const logicalRoot of ['work', 'output', 'tmp', 'home']) {
      await mkdir(path.join(outsideRoot, `workspace-${workspace.workspaceId}`, logicalRoot));
    }
    const sentinel = path.join(
      outsideRoot,
      `workspace-${workspace.workspaceId}`,
      'input',
      'sentinel.txt',
    );
    await writeFile(sentinel, 'outside');
    await symlink(outsideRoot, root);

    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    )).rejects.toThrow();
    await expect(access(sentinel)).resolves.toBeUndefined();
  });

  it('rejects a managed root replaced by another directory with the same path', async () => {
    const { root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const originalRoot = `${root}-original`;
    roots.push(originalRoot);
    await rename(root, originalRoot);
    await mkdir(path.join(root, `workspace-${workspace.workspaceId}`, 'input'), { recursive: true });
    for (const logicalRoot of ['work', 'output', 'tmp', 'home']) {
      await mkdir(path.join(root, `workspace-${workspace.workspaceId}`, logicalRoot));
    }
    const sentinel = path.join(root, `workspace-${workspace.workspaceId}`, 'input', 'sentinel.txt');
    await writeFile(sentinel, 'replacement');

    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    )).rejects.toThrow();
    await expect(access(sentinel)).resolves.toBeUndefined();
  });

  symlinkRootIt('rejects a symlinked managed root before initialization', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-root-test-'));
    roots.push(parent);
    const outsideRoot = path.join(parent, 'outside');
    const managedRoot = path.join(parent, 'managed');
    await mkdir(outsideRoot);
    await symlink(outsideRoot, managedRoot);
    const manager = createAgentLocalStorageQuotaManager();
    const store = createAgentShellWorkspaceStore({
      quotaManager: manager,
      rootPath: managedRoot,
    });

    await expect(store.ready).rejects.toThrow('受控目录');
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

  verifiedIdentityIt('resolves a main-only preparation context bound to the current Run and generation', async () => {
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
      owner: OWNER,
      runId: 'run-1',
      workspaceContentScannerRevision: 'workspace-content-scanner-v3',
      workspaceEntryCount: 5,
      workspaceTotalBytes: 0,
      workspaceId: workspace.workspaceId,
    });
    expect(resolved.workspaceContentIdentity).toMatch(/^v3:[a-f0-9]{64}$/u);
    expect(resolved.workspaceMetadataIdentity).toMatch(/^v2:[a-f0-9]{64}$/u);
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
    const { manager, root, store } = await createStore();
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
    expect(store.get(workspace.workspaceId, OWNER)).not.toBeNull();
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toMatchObject({
      state: 'committed',
    });
  });

  it('quarantines a missing physical workspace root during preparation', async () => {
    const { manager, root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const workspaceRoot = path.join(root, `workspace-${workspace.workspaceId}`);
    await rm(workspaceRoot, { recursive: true });

    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    )).rejects.toThrow();
    expect(store.get(workspace.workspaceId, OWNER)).toBeNull();
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toBeNull();
  });

  verifiedIdentityIt('rejects symlink escape even when the logical path remains inside a root', async () => {
    const { manager, root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const markDeleting = vi.spyOn(manager, 'markDeleting');
    const workspaceRoot = path.join(root, `workspace-${workspace.workspaceId}`);
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(workspaceRoot, 'work', 'linked'));

    await expect(store.resolveLogicalPath(workspace.workspaceId, 'work/linked/secret.txt', OWNER))
      .rejects.toThrow('symlink');
    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    )).rejects.toThrow('符号链接');
    expect(markDeleting).toHaveBeenCalledWith(
      `workspace:${workspace.workspaceId}`,
      OWNER,
      'unknown',
    );
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toBeNull();
    await expect(lstat(workspaceRoot)).rejects.toThrow();
  });

  verifiedIdentityIt('binds preparation to bytes across every workspace root, not only cwd metadata', async () => {
    const { manager, root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const workspaceRoot = path.join(root, `workspace-${workspace.workspaceId}`);
    const first = await store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );

    await writeFile(path.join(workspaceRoot, 'input', 'fixture.txt'), 'first');
    const staged = await store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );
    expect(staged.workspaceContentIdentity).not.toBe(first.workspaceContentIdentity);
    expect(staged.workspaceMetadataIdentity).not.toBe(first.workspaceMetadataIdentity);
    expect(staged.workspaceEntryCount).toBe(6);
    expect(staged.workspaceTotalBytes).toBeGreaterThanOrEqual(5);
    expect(manager.getUsage().totalBytes).toBe(staged.workspaceTotalBytes);
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toMatchObject({
      actualBytes: staged.workspaceTotalBytes,
      expectedBytes: staged.workspaceTotalBytes,
    });

    await writeFile(path.join(workspaceRoot, 'home', 'state.txt'), 'home');
    const homeChanged = await store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );
    expect(homeChanged.workspaceContentIdentity).not.toBe(staged.workspaceContentIdentity);
    expect(manager.getUsage().totalBytes).toBe(homeChanged.workspaceTotalBytes);

    await writeFile(path.join(workspaceRoot, 'input', 'fixture.txt'), 'x');
    await rm(path.join(workspaceRoot, 'home', 'state.txt'));
    const reduced = await store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );
    expect(reduced.workspaceTotalBytes).toBeGreaterThanOrEqual(1);
    expect(manager.getUsage().totalBytes).toBe(reduced.workspaceTotalBytes);
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toMatchObject({
      actualBytes: reduced.workspaceTotalBytes,
      expectedBytes: reduced.workspaceTotalBytes,
    });
  });

  verifiedIdentityIt('fails preparation when scanned bytes exceed the shared quota', async () => {
    const { manager, root, store } = await createStore({
      maxSingleResourceBytes: 500,
      maxTotalBytes: 1_000,
    });
    const workspace = await store.create('run-1', OWNER);
    const workspaceRoot = path.join(root, `workspace-${workspace.workspaceId}`);
    await writeFile(path.join(workspaceRoot, 'work', 'oversized.bin'), Buffer.alloc(501));
    const markDeleting = vi.spyOn(manager, 'markDeleting');
    const requestRelease = vi.spyOn(manager, 'requestRelease');

    await expect(store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    )).rejects.toThrow('单文件配额不足');
    expect(markDeleting).toHaveBeenCalledWith(
      `workspace:${workspace.workspaceId}`,
      OWNER,
      expect.any(Number),
    );
    expect(requestRelease).toHaveBeenCalledWith(
      `workspace:${workspace.workspaceId}`,
      OWNER,
      expect.any(Number),
    );
    const observedBytes = markDeleting.mock.calls[0]?.[2];
    expect(observedBytes).toEqual(requestRelease.mock.calls[0]?.[2]);
    expect(observedBytes).toEqual(expect.any(Number));
    expect(observedBytes as number).toBeGreaterThanOrEqual(501);
    expect(manager.getUsage().totalBytes).toBe(0);
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toBeNull();
    await expect(lstat(workspaceRoot)).rejects.toThrow();
  });

  verifiedIdentityIt('finishes pending cleanup when the preparation lease is released', async () => {
    const { manager, root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const originalAcquireLease = manager.acquireLease.bind(manager);
    let notifyLeaseAcquired!: () => void;
    let continuePreparation!: () => void;
    const leaseAcquired = new Promise<void>((resolve) => { notifyLeaseAcquired = resolve; });
    const preparationMayContinue = new Promise<void>((resolve) => { continuePreparation = resolve; });
    vi.spyOn(manager, 'acquireLease').mockImplementation(async (resourceRef, ttlMs, owner) => {
      const lease = await originalAcquireLease(resourceRef, ttlMs, owner);
      notifyLeaseAcquired();
      await preparationMayContinue;
      return lease;
    });

    const preparation = store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );
    await leaseAcquired;
    await expect(store.requestCleanup(workspace.workspaceId, OWNER)).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    continuePreparation();

    await expect(preparation).rejects.toThrow('正在清理');
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toBeNull();
    await expect(lstat(path.join(root, `workspace-${workspace.workspaceId}`))).rejects.toThrow();
    await expect(store.requestCleanup(workspace.workspaceId, OWNER)).resolves.toEqual({
      released: false,
      state: 'not_found',
    });
  });

  it('persists workspace quarantine when the quota deletion mark initially fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-recovery-test-'));
    roots.push(root);
    let failQuotaPersistence = false;
    let quotaSnapshot: AgentLocalStorageQuotaPersistedRecord[] = [];
    let workspaceSnapshot: AgentShellWorkspacePersistedRecord[] = [];
    const manager = createAgentLocalStorageQuotaManager({
      maxSingleResourceBytes: 500,
      maxTotalBytes: 1_000,
      persistence: {
        load: async () => quotaSnapshot,
        replace: async (records) => {
          if (failQuotaPersistence) throw new Error('simulated quota persistence failure');
          quotaSnapshot = structuredClone(records);
        },
      },
    });
    const store = createAgentShellWorkspaceStore({
      adapterId: 'shell-workspace-recovery',
      createId: () => 'recovery-workspace',
      persistence: {
        load: async () => workspaceSnapshot,
        replace: async (records) => {
          workspaceSnapshot = structuredClone(records);
        },
      },
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    const workspace = await store.create('run-1', OWNER);

    failQuotaPersistence = true;
    await expect(store.requestCleanup(workspace.workspaceId, OWNER))
      .rejects.toThrow('simulated quota persistence failure');
    expect(workspaceSnapshot[0]).toMatchObject({ status: 'deleting' });
    expect(quotaSnapshot[0]).toMatchObject({ state: 'committed' });
    await expect(manager.reserve(OWNER, 'workspace', 'run-2', 0, 10_000, 'shell-workspace-recovery'))
      .rejects.toThrow('尚未持久化的清理事实');

    failQuotaPersistence = false;
    await expect(manager.sweep('recover-workspace-deletion-intent')).resolves.toMatchObject({
      attempted: 1,
      failed: 0,
      released: 1,
    });
    expect(quotaSnapshot).toEqual([]);
    expect(workspaceSnapshot).toEqual([]);
    await expect(lstat(path.join(root, `workspace-${workspace.workspaceId}`))).rejects.toThrow();
    await store.dispose();
  });

  verifiedIdentityIt('waits for every concurrent preparation lease before cleanup', async () => {
    const { manager, root, store } = await createStore();
    const workspace = await store.create('run-1', OWNER);
    const originalAcquireLease = manager.acquireLease.bind(manager);
    let acquiredCount = 0;
    let notifyBothAcquired!: () => void;
    let continuePreparations!: () => void;
    const bothAcquired = new Promise<void>((resolve) => { notifyBothAcquired = resolve; });
    const preparationsMayContinue = new Promise<void>((resolve) => {
      continuePreparations = resolve;
    });
    vi.spyOn(manager, 'acquireLease').mockImplementation(async (resourceRef, ttlMs, owner) => {
      const lease = await originalAcquireLease(resourceRef, ttlMs, owner);
      acquiredCount += 1;
      if (acquiredCount === 2) notifyBothAcquired();
      await preparationsMayContinue;
      return lease;
    });

    const first = store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );
    const second = store.resolvePreparationContext(
      workspace.workspaceId,
      'work',
      'run-1',
      OWNER,
    );
    await bothAcquired;
    await expect(store.requestCleanup(workspace.workspaceId, OWNER)).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    continuePreparations();

    const results = await Promise.allSettled([first, second]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toBeNull();
    await expect(lstat(path.join(root, `workspace-${workspace.workspaceId}`))).rejects.toThrow();
  });

  it.each(['home', 'tmp'])('quarantines a redirected fixed %s root during preparation', async (rootName) => {
    const { manager, root, store } = await createStore();
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
    expect(manager.getResource(`workspace:${workspace.workspaceId}`, OWNER)).toBeNull();
    await expect(lstat(workspaceRoot)).rejects.toThrow();
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

  it('enforces the cumulative provenance limit without corrupting restart state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-provenance-'));
    roots.push(root);
    const manager = createAgentLocalStorageQuotaManager();
    let workspaceSnapshot: AgentShellWorkspacePersistedRecord[] = [];
    const persistence = {
      load: async (): Promise<AgentShellWorkspacePersistedRecord[]> => (
        structuredClone(workspaceSnapshot)
      ),
      replace: async (records: AgentShellWorkspacePersistedRecord[]): Promise<void> => {
        workspaceSnapshot = structuredClone(records);
      },
    };
    const store = createAgentShellWorkspaceStore({
      adapterId: 'workspace-provenance-limit',
      createId: () => 'provenance-workspace',
      persistence,
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    const workspace = await store.create('run-1', OWNER);
    const acceptedProvenance = Array.from({ length: 200 }, (_, index) => `accepted:${index}`);
    const accepted = await store.updateManifest(workspace.workspaceId, {
      expectedGeneration: workspace.generation,
      provenance: acceptedProvenance,
    }, OWNER);
    expect(accepted.provenance).toHaveLength(200);

    await expect(store.updateManifest(workspace.workspaceId, {
      expectedGeneration: accepted.generation,
      provenance: Array.from({ length: 57 }, (_, index) => `rejected:${index}`),
    }, OWNER)).rejects.toThrow('provenance 条目过多');
    expect(store.get(workspace.workspaceId, OWNER)?.manifest).toMatchObject({
      generation: accepted.generation,
      provenance: accepted.provenance,
    });
    expect(workspaceSnapshot[0]?.manifest).toMatchObject({
      generation: accepted.generation,
      provenance: accepted.provenance,
    });

    await store.dispose();
    const restarted = createAgentShellWorkspaceStore({
      adapterId: 'workspace-provenance-limit',
      persistence,
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    await restarted.ready;
    expect(restarted.get(workspace.workspaceId, OWNER)?.manifest).toMatchObject({
      generation: accepted.generation,
      provenance: accepted.provenance,
    });
    await restarted.dispose();
  });

  it('serializes persistence rollback before the next mutation and restores the final snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-serialized-'));
    roots.push(root);
    const manager = createAgentLocalStorageQuotaManager();
    const firstUpdateEntered = createDeferred();
    const firstUpdateMayFail = createDeferred();
    let failFirstUpdate = true;
    let replaceCalls = 0;
    let workspaceSnapshot: AgentShellWorkspacePersistedRecord[] = [];
    const workspaceIds = ['serialized-workspace', 'unrelated-workspace'];
    const persistence = {
      load: async (): Promise<AgentShellWorkspacePersistedRecord[]> => (
        structuredClone(workspaceSnapshot)
      ),
      replace: async (records: AgentShellWorkspacePersistedRecord[]): Promise<void> => {
        replaceCalls += 1;
        const nextSnapshot = structuredClone(records);
        const containsFirstUpdate = nextSnapshot[0]?.manifest.entries.some(
          entry => entry.logicalPath === 'work/first.txt',
        );
        if (failFirstUpdate && containsFirstUpdate) {
          firstUpdateEntered.resolve();
          await firstUpdateMayFail.promise;
          failFirstUpdate = false;
          throw new Error('simulated workspace persistence failure');
        }
        workspaceSnapshot = nextSnapshot;
      },
    };
    const store = createAgentShellWorkspaceStore({
      adapterId: 'workspace-serialized-mutation',
      createId: () => workspaceIds.shift() || 'unexpected-workspace',
      persistence,
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    const workspace = await store.create('run-1', OWNER);
    const unrelatedWorkspace = await store.create('run-2', OWNER);
    const unrelatedAdjustmentEntered = createDeferred();
    const unrelatedAdjustmentMayContinue = createDeferred();
    const originalAdjust = manager.adjust.bind(manager);
    vi.spyOn(manager, 'adjust').mockImplementation(async (target, bytes, owner) => {
      if (target === `workspace:${unrelatedWorkspace.workspaceId}`) {
        unrelatedAdjustmentEntered.resolve();
        await unrelatedAdjustmentMayContinue.promise;
      }
      return originalAdjust(target, bytes, owner);
    });
    const unrelatedPreparation = store.resolvePreparationContext(
      unrelatedWorkspace.workspaceId,
      'work',
      'run-2',
      OWNER,
    );
    await unrelatedAdjustmentEntered.promise;
    const firstUpdate = store.updateManifest(workspace.workspaceId, {
      entries: [{ kind: 'file', logicalPath: 'work/first.txt', sizeBytes: 1 }],
    }, OWNER);
    await firstUpdateEntered.promise;
    const secondUpdate = store.updateManifest(workspace.workspaceId, {
      entries: [{ kind: 'file', logicalPath: 'work/second.txt', sizeBytes: 2 }],
    }, OWNER);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(replaceCalls).toBe(3);

    const firstFailure = expect(firstUpdate).rejects.toThrow(
      'simulated workspace persistence failure',
    );
    firstUpdateMayFail.resolve();
    await firstFailure;
    const finalManifest = await secondUpdate;
    expect(finalManifest).toMatchObject({ generation: workspace.generation + 1 });
    expect(finalManifest.entries.map(entry => entry.logicalPath)).toContain('work/second.txt');
    expect(finalManifest.entries.map(entry => entry.logicalPath)).not.toContain('work/first.txt');
    expect(replaceCalls).toBe(4);
    expect(store.get(workspace.workspaceId, OWNER)?.manifest).toEqual(finalManifest);
    expect(workspaceSnapshot[0]?.manifest).toEqual(finalManifest);
    unrelatedAdjustmentMayContinue.resolve();
    await expect(unrelatedPreparation).resolves.toMatchObject({
      generation: unrelatedWorkspace.generation,
      workspaceId: unrelatedWorkspace.workspaceId,
    });
    expect(store.get(unrelatedWorkspace.workspaceId, OWNER)).not.toBeNull();

    await store.dispose();
    const restarted = createAgentShellWorkspaceStore({
      adapterId: 'workspace-serialized-mutation',
      persistence,
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    await restarted.ready;
    expect(restarted.get(workspace.workspaceId, OWNER)?.manifest).toEqual(finalManifest);
    await restarted.dispose();
  });

  it('closes admission and waits for an admitted multi-phase create before disposing once', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-dispose-'));
    roots.push(root);
    const manager = createAgentLocalStorageQuotaManager();
    const close = vi.fn(async () => undefined);
    const workspaceIds = ['existing-workspace', 'pending-workspace', 'rejected-workspace'];
    let workspaceSnapshot: AgentShellWorkspacePersistedRecord[] = [];
    const store = createAgentShellWorkspaceStore({
      adapterId: 'workspace-dispose-barrier',
      createId: () => workspaceIds.shift() || 'unexpected-workspace',
      persistence: {
        close,
        load: async () => structuredClone(workspaceSnapshot),
        replace: async (records) => {
          workspaceSnapshot = structuredClone(records);
        },
      },
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    const existingWorkspace = await store.create('run-existing', OWNER);
    const pendingCommitEntered = createDeferred();
    const pendingCommitMayContinue = createDeferred();
    const originalCommit = manager.commit.bind(manager);
    vi.spyOn(manager, 'commit').mockImplementation(async (...args) => {
      if (args[1] === 'workspace:pending-workspace') {
        pendingCommitEntered.resolve();
        await pendingCommitMayContinue.promise;
      }
      return originalCommit(...args);
    });
    const pendingCreate = store.create('run-pending', OWNER);
    await pendingCommitEntered.promise;
    expect(store.get(existingWorkspace.workspaceId, OWNER)).not.toBeNull();

    const firstDispose = store.dispose();
    const secondDispose = store.dispose();
    expect(secondDispose).toBe(firstDispose);
    expect(store.get(existingWorkspace.workspaceId, OWNER)).toBeNull();
    await expect(store.create('run-rejected', OWNER)).rejects.toThrow('正在关闭');
    await expect(store.resolveLogicalPath(
      existingWorkspace.workspaceId,
      'work',
      OWNER,
    )).rejects.toThrow('正在关闭');
    expect(close).not.toHaveBeenCalled();

    pendingCommitMayContinue.resolve();
    await expect(pendingCreate).resolves.toMatchObject({ workspaceId: 'pending-workspace' });
    await firstDispose;
    await secondDispose;
    expect(workspaceSnapshot.map(record => record.workspaceId).sort()).toEqual([
      'existing-workspace',
      'pending-workspace',
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the cleanup adapter registered until an admitted adapter callback settles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-adapter-close-'));
    roots.push(root);
    const manager = createAgentLocalStorageQuotaManager();
    const adapterPersistEntered = createDeferred();
    const adapterPersistMayContinue = createDeferred();
    const close = vi.fn(async () => undefined);
    let pauseNextPersist = false;
    let workspaceSnapshot: AgentShellWorkspacePersistedRecord[] = [];
    const store = createAgentShellWorkspaceStore({
      adapterId: 'workspace-adapter-close-barrier',
      createId: () => 'adapter-close-workspace',
      persistence: {
        close,
        load: async () => structuredClone(workspaceSnapshot),
        replace: async (records) => {
          if (pauseNextPersist) {
            pauseNextPersist = false;
            adapterPersistEntered.resolve();
            await adapterPersistMayContinue.promise;
          }
          workspaceSnapshot = structuredClone(records);
        },
      },
      quotaManager: manager,
      rootPath: root,
      ttlMs: 10_000,
    });
    const workspace = await store.create('run-1', OWNER);
    const unregisterAdapter = vi.spyOn(manager, 'unregisterAdapter');

    pauseNextPersist = true;
    const release = manager.requestRelease(
      `workspace:${workspace.workspaceId}`,
      OWNER,
      'unknown',
    );
    await adapterPersistEntered.promise;
    const disposing = store.dispose();
    await Promise.resolve();

    expect(unregisterAdapter).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    adapterPersistMayContinue.resolve();
    await expect(release).resolves.toEqual({ released: true, state: 'released' });
    await disposing;

    expect(unregisterAdapter).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(unregisterAdapter.mock.invocationCallOrder[0])
      .toBeLessThan(close.mock.invocationCallOrder[0]);
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
