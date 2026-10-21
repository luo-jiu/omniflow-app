import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AgentFileChangePrepareRequest } from '../../../src/shared/agent/agent-file-changes';
import { AGENT_FILE_TEXT_MAX_BYTES, normalizeAgentFileWriteInput } from '../../../src/shared/agent/agent-file-write';
import { normalizeAgentFilePatchInput } from '../../../src/shared/agent/agent-file-patch';
import { decodeAgentFileChangeSnapshot } from './agent-file-change-prepare';

type Snapshot = AgentFileChangePrepareRequest['snapshot'];
const hash = (text: string | Uint8Array) => crypto.createHash('sha256').update(text).digest('hex');
const b64 = (text: string | Uint8Array) => (typeof text === 'string' ? Buffer.from(text, 'utf8') : Buffer.from(text)).toString('base64');
const target = '/docs/a.txt';

function source(before: string | null, after: string): Snapshot {
  return { path: target, ...(before === null ? {} : { nodeId: 9 }), beforeBase64: before === null ? null : b64(before),
    afterBase64: b64(after), ...(before === null ? {} : { beforeRevision: hash(before) }), afterRevision: hash(after) };
}
function write(before: string | null, after: string) {
  return normalizeAgentFileWriteInput({ path: target, content: after, ...(before === null ? {} : { revision: hash(before) }) });
}
function patch(before: string, text = '@@ -1 +1 @@\n-old\n+new\n') {
  return normalizeAgentFilePatchInput({ path: target, revision: hash(before), patch: text });
}

describe('private file mutation snapshot validation', () => {
  it('distinguishes a newly created file from replacement of an existing empty file', () => {
    const created = decodeAgentFileChangeSnapshot(source(null, ''), write(null, ''));
    expect(created).toMatchObject({ scope: 'library', path: target, fileName: 'a.txt', beforeBytes: null, afterRevision: hash('') });
    expect(created).not.toHaveProperty('nodeId');
    const replaced = decodeAgentFileChangeSnapshot(source('', ''), write('', ''));
    expect(replaced).toMatchObject({ nodeId: 9, beforeRevision: hash('') });
    expect(replaced.beforeBytes).toEqual(Buffer.alloc(0));
  });
  it('returns exact private before/after bytes including BOM, Unicode and mixed newlines', () => {
    const before = '\uFEFFold\r\nlast';
    const after = '\uFEFF中文😀\nlast\r\n';
    const result = decodeAgentFileChangeSnapshot(source(before, after), write(before, after));
    expect(Buffer.from(result.beforeBytes!)).toEqual(Buffer.from(before));
    expect(Buffer.from(result.afterBytes)).toEqual(Buffer.from(after));
    expect(result.beforeRevision).toBe(hash(before));
    expect(result.afterRevision).toBe(hash(after));
  });
  it.each(['YQ', 'YQ===', 'YQ==\n', 'Y Q==', 'YQ__', '%%%%', 'YR==', 'YWJ='])('rejects noncanonical base64 %j', invalid => {
    const snapshot = source(null, 'a');
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot, afterBase64: invalid }, write(null, 'a'))).toThrow();
  });
  it('validates before encoding as well as after encoding and refuses missing bytes', () => {
    const snapshot = source('old', 'new');
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot, beforeBase64: 'b2xk\n' }, write('old', 'new'))).toThrow();
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot, beforeBase64: undefined } as unknown as Snapshot, write('old', 'new'))).toThrow();
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot, afterBase64: 12 } as unknown as Snapshot, write('old', 'new'))).toThrow();
  });
  it.each([
    Buffer.from([255]), Buffer.from('binary\0data'), Buffer.from('%PDF-1.7'),
  ])('rejects invalid UTF-8 / binary snapshots before any journal can accept them', bytes => {
    const snapshot = source(null, 'new');
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot, afterBase64: b64(bytes), afterRevision: hash(bytes) }, write(null, 'new'))).toThrow();
  });
  it('rejects a different path, host scope, malformed object, and injected private execution fields', () => {
    const snapshot = source('old', 'new');
    const input = write('old', 'new');
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot, path: '/docs/other.txt' }, input)).toThrow('目标');
    expect(() => decodeAgentFileChangeSnapshot(snapshot, { ...input, scope: 'host' })).toThrow('目标');
    for (const value of [null, [], { ...snapshot, operationId: 'forged' }, { ...snapshot, libraryId: 4 }]) {
      expect(() => decodeAgentFileChangeSnapshot(value as unknown as Snapshot, input)).toThrow();
    }
  });
  it('binds the original source revision and recomputes both declared byte hashes', () => {
    const snapshot = source('old', 'new');
    const input = write('old', 'new');
    for (const changed of [
      { ...snapshot, beforeRevision: 'a'.repeat(64) }, { ...snapshot, afterRevision: 'b'.repeat(64) },
      { ...snapshot, beforeBase64: b64('other'), beforeRevision: hash('other') },
      { ...snapshot, beforeRevision: undefined },
    ]) expect(() => decodeAgentFileChangeSnapshot(changed, input)).toThrow('版本');
    expect(() => decodeAgentFileChangeSnapshot(snapshot, write('stale', 'new'))).toThrow('版本');
  });
  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '9'])('requires a valid existing-file node identity: %j', nodeId => {
    const snapshot = { ...source('old', 'new'), nodeId } as unknown as Snapshot;
    expect(() => decodeAgentFileChangeSnapshot(snapshot, write('old', 'new'))).toThrow('节点');
  });
  it('does not accept create snapshots disguised as replace or a create node identity', () => {
    expect(() => decodeAgentFileChangeSnapshot({ ...source(null, 'new'), nodeId: 9 }, write(null, 'new'))).toThrow('节点');
    expect(() => decodeAgentFileChangeSnapshot(source(null, 'new'), write('old', 'new'))).toThrow('版本');
    expect(() => decodeAgentFileChangeSnapshot(source('old', 'new'), write(null, 'new'))).toThrow('版本');
  });
  it('rejects replacement body tampering even when the claimed after hash matches the tampered bytes', () => {
    expect(() => decodeAgentFileChangeSnapshot(source('old', 'tampered'), write('old', 'authorized'))).toThrow('内容');
    expect(() => decodeAgentFileChangeSnapshot(source(null, 'authorized\n'), write(null, 'authorized'))).toThrow('内容');
  });
  it('recomputes the exact strict patch result instead of trusting the renderer after body', () => {
    const input = patch('old\n');
    expect(Buffer.from(decodeAgentFileChangeSnapshot(source('old\n', 'new\n'), input).afterBytes).toString('utf8')).toBe('new\n');
    expect(() => decodeAgentFileChangeSnapshot(source('old\n', 'new\nextra\n'), input)).toThrow('内容');
    expect(() => decodeAgentFileChangeSnapshot(source('old\n', 'new\r\n'), input)).toThrow('内容');
    expect(() => decodeAgentFileChangeSnapshot(source('old\n', 'new\n'), patch('old\n', '@@ -1 +1 @@\n-mismatch\n+new\n'))).toThrow('上下文');
  });
  it('does not allow patching a null source or switching target via a patch header', () => {
    expect(() => decodeAgentFileChangeSnapshot(source(null, 'new\n'), patch('old\n'))).toThrow();
    const input = patch('old\n', '--- /docs/a.txt\n+++ /docs/other.txt\n@@ -1 +1 @@\n-old\n+new\n');
    expect(() => decodeAgentFileChangeSnapshot(source('old\n', 'new\n'), input)).toThrow('header');
  });
  it('rejects byte and encoded length overflow before accepting a source snapshot', () => {
    const oversized = Buffer.alloc(AGENT_FILE_TEXT_MAX_BYTES + 1, 65);
    const snapshot = source(null, 'new');
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot, afterBase64: b64(oversized), afterRevision: hash(oversized) }, write(null, 'new'))).toThrow('超限');
    expect(() => decodeAgentFileChangeSnapshot({ ...snapshot,
      afterBase64: 'A'.repeat(Math.ceil(AGENT_FILE_TEXT_MAX_BYTES / 3) * 4 + 4) }, write(null, 'new'))).toThrow('超限');
  });
  it('accepts a canonical snapshot at the 8 MiB text boundary without regex stack overflow', () => {
    const before = 'a\n'.repeat(AGENT_FILE_TEXT_MAX_BYTES / 2);
    const after = 'b\n' + before.slice(2);
    const input = patch(before, '@@ -1 +1 @@\n-a\n+b\n');
    const result = decodeAgentFileChangeSnapshot(source(before, after), input);
    expect(result.beforeBytes?.byteLength).toBe(AGENT_FILE_TEXT_MAX_BYTES);
    expect(result.afterBytes.byteLength).toBe(AGENT_FILE_TEXT_MAX_BYTES);
    expect(result.afterRevision).toBe(hash(after));
  });
});
