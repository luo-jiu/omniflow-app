import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { resolveAgentComputerHelperPath, type AgentComputerWindowIdentity } from './desktop-computer';
import {
  AgentComputerWindowInputError, prepareAgentComputerWindowInputWindow, prepareAgentComputerWindowInputRequest,
  parseAgentComputerWindowInputFailure, parseAgentComputerWindowInputReceipt, pointerFeedback,
  type AgentComputerWindowInputRequest, type AgentComputerWindowInputReceipt, type AgentComputerWindowInputPointerEvent,
} from './window-input';

export interface AgentComputerWindowInputSessionLease {
  input(request: AgentComputerWindowInputRequest, signal: AbortSignal,
    onPointerEvent?: (event: AgentComputerWindowInputPointerEvent) => void): Promise<AgentComputerWindowInputReceipt>;
  /** Stops admission immediately. closed requires native termination and a clean focus receipt. */
  close(): void;
  dispose(): void;
  closed: Promise<boolean>;
}

export class AgentComputerWindowInputSessionCloseError extends AgentComputerWindowInputError {
  constructor() {
    super('后台输入会话关闭未确认，已暂停新输入会话；请重启应用后再操作', 'not-dispatched', 'not-required');
    this.name = 'AgentComputerWindowInputSessionCloseError';
  }
}

// A late exit cannot turn an already unknown shutdown into a new authorization.
let unconfirmedClose = false;
const closingSessions = new Set<Promise<boolean>>();
const ignoreTerminatedError = () => {};
const maximumFrameBytes = 4096;
const maximumRequestBytes = 72 * 1024;
const maximumInputCount = 256;

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid input session object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
    || !required.includes(key) && !optional.includes(key))) throw new Error('invalid input session fields');
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key as string];
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid input session property');
    return [key, descriptor.value];
  }));
}

function inputFailure(message: string, sent: boolean, releaseState: 'confirmed' | 'unconfirmed' | 'not-required' = sent ? 'unconfirmed' : 'not-required') {
  return new AgentComputerWindowInputError(message, sent ? 'unknown' : 'not-dispatched', releaseState);
}

/** Run/share-owned native input and protected focus state, without global input or a renderer entry point. */
export async function createAgentComputerWindowInputSession(input: AgentComputerWindowIdentity,
  startupSignal: AbortSignal): Promise<AgentComputerWindowInputSessionLease> {
  startupSignal.throwIfAborted();
  if (process.platform !== 'darwin') throw inputFailure('后台窗口输入目前仅支持 macOS', false);
  let target: AgentComputerWindowIdentity;
  try { target = prepareAgentComputerWindowInputWindow(input); }
  catch { throw inputFailure('窗口输入身份无效，请重新选择窗口', false); }
  if (closingSessions.size) await Promise.all([...closingSessions]);
  startupSignal.throwIfAborted();
  if (unconfirmedClose) throw new AgentComputerWindowInputSessionCloseError();
  let child: ReturnType<typeof spawn>;
  try { child = spawn(resolveAgentComputerHelperPath(), ['--window-input-session'], { shell: false,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: { ...process.env, OMNIFLOW_WINDOW_INPUT_POINTER_FD: '3' } }); }
  catch { throw inputFailure('后台输入组件不可用，请重新构建或安装 OmniFlow', false); }
  const stdin = child.stdin!; const stdout = child.stdout!; const stderr = child.stderr!;
  const progress = child.stdio?.[3];
  const emitters: EventEmitter[] = [child, stdin, stdout, stderr];
  let started = false; let readySeen = false; let stopping = false; let finished = false; let invalidOutput = false; let exited = false;
  let sequence = 0; let outputBytes = 0; let inputBytes = 0; let stderrBytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let buffer = Buffer.alloc(0); let closeId: string | undefined; let closeAcknowledged = false;
  let stoppedFocusState: 'inactive' | 'released' | 'unconfirmed' | undefined;
  let unconfirmedFocus = false;
  let focusEffectsObserved = false;
  let startupError: Error | undefined;
  let resolveStartup!: () => void; let rejectStartup!: (error: Error) => void;
  const startup = new Promise<void>((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
  let resolveClosed!: (confirmed: boolean) => void;
  const closed = new Promise<boolean>(resolve => { resolveClosed = resolve; });
  type Pending = {
    id: string; request: AgentComputerWindowInputRequest; sent: boolean; signal: AbortSignal; cancel: () => void;
    timer: ReturnType<typeof setTimeout>; resolve: (receipt: AgentComputerWindowInputReceipt) => void; reject: (error: Error) => void;
    cancellationResult?: AgentComputerWindowInputError;
    feedback?: ReturnType<typeof pointerFeedback>;
  };
  let pending: Pending | undefined;
  let feedbackActive = true; let feedbackBytes = 0; let feedbackBuffer = Buffer.alloc(0);
  let killTimer: ReturnType<typeof setTimeout> | undefined; let exitTimer: ReturnType<typeof setTimeout> | undefined;

  function settlePending(error?: Error, receipt?: AgentComputerWindowInputReceipt) {
    const selected = pending; if (!selected) return;
    selected.feedback?.stop();
    pending = undefined; clearTimeout(selected.timer); selected.signal.removeEventListener('abort', selected.cancel);
    if (error) selected.reject(error); else selected.resolve(receipt!);
  }
  function finish(terminated: boolean) {
    if (finished) return;
    const confirmed = terminated && !unconfirmedFocus
      && (!readySeen || !invalidOutput && (stoppedFocusState === 'inactive' || stoppedFocusState === 'released'));
    finished = true; stopping = true;
    stopPointerFeedback();
    if (!confirmed) unconfirmedClose = true;
    clearTimeout(startupTimer); clearTimeout(killTimer); clearTimeout(exitTimer);
    startupSignal.removeEventListener('abort', cancelStartup);
    rejectStartup(startupError ?? inputFailure('后台输入会话已结束', false));
    settlePending(pending?.cancellationResult ?? inputFailure('后台输入会话已结束；请重新观察，勿重复未知操作', Boolean(pending?.sent)));
    buffer = Buffer.alloc(0);
    stdout.removeListener('data', onData); stderr.removeListener('data', onStderr);
    progress?.removeListener('data', onPointerData);
    progress?.removeListener('error', stopPointerFeedback); progress?.removeListener('end', stopPointerFeedback);
    progress?.on('error', ignoreTerminatedError);
    child.removeListener('exit', onExit); child.removeListener('close', onClose);
    for (const emitter of emitters) {
      emitter.removeListener('error', onError); emitter.on('error', ignoreTerminatedError);
    }
    stdin.destroy(); stdout.destroy(); stderr.destroy(); progress?.destroy();
    resolveClosed(confirmed);
  }
  function write(value: unknown): boolean {
    const frame = `${JSON.stringify(value)}\n`;
    const bytes = Buffer.byteLength(frame);
    inputBytes += bytes;
    if (bytes > maximumRequestBytes || inputBytes > 20 * 1024 * 1024) return false;
    return stdin.write(frame);
  }
  function stop(message = '后台输入会话已关闭', gracefulCommand = true) {
    if (stopping || finished) return;
    stopping = true;
    pending?.feedback?.stop();
    startupError ??= inputFailure(message, false);
    clearTimeout(startupTimer); clearTimeout(pending?.timer);
    startupSignal.removeEventListener('abort', cancelStartup);
    // Keep the current request and its stdout parser alive for the paired-up receipt.
    closingSessions.add(closed);
    void closed.then(() => closingSessions.delete(closed));
    killTimer = setTimeout(() => {
      if (finished) return;
      try { child.kill('SIGKILL'); } catch { /* A kill request is not an exit acknowledgement. */ }
      if (!finished) { exitTimer = setTimeout(() => finish(false), 300); exitTimer.unref(); }
    }, 2000); killTimer.unref();
    if (started && !pending && gracefulCommand) {
      closeId = String(++sequence);
      try { write({ requestId: closeId, command: 'close' }); } catch { /* TERM still owns teardown. */ }
    }
    try { child.kill('SIGTERM'); } catch { /* Continue holding ownership through bounded KILL/exit wait. */ }
  }
  function fail(message: string) {
    invalidOutput = true;
    stop(message, false);
  }
  function stopPointerFeedback() {
    feedbackActive = false; feedbackBuffer = Buffer.alloc(0); pending?.feedback?.stop();
  }
  function onPointerData(chunk: Buffer) {
    // Keep draining fd3 through native exit. Bad, late or cancelled drawing
    // feedback must never stop stdout settlement or the runner's paired up.
    if (!feedbackActive) return;
    feedbackBytes += chunk.length;
    if (feedbackBytes > maximumInputCount * 16_384) { stopPointerFeedback(); return; }
    feedbackBuffer = Buffer.concat([feedbackBuffer, chunk]);
    try {
      let newline: number;
      while ((newline = feedbackBuffer.indexOf(10)) >= 0) {
        if (newline === 0 || newline > 256) throw new Error('invalid session pointer frame');
        const frame = feedbackBuffer.subarray(0, newline); feedbackBuffer = feedbackBuffer.subarray(newline + 1);
        const source = fields(JSON.parse(frame.toString('utf8')), ['requestId', 'phase', 'point', 'sequence']);
        if (typeof source.requestId !== 'string' || !/^[1-9][0-9]{0,8}$/u.test(source.requestId)
          || Number(source.requestId) > sequence) throw new Error('invalid session pointer request');
        const selected = pending;
        if (!selected || source.requestId !== selected.id || stopping || finished || selected.signal.aborted || selected.cancellationResult) continue;
        const { requestId: _requestId, ...event } = source;
        void _requestId;
        selected.feedback?.data(Buffer.from(`${JSON.stringify(event)}\n`));
      }
      if (feedbackBuffer.length > 256) stopPointerFeedback();
    } catch { stopPointerFeedback(); }
  }
  function onData(chunk: Buffer) {
    if (finished || invalidOutput) return;
    outputBytes += chunk.length;
    if (outputBytes > 1024 * 1024 || buffer.length + chunk.length > maximumFrameBytes * 2) {
      fail('后台输入组件输出超限'); return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    try {
      let newline: number;
      while ((newline = buffer.indexOf(10)) >= 0) {
        if (newline === 0 || newline > maximumFrameBytes) throw new Error('invalid frame length');
        const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
        const result: unknown = JSON.parse(decoder.decode(line));
        if (!readySeen) {
          if ((result as { ok?: unknown } | null)?.ok === false) {
            const refusal = parseAgentComputerWindowInputFailure(result);
            if (refusal.dispatched !== false) throw new Error('invalid startup refusal');
            startupError = inputFailure(`后台输入会话启动失败（${refusal.code}）`, false);
            stop(startupError.message, false); return;
          }
          const ready = fields(result, ['ok', 'type', 'protocol']);
          if (ready.ok !== true || ready.type !== 'ready' || ready.protocol !== 2) throw new Error('invalid ready');
          readySeen = true;
          // A ready after cancellation never revives the session or completes its constructor.
          if (stopping) continue;
          started = true; clearTimeout(startupTimer); startupSignal.removeEventListener('abort', cancelStartup);
          resolveStartup(); continue;
        }
        if ((result as { type?: unknown } | null)?.type === 'stopped') {
          const terminal = fields(result, ['ok', 'type', 'focusState']);
          if (stoppedFocusState !== undefined || terminal.ok !== true
            || !['inactive', 'released', 'unconfirmed'].includes(terminal.focusState as string)) throw new Error('invalid stopped receipt');
          if (terminal.focusState === 'inactive' && focusEffectsObserved) throw new Error('missing focus release receipt');
          stoppedFocusState = terminal.focusState as typeof stoppedFocusState;
          if (stoppedFocusState === 'unconfirmed') { unconfirmedFocus = true; unconfirmedClose = true; }
          stop('后台输入会话已停止', false);
          continue;
        }
        if (stoppedFocusState !== undefined) throw new Error('response after stopped receipt');
        const source = fields(result, ['requestId', 'ok'], ['dispatched', 'method', 'eventCount', 'releaseSent', 'error', 'type', 'focusPosted', 'focusState', 'completionWindowId']);
        if (typeof source.requestId !== 'string') throw new Error('invalid request id');
        if (closeId && source.requestId === closeId) {
          fields(source, ['requestId', 'ok', 'type']);
          if (!stopping || closeAcknowledged || source.ok !== true || source.type !== 'closed') throw new Error('invalid close acknowledgement');
          closeAcknowledged = true; continue;
        }
        const selected = pending;
        if (!selected || source.requestId !== selected.id || selected.cancellationResult) throw new Error('unmatched input response');
        if (typeof source.focusPosted !== 'boolean' || !['inactive', 'retained', 'released', 'unconfirmed'].includes(source.focusState as string)) {
          throw new Error('invalid focus receipt');
        }
        focusEffectsObserved ||= source.focusPosted || source.focusState !== 'inactive';
        if (source.focusState === 'unconfirmed') { unconfirmedFocus = true; unconfirmedClose = true; }
        const receipt = { ...source }; delete receipt.requestId; delete receipt.focusPosted; delete receipt.focusState;
        if (source.ok === false) {
          const failure = parseAgentComputerWindowInputFailure(receipt, selected.request);
          const affected = failure.dispatched !== false || source.focusPosted || unconfirmedFocus;
          const error = inputFailure(!affected ? '窗口输入在派发前拒绝，请重新观察窗口'
            : '窗口输入结果未知；请重新观察，勿重复操作', affected, failure.releaseState);
          if (stopping) selected.cancellationResult = error;
          else if (failure.releaseState === 'unconfirmed' || unconfirmedFocus) { selected.cancellationResult = error; stop(error.message, false); }
          else settlePending(error);
        } else {
          const parsed = parseAgentComputerWindowInputReceipt(receipt, selected.request);
          if (stopping || unconfirmedFocus) {
            selected.cancellationResult = inputFailure('窗口输入已取消；对应释放事件已发送，请重新观察，勿重复操作', true, 'confirmed');
            if (unconfirmedFocus) stop('后台输入的焦点释放未确认', false);
          }
          else settlePending(undefined, parsed);
        }
      }
      if (buffer.length > maximumFrameBytes) throw new Error('unterminated frame');
    } catch { fail('后台输入回执无效；请重新观察，勿重复未知操作'); }
  }
  function onStderr(chunk: Buffer) {
    stderrBytes += chunk.length;
    if (stderrBytes > 64 * 1024) fail('后台输入组件诊断输出超限');
  }
  function onError() { if (!finished) stop('后台输入组件或管道失败', false); }
  function onExit() {
    if (finished || exited) return;
    exited = true; stopping = true;
    pending?.feedback?.stop();
    clearTimeout(startupTimer); clearTimeout(killTimer); clearTimeout(exitTimer); clearTimeout(pending?.timer);
    // Node may report process exit before the final stdout data reaches main.
    // Preserve a bounded drain interval for the paired-release receipt.
    closingSessions.add(closed);
    void closed.then(() => closingSessions.delete(closed));
    exitTimer = setTimeout(() => finish(true), 300); exitTimer.unref();
  }
  function onClose() { finish(true); }
  const cancelStartup = () => stop('后台输入会话启动已取消', false);
  const startupTimer = setTimeout(() => stop('后台输入会话启动超时', false), 3000); startupTimer.unref();
  stdout.on('data', onData); stderr.on('data', onStderr);
  progress?.on('data', onPointerData);
  progress?.on('error', stopPointerFeedback); progress?.on('end', stopPointerFeedback);
  child.once('exit', onExit); child.once('close', onClose);
  for (const emitter of emitters) emitter.on('error', onError);
  startupSignal.addEventListener('abort', cancelStartup, { once: true });
  try { if (!write({ window: target })) stop('后台输入会话初始化管道阻塞', false); }
  catch { stop('后台输入会话初始化失败', false); }
  if (startupSignal.aborted) cancelStartup();
  try {
    await startup;
    if (stopping || finished) throw startupError ?? inputFailure('后台输入会话已结束', false);
  } catch (error) {
    stop('后台输入会话启动失败', false);
    if (!await closed) throw new AgentComputerWindowInputSessionCloseError();
    startupSignal.throwIfAborted();
    throw error;
  }

  return {
    close: stop, dispose: stop, closed,
    async input(input, signal, onPointerEvent) {
      signal.throwIfAborted();
      if (stopping || finished || pending || sequence >= maximumInputCount) {
        if (sequence >= maximumInputCount) stop('后台输入会话操作数量已达上限');
        throw inputFailure('后台输入会话已关闭、正忙或达到操作上限，请重新观察', false);
      }
      let request: AgentComputerWindowInputRequest;
      try {
        request = prepareAgentComputerWindowInputRequest(input);
        if (request.profile !== 'directed-v1' || JSON.stringify(request.window) !== JSON.stringify(target)) throw new Error('changed frozen window');
      } catch { throw inputFailure('窗口输入请求或冻结窗口不匹配，请重新观察', false); }
      return new Promise((resolve, reject) => {
        const id = String(++sequence);
        const cancel = () => stop('后台输入已取消', false);
        const timer = setTimeout(() => stop('后台输入超时，请重新观察，勿重复未知操作', false), request.operation === 'typeText' ? 15000 : 5000);
        timer.unref();
        const selected: Pending = { id, request, sent: false, signal, cancel, timer, resolve, reject };
        if (onPointerEvent && feedbackActive && ['click', 'rightClick', 'doubleClick', 'drag'].includes(request.operation)) {
          selected.feedback = pointerFeedback(request, event => {
            if (pending === selected && !stopping && !finished && !signal.aborted && !selected.cancellationResult) onPointerEvent(event);
          });
        }
        pending = selected;
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) { cancel(); return; }
        pending.sent = true;
        try { if (!write({ requestId: id, command: 'input', request })) stop('后台输入管道阻塞，请重新观察', false); }
        catch { stop('后台输入发送失败，请重新观察', false); }
      });
    },
  };
}
