import { spawn } from 'node:child_process';
import path from 'node:path';
import { opendir, lstat, realpath } from 'node:fs/promises';
import { AgentGrepError } from './agent-ripgrep';
import { resolveAgentRipgrepExecutable } from './agent-ripgrep-executable';

const MAX_FILES = 5_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
let activeScans = 0;

export interface AgentHostScanOptions {
  engine?: 'auto' | 'javascript' | 'ripgrep';
  executable?: string;
  spawnProcess?: typeof spawn;
  timeoutMs?: number;
}

/** Files only. Public Globs are deliberately evaluated by the common matcher after enumeration. */
export async function enumerateAgentHostFiles(root: string, signal: AbortSignal, options: AgentHostScanOptions = {}) {
  signal.throwIfAborted();
  const anchor = await lstat(root);
  if (!anchor.isDirectory() || anchor.isSymbolicLink()) throw new Error('本机搜索根目录无效');
  const canonicalRoot = await realpath(root);
  let files: string[], engine: 'ripgrep-files' | 'javascript-files' = 'ripgrep-files';
  try {
    if (options.engine === 'javascript') throw new AgentGrepError('UNSUPPORTED_CAPABILITY', '使用兼容目录枚举器');
    files = await nativeFiles(root, signal, options);
  } catch (error) {
    if (!(error instanceof AgentGrepError) || error.code !== 'UNSUPPORTED_CAPABILITY' || options.engine === 'ripgrep') throw error;
    engine = 'javascript-files';
    files = await javascriptFiles(root, canonicalRoot, signal);
  }
  signal.throwIfAborted();
  const fresh = await lstat(root);
  if (!fresh.isDirectory() || fresh.isSymbolicLink() || fresh.dev !== anchor.dev || fresh.ino !== anchor.ino
    || await realpath(root) !== canonicalRoot) throw new Error('本机搜索根目录已变化');
  const unique = new Set<string>();
  for (const file of files) {
    const relative = path.relative(root, file);
    if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..' || unique.has(file)) {
      throw new Error('本机枚举结果不在目录内或存在重复，搜索不完整');
    }
    unique.add(file);
  }
  return { files, engine, canonicalRoot };
}

async function javascriptFiles(root: string, canonicalRoot: string, signal: AbortSignal) {
  const files: string[] = [], queue = [root];
  let scannedEntries = 0;
  for (let i = 0; i < queue.length; i += 1) {
    signal.throwIfAborted();
    const directoryPath = queue[i];
    const metadata = await lstat(directoryPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()
      || await realpath(directoryPath) !== path.join(canonicalRoot, path.relative(root, directoryPath))) {
      throw new Error('本机目录在枚举期间已变化');
    }
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (++scannedEntries > 50_000) throw new Error('本机目录超过 50000 项枚举预算，请缩小搜索范围');
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) queue.push(file);
      else if (entry.isFile()) {
        if (files.length >= MAX_FILES) throw new Error('本机目录超过 5000 个文件候选，请缩小搜索范围');
        files.push(file);
      }
    }
  }
  return files;
}

async function nativeFiles(root: string, signal: AbortSignal, options: AgentHostScanOptions): Promise<string[]> {
  const executable = options.executable ?? (options.spawnProcess ? 'rg' : await resolveAgentRipgrepExecutable());
  if (!executable) throw new AgentGrepError('UNSUPPORTED_CAPABILITY', '随应用提供的原生目录枚举器缺失或不可执行');
  signal.throwIfAborted();
  if (activeScans >= 4) return Promise.reject(new AgentGrepError('SEARCH_BUDGET', '目录枚举并发已达上限，请稍后重试'));
  activeScans += 1;
  const args = ['--files', '--hidden', '--no-ignore', '--no-follow', '--null', '--no-config', '--color=never', '--', root];
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = (options.spawnProcess ?? spawn)(executable, args,
        { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      activeScans -= 1;
      reject(new AgentGrepError('SEARCH_FAILED', '无法创建原生目录枚举进程'));
      return;
    }
    let size = 0, count = 0, failure: Error | undefined, settled = false;
    const chunks: Buffer[] = [];
    const stop = (error: Error) => { failure ??= error; child.kill('SIGKILL'); };
    const abort = () => stop(signal.reason instanceof Error ? signal.reason : new Error('目录枚举已取消'));
    const timer = setTimeout(() => stop(new AgentGrepError('SEARCH_BUDGET', '目录枚举超时，搜索不完整')), options.timeoutMs ?? 5_000);
    const finish = (error?: Error, files?: string[]) => {
      if (settled) return;
      settled = true; activeScans -= 1; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(files!);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout!.on('data', (chunk: Buffer) => {
      size += chunk.length;
      for (const byte of chunk) if (byte === 0) count += 1;
      if (count > MAX_FILES || size > MAX_OUTPUT_BYTES) stop(new AgentGrepError('SEARCH_BUDGET', '本机目录超过 5000 个文件候选或路径输出预算，请缩小搜索范围'));
      else chunks.push(chunk);
    });
    child.stderr!.resume();
    child.on('error', (error: NodeJS.ErrnoException) => finish(failure ?? new AgentGrepError(
      error.code === 'ENOENT' ? 'UNSUPPORTED_CAPABILITY' : 'SEARCH_FAILED', '无法启动原生目录枚举器')));
    child.on('close', code => {
      if (failure) return finish(failure);
      if (code !== 0 && code !== 1) return finish(new AgentGrepError('SEARCH_FAILED', '原生目录枚举失败，搜索不完整'));
      try {
        const output = Buffer.concat(chunks);
        if (output.length && output.at(-1) !== 0) throw new Error('原生目录枚举输出不完整');
        const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(output);
        finish(undefined, decoded ? decoded.slice(0, -1).split('\0') : []);
      } catch { finish(new AgentGrepError('SEARCH_FAILED', '原生目录枚举路径无效或输出不完整')); }
    });
  });
}
