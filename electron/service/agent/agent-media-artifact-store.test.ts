import { access, mkdir, mkdtemp, rm, truncate, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_MEDIA_MAX_ARTIFACT_BYTES,
  createAgentMediaArtifactStore,
} from './agent-media-artifact-store';

const OWNER = {
  executionId: 'execution-1',
  ownerWebContentsId: 77,
  runId: 'run-1',
  sessionId: 'session-1',
};

describe('Agent media artifact store', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
  });

  async function createStore(options: {
    maxTotalArtifactBytes?: number;
    now?: () => number;
    ttlMs?: number;
  } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-artifact-test-'));
    roots.push(root);
    return {
      root,
      store: createAgentMediaArtifactStore({ rootPath: root, ...options }),
    };
  }

  it('finalizes a non-empty artifact and removes it only for the exact owner', async () => {
    const { store } = await createStore();
    const artifact = await store.create('movie-audio.m4a', OWNER);
    await writeFile(artifact.filePath, 'audio');

    await expect(store.finalize(artifact.artifactId)).resolves.toMatchObject({
      fileName: 'movie-audio.m4a',
      sizeBytes: 5,
    });
    await expect(store.release(artifact.artifactId, {
      ...OWNER,
      ownerWebContentsId: 88,
    })).rejects.toThrow('无权释放');
    await expect(access(artifact.filePath)).resolves.toBeUndefined();
    await expect(store.release(artifact.artifactId, OWNER)).resolves.toBe(true);
    await expect(access(artifact.filePath)).rejects.toThrow();
  });

  it('rejects empty and oversized artifacts and cleans their directories', async () => {
    const { store } = await createStore();
    const empty = await store.create('empty.m4a', OWNER);
    await writeFile(empty.filePath, '');
    await expect(store.finalize(empty.artifactId)).rejects.toThrow('未生成有效');
    await expect(access(empty.directoryPath)).rejects.toThrow();

    const oversized = await store.create('oversized.wav', OWNER);
    await writeFile(oversized.filePath, 'x');
    await truncate(oversized.filePath, AGENT_MEDIA_MAX_ARTIFACT_BYTES + 1);
    await expect(store.finalize(oversized.artifactId)).rejects.toThrow('超过 2 GiB');
    await expect(access(oversized.directoryPath)).rejects.toThrow();
  });

  it('sweeps expired records and crash leftovers', async () => {
    let now = 10_000;
    const { root, store } = await createStore({ now: () => now, ttlMs: 1_000 });
    const artifact = await store.create('expired.mp3', OWNER);
    await writeFile(artifact.filePath, 'audio');
    await store.finalize(artifact.artifactId);
    const orphan = path.join(root, 'agent-media-orphan');
    await mkdir(orphan);
    await utimes(orphan, new Date(0), new Date(0));

    now += 1_001;
    await store.sweepExpired();

    await expect(access(artifact.directoryPath)).rejects.toThrow();
    await expect(access(orphan)).rejects.toThrow();
  });

  it('keeps active extraction files and enforces the concurrent reservation limit', async () => {
    let now = 10_000;
    const { store } = await createStore({ now: () => now, ttlMs: 1_000 });
    const active = await store.create('active.wav', OWNER);
    now += 1_001;

    await store.sweepExpired();
    await expect(access(active.directoryPath)).resolves.toBeUndefined();

    const attempts = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => (
      store.create(`parallel-${index}.m4a`, {
        ...OWNER,
        executionId: `execution-${index + 2}`,
      })
    )));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    await store.releaseRun(OWNER.runId);
  });

  it('renews the finalized artifact lease from its exact execution owner', async () => {
    let now = 10_000;
    const { store } = await createStore({ now: () => now, ttlMs: 1_000 });
    const artifact = await store.create('uploading.m4a', OWNER);
    await writeFile(artifact.filePath, 'audio');
    await store.finalize(artifact.artifactId);
    now += 900;

    expect(store.touchExecution({ ...OWNER, executionId: 'another-execution' })).toBe(false);
    expect(store.touchExecution(OWNER)).toBe(true);
    now += 900;
    await store.sweepExpired();
    await expect(access(artifact.filePath)).resolves.toBeUndefined();

    now += 101;
    await store.sweepExpired();
    await expect(access(artifact.filePath)).rejects.toThrow();
  });

  it('counts recent crash residue against the aggregate artifact reservation', async () => {
    const { root, store } = await createStore({
      maxTotalArtifactBytes: AGENT_MEDIA_MAX_ARTIFACT_BYTES,
    });
    const orphan = path.join(root, 'agent-media-recent-crash');
    await mkdir(orphan);
    await writeFile(path.join(orphan, 'leftover.wav'), 'x');

    await expect(store.create('next.wav', OWNER)).rejects.toThrow('总量已达到上限');
  });
});
