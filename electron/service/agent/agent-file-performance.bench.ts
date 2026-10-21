import { mkdtemp, mkdir, writeFile, opendir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, bench, describe, expect, vi } from 'vitest';
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
import { queryAgentHostFiles } from './agent-host-file-query';
import { createAgentFileGlob } from './agent-file-glob';
import { decodeAgentText } from './agent-text-reader';
import { createAgentLibraryTextReader } from './agent-library-text-reader';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import type { AgentFileAuthorityResultV1 } from '@/shared/agent/agent.types';

let root: string, cachedBytes: Uint8Array, uncachedBytes: Uint8Array;
const signal = new AbortController().signal;
const reader = createAgentLibraryTextReader();
const timing = { time: 500, warmupTime: 100, iterations: 5 };
// The former host file-search hot path: all directory entries get sequential lstat before filtering.
async function legacySearch() {
  await lstat(root);
  const match = createAgentFileGlob('*.txt');
  const queue = [root], found: string[] = [];
  for (let i = 0; i < queue.length; i += 1) {
    for await (const entry of await opendir(queue[i])) {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
      const file = path.join(queue[i], entry.name);
      const metadata = await lstat(file);
      if (metadata.isDirectory()) queue.push(file);
      else if (match(path.relative(root, file).split(path.sep).join('/'))) found.push(file);
    }
  }
  return found.sort();
}
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-file-benchmark-'));
  for (let i = 0; i < 100; i += 1) {
    const dir = path.join(root, `group-${i}`);
    await mkdir(dir);
    await Promise.all(Array.from({ length: 20 }, (_, j) => writeFile(path.join(dir, `other-${j}.md`), 'small fixture')));
    if (i % 10 === 0) await writeFile(path.join(dir, 'match.TXT'), 'needle');
  }
  const optimized = await queryAgentHostFiles('search', { path: root, nodeType: 'file', glob: '*.txt' }, signal);
  if (!('entries' in optimized)) throw new Error('expected directory results');
  expect(optimized.entries?.map(entry => entry.path)).toEqual(await legacySearch());
  console.info('host fixture', { files: 2010, directories: 100, baselineMetadataReads: 2111,
    filteredEntries: optimized.filteredEntries, optimizedMetadataReads: optimized.metadataReads, engine: optimized.enumerationEngine });
  const text = 'line 😀 mixed UTF-8 统计\r\n'.repeat(50_000);
  const node = { version: 1 as const, id: 7, libraryId: 3, parentId: 4, type: 'file' as const, name: 'benchmark.txt',
    fileSize: Buffer.byteLength(text), storageKey: 'fixture', storageProvider: 'local' };
  const input = { libraryId: 3, runId: 'benchmark', sessionId: 'benchmark', signal,
    operation: { operation: 'stage-library-node', nodeId: 7, includeDownloadUrl: true } } as AgentFileAuthorityBrokerRequestInput;
  const authorize = async (): Promise<AgentFileAuthorityResultV1> => ({ operation: 'stage-library-node', version: 1, node, downloadUrl: 'https://fixture.invalid/a' });
  decodeAgentText(await reader.read(input, authorize, async () => new Response(text, { headers: { etag: '"fixture"' } })));
  cachedBytes = await reader.read(input, authorize, async () => new Response(null, { status: 304, headers: { etag: '"fixture"' } }));
  uncachedBytes = Buffer.from(cachedBytes);
  expect(decodeAgentText(cachedBytes).lines).toHaveLength(50_000);
  console.info('decode fixture', { sourceBytes: cachedBytes.byteLength, lines: 50_000, retainedWeight: reader.retainedBytes() });
});
afterAll(async () => { reader.releaseRun('benchmark'); if (root) await rm(root, { recursive: true, force: true }); });

describe('host filename search: 2010 files, 100 directories, 10 matches', () => {
  bench('before: sequential metadata then Glob', async () => { await legacySearch(); }, timing);
  bench('after: native candidates, common Glob then bounded metadata', async () => {
    await queryAgentHostFiles('search', { path: root, nodeType: 'file', glob: '*.txt' }, signal);
  }, timing);
});
describe('library continuation CPU: verified bytes, 50000 mixed UTF-8/CRLF lines', () => {
  bench('before: hash + validate + decode + split every time', () => { decodeAgentText(uncachedBytes); }, timing);
  bench('after: hash + Run-owned decoded line reuse', () => { decodeAgentText(cachedBytes); }, timing);
});
