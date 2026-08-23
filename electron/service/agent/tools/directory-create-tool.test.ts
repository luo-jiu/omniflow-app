import { describe, expect, it } from 'vitest';

import { assessAgentToolPermission } from '../agent-permission-gate';
import { directoryCreateTool, normalizeAgentDirectoryName } from './directory-create-tool';

function context() {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'win32' as const,
      selectedNodeIds: [],
    },
    onProgress: () => undefined,
    signal: new AbortController().signal,
  };
}

describe('directory.create Agent tool', () => {
  it('binds a validated name to the perceived current directory', async () => {
    const executionContext = context();
    await expect(assessAgentToolPermission(
      directoryCreateTool,
      { name: ' 测试 ' },
      executionContext,
    )).resolves.toMatchObject({
      behavior: 'ask',
      preview: { description: '将在“视频”中创建文件夹“测试”。' },
    });
    expect(directoryCreateTool.createRendererRequest?.(
      { name: ' 测试 ' },
      executionContext,
    )).toEqual({
      conflictPolicy: 'error',
      libraryId: 3,
      name: '测试',
      parentId: 10,
    });
  });

  it('rejects paths and names that are unsafe on Windows', () => {
    expect(() => normalizeAgentDirectoryName({ name: '../outside' })).toThrow('无效字符');
    expect(() => normalizeAgentDirectoryName({ name: 'CON' })).toThrow('Windows');
    expect(() => normalizeAgentDirectoryName({ name: 'ending.' })).toThrow('Windows');
  });

  it('denies creation when no current directory is available', async () => {
    await expect(assessAgentToolPermission(
      directoryCreateTool,
      { name: '测试' },
      {
        ...context(),
        appContext: {
          libraryId: 3,
          platform: 'darwin',
          selectedNodeIds: [],
        },
      },
    )).resolves.toMatchObject({ behavior: 'deny' });
  });
});
