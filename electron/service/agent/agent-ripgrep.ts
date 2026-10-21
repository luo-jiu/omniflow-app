import { spawn } from 'node:child_process';
import { AGENT_TEXT_MAX_BYTES } from './agent-text-reader';
import { resolveAgentRipgrepExecutable } from './agent-ripgrep-executable';

export class AgentGrepError extends Error {
  constructor(public readonly code: 'UNSUPPORTED_CAPABILITY' | 'INVALID_PATTERN' | 'SEARCH_BUDGET' | 'SEARCH_FAILED', message: string) {
    super(message);
    this.name = 'AgentGrepError';
  }
}

interface RipgrepOptions {
  signal: AbortSignal;
  regex: boolean;
  caseSensitive?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  executable?: string;
  spawnProcess?: typeof spawn;
}

/** Private adapter: searches verified UTF-8 snapshots through stdin, never model-supplied paths or flags. */
export async function runAgentRipgrep(input: string, pattern: string, options: RipgrepOptions): Promise<string> {
  options.signal.throwIfAborted();
  if (Buffer.byteLength(input) > AGENT_TEXT_MAX_BYTES + 1) throw new AgentGrepError('SEARCH_BUDGET', '搜索快照超过 8 MiB 预算');
  const executable = options.executable ?? (options.spawnProcess ? 'rg' : await resolveAgentRipgrepExecutable());
  if (!executable) throw new AgentGrepError('UNSUPPORTED_CAPABILITY', '随应用提供的 rg 资源缺失或不可执行；rust-regex-v1 不可用');
  const args = ['--json', '--no-config', '--color=never', '--line-number', '--no-heading', '--text',
    '--encoding=none', '--engine=default', '--no-multiline', options.caseSensitive === false ? '--ignore-case' : '--case-sensitive',
    ...(!options.regex ? ['--fixed-strings'] : []), '-e', pattern, '--', '-'];
  const outputLimit = options.maxOutputBytes ?? 16 * 1024 * 1024;
  return new Promise<string>((resolve, reject) => {
    const child = (options.spawnProcess ?? spawn)(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    let outputSize = 0, errorText = '', failure: Error | undefined, settled = false;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const abort = () => stop(options.signal.reason instanceof Error ? options.signal.reason : new Error('搜索已取消'));
    const timer = setTimeout(() => stop(new AgentGrepError('SEARCH_BUDGET', 'rg 搜索超时，结果不完整')), Math.max(1, options.timeoutMs ?? 5_000));
    const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); };
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error); else resolve(value!);
    };
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    child.stdout!.on('data', (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > outputLimit) stop(new AgentGrepError('SEARCH_BUDGET', 'rg 输出超过内部预算，结果不完整'));
      else output.push(chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => { if (errorText.length < 4_096) errorText += chunk.toString('utf8').slice(0, 4_096 - errorText.length); });
    child.stdin!.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') stop(error); });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(failure ?? (error.code === 'ENOENT'
        ? new AgentGrepError('UNSUPPORTED_CAPABILITY', '随应用提供的 rg 资源缺失；rust-regex-v1 不可用')
        : new AgentGrepError('SEARCH_FAILED', `无法启动 rg：${error.message}`)));
    });
    child.on('close', code => {
      if (failure) finish(failure);
      else if (code === 0 || code === 1) finish(undefined, Buffer.concat(output).toString('utf8'));
      else finish(new AgentGrepError(options.regex && errorText.includes('regex parse error') ? 'INVALID_PATTERN' : 'SEARCH_FAILED',
        `rg 搜索失败：${errorText.trim() || `exit ${code}`}`));
    });
    child.stdin!.end(input);
  });
}
