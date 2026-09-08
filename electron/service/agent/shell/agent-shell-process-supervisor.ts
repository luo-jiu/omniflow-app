import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { terminateDesktopProcessTree } from '../../../platform/processTree';
import type { AgentShellSupportedPlatform } from '../../../platform/shell/shell-provider.types';
import {
  isAgentShellExecutionLeaseGrant,
  type AgentShellExecutionLeaseGrant,
} from './agent-shell-execution-lease';
import {
  createAgentShellOutputProjectionCollector,
  type AgentShellProviderStreamOutputV1,
} from './agent-shell-output-projection';
import { createAgentShellCommandHash } from './agent-shell-prepared-action';

const DEFAULT_MAX_CONCURRENT_PROCESSES = 2;
const MAX_CONCURRENT_PROCESSES = 4;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_CAPTURED_OUTPUT_EVENTS = 4_096;
const OUTPUT_TAIL_COMPACT_OFFSET = 64;
const DEFAULT_TERMINATION_GRACE_MS = 1_500;
const MAX_TERMINATION_GRACE_MS = 30_000;
const DEFAULT_TERMINATION_SETTLE_MS = 5_000;
const MAX_TERMINATION_SETTLE_MS = 60_000;
const MAX_ARGUMENT_COUNT = 512;
const MAX_ARGUMENT_LENGTH = 64 * 1024;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH = 64 * 1024;
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export type AgentShellProcessState =
  | 'starting'
  | 'running'
  | 'terminating'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'interrupted';

export type AgentShellProcessTerminalState = Extract<
  AgentShellProcessState,
  'completed' | 'failed' | 'cancelled' | 'timed-out' | 'interrupted'
>;

export type AgentShellProcessTerminationReason = Extract<
  AgentShellProcessTerminalState,
  'cancelled' | 'timed-out' | 'interrupted'
>;

export interface AgentShellProcessStateEvent {
  readonly executionId: string;
  readonly kind: 'state';
  readonly state: AgentShellProcessState;
  readonly timestamp: number;
}

export interface AgentShellProcessOutputEvent {
  readonly byteLength: number;
  readonly executionId: string;
  readonly kind: 'output';
  readonly sequence: number;
  readonly stream: 'stderr' | 'stdout';
  readonly text: string;
  readonly timestamp: number;
}

export type AgentShellProcessEvent =
  | AgentShellProcessOutputEvent
  | AgentShellProcessStateEvent;

export interface AgentShellProcessResult {
  readonly durationMs: number;
  readonly errorMessage?: string;
  readonly executionId: string;
  readonly exitCode: number | null;
  readonly output: readonly AgentShellProcessOutputEvent[];
  readonly outputBytes: number;
  readonly droppedOutputBytes: number;
  readonly status: AgentShellProcessTerminalState;
  readonly stderr: string;
  readonly stdout: string;
  readonly terminationConfirmed: boolean;
  readonly terminationSignal: NodeJS.Signals | null;
}

export interface AgentShellProcessStartInput {
  readonly grant: AgentShellExecutionLeaseGrant;
  readonly onEvent?: (event: AgentShellProcessEvent) => void;
  readonly signal?: AbortSignal;
}

export interface AgentShellProcessHandle {
  readonly executionId: string;
  readonly promise: Promise<AgentShellProcessResult>;
}

export interface AgentShellProcessSpawnOptions {
  readonly cwd: string;
  readonly detached: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly stdio: ['ignore', 'pipe', 'pipe'];
  readonly windowsHide: boolean;
}

export interface AgentShellProcessSupervisorOptions {
  readonly createId?: () => string;
  readonly maxConcurrentProcesses?: number;
  readonly maxOutputBytes?: number;
  readonly now?: () => number;
  readonly platform?: AgentShellSupportedPlatform;
  readonly spawnProcess?: (
    executable: string,
    argv: readonly string[],
    options: AgentShellProcessSpawnOptions,
  ) => ChildProcess;
  readonly terminateProcessTree?: (
    child: ChildProcess,
    options: {
      readonly environment: NodeJS.ProcessEnv;
      readonly force: boolean;
      readonly platform: AgentShellSupportedPlatform;
    },
  ) => void;
  readonly terminationGraceMs?: number;
  readonly terminationSettleMs?: number;
}

interface TerminationRequest {
  readonly errorMessage?: string;
  readonly status: AgentShellProcessTerminalState;
  readonly confirmedStatus: AgentShellProcessTerminalState;
}

interface ActiveExecution {
  readonly executionId: string;
  readonly grant: AgentShellExecutionLeaseGrant;
  readonly onEvent?: (event: AgentShellProcessEvent) => void;
  readonly promise: Promise<AgentShellProcessResult>;
  readonly promiseResolve: (result: AgentShellProcessResult) => void;
  readonly startedAt: number;
  readonly signal?: AbortSignal;
  child: ChildProcess | null;
  state: AgentShellProcessState;
  terminationRequest: TerminationRequest | null;
  settled: boolean;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  forceTimer?: ReturnType<typeof setTimeout>;
  settleTimer?: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
  output: OutputCollector;
  closeHandler?: (...args: unknown[]) => void;
  errorHandler?: (...args: unknown[]) => void;
  stderrEndHandler?: () => void;
  stderrHandler?: (...args: unknown[]) => void;
  stdoutEndHandler?: () => void;
  stdoutHandler?: (...args: unknown[]) => void;
}

interface OutputCollector {
  readonly decoders: {
    readonly stderr: StringDecoder;
    readonly stdout: StringDecoder;
  };
  readonly events: {
    complete: AgentShellProcessOutputEvent[];
    head: AgentShellProcessOutputEvent[];
    tail: AgentShellProcessOutputEvent[];
    tailBytes: number;
    tailStart: number;
    totalBytes: number;
    truncated: boolean;
  };
  outputBytes: number;
  readonly projection: ReturnType<typeof createAgentShellOutputProjectionCollector>;
  sequence: number;
}

function invalidSupervisor(message: string): never {
  throw new Error(message);
}

function boundedInteger(
  input: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const value = input === undefined ? fallback : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    invalidSupervisor(`${label}无效`);
  }
  return value;
}

function platformPath(platform: AgentShellSupportedPlatform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

function validateGrant(
  grant: AgentShellExecutionLeaseGrant,
  platform: AgentShellSupportedPlatform,
): void {
  if (!isAgentShellExecutionLeaseGrant(grant)) {
    invalidSupervisor('Agent Shell Supervisor 只接受已消费的 execution lease grant');
  }
  const pathApi = platformPath(platform);
  if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= 0) {
    invalidSupervisor('Agent Shell execution grant 过期时间无效');
  }
  if (typeof grant.leaseId !== 'string' || !grant.leaseId || grant.leaseId.includes('\0')) {
    invalidSupervisor('Agent Shell execution grant lease ID 无效');
  }
  if (!Number.isSafeInteger(grant.timeoutMs) || grant.timeoutMs <= 0 || grant.timeoutMs > MAX_TIMEOUT_MS) {
    invalidSupervisor('Agent Shell execution grant timeout 无效');
  }
  if (!pathApi.isAbsolute(grant.cwdPath) || grant.cwdPath.includes('\0')) {
    invalidSupervisor('Agent Shell execution grant cwd 无效');
  }
  if (grant.executionContext === 'host') {
    if (!grant.host || grant.cwdPath !== grant.host.cwd.canonicalPath) {
      invalidSupervisor('Agent Shell execution grant host cwd identity 不匹配');
    }
  } else if (!grant.workspace || grant.cwdPath !== grant.workspace.physicalCwdPath) {
    invalidSupervisor('Agent Shell execution grant cwd identity 不匹配');
  }
  if (!pathApi.isAbsolute(grant.invocation.executable) || grant.invocation.executable.includes('\0')) {
    invalidSupervisor('Agent Shell execution grant executable 无效');
  }
  if (grant.invocation.executable !== grant.provider.resolvedExecutable) {
    invalidSupervisor('Agent Shell execution grant Provider executable 不匹配');
  }
  if (grant.invocation.shell !== false) {
    invalidSupervisor('Agent Shell execution grant 必须禁用 shell');
  }
  if (!Array.isArray(grant.invocation.argv) || grant.invocation.argv.length > MAX_ARGUMENT_COUNT) {
    invalidSupervisor('Agent Shell execution grant argv 无效');
  }
  grant.invocation.argv.forEach((argument) => {
    if (typeof argument !== 'string' || argument.length > MAX_ARGUMENT_LENGTH || argument.includes('\0')) {
      invalidSupervisor('Agent Shell execution grant argv 无效');
    }
  });
  if (
    !Array.isArray(grant.provider.fixedArgs)
    || grant.provider.fixedArgs.length > grant.invocation.argv.length
    || grant.provider.fixedArgs.some((argument, index) => grant.invocation.argv[index] !== argument)
  ) {
    invalidSupervisor('Agent Shell execution grant Provider fixed args 不匹配');
  }
  if (grant.commandHash !== createAgentShellCommandHash(grant.command)) {
    invalidSupervisor('Agent Shell execution grant command hash 无效');
  }
  if (!HASH_PATTERN.test(grant.provider.executableContentIdentity.sha256)) {
    invalidSupervisor('Agent Shell execution grant Provider identity 无效');
  }
  if (
    !Array.isArray(grant.environment)
    || grant.environment.length > MAX_ENVIRONMENT_ENTRIES
  ) {
    invalidSupervisor('Agent Shell execution grant environment 无效');
  }
  const environmentNames = new Set<string>();
  grant.environment.forEach((entry) => {
    if (
      !entry
      || typeof entry.name !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(entry.name)
      || typeof entry.value !== 'string'
      || entry.name.includes('\0')
      || entry.value.includes('\0')
      || entry.value.length > MAX_ENVIRONMENT_VALUE_LENGTH
      || environmentNames.has(entry.name)
    ) {
      invalidSupervisor('Agent Shell execution grant environment 无效');
    }
    environmentNames.add(entry.name);
  });
}

function createOutputCollector(maximumBytes: number): OutputCollector {
  return {
    decoders: {
      stderr: new StringDecoder('utf8'),
      stdout: new StringDecoder('utf8'),
    },
    events: {
      complete: [],
      head: [],
      tail: [],
      tailBytes: 0,
      tailStart: 0,
      totalBytes: 0,
      truncated: false,
    },
    outputBytes: 0,
    projection: createAgentShellOutputProjectionCollector(maximumBytes),
    sequence: 0,
  };
}

function textByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function takeUtf8Prefix(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0 || !value) return '';
  if (textByteLength(value) <= maximumBytes) return value;
  let result = '';
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = textByteLength(character);
    if (usedBytes + characterBytes > maximumBytes) break;
    result += character;
    usedBytes += characterBytes;
  }
  return result;
}

function takeUtf8Suffix(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0 || !value) return '';
  if (textByteLength(value) <= maximumBytes) return value;
  const characters = [...value];
  const result: string[] = [];
  let usedBytes = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    const characterBytes = textByteLength(character);
    if (usedBytes + characterBytes > maximumBytes) break;
    result.push(character);
    usedBytes += characterBytes;
  }
  return result.reverse().join('');
}

function sliceOutputEvent(
  event: AgentShellProcessOutputEvent,
  maximumBytes: number,
  edge: 'prefix' | 'suffix',
): AgentShellProcessOutputEvent | null {
  const text = edge === 'prefix'
    ? takeUtf8Prefix(event.text, maximumBytes)
    : takeUtf8Suffix(event.text, maximumBytes);
  if (!text) return null;
  return Object.freeze({
    ...event,
    byteLength: textByteLength(text),
    text,
  });
}

function takeOutputEventPrefix(
  events: readonly AgentShellProcessOutputEvent[],
  maximumBytes: number,
  maximumEvents: number,
): AgentShellProcessOutputEvent[] {
  const result: AgentShellProcessOutputEvent[] = [];
  let remaining = maximumBytes;
  for (const event of events) {
    if (remaining <= 0 || result.length >= maximumEvents) break;
    const sliced = sliceOutputEvent(event, remaining, 'prefix');
    if (!sliced) continue;
    result.push(sliced);
    remaining -= textByteLength(sliced.text);
  }
  return result;
}

function takeOutputEventSuffix(
  events: readonly AgentShellProcessOutputEvent[],
  maximumBytes: number,
  maximumEvents: number,
): AgentShellProcessOutputEvent[] {
  const result: AgentShellProcessOutputEvent[] = [];
  let remaining = maximumBytes;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (remaining <= 0 || result.length >= maximumEvents) break;
    const sliced = sliceOutputEvent(events[index], remaining, 'suffix');
    if (!sliced) continue;
    result.push(sliced);
    remaining -= textByteLength(sliced.text);
  }
  return result.reverse();
}

function compactOutputEventTail(output: OutputCollector): void {
  const { events } = output;
  if (
    events.tailStart < OUTPUT_TAIL_COMPACT_OFFSET
    || events.tailStart * 2 < events.tail.length
  ) {
    return;
  }
  events.tail = events.tail.slice(events.tailStart);
  events.tailStart = 0;
}

function captureOutputEvent(
  output: OutputCollector,
  event: AgentShellProcessOutputEvent,
  maximumBytes: number,
): void {
  const eventBytes = textByteLength(event.text);
  if (eventBytes === 0) return;
  output.events.totalBytes += eventBytes;
  if (
    !output.events.truncated
    && output.events.totalBytes <= maximumBytes
    && output.events.complete.length < MAX_CAPTURED_OUTPUT_EVENTS
  ) {
    output.events.complete.push(event);
    return;
  }

  const headBytes = Math.ceil(maximumBytes / 2);
  const tailBytes = Math.floor(maximumBytes / 2);
  const headEvents = Math.ceil(MAX_CAPTURED_OUTPUT_EVENTS / 2);
  const tailEvents = Math.floor(MAX_CAPTURED_OUTPUT_EVENTS / 2);
  if (!output.events.truncated) {
    const source = [...output.events.complete, event];
    output.events.complete = [];
    output.events.head = takeOutputEventPrefix(source, headBytes, headEvents);
    output.events.tail = takeOutputEventSuffix(source, tailBytes, tailEvents);
    output.events.tailBytes = output.events.tail.reduce(
      (total, item) => total + textByteLength(item.text),
      0,
    );
    output.events.tailStart = 0;
    output.events.truncated = true;
    return;
  }
  output.events.tail.push(event);
  output.events.tailBytes += eventBytes;
  while (
    output.events.tailBytes > tailBytes
    || output.events.tail.length - output.events.tailStart > tailEvents
  ) {
    const first = output.events.tail[output.events.tailStart];
    if (!first) break;
    const firstBytes = textByteLength(first.text);
    const excessBytes = output.events.tailBytes - tailBytes;
    if (
      output.events.tail.length - output.events.tailStart > tailEvents
      || firstBytes <= excessBytes
    ) {
      output.events.tailStart += 1;
      output.events.tailBytes -= firstBytes;
      continue;
    }
    const retained = sliceOutputEvent(first, firstBytes - excessBytes, 'suffix');
    if (!retained) {
      output.events.tailStart += 1;
      output.events.tailBytes -= firstBytes;
      continue;
    }
    output.events.tail[output.events.tailStart] = retained;
    output.events.tailBytes -= firstBytes - textByteLength(retained.text);
  }
  compactOutputEventTail(output);
}

function capturedOutputEvents(output: OutputCollector): readonly AgentShellProcessOutputEvent[] {
  return output.events.truncated
    ? Object.freeze([
      ...output.events.head,
      ...output.events.tail.slice(output.events.tailStart),
    ])
    : Object.freeze([...output.events.complete]);
}

function formattedCapturedStream(output: AgentShellProviderStreamOutputV1): string {
  if (!output.truncated) return output.head;
  return `${output.head}\n[... ${output.omittedBytes} bytes omitted ...]\n${output.tail}`;
}

function createEnvironment(
  entries: readonly { name: string; value: string }[],
): NodeJS.ProcessEnv {
  const environment = Object.create(null) as NodeJS.ProcessEnv;
  entries.forEach(entry => {
    environment[entry.name] = entry.value;
  });
  return environment;
}

export function createAgentShellProcessSupervisor(
  options: AgentShellProcessSupervisorOptions = {},
) {
  const platform = options.platform || getCurrentSupportedPlatform();
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error(`Agent Shell Supervisor 不支持平台：${platform}`);
  }
  const createId = options.createId || (() => cryptoRandomId());
  const now = options.now || Date.now;
  const maxConcurrentProcesses = boundedInteger(
    options.maxConcurrentProcesses,
    DEFAULT_MAX_CONCURRENT_PROCESSES,
    MAX_CONCURRENT_PROCESSES,
    'Agent Shell Supervisor 并发上限',
  );
  const maxOutputBytes = boundedInteger(
    options.maxOutputBytes,
    DEFAULT_MAX_OUTPUT_BYTES,
    MAX_OUTPUT_BYTES,
    'Agent Shell Supervisor 输出捕获上限',
  );
  const terminationGraceMs = boundedInteger(
    options.terminationGraceMs,
    DEFAULT_TERMINATION_GRACE_MS,
    MAX_TERMINATION_GRACE_MS,
    'Agent Shell Supervisor termination grace',
  );
  const terminationSettleMs = boundedInteger(
    options.terminationSettleMs,
    DEFAULT_TERMINATION_SETTLE_MS,
    MAX_TERMINATION_SETTLE_MS,
    'Agent Shell Supervisor termination settle',
  );
  const spawnProcess = options.spawnProcess || ((executable, argv, spawnOptions) => spawn(
    executable,
    [...argv],
    spawnOptions,
  ));
  const terminateProcessTree = options.terminateProcessTree || ((child, terminationOptions) => {
    terminateDesktopProcessTree(child, terminationOptions);
  });
  const activeExecutions = new Map<string, ActiveExecution>();
  const usedLeaseIds = new Map<string, number>();

  function removeExpiredUsedLeases(currentTime = now()): void {
    for (const [leaseId, expiresAt] of usedLeaseIds) {
      if (expiresAt <= currentTime) usedLeaseIds.delete(leaseId);
    }
  }

  function emit(record: ActiveExecution, event: AgentShellProcessEvent): void {
    try {
      record.onEvent?.(event);
    } catch {
      // Observers cannot change process execution semantics.
    }
  }

  function setState(record: ActiveExecution, state: AgentShellProcessState): void {
    if (record.state === state) return;
    record.state = state;
    emit(record, Object.freeze({
      executionId: record.executionId,
      kind: 'state',
      state,
      timestamp: now(),
    }));
  }

  function clearTimers(record: ActiveExecution): void {
    if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
    if (record.forceTimer) clearTimeout(record.forceTimer);
    if (record.settleTimer) clearTimeout(record.settleTimer);
    record.timeoutTimer = undefined;
    record.forceTimer = undefined;
    record.settleTimer = undefined;
  }

  function appendOutput(
    record: ActiveExecution,
    stream: 'stderr' | 'stdout',
    chunk: Buffer | string,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    record.output.outputBytes += buffer.byteLength;
    const text = record.output.decoders[stream].write(buffer);
    const event = Object.freeze({
      byteLength: buffer.byteLength,
      executionId: record.executionId,
      kind: 'output' as const,
      sequence: record.output.sequence,
      stream,
      text,
      timestamp: now(),
    });
    record.output.sequence += 1;
    record.output.projection.append([event]);
    captureOutputEvent(record.output, event, maxOutputBytes);
    emit(record, event);
  }

  function flushOutput(record: ActiveExecution, stream: 'stderr' | 'stdout'): void {
    const text = record.output.decoders[stream].end();
    if (!text) return;
    const event = Object.freeze({
      byteLength: 0,
      executionId: record.executionId,
      kind: 'output' as const,
      sequence: record.output.sequence,
      stream,
      text,
      timestamp: now(),
    });
    record.output.sequence += 1;
    record.output.projection.append([event]);
    captureOutputEvent(record.output, event, maxOutputBytes);
    emit(record, event);
  }

  function cleanupChildListeners(record: ActiveExecution): void {
    const child = record.child;
    if (!child) return;
    if (record.stdoutHandler) child.stdout?.removeListener('data', record.stdoutHandler);
    if (record.stderrHandler) child.stderr?.removeListener('data', record.stderrHandler);
    if (record.stdoutEndHandler) child.stdout?.removeListener('end', record.stdoutEndHandler);
    if (record.stderrEndHandler) child.stderr?.removeListener('end', record.stderrEndHandler);
    if (record.errorHandler) child.removeListener('error', record.errorHandler);
    if (record.closeHandler) child.removeListener('close', record.closeHandler);
  }

  function finish(
    record: ActiveExecution,
    status: AgentShellProcessTerminalState,
    exitCode: number | null,
    terminationSignal: NodeJS.Signals | null,
    terminationConfirmed: boolean,
    errorMessage?: string,
  ): void {
    if (record.settled) return;
    record.settled = true;
    clearTimers(record);
    if (record.signal && record.abortHandler) {
      record.signal.removeEventListener('abort', record.abortHandler);
    }
    cleanupChildListeners(record);
    flushOutput(record, 'stdout');
    flushOutput(record, 'stderr');
    setState(record, status);
    activeExecutions.delete(record.executionId);
    const outputProjection = record.output.projection.snapshot();
    const outputEvents = capturedOutputEvents(record.output);
    const retainedEventBytes = outputEvents.reduce(
      (total, event) => total + textByteLength(event.text),
      0,
    );
    const droppedOutputBytes = Math.max(
      outputProjection.stdout.omittedBytes + outputProjection.stderr.omittedBytes,
      Math.max(0, record.output.outputBytes - maxOutputBytes),
      Math.max(0, record.output.events.totalBytes - retainedEventBytes),
    );
    const result: AgentShellProcessResult = Object.freeze({
      ...(errorMessage ? { errorMessage } : {}),
      durationMs: Math.max(0, now() - record.startedAt),
      executionId: record.executionId,
      exitCode,
      output: outputEvents,
      outputBytes: record.output.outputBytes,
      droppedOutputBytes,
      status,
      stderr: formattedCapturedStream(outputProjection.stderr),
      stdout: formattedCapturedStream(outputProjection.stdout),
      terminationConfirmed,
      terminationSignal,
    });
    record.promiseResolve(result);
  }

  function beginTermination(record: ActiveExecution, request: TerminationRequest): void {
    if (record.settled) return;
    if (record.terminationRequest) return;
    record.terminationRequest = request;
    if (!record.child) return;
    setState(record, 'terminating');
    const child = record.child;
    const terminateChild = (force: boolean): void => {
      try {
        terminateProcessTree(child, {
          environment: createEnvironment(record.grant.environment),
          force,
          platform,
        });
      } catch {
        child.kill(force ? 'SIGKILL' : 'SIGTERM');
      }
    };
    terminateChild(false);
    record.forceTimer = setTimeout(() => {
      terminateChild(true);
    }, terminationGraceMs);
    record.forceTimer.unref?.();
    record.settleTimer = setTimeout(() => {
      const fallback = record.terminationRequest;
      if (!fallback || record.settled) return;
      finish(
        record,
        'interrupted',
        null,
        null,
        false,
        fallback.errorMessage || 'Agent Shell 进程终止未确认',
      );
    }, terminationSettleMs);
    record.settleTimer.unref?.();
  }

  function requestTermination(
    record: ActiveExecution,
    status: AgentShellProcessTerminalState,
    errorMessage?: string,
  ): void {
    beginTermination(record, {
      ...(errorMessage ? { errorMessage } : {}),
      confirmedStatus: status,
      status,
    });
  }

  function terminate(
    executionId: string,
    status: AgentShellProcessTerminationReason,
  ): boolean {
    const record = activeExecutions.get(executionId);
    if (!record || record.settled) return false;
    requestTermination(record, status, status === 'timed-out'
      ? `Agent Shell 进程执行超时（${record.grant.timeoutMs}ms）`
      : undefined);
    return true;
  }

  function start(input: AgentShellProcessStartInput): AgentShellProcessHandle {
    validateGrant(input?.grant, platform);
    removeExpiredUsedLeases();
    if (input.grant.expiresAt <= now()) {
      invalidSupervisor('Agent Shell execution grant 已过期');
    }
    if (activeExecutions.size >= maxConcurrentProcesses) {
      invalidSupervisor(`Agent Shell Supervisor 并发数已达到上限：${maxConcurrentProcesses}`);
    }
    if (usedLeaseIds.has(input.grant.leaseId)) {
      invalidSupervisor('Agent Shell execution grant 已经启动过，不能重复 spawn');
    }
    const executionId = String(createId() || '').trim();
    if (!executionId || executionId.includes('\0') || executionId.length > 200) {
      invalidSupervisor('Agent Shell Supervisor execution ID 无效');
    }
    if (activeExecutions.has(executionId)) {
      invalidSupervisor('Agent Shell Supervisor execution ID 冲突');
    }
    usedLeaseIds.set(input.grant.leaseId, input.grant.expiresAt);
    let promiseResolve!: (result: AgentShellProcessResult) => void;
    const promise = new Promise<AgentShellProcessResult>(resolve => {
      promiseResolve = resolve;
    });
    const record = {
      abortHandler: undefined,
      child: null,
      closeHandler: undefined,
      errorHandler: undefined,
      executionId,
      grant: input.grant,
      onEvent: input.onEvent,
      output: createOutputCollector(maxOutputBytes),
      promise,
      promiseResolve,
      settled: false,
      signal: input.signal,
      startedAt: now(),
      state: 'starting' as const,
      stderrHandler: undefined,
      stdoutHandler: undefined,
      terminationRequest: null,
    } as ActiveExecution;
    activeExecutions.set(executionId, record);
    emit(record, Object.freeze({
      executionId,
      kind: 'state',
      state: 'starting',
      timestamp: now(),
    }));

    const execute = async () => {
      record.abortHandler = () => requestTermination(record, 'cancelled');
      input.signal?.addEventListener('abort', record.abortHandler, { once: true });
      record.timeoutTimer = setTimeout(() => requestTermination(
        record,
        'timed-out',
        `Agent Shell 进程执行超时（${record.grant.timeoutMs}ms）`,
      ), record.grant.timeoutMs);
      record.timeoutTimer.unref?.();
      try {
        if (input.signal?.aborted) requestTermination(record, 'cancelled');
        if (record.terminationRequest) {
          finish(record, record.terminationRequest.status, null, null, true, record.terminationRequest.errorMessage);
          return;
        }
        record.child = spawnProcess(
          record.grant.invocation.executable,
          record.grant.invocation.argv,
          {
            cwd: record.grant.cwdPath,
            detached: platform !== 'win32',
            env: createEnvironment(record.grant.environment),
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: platform === 'win32',
          },
        );
      } catch (error) {
        finish(record, 'failed', null, null, true, error instanceof Error ? error.message : String(error));
        return;
      }
      record.stdoutHandler = chunk => appendOutput(record, 'stdout', chunk as Buffer | string);
      record.stderrHandler = chunk => appendOutput(record, 'stderr', chunk as Buffer | string);
      record.stdoutEndHandler = () => flushOutput(record, 'stdout');
      record.stderrEndHandler = () => flushOutput(record, 'stderr');
      record.errorHandler = error => {
        if (record.terminationRequest) return;
        finish(record, 'failed', null, null, true, error instanceof Error ? error.message : String(error));
      };
      record.closeHandler = (exitCode: unknown, signal: unknown) => {
        const normalizedSignal = typeof signal === 'string' ? signal as NodeJS.Signals : null;
        if (record.terminationRequest) {
          const request = record.terminationRequest;
          finish(record, request.confirmedStatus, typeof exitCode === 'number' ? exitCode : null, normalizedSignal, true, request.errorMessage);
          return;
        }
        const normalizedExitCode = typeof exitCode === 'number' ? exitCode : null;
        const status: AgentShellProcessTerminalState = normalizedExitCode === 0 && !normalizedSignal
          ? 'completed'
          : 'failed';
        finish(record, status, normalizedExitCode, normalizedSignal, true);
      };
      record.child.stdout?.on('data', record.stdoutHandler);
      record.child.stderr?.on('data', record.stderrHandler);
      record.child.stdout?.once('end', record.stdoutEndHandler);
      record.child.stderr?.once('end', record.stderrEndHandler);
      record.child.once('error', record.errorHandler);
      record.child.once('close', record.closeHandler);
      setState(record, 'running');
      if (record.terminationRequest) beginTermination(record, record.terminationRequest);
    };
    void execute();
    return Object.freeze({ executionId, promise });
  }

  function run(input: AgentShellProcessStartInput): Promise<AgentShellProcessResult> {
    return start(input).promise;
  }

  async function interruptAll(): Promise<void> {
    const handles = [...activeExecutions.values()].map(record => {
      requestTermination(record, 'interrupted', 'Agent Shell 进程因宿主中断');
      return record.promise;
    });
    await Promise.all(handles);
  }

  return Object.freeze({
    cancel: (executionId: string) => terminate(executionId, 'cancelled'),
    getActiveCount: () => activeExecutions.size,
    getState: (executionId: string) => activeExecutions.get(executionId)?.state,
    interrupt: (executionId: string) => terminate(executionId, 'interrupted'),
    interruptAll,
    run,
    start,
  });
}

function cryptoRandomId(): string {
  return crypto.randomUUID();
}

function getCurrentSupportedPlatform(): AgentShellSupportedPlatform {
  if (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32') {
    return process.platform;
  }
  throw new Error(`Agent Shell Supervisor 不支持平台：${process.platform}`);
}

export type AgentShellProcessSupervisor = ReturnType<typeof createAgentShellProcessSupervisor>;
