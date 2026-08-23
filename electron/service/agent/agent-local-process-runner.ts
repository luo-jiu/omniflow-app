import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { terminateDesktopProcessTree } from '../../platform/processTree';

const DEFAULT_MAX_CONCURRENT_PROCESSES = 2;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_ARGUMENT_COUNT = 512;
const MAX_ARGUMENT_LENGTH = 64 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const TERMINATION_GRACE_MS = 1_500;
const TERMINATION_SETTLE_MS = 5_000;

const SAFE_ENVIRONMENT_KEYS = [
  'APPDATA',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
] as const;

export interface AgentLocalProcessOutput {
  stream: 'stderr' | 'stdout';
  text: string;
}

export interface AgentLocalProcessRequest {
  args: string[];
  cwd?: string;
  executablePath: string;
  maxOutputBytes?: number;
  onOutput?: (output: AgentLocalProcessOutput) => void;
  signal: AbortSignal;
  timeoutMs?: number;
}

export interface AgentLocalProcessResult {
  durationMs: number;
  exitCode: number | null;
  stderr: string;
  stdout: string;
  terminationSignal: NodeJS.Signals | null;
}

interface AgentLocalProcessRunnerOptions {
  maxConcurrentProcesses?: number;
}

function abortError(message = 'Agent 本地进程已取消'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function normalizeRequest(input: AgentLocalProcessRequest): Required<Pick<
  AgentLocalProcessRequest,
  'args' | 'executablePath' | 'maxOutputBytes' | 'signal' | 'timeoutMs'
>> & Pick<AgentLocalProcessRequest, 'cwd' | 'onOutput'> {
  const executablePath = String(input?.executablePath || '').trim();
  if (!path.isAbsolute(executablePath) || executablePath.includes('\0')) {
    throw new Error('Agent 本地进程必须使用绝对可执行文件路径');
  }
  if (!Array.isArray(input?.args) || input.args.length > MAX_ARGUMENT_COUNT) {
    throw new Error(`Agent 本地进程参数数量不能超过 ${MAX_ARGUMENT_COUNT}`);
  }
  const args = input.args.map((value) => {
    if (typeof value !== 'string' || value.length > MAX_ARGUMENT_LENGTH || value.includes('\0')) {
      throw new Error('Agent 本地进程参数无效');
    }
    return value;
  });
  const cwd = input.cwd === undefined ? undefined : String(input.cwd).trim();
  if (cwd && (!path.isAbsolute(cwd) || cwd.includes('\0'))) {
    throw new Error('Agent 本地进程工作目录必须使用绝对路径');
  }
  if (!input.signal || typeof input.signal.aborted !== 'boolean') {
    throw new Error('Agent 本地进程缺少取消信号');
  }
  const timeoutMs = Math.max(1, Math.min(
    Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  ));
  const maxOutputBytes = Math.max(1, Math.min(
    Number(input.maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES,
    MAX_OUTPUT_BYTES,
  ));
  return {
    args,
    ...(cwd ? { cwd } : {}),
    executablePath,
    maxOutputBytes,
    ...(input.onOutput ? { onOutput: input.onOutput } : {}),
    signal: input.signal,
    timeoutMs,
  };
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const environment = SAFE_ENVIRONMENT_KEYS.reduce<Record<string, string>>((result, key) => {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
    return result;
  }, {});
  return environment as NodeJS.ProcessEnv;
}

function terminateProcessTree(child: ChildProcess, force: boolean): void {
  terminateDesktopProcessTree(child, {
    environment: safeEnvironment(),
    force,
  });
}

export function createAgentLocalProcessRunner(
  options: AgentLocalProcessRunnerOptions = {},
) {
  const maxConcurrentProcesses = Math.max(
    1,
    Math.min(
      Math.floor(Number(options.maxConcurrentProcesses) || DEFAULT_MAX_CONCURRENT_PROCESSES),
      4,
    ),
  );
  let activeProcessCount = 0;

  async function run(input: AgentLocalProcessRequest): Promise<AgentLocalProcessResult> {
    const request = normalizeRequest(input);
    if (request.signal.aborted) throw abortError();
    if (activeProcessCount >= maxConcurrentProcesses) {
      throw new Error(`Agent 本地进程并发数已达到上限：${maxConcurrentProcesses}`);
    }
    activeProcessCount += 1;
    const startedAt = Date.now();

    try {
      return await new Promise<AgentLocalProcessResult>((resolve, reject) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let terminationError: Error | null = null;
        let settled = false;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        let settleTimer: ReturnType<typeof setTimeout> | undefined;
        let child: ChildProcess | null = null;

        const cleanup = () => {
          clearTimeout(timeoutTimer);
          if (forceTimer) clearTimeout(forceTimer);
          if (settleTimer) clearTimeout(settleTimer);
          request.signal.removeEventListener('abort', handleAbort);
          child?.stdout?.removeAllListeners();
          child?.stderr?.removeAllListeners();
          child?.removeAllListeners();
        };
        const finish = (handler: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          handler();
        };
        const terminate = (error: Error) => {
          if (terminationError) return;
          terminationError = error;
          if (!child) {
            finish(() => reject(error));
            return;
          }
          const runningChild = child;
          terminateProcessTree(runningChild, false);
          forceTimer = setTimeout(
            () => terminateProcessTree(runningChild, true),
            TERMINATION_GRACE_MS,
          );
          forceTimer.unref?.();
          settleTimer = setTimeout(() => finish(() => reject(error)), TERMINATION_SETTLE_MS);
          settleTimer.unref?.();
        };
        const handleAbort = () => terminate(abortError());
        const timeoutTimer = setTimeout(() => {
          terminate(new Error(`Agent 本地进程执行超时（${request.timeoutMs}ms）`));
        }, request.timeoutMs);
        timeoutTimer.unref?.();

        try {
          child = spawn(request.executablePath, request.args, {
            ...(request.cwd ? { cwd: request.cwd } : {}),
            detached: process.platform !== 'win32',
            env: safeEnvironment(),
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });
        } catch (error) {
          finish(() => reject(error));
          return;
        }

        const collect = (stream: 'stderr' | 'stdout', chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          outputBytes += buffer.byteLength;
          if (outputBytes > request.maxOutputBytes) {
            terminate(new Error(`Agent 本地进程输出超过 ${request.maxOutputBytes} 字节上限`));
            return;
          }
          (stream === 'stdout' ? stdout : stderr).push(buffer);
          try {
            request.onOutput?.({ stream, text: buffer.toString('utf8') });
          } catch {
            // Progress observers cannot change process execution semantics.
          }
        };
        child.stdout?.on('data', chunk => collect('stdout', chunk));
        child.stderr?.on('data', chunk => collect('stderr', chunk));
        child.once('error', error => finish(() => reject(error)));
        child.once('close', (exitCode, signal) => {
          if (terminationError) {
            finish(() => reject(terminationError));
            return;
          }
          finish(() => resolve({
            durationMs: Date.now() - startedAt,
            exitCode,
            stderr: Buffer.concat(stderr).toString('utf8'),
            stdout: Buffer.concat(stdout).toString('utf8'),
            terminationSignal: signal,
          }));
        });
        if (request.signal.aborted) handleAbort();
        else request.signal.addEventListener('abort', handleAbort, { once: true });
      });
    } finally {
      activeProcessCount -= 1;
    }
  }

  return { run };
}

export const agentLocalProcessRunner = createAgentLocalProcessRunner();
