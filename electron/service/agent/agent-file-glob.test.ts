import { describe, expect, it } from 'vitest';
import { createAgentFileGlob } from './agent-file-glob';
import { decodeSearchCursor, encodeSearchCursor } from './agent-search-cursor';

describe('shared file glob', () => {
  it('matches basename or relative paths consistently, including Unicode and dotfiles', () => {
    expect(createAgentFileGlob('*.md')('文档/note.MD')).toBe(true);
    expect(createAgentFileGlob('*.md')('.hidden.md')).toBe(true);
    expect(createAgentFileGlob('docs/*.md')('docs/nested/a.md')).toBe(false);
    expect(createAgentFileGlob('docs/**/*.md')('docs/nested/a.md')).toBe(true);
    expect(createAgentFileGlob('docs/**/*.md')('docs/a.md')).toBe(true);
    expect(createAgentFileGlob('a?.[ch]')('ab.c')).toBe(true);
    expect(createAgentFileGlob('*.txt')('a.md')).toBe(false);
  });
  it('rejects paths and unimplemented syntax rather than changing glob meaning', () => {
    for (const pattern of ['/a', '../a', 'a/../b', '!a', '{a,b}', '@(a)', 'a\\b', '']) {
      expect(() => createAgentFileGlob(pattern)).toThrow('glob');
    }
  });
  it('binds opaque cursors to query and operation and rejects tampering', () => {
    const cursor = encodeSearchCursor('grep', 'scope', { line: 4 });
    expect(decodeSearchCursor(cursor, 'grep', 'scope')).toEqual({ line: 4 });
    expect(() => decodeSearchCursor(cursor, 'glob', 'scope')).toThrow('游标');
    expect(() => decodeSearchCursor(cursor, 'grep', 'other')).toThrow('游标');
    expect(() => decodeSearchCursor(`x${cursor}`, 'grep', 'scope')).toThrow('游标');
  });
});
