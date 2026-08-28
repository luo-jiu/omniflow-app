import { copyFile, mkdir, readFile, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showSaveDialog: vi.fn() },
}));

import {
  createAgentMediaArtifactStore,
  type AgentMediaArtifact,
} from './agent-media-artifact-store';
import { saveAgentMediaArtifactAs } from './agent-media-save-as';

describe('Agent media Save As', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
  });

  async function fixture(): Promise<{
    artifact: AgentMediaArtifact;
    root: string;
    targetPath: string;
  }> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-save-as-test-'));
    roots.push(root);
    const artifactDirectory = path.join(root, 'artifacts');
    const destinationDirectory = path.join(root, 'destination');
    await Promise.all([
      mkdir(artifactDirectory),
      mkdir(destinationDirectory),
    ]);
    const filePath = path.join(artifactDirectory, 'artifact.m4a');
    await writeFile(filePath, 'audio-content');
    return {
      artifact: {
        artifactId: 'artifact-1',
        directoryPath: artifactDirectory,
        fileName: 'artifact.m4a',
        filePath,
        sizeBytes: 13,
      },
      root,
      targetPath: path.join(destinationDirectory, 'saved.m4a'),
    };
  }

  function copyArtifact(artifact: AgentMediaArtifact) {
    return async (temporaryPath: string) => copyFile(artifact.filePath, temporaryPath);
  }

  it('copies the artifact and only returns the selected file name', async () => {
    const { artifact, targetPath } = await fixture();
    const result = await saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: 'saved.m4a',
      sender: {} as never,
      signal: new AbortController().signal,
    }, {
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: targetPath })) as never,
    });

    expect(await readFile(targetPath, 'utf8')).toBe('audio-content');
    expect(result).toEqual({ canceled: false, fileName: 'saved.m4a' });
    expect(JSON.stringify(result)).not.toContain(targetPath);
  });

  it('consumes a user cancellation without creating a destination', async () => {
    const { artifact, targetPath } = await fixture();
    await expect(saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: 'saved.m4a',
      sender: {} as never,
      signal: new AbortController().signal,
    }, {
      showSaveDialog: vi.fn(async () => ({ canceled: true })) as never,
    })).resolves.toEqual({ canceled: true });
    await expect(readFile(targetPath)).rejects.toThrow();
  });

  it('stops after dialog selection when the execution is aborted', async () => {
    const { artifact, targetPath } = await fixture();
    const controller = new AbortController();

    await expect(saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: 'saved.m4a',
      sender: {} as never,
      signal: controller.signal,
    }, {
      showSaveDialog: vi.fn(async () => {
        controller.abort();
        return { canceled: false, filePath: targetPath };
      }) as never,
    })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readFile(targetPath)).rejects.toThrow();
  });

  it('rejects the internal artifact path as a destination', async () => {
    const { artifact } = await fixture();

    await expect(saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: artifact.fileName,
      sender: {} as never,
      signal: new AbortController().signal,
    }, {
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: artifact.filePath,
      })) as never,
    })).rejects.toThrow('内部临时位置');
    expect(await readFile(artifact.filePath, 'utf8')).toBe('audio-content');
  });

  it('rejects another file name in the internal artifact directory', async () => {
    const { artifact } = await fixture();
    const targetPath = path.join(artifact.directoryPath, 'renamed.m4a');

    await expect(saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: 'renamed.m4a',
      sender: {} as never,
      signal: new AbortController().signal,
    }, {
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: targetPath })) as never,
    })).rejects.toThrow('内部临时位置');
    await expect(readFile(targetPath)).rejects.toThrow();
  });

  it('rejects a destination below the internal artifact directory', async () => {
    const { artifact } = await fixture();
    const nestedDirectory = path.join(artifact.directoryPath, 'nested');
    const targetPath = path.join(nestedDirectory, 'saved.m4a');
    await mkdir(nestedDirectory);

    await expect(saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: 'saved.m4a',
      sender: {} as never,
      signal: new AbortController().signal,
    }, {
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: targetPath })) as never,
    })).rejects.toThrow('内部临时位置');
    await expect(readFile(targetPath)).rejects.toThrow();
  });

  it('replaces an existing file through the Windows-compatible backup path', async () => {
    const { artifact, targetPath } = await fixture();
    await writeFile(targetPath, 'old-content');
    let renameCount = 0;

    await expect(saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: 'saved.m4a',
      sender: {} as never,
      signal: new AbortController().signal,
    }, {
      renameFile: (async (from, to) => {
        renameCount += 1;
        if (renameCount === 1) {
          throw Object.assign(new Error('target exists'), { code: 'EEXIST' });
        }
        await rename(from, to);
      }) as typeof rename,
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: targetPath })) as never,
    })).resolves.toEqual({ canceled: false, fileName: 'saved.m4a' });
    expect(renameCount).toBe(3);
    expect(await readFile(targetPath, 'utf8')).toBe('audio-content');
  });

  it('restores the original target when the replacement rename fails', async () => {
    const { artifact, targetPath } = await fixture();
    await writeFile(targetPath, 'old-content');
    let renameCount = 0;

    await expect(saveAgentMediaArtifactAs({
      artifact,
      copyArtifact: copyArtifact(artifact),
      defaultFileName: 'saved.m4a',
      sender: {} as never,
      signal: new AbortController().signal,
    }, {
      renameFile: (async (from, to) => {
        renameCount += 1;
        if (renameCount === 1) {
          throw Object.assign(new Error('target exists'), { code: 'EEXIST' });
        }
        if (renameCount === 3) {
          throw Object.assign(new Error('replace denied'), { code: 'EACCES' });
        }
        await rename(from, to);
      }) as typeof rename,
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: targetPath })) as never,
    })).rejects.toThrow('replace denied');
    expect(renameCount).toBe(4);
    expect(await readFile(targetPath, 'utf8')).toBe('old-content');
  });

  it('does not commit the destination when the opened artifact path is replaced mid-copy', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-save-as-race-test-'));
    roots.push(root);
    const store = createAgentMediaArtifactStore({ rootPath: path.join(root, 'artifacts') });
    const owner = {
      executionId: 'execution-1',
      ownerScope: {
        accountScope: 'user:7',
        backendScope: 'https://api.example.test/v1',
      },
      ownerWebContentsId: 77,
      runId: 'run-1',
      sessionId: 'session-1',
    };
    const artifact = await store.create('artifact.m4a', owner);
    await writeFile(artifact.filePath, 'trusted-audio');
    await store.finalize(artifact.artifactId);
    const targetPath = path.join(root, 'saved.m4a');

    await expect(store.withOwnedFile(artifact.artifactId, owner, ownedFile => (
      saveAgentMediaArtifactAs({
        artifact: ownedFile.artifact,
        copyArtifact: async (temporaryPath) => {
          await writeFile(temporaryPath, await ownedFile.fileHandle.readFile());
          await rename(artifact.filePath, `${artifact.filePath}.original`);
          await writeFile(artifact.filePath, 'replacement');
          await ownedFile.verifyUnchanged();
        },
        defaultFileName: 'saved.m4a',
        sender: {} as never,
        signal: new AbortController().signal,
      }, {
        showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: targetPath })) as never,
      })
    ))).rejects.toThrow('读取期间发生变化');

    await expect(readFile(targetPath)).rejects.toThrow();
    expect((await readdir(root)).some(name => name.includes('.omniflow-'))).toBe(false);
  });
});
