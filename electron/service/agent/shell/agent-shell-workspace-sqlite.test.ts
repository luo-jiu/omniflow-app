import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAgentLocalStorageQuotaManager } from '../storage/agent-local-storage-quota-manager';
import { createSQLiteAgentLocalStorageQuotaPersistence } from '../storage/agent-local-storage-quota-sqlite';
import {
  createAgentShellWorkspaceStore,
  type AgentShellWorkspaceOwner,
} from './agent-shell-workspace-store';
import { createSQLiteAgentShellWorkspacePersistence } from './agent-shell-workspace-sqlite';

const OWNER: AgentShellWorkspaceOwner = {
  accountScope: 'user:7002',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
};

describe('SQLite Agent shell workspace persistence', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, {
      force: true,
      recursive: true,
    })));
  });

  it('recovers workspace metadata and manifest after recreation', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-sqlite-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const rootPath = path.join(directory, 'workspaces');

    const quotaPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const quotaManager = createAgentLocalStorageQuotaManager({
      adapters: {},
      persistence: quotaPersistence,
      maxTotalBytes: 1_000,
    });
    const workspacePersistence = await createSQLiteAgentShellWorkspacePersistence(databasePath);
    const first = createAgentShellWorkspaceStore({
      adapterId: 'shell-workspace',
      createId: () => 'workspace-1',
      persistence: workspacePersistence,
      quotaManager,
      rootPath,
    });
    await first.ready;
    const workspace = await first.create('run-1', OWNER);
    await first.updateManifest(workspace.workspaceId, {
      entries: [{ kind: 'file', logicalPath: 'output/result.txt', sizeBytes: 7 }],
      expectedGeneration: workspace.generation,
      provenance: ['stage:test'],
    }, OWNER);
    await first.dispose();
    await quotaManager.close();

    const restoredQuotaPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const restoredQuota = createAgentLocalStorageQuotaManager({
      adapters: {},
      persistence: restoredQuotaPersistence,
      maxTotalBytes: 1_000,
    });
    const restoredWorkspacePersistence = await createSQLiteAgentShellWorkspacePersistence(databasePath);
    const second = createAgentShellWorkspaceStore({
      adapterId: 'shell-workspace',
      persistence: restoredWorkspacePersistence,
      quotaManager: restoredQuota,
      rootPath,
    });
    await second.ready;
    expect(second.get('workspace-1', OWNER)?.manifest).toMatchObject({
      provenance: ['stage:test'],
    });
    expect(second.get('workspace-1', OWNER)?.manifest.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalPath: 'output/result.txt', sizeBytes: 7 }),
    ]));
    await expect(second.requestCleanup('workspace-1', OWNER)).resolves.toEqual({
      released: true,
      state: 'released',
    });
    await expect(access(path.join(rootPath, 'workspace-workspace-1'))).rejects.toThrow();
    expect(restoredQuota.getUsage()).toMatchObject({ resourceCount: 0, totalBytes: 0 });
    await second.dispose();
    await restoredQuota.close();
  });

  it('cleans the durable quota resource when its workspace is missing after restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-workspace-missing-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const rootPath = path.join(directory, 'workspaces');

    const quotaPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const quotaManager = createAgentLocalStorageQuotaManager({
      persistence: quotaPersistence,
      maxTotalBytes: 1_000,
    });
    const workspacePersistence = await createSQLiteAgentShellWorkspacePersistence(databasePath);
    const first = createAgentShellWorkspaceStore({
      adapterId: 'shell-workspace',
      createId: () => 'workspace-missing',
      persistence: workspacePersistence,
      quotaManager,
      rootPath,
    });
    const workspace = await first.create('run-missing', OWNER);
    await first.dispose();
    await quotaManager.close();
    await rm(path.join(rootPath, `workspace-${workspace.workspaceId}`), {
      force: true,
      recursive: true,
    });

    const restoredQuotaPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const restoredQuota = createAgentLocalStorageQuotaManager({
      persistence: restoredQuotaPersistence,
      maxTotalBytes: 1_000,
    });
    const restoredWorkspacePersistence = await createSQLiteAgentShellWorkspacePersistence(databasePath);
    const second = createAgentShellWorkspaceStore({
      adapterId: 'shell-workspace',
      persistence: restoredWorkspacePersistence,
      quotaManager: restoredQuota,
      rootPath,
    });

    await second.ready;
    expect(second.get(workspace.workspaceId, OWNER)).toBeNull();
    expect(restoredQuota.getUsage()).toEqual({
      byCategory: {},
      byRun: {},
      resourceCount: 0,
      totalBytes: 0,
    });
    await second.dispose();
    await restoredQuota.close();
  });
});
