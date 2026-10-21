import crypto from 'node:crypto';
import path from 'node:path';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { normalizeAgentLocalPathExpression } from './tools/agent-local-file';
import { createAgentFileGlob } from './agent-file-glob';
import { enumerateAgentHostFiles, type AgentHostScanOptions } from './agent-host-file-scan';

interface HostQuery { path?: string; glob?: string; keyword?: string; nodeType?: string; limit?: number; cursor?: string; tagIds?: number[]; directoryId?: number; nodeId?: number }

export async function queryAgentHostFiles(kind: 'list' | 'search' | 'stat' | 'resolve', query: HostQuery, signal: AbortSignal, scanOptions: AgentHostScanOptions = {}) {
  if (!query.path || query.nodeId !== undefined || query.directoryId !== undefined || query.tagIds !== undefined) {
    throw new Error('本机查询需要明确 path，不接受资料库 ID 或标签');
  }
  const root = normalizeAgentLocalPathExpression(query.path).absolutePath;
  const match = createAgentFileGlob(query.glob);
  const describe = async (filePath: string) => {
    signal.throwIfAborted();
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('本机查询不跟随符号链接或特殊文件');
    return { path: filePath, name: path.basename(filePath) || filePath,
      type: stat.isDirectory() ? 'dir' : 'file', fileSize: stat.size, updatedAt: stat.mtime.toISOString() };
  };
  const rootNode = await describe(root);
  if (kind === 'stat' || kind === 'resolve') {
    if (query.nodeType && query.nodeType !== rootNode.type) throw new Error('路径类型与请求不匹配');
    return { scope: 'host', node: rootNode };
  }
  if (rootNode.type !== 'dir') throw new Error('查询路径不是目录');
  const entries: Awaited<ReturnType<typeof describe>>[] = [];
  let enumerationEngine = 'javascript-entries', examinedEntries = 0, filteredEntries = 0, metadataReads = 1;
  if (kind === 'search' && query.nodeType === 'file') {
    const candidates = await enumerateAgentHostFiles(root, signal, scanOptions);
    enumerationEngine = candidates.engine;
    examinedEntries = candidates.files.length;
    // Apply exactly the public Glob/keyword semantics before performing per-file metadata I/O.
    const selected = candidates.files.filter(file => match(path.relative(root, file).split(path.sep).join('/'))
      && (!query.keyword || path.basename(file).toLocaleLowerCase().includes(query.keyword.toLocaleLowerCase())));
    filteredEntries = examinedEntries - selected.length;
    const directories = new Map<string, Promise<void>>();
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(8, selected.length) }, async () => {
      for (;;) {
        const index = nextIndex++;
        if (index >= selected.length) return;
        signal.throwIfAborted();
        const file = selected[index];
        const directory = path.dirname(file);
        let checked = directories.get(directory);
        if (!checked) {
          checked = (async () => {
            if (await realpath(directory) !== path.join(candidates.canonicalRoot, path.relative(root, directory))) {
              throw new Error('本机搜索目录已变为符号链接，搜索不完整');
            }
          })();
          directories.set(directory, checked);
        }
        await checked;
        metadataReads += 1;
        const node = await describe(file);
        if (node.type !== 'file') throw new Error('本机搜索候选类型已变化，请重新搜索');
        entries.push(node);
      }
    }));
  } else {
  const queue = [root];
  let scanned = 0;
  for (let index = 0; index < queue.length; index += 1) {
    signal.throwIfAborted();
    const directory = await opendir(queue[index]);
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (++scanned > 5_000) throw new Error('本机目录超过 5000 项扫描上限，请缩小目录范围或使用 Shell 搜索');
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
      const node = await describe(path.join(queue[index], entry.name));
      metadataReads += 1;
      if (kind === 'search' && node.type === 'dir') queue.push(node.path);
      if (query.nodeType && node.type !== query.nodeType) continue;
      if (!match(path.relative(root, node.path).split(path.sep).join('/'))) continue;
      if (query.keyword && !node.name.toLocaleLowerCase().includes(query.keyword.toLocaleLowerCase())) continue;
      entries.push(node);
    }
  }
  examinedEntries = scanned;
  filteredEntries = scanned - entries.length;
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const revision = crypto.createHash('sha256').update(JSON.stringify({ kind, root, keyword: query.keyword,
    nodeType: query.nodeType, glob: query.glob, entries })).digest('hex');
  let start = 0;
  if (query.cursor) {
    let cursor: { revision: string; offset: number };
    try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()); }
    catch { throw new Error('本机分页游标无效'); }
    if (cursor.revision !== revision || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset >= entries.length) {
      throw new Error('目录内容或筛选条件已变化，请从第一页重新查询');
    }
    start = cursor.offset;
  }
  const limit = query.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit 必须在 1 到 100 之间');
  const selected = [];
  let size = 0;
  for (const node of entries.slice(start, start + limit)) {
    const bytes = Buffer.byteLength(JSON.stringify(node));
    if (size + bytes > 20_000) break;
    selected.push(node); size += bytes;
  }
  if (!selected.length && start < entries.length) throw new Error('单个目录条目超出输出上限');
  const next = start + selected.length;
  return { scope: 'host', directory: rootNode, entries: selected, hasMore: next < entries.length,
    examinedEntries, filteredEntries, enumerationEngine, metadataReads,
    ...(next < entries.length ? { nextCursor: Buffer.from(JSON.stringify({ revision, offset: next })).toString('base64url') } : {}) };
}
