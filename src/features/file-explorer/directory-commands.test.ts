import { describe, expect, it, vi } from 'vitest';
import { DIRECTORY_MENU_COMMANDS, directoryCommands, getDirectoryMenuCommands, isDirectoryMediaFile } from './directory-commands';

describe('directory command compatibility', () => {
  it('keeps root/file order and media availability declarative', () => {
    expect(getDirectoryMenuCommands('root.create', { location: 'root', isMediaFile: false }).map(item => item.title)).toEqual(['新建文件', '新建文件夹']);
    expect(getDirectoryMenuCommands('file.basic', { location: 'file', isMediaFile: false }).map(item => item.title)).toEqual(['重命名', '属性', '下载', '在浏览器打开']);
    expect(getDirectoryMenuCommands('file.basic', { location: 'file', isMediaFile: true }).at(-1)?.title).toBe('在媒体工具打开');
  });
  it('dispatches each stable identifier to the existing action exactly once', async () => {
    for (const item of Object.values(DIRECTORY_MENU_COMMANDS)) {
      const dispatchLegacyAction = vi.fn(async () => undefined);
      await directoryCommands.executeHost(item.id, undefined, { location: item.locations[0], isMediaFile: true, dispatchLegacyAction });
      expect(dispatchLegacyAction).toHaveBeenCalledTimes(1);
      expect(dispatchLegacyAction).toHaveBeenCalledWith(item.legacyAction);
    }
  });
  it('rejects invalid location and parameters without running a destructive action', () => {
    const dispatchLegacyAction = vi.fn(async () => undefined);
    expect(() => directoryCommands.executeHost('omniflow.node.delete', undefined, { location: 'root', isMediaFile: false, dispatchLegacyAction })).toThrow('disabled');
    expect(() => directoryCommands.executeHost('omniflow.node.delete', { nodeId: 999 }, { location: 'file', isMediaFile: false, dispatchLegacyAction })).toThrow('arguments');
    expect(dispatchLegacyAction).not.toHaveBeenCalled();
  });
  it('preserves existing MIME and extension based media-menu eligibility', () => {
    expect(isDirectoryMediaFile({ mimeType: 'video/mp4' })).toBe(true);
    expect(isDirectoryMediaFile({ data: { rawExt: '.MP3' } })).toBe(true);
    expect(isDirectoryMediaFile({ ext: 'txt' })).toBe(false);
  });
});
