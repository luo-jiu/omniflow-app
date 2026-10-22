import { describe, expect, it } from 'vitest';
import {
  AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS, AGENT_FILE_PATCH_MAX_ARGUMENT_CHARACTERS,
  assertAgentFilePatchArgumentBudget, normalizeAgentFilePatchInput,
} from './agent-file-patch-input';

const revision = 'a'.repeat(64);
const context = { path: '/a.txt', format: 'context-v1', revision, patch: '@@\n-old\n+new\n' };

describe('file.patch input normalization', () => {
  it('requires an explicit context format and read revision and defaults only its EOF policy', () => {
    expect(normalizeAgentFilePatchInput(context)).toEqual({ ...context, scope: 'library', view: 'saved', finalNewline: 'preserve' });
    expect(normalizeAgentFilePatchInput({ ...context, finalNewline: 'ensure' })).toMatchObject({ finalNewline: 'ensure' });
    expect(() => normalizeAgentFilePatchInput({ ...context, revision: undefined })).toThrow('revision');
    expect(() => normalizeAgentFilePatchInput({ ...context, revision: undefined, expectedRevision: revision })).toThrow('revision');
    expect(() => normalizeAgentFilePatchInput({ ...context, expectedRevision: revision })).toThrow('expectedRevision');
    expect(() => normalizeAgentFilePatchInput({ ...context, finalNewline: null })).toThrow('finalNewline');
  });

  it('preserves legacy aliases and rejects contradictory revision or EOF instructions', () => {
    const legacy = { path: '/a.txt', expectedRevision: revision, patch: '@@ -1 +1 @@\n-old\n+new\n' };
    expect(normalizeAgentFilePatchInput(legacy)).toMatchObject({ format: 'unified-v1', revision });
    expect(normalizeAgentFilePatchInput(legacy)).not.toHaveProperty('expectedRevision');
    expect(() => normalizeAgentFilePatchInput({ ...legacy, revision })).toThrow('不能同时');
    expect(() => normalizeAgentFilePatchInput({ ...legacy, finalNewline: 'preserve' })).toThrow('unified-v1');
    expect(() => normalizeAgentFilePatchInput({ ...legacy, format: 'context-v2' })).toThrow('格式');
    expect(() => normalizeAgentFilePatchInput({ ...context, append: true })).toThrow('不支持');
  });

  it('applies the context body limit independently from the serialized argument budget', () => {
    const prefix = '@@\n-old\n+';
    const patch = prefix + 'x'.repeat(AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS - prefix.length);
    expect(normalizeAgentFilePatchInput({ ...context, patch }).patch).toBe(patch);
    expect(() => normalizeAgentFilePatchInput({ ...context, patch: patch + 'x' })).toThrow('32000');
    const escaped = prefix + '"'.repeat(AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS - prefix.length);
    expect(escaped.length).toBe(32_000);
    expect(() => normalizeAgentFilePatchInput({ ...context, patch: escaped })).toThrow('64000');
  });

  it('counts the complete original envelope, escaping and normalized fields without truncating', () => {
    const base = { scope: 'library', path: '/a.txt', view: 'saved', revision, format: 'unified-v1', patch: '' };
    const room = AGENT_FILE_PATCH_MAX_ARGUMENT_CHARACTERS - JSON.stringify(base).length;
    const boundary = { ...base, patch: 'x'.repeat(room) };
    expect(JSON.stringify(boundary)).toHaveLength(64_000);
    expect(normalizeAgentFilePatchInput(boundary).patch).toHaveLength(room);
    expect(() => normalizeAgentFilePatchInput({ ...boundary, patch: boundary.patch + 'x' })).toThrow('64000');
    // A later path resolver may remove basePath; the original transport envelope still counts.
    expect(() => assertAgentFilePatchArgumentBudget({ ...boundary, basePath: '/extra' })).toThrow('64000');
    const implicit = { path: '/a.txt', revision, patch: 'x'.repeat(room + 20) };
    expect(JSON.stringify(implicit).length).toBeLessThan(64_000);
    expect(() => normalizeAgentFilePatchInput(implicit)).toThrow('64000');
  });
});
