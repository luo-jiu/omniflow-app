import { describe, expect, it } from 'vitest';
import { applyAgentFilePatch, normalizeAgentFilePatchInput } from './agent-file-patch';
import { normalizeAgentFileWriteInput } from './agent-file-write';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const apply = (before: string, patch: string) => applyAgentFilePatch(encode(before), patch, '/docs/a.txt');

describe('shared saved file mutation contract', () => {
  it('keeps the old write create/replace inputs and accepts explicit revision aliases', () => {
    expect(normalizeAgentFileWriteInput({ path: '/docs/a.txt', content: '' }))
      .toMatchObject({ scope: 'library', mode: 'create', view: 'saved' });
    expect(normalizeAgentFileWriteInput({ path: '~/a.txt', content: 'new', scope: 'host', mode: 'replace', expectedRevision: 'a'.repeat(64) }))
      .toMatchObject({ scope: 'host', mode: 'replace', revision: 'a'.repeat(64) });
  });
  it.each([
    { mode: 'replace' }, { mode: 'create', revision: 'a'.repeat(64) },
    { expectedRevision: 'bad' }, { revision: 'a'.repeat(64), expectedRevision: 'a'.repeat(64) }, { view: 'working' },
  ])('rejects contradictory write/version inputs: %j', extra => {
    expect(() => normalizeAgentFileWriteInput({ path: '/docs/a.txt', content: 'new', ...extra })).toThrow();
  });
  it('requires a patch version and rejects unknown/private execution fields', () => {
    const base = { path: '/docs/a.txt', patch: '@@ -1 +1 @@\n-old\n+new\n' };
    expect(() => normalizeAgentFilePatchInput(base)).toThrow();
    expect(() => normalizeAgentFilePatchInput({ ...base, revision: 'a'.repeat(64), operationId: 'forged' })).toThrow();
    expect(normalizeAgentFilePatchInput({ ...base, expectedRevision: 'a'.repeat(64) }))
      .toMatchObject({ scope: 'library', format: 'unified-v1', view: 'saved', revision: 'a'.repeat(64) });
  });
});

describe('strict single-file patch engine', () => {
  it('preserves BOM, untouched mixed newlines and Unicode exactly', () => {
    const before = '\uFEFFalpha\r\nbeta\nomega\rlast';
    const result = apply(before, '@@ -2 +2 @@\n-beta\n+中文😀\n');
    expect(decode(result.bytes)).toBe('\uFEFFalpha\r\n中文😀\nomega\rlast');
    expect(result).toMatchObject({ additions: 1, deletions: 1, hunks: 1 });
  });
  it('applies multiple exact hunks with updated new-file line numbers', () => {
    const result = apply('a\nb\nc\n', '@@ -1 +1,2 @@\n a\n+x\n@@ -3 +4 @@\n-c\n+z\n');
    expect(decode(result.bytes)).toBe('a\nx\nb\nz\n');
  });
  it('supports insertion into empty files and deletion of the final line', () => {
    expect(decode(apply('', '@@ -0,0 +1 @@\n+first\n').bytes)).toBe('first\n');
    expect(decode(apply('a\nb\n', '@@ -2 +1,0 @@\n-b\n').bytes)).toBe('a\n');
  });
  it('requires and honors exact no-final-newline markers', () => {
    const marker = '\\ No newline at end of file';
    expect(() => apply('old', '@@ -1 +1 @@\n-old\n+new\n')).toThrow();
    expect(decode(apply('old', `@@ -1 +1 @@\n-old\n${marker}\n+new\n${marker}\n`).bytes)).toBe('new');
    expect(decode(apply('old', `@@ -1 +1 @@\n-old\n${marker}\n+new\n`).bytes)).toBe('new\n');
  });
  it('uses local CRLF for inserted lines and accepts CRLF patch transport', () => {
    expect(decode(apply('a\r\nb\r\n', '@@ -1 +1,2 @@\r\n a\r\n+x\r\n').bytes)).toBe('a\r\nx\r\nb\r\n');
  });
  it('accepts only headers that identify the structured target', () => {
    expect(decode(apply('old\n', '--- a/docs/a.txt\n+++ b/docs/a.txt\n@@ -1 +1 @@\n-old\n+new\n').bytes)).toBe('new\n');
    expect(() => apply('old\n', '--- /docs/a.txt\n+++ /other.txt\n@@ -1 +1 @@\n-old\n+new\n')).toThrow();
  });
  it.each([
    '@@ -1 +1 @@\n-OLD\n+new\n',
    '@@ -2 +1 @@\n-old\n+new\n',
    '@@ -1 +2 @@\n-old\n+new\n',
    '@@ -1,2 +1 @@\n-old\n+new\n',
    '@@ -1 +1 @@\n old\n',
    '@@ -1 +1 @@\n-old\n+new\n--- /other.txt\n+++ /other.txt\n',
    '*** Begin Patch\n*** Delete File: /docs/a.txt\n*** End Patch',
  ])('rejects invalid/ambiguous/fuzzy/multiple-file patch %j before returning bytes', patch => {
    expect(() => apply('old\n', patch)).toThrow();
  });
  it('rejects invalid UTF-8 and binary source data', () => {
    for (const bytes of [new Uint8Array([255]), encode('a\0b'), encode('%PDF-1.0')]) {
      expect(() => applyAgentFilePatch(bytes, '@@ -1 +1 @@\n-a\n+b\n', '/docs/a.txt')).toThrow();
    }
  });
  it('patches a large number of untouched lines without retaining a per-line source document', () => {
    const prefix = '\n'.repeat(250_000);
    const result = apply(prefix + 'old\n', '@@ -250001 +250001 @@\n-old\n+new\n');
    expect(decode(result.bytes)).toBe(prefix + 'new\n');
  });
});
