import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLocalFilePreview } from './local-file-preview';

describe('local preview snapshot', () => {
  it('reads Unicode text without writing to the original and rejects directories, missing and oversized files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'of-preview-'));
    try {
      const file = path.join(root, 'hello world.md');
      await writeFile(file, '你好\npreview');
      const preview = await readLocalFilePreview(file);
      expect(preview.type).toBe('text');
      expect(Buffer.from(preview.dataUrl.split(',')[1], 'base64').toString()).toBe('你好\npreview');
      await expect(readLocalFilePreview(root)).rejects.toThrow('普通文件');
      await expect(readLocalFilePreview(path.join(root, 'missing.txt'))).rejects.toThrow();
      await truncate(file, 33 * 1024 * 1024);
      await expect(readLocalFilePreview(file)).rejects.toThrow('32 MiB');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
