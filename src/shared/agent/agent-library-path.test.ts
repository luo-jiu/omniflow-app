import { describe, expect, it } from 'vitest';

import {
  AGENT_LIBRARY_DIRECTORY_PATH_MAX_BYTES,
  normalizeAgentLibraryDirectoryPath,
  splitAgentLibraryDirectoryPath,
} from './agent-library-path';

describe('Agent library directory path', () => {
  it('normalizes an absolute Unicode path and preserves exact segments', () => {
    expect(normalizeAgentLibraryDirectoryPath('  /文档/提示词  ')).toBe('/文档/提示词');
    expect(splitAgentLibraryDirectoryPath('/文档/提示词')).toEqual(['文档', '提示词']);
    expect(Object.isFrozen(splitAgentLibraryDirectoryPath('/文档/提示词'))).toBe(true);
  });

  it('represents the current library root as an empty traversal', () => {
    expect(normalizeAgentLibraryDirectoryPath('/')).toBe('/');
    expect(splitAgentLibraryDirectoryPath('/')).toEqual([]);
  });

  it.each([
    undefined,
    '',
    '文档/提示词',
    'C:\\文档\\提示词',
    '/文档\\提示词',
    '/文档//提示词',
    '/文档/./提示词',
    '/文档/../提示词',
    '/文档/提示词/',
    `/文档/${String.fromCharCode(1)}提示词`,
  ])('rejects an invalid or traversing path: %s', (input) => {
    expect(() => normalizeAgentLibraryDirectoryPath(input)).toThrow('资料库目录路径无效');
  });

  it('enforces UTF-8 path and segment byte budgets', () => {
    expect(normalizeAgentLibraryDirectoryPath(`/${'a'.repeat(512)}`))
      .toHaveLength(513);
    expect(() => normalizeAgentLibraryDirectoryPath(`/${'a'.repeat(513)}`))
      .toThrow('资料库目录路径无效');
    expect(() => normalizeAgentLibraryDirectoryPath(
      `/${'a'.repeat(512)}/${'b'.repeat(512)}/${'c'.repeat(512)}/${'d'.repeat(512)}`,
    )).toThrow('资料库目录路径无效');
    expect(AGENT_LIBRARY_DIRECTORY_PATH_MAX_BYTES).toBe(2_048);
  });
});
