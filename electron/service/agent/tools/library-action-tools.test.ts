import { describe, expect, it } from 'vitest';
import { libraryActionTools } from './library-action-tools';
import { directoryCreateTool } from './directory-create-tool';
import { createAgentToolRegistry } from '../agent-tool-registry';
import { normalizeAgentLibraryAction } from '../../../../src/shared/agent/agent-library-actions';

describe('internal action schemas', () => {
  const registry = createAgentToolRegistry([...libraryActionTools, directoryCreateTool]);
  it('accepts matching path/ID requests and rejects mixed source identities', () => {
    expect(registry.validateInput('file.move', { path: '/docs/a.txt', parentId: 20 }).ok).toBe(true);
    expect(registry.validateInput('file.rename', { nodeId: 9, name: 'next.md' }).ok).toBe(true);
    expect(registry.validateInput('file.move', { nodeId: 9, path: '/a', parentId: 20 }).ok).toBe(false);
    expect(registry.validateInput('file.copy', { nodeId: 9, parentId: 20, conflictPolicy: 'replace' }).ok).toBe(false);
    expect(registry.validateInput('recycle.restore', { path: '/a' }).ok).toBe(false);
  });
  it('normalizes directory paths and rejects roots, path traversal and duplicate parent selectors', () => {
    expect(normalizeAgentLibraryAction('directory.create', { path: '/docs/new' })).toMatchObject({ name: 'new', parentPath: '/docs' });
    for (const input of [{ path: '/' }, { path: '/docs/../a' }, { name: 'new', parentId: 9, parentPath: '/docs' }, { name: 'CON' }]) {
      expect(() => normalizeAgentLibraryAction('directory.create', input)).toThrow();
    }
  });
});
