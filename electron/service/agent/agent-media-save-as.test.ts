import { readFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showSaveDialog: vi.fn() },
}));

import type { AgentMediaArtifact } from './agent-media-artifact-store';
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
    const filePath = path.join(root, 'artifact.m4a');
    await writeFile(filePath, 'audio-content');
    return {
      artifact: {
        artifactId: 'artifact-1',
        directoryPath: root,
        fileName: 'artifact.m4a',
        filePath,
        sizeBytes: 13,
      },
      root,
      targetPath: path.join(root, 'saved.m4a'),
    };
  }

  it('copies the artifact and only returns the selected file name', async () => {
    const { artifact, targetPath } = await fixture();
    const result = await saveAgentMediaArtifactAs({
      artifact,
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

  it('replaces an existing file through the Windows-compatible backup path', async () => {
    const { artifact, targetPath } = await fixture();
    await writeFile(targetPath, 'old-content');
    let renameCount = 0;

    await expect(saveAgentMediaArtifactAs({
      artifact,
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
});
