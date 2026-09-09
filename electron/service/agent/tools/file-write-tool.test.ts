import { describe, expect, it } from 'vitest';
import { fileWriteTool } from './file-write-tool';
import { normalizeAgentFileWriteInput } from '../../../../src/shared/agent/agent-file-write';
import { resolveAgentRunPermissionDecision } from '../agent-permission-gate';
import type { AgentToolExecutionContext } from '../agent-tool-registry';

describe('file.write contract', () => {
  it('permits ordinary writes in full access and retains standard-mode confirmation', async () => {
    const context = { appContext: { libraryId: 3 } } as AgentToolExecutionContext;
    for (const revision of [undefined, 'a'.repeat(64)]) {
      const input = { path: '/docs/a.cpp', content: 'text', ...(revision ? { revision } : {}) };
      const decision = await fileWriteTool.assess!(input, context);
      expect(resolveAgentRunPermissionDecision('file.write', decision, 'full-access').behavior).toBe('allow');
      expect(resolveAgentRunPermissionDecision('file.write', decision, undefined).behavior).toBe('ask');
    }
  });
  it('rejects host writes, invalid revisions and invalid names', () => {
    expect(() => normalizeAgentFileWriteInput({ path: '/a.txt', content: '', scope: 'host' })).toThrow();
    expect(() => normalizeAgentFileWriteInput({ path: '/', content: '' })).toThrow();
    expect(() => normalizeAgentFileWriteInput({ path: '/CON.txt', content: '' })).toThrow();
    expect(() => normalizeAgentFileWriteInput({ path: '/a.txt', content: '', revision: 'guess' })).toThrow();
    expect(() => normalizeAgentFileWriteInput({ path: '/a.txt', content: 'binary\0data' })).toThrow();
    expect(() => normalizeAgentFileWriteInput({ path: `/${'文'.repeat(90)}.txt`, content: '' })).toThrow();
  });
});
