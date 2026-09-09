import { describe, expect, it, vi } from 'vitest';
import {
  resolveTextFileDialogFilters,
  saveTextContentToDesktop,
} from './text-viewer-local-save';

describe('text viewer local save', () => {
  it('uses the current extension as the first system dialog filter', () => {
    expect(resolveTextFileDialogFilters('notes.md')).toEqual([
      { name: 'MD 文件', extensions: ['md'] },
      { name: '所有文件', extensions: ['*'] },
    ]);
  });

  it('writes the current editor content after the user selects a path', async () => {
    const bridge = {
      saveDownloadFile: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: '/tmp/notes.md',
      }),
      writeTextFile: vi.fn().mockResolvedValue('/tmp/notes.md'),
    };

    await expect(saveTextContentToDesktop(bridge, 'notes.md', '# current')).resolves.toBe('/tmp/notes.md');
    expect(bridge.writeTextFile).toHaveBeenCalledWith('/tmp/notes.md', '# current');
  });

  it('does not write when the system dialog is canceled', async () => {
    const bridge = {
      saveDownloadFile: vi.fn().mockResolvedValue({ canceled: true, filePath: '' }),
      writeTextFile: vi.fn(),
    };

    await expect(saveTextContentToDesktop(bridge, 'notes.md', '# current')).resolves.toBeNull();
    expect(bridge.writeTextFile).not.toHaveBeenCalled();
  });
});
