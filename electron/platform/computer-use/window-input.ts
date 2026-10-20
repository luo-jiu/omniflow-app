import { spawn } from 'node:child_process';
import { normalizeWindowInputOperations, normalizeWindowInputShortcut, WINDOW_INPUT_OPERATIONS,
  WINDOW_INPUT_DRAG_MIN_DURATION_MS, WINDOW_INPUT_DRAG_MAX_DURATION_MS, normalizeWindowInputScrollDelta,
  type WindowInputOperation, type WindowInputShortcut, type WindowInputPoint } from '../../../src/shared/computer-use/window-input-contract';
import { AgentComputerInputError, resolveAgentComputerHelperPath,
  type AgentComputerWindowIdentity } from './desktop-computer';
import { validateComputerText } from '../../../src/shared/computer-use/computer-use-contract';

export interface AgentComputerWindowInputStatus {
  ready: boolean;
  profile?: string;
  /** Main/native-only receiver identity; never expose it as an observation field. */
  focusToken?: string;
  operations: WindowInputOperation[];
  reason?: string;
}

export interface AgentComputerWindowInputRequest {
  window: AgentComputerWindowIdentity;
  profile: string;
  operation: WindowInputOperation;
  shortcut?: WindowInputShortcut;
  /** Global screen points, including negative origins on additional displays. */
  point?: WindowInputPoint;
  endPoint?: WindowInputPoint;
  durationMs?: number;
  text?: string;
  focusToken?: string;
  deltaX?: number;
  deltaY?: number;
  /** Main-only association for a newly opened right-click overlay; never an input receiver. */
  completionWindow?: AgentComputerWindowIdentity;
}

export interface AgentComputerWindowInputReceipt {
  dispatched: true;
  method: 'CGEventPostToPid';
  eventCount: number;
  /** Confirms the matching up was posted, not that the application consumed it. */
  releaseSent: true;
  /** Observed focus handoff only; runtime must verify the trusted overlay promotion. */
  completionWindowId?: number;
}

/** Reports a native post returning, never application consumption or a planned point. */
export interface AgentComputerWindowInputPointerEvent {
  phase: 'down' | 'move' | 'up';
  point: WindowInputPoint;
  sequence: number;
}

export class AgentComputerWindowInputError extends AgentComputerInputError {
  constructor(message: string, dispatchState: 'not-dispatched' | 'unknown',
    readonly releaseState: 'confirmed' | 'unconfirmed' | 'not-required') {
    super(message, dispatchState);
    this.name = 'AgentComputerWindowInputError';
  }
}

// The native helper must prove the exact application and OS receiver gate again
// before dispatch; this only validates its frozen protocol identifier.
const profiles = new Set(['appkit-fixture-v1', 'textedit-415-25f84-v1', 'directed-v1']);
const refusalReasons = new Set([
  'unsupported_receiver', 'target_changed', 'accessibility_denied', 'target_frontmost', 'foreground_unknown',
  'focused_window_mismatch', 'focused_element_mismatch', 'user_input_active', 'transient_ui_active', 'cancelled', 'receiver_changed',
]);

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
    || ![...required, ...optional].includes(key))) throw new Error('invalid fields');
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key as string];
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid property');
    return [key, descriptor.value];
  }));
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('invalid integer');
  return value;
}

function boundedString(value: unknown, maximumBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || Buffer.byteLength(value, 'utf8') > maximumBytes
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
    || [...value].some(character => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    })) throw new Error('invalid text');
  return value;
}

/** Main-platform protocol parser shared by one-shot and persistent input transports. */
export function prepareAgentComputerWindowInputWindow(value: unknown): AgentComputerWindowIdentity {
  const source = fields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds'], ['title', 'applicationLabel', 'windowLabel']);
  const bounds = fields(source.bounds, ['x', 'y', 'width', 'height']);
  if (Object.values(bounds).some(number => typeof number !== 'number' || !Number.isFinite(number))
    || Math.abs(Number(bounds.x)) > 10_000_000 || Math.abs(Number(bounds.y)) > 10_000_000
    || Number(bounds.width) <= 0 || Number(bounds.height) <= 0 || Number(bounds.width) > 100_000 || Number(bounds.height) > 100_000
    || source.layer !== 0) throw new Error('invalid window geometry');
  for (const key of ['applicationLabel', 'windowLabel'] as const) if (key in source) boundedString(source[key], 256);
  return {
    windowId: integer(source.windowId, 1, 0xffffffff), pid: integer(source.pid, 1, 0x7fffffff),
    processStartedAt: integer(source.processStartedAt, 1, Number.MAX_SAFE_INTEGER), layer: 0,
    bounds: bounds as unknown as AgentComputerWindowIdentity['bounds'],
    ...('title' in source ? { title: boundedString(source.title, 256, true) } : {}),
  };
}

function profile(value: unknown): string {
  const selected = boundedString(value, 64);
  if (!profiles.has(selected)) throw new Error('unsupported input profile');
  return selected;
}

function focusToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('invalid private focus token');
  return value;
}

function unicodeTextEventCount(text: string): number {
  let chunks = 0, units = 0;
  for (const scalar of text) {
    if (units + scalar.length > 20) { chunks += 1; units = 0; }
    units += scalar.length;
  }
  return (chunks + (units ? 1 : 0)) * 2;
}

function point(value: unknown, window: AgentComputerWindowIdentity): WindowInputPoint {
  const selected = fields(value, ['x', 'y']);
  const bounds = window.bounds;
  if (typeof selected.x !== 'number' || typeof selected.y !== 'number'
    || !Number.isFinite(selected.x) || !Number.isFinite(selected.y)
    || Math.abs(selected.x) > 10_000_000 || Math.abs(selected.y) > 10_000_000
    || selected.x < bounds.x || selected.x >= bounds.x + bounds.width
    || selected.y < bounds.y || selected.y >= bounds.y + bounds.height) throw new Error('point outside frozen window');
  return { x: selected.x, y: selected.y };
}

/** Main-platform protocol parser; never expose private input text to renderer callers. */
export function prepareAgentComputerWindowInputRequest(input: unknown): AgentComputerWindowInputRequest {
  const base = fields(input, ['window', 'profile', 'operation'], ['shortcut', 'point', 'endPoint', 'durationMs', 'text', 'focusToken', 'deltaX', 'deltaY', 'completionWindow']);
  const window = prepareAgentComputerWindowInputWindow(base.window);
  const selected = profile(base.profile);
  if (typeof base.operation !== 'string' || !WINDOW_INPUT_OPERATIONS.includes(base.operation as WindowInputOperation)) throw new Error('invalid operation');
  if (base.operation === 'shortcut') {
    fields(input, ['window', 'profile', 'operation', 'shortcut']);
    return { window, profile: selected, operation: 'shortcut', shortcut: normalizeWindowInputShortcut(base.shortcut) };
  }
  if (base.operation === 'typeText') {
    fields(input, ['window', 'profile', 'operation', 'text', 'focusToken']);
    return { window, profile: selected, operation: 'typeText', text: validateComputerText(base.text, 'insert').text,
      focusToken: focusToken(base.focusToken) };
  }
  if (base.operation === 'scroll') {
    fields(input, ['window', 'profile', 'operation', 'point', 'deltaX', 'deltaY']);
    return { window, profile: selected, operation: 'scroll', point: point(base.point, window),
      ...normalizeWindowInputScrollDelta(base.deltaX, base.deltaY) };
  }
  if (base.operation === 'drag') {
    fields(input, ['window', 'profile', 'operation', 'point', 'endPoint', 'durationMs']);
    const start = point(base.point, window);
    const end = point(base.endPoint, window);
    if (start.x === end.x && start.y === end.y) throw new Error('drag endpoints must differ');
    return { window, profile: selected, operation: 'drag', point: start, endPoint: end,
      durationMs: integer(base.durationMs, WINDOW_INPUT_DRAG_MIN_DURATION_MS, WINDOW_INPUT_DRAG_MAX_DURATION_MS) };
  }
  fields(input, ['window', 'profile', 'operation', 'point'], base.operation === 'rightClick' ? ['completionWindow'] : []);
  let completionWindow: AgentComputerWindowIdentity | undefined;
  if ('completionWindow' in base) {
    completionWindow = prepareAgentComputerWindowInputWindow(base.completionWindow);
    const bounds = completionWindow.bounds;
    if (selected !== 'directed-v1' || completionWindow.pid !== window.pid || completionWindow.processStartedAt !== window.processStartedAt
      || completionWindow.windowId === window.windowId || bounds.x < window.bounds.x || bounds.y < window.bounds.y
      || bounds.x + bounds.width > window.bounds.x + window.bounds.width
      || bounds.y + bounds.height > window.bounds.y + window.bounds.height) throw new Error('invalid completion window');
  }
  return { window, profile: selected, operation: base.operation as 'click' | 'rightClick' | 'doubleClick', point: point(base.point, window),
    ...(completionWindow ? { completionWindow } : {}) };
}

type InputHelperMode = '--window-input-check' | '--window-input';

/** A separate, optional visual stream cannot authorize, stop or settle input. */
export function pointerFeedback(request: AgentComputerWindowInputRequest, callback: (event: AgentComputerWindowInputPointerEvent) => void) {
  const maximumEvents = request.operation === 'drag' ? Math.max(8, Math.floor(request.durationMs! / 32)) + 2
    : request.operation === 'doubleClick' ? 4 : request.operation === 'rightClick' || request.operation === 'click' ? 2 : 0;
  let active = true;
  let pending = Buffer.alloc(0);
  let totalBytes = 0;
  let sequence = 0;
  let presses = 0;
  let pressed = false;
  let current = request.point;
  const samePoint = (left: WindowInputPoint, right?: WindowInputPoint) => left.x === right?.x && left.y === right?.y;
  const stop = () => { active = false; pending = Buffer.alloc(0); };
  return {
    stop,
    data(bytes: Buffer) {
      if (!active) return;
      totalBytes += bytes.length;
      if (totalBytes > 16_384) { stop(); return; }
      pending = Buffer.concat([pending, bytes]);
      try {
        let newline: number;
        while ((newline = pending.indexOf(10)) >= 0) {
          if (newline === 0 || newline > 256) throw new Error('invalid pointer frame');
          const frame = pending.subarray(0, newline);
          pending = pending.subarray(newline + 1);
          const source = fields(JSON.parse(frame.toString('utf8')), ['phase', 'point', 'sequence']);
          if (integer(source.sequence, 1, maximumEvents) !== sequence + 1) throw new Error('invalid pointer sequence');
          const position = point(source.point, request.window);
          const phase = source.phase;
          if (phase === 'down') {
            if (pressed || !samePoint(position, request.point) || ++presses > (request.operation === 'doubleClick' ? 2 : 1)) throw new Error('invalid pointer down');
            pressed = true;
          } else if (phase === 'move') {
            if (!pressed || request.operation !== 'drag') throw new Error('invalid pointer move');
          } else if (phase === 'up') {
            if (!pressed || !samePoint(position, current)) throw new Error('invalid pointer up');
            pressed = false;
          } else throw new Error('invalid pointer phase');
          current = position;
          sequence += 1;
          callback({ phase, point: position, sequence });
          if (!active) return;
        }
        if (pending.length > 256) stop();
      } catch { stop(); }
    },
  };
}

/** This runner intentionally leaves the AX helper's existing cancellation behavior alone. */
async function runInputHelper(mode: InputHelperMode, input: unknown, signal: AbortSignal,
  feedback?: ReturnType<typeof pointerFeedback>): Promise<{ code: number | null; receipt: unknown }> {
  signal.throwIfAborted();
  if (process.platform !== 'darwin') throw new AgentComputerWindowInputError('窗口输入目前仅支持 macOS', 'not-dispatched', 'not-required');
  const mutation = mode === '--window-input';
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(resolveAgentComputerHelperPath(), [mode], { shell: false,
      stdio: feedback ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      ...(feedback ? { env: { ...process.env, OMNIFLOW_WINDOW_INPUT_POINTER_FD: '3' } } : {}) }); }
    catch { reject(new AgentComputerWindowInputError('窗口输入组件不可用，请重新构建或安装 OmniFlow', 'not-dispatched', 'not-required')); return; }
    let launched = false;
    let finished = false;
    let terminating = false;
    let invalidOutput = false;
    let size = 0;
    const output: Buffer[] = [];
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (error?: Error, result?: { code: number | null; receipt: unknown }) => {
      if (finished) return;
      finished = true;
      feedback?.stop();
      clearTimeout(timer);
      clearTimeout(graceTimer);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(result!);
    };
    const unknown = (message: string) => new AgentComputerWindowInputError(`${message}；抬键/抬鼠标回执未确认，请重新观察，勿重复操作`, 'unknown', 'unconfirmed');
    const stopGracefully = () => {
      if (terminating || finished) return;
      terminating = true;
      feedback?.stop();
      clearTimeout(timer);
      // Native SIGTERM stops generation and posts the one matching up event.
      // An immediate SIGKILL could leave its synthetic button/key down.
      graceTimer = setTimeout(() => {
        settle(unknown('窗口输入组件未及时结束'));
        try { child.kill('SIGKILL'); } catch { /* Unknown delivery remains authoritative. */ }
      }, 2_000);
      graceTimer.unref();
      try { child.kill('SIGTERM'); } catch { /* Keep the bounded wait for close/up receipt. */ }
    };
    const cancel = () => {
      if (mutation) stopGracefully();
      else { settle(new DOMException('窗口输入检查已取消', 'AbortError')); try { child.kill('SIGTERM'); } catch { /* Read only. */ } }
    };
    const timer = setTimeout(() => {
      if (mutation) stopGracefully();
      else {
        settle(new AgentComputerWindowInputError('窗口输入检查超时，请重新观察', 'not-dispatched', 'not-required'));
        try { child.kill('SIGKILL'); } catch { /* Read only. */ }
      }
    }, mutation && (input as AgentComputerWindowInputRequest).operation === 'typeText' ? 15_000 : 5_000);
    timer.unref();
    signal.addEventListener('abort', cancel, { once: true });
    child.once('spawn', () => { launched = true; });
    child.on('error', () => {
      if (finished) return;
      if (launched && mutation) { invalidOutput = true; stopGracefully(); }
      else settle(new AgentComputerWindowInputError('窗口输入组件不可用，请重新构建或安装 OmniFlow', 'not-dispatched', 'not-required'));
    });
    child.stdout!.on('data', (bytes: Buffer) => {
      if (finished || invalidOutput) return;
      size += bytes.length;
      if (size > 4_096) {
        invalidOutput = true;
        if (mutation) stopGracefully();
        else {
          settle(new AgentComputerWindowInputError('窗口输入检查回执超限', 'not-dispatched', 'not-required'));
          try { child.kill('SIGKILL'); } catch { /* Read only. */ }
        }
      } else output.push(bytes);
    });
    child.stderr!.resume();
    const progress = child.stdio?.[3];
    if (feedback && progress && 'on' in progress) {
      // Keep the data listener through close, even after cancellation or bad
      // telemetry, so a visual consumer can never stall native paired release.
      progress.on('data', (bytes: Buffer) => {
        if (signal.aborted || finished) feedback.stop();
        feedback.data(bytes);
      });
      progress.on('error', feedback.stop);
      progress.on('end', feedback.stop);
    }
    child.stdin!.on('error', () => { /* The process close event supplies the authoritative receipt. */ });
    child.once('close', code => {
      if (finished) return;
      try {
        if (invalidOutput) throw new Error('invalid output');
        settle(undefined, { code, receipt: JSON.parse(Buffer.concat(output, size).toString('utf8')) });
      } catch {
        settle(mutation ? unknown('窗口输入回执不可读取')
          : new AgentComputerWindowInputError('窗口输入检查回执无效', 'not-dispatched', 'not-required'));
      }
    });
    child.stdin!.end(JSON.stringify(input));
    if (signal.aborted) cancel();
  });
}

/** Exact native failure receipt, excluding transport framing such as requestId. */
export function parseAgentComputerWindowInputFailure(receipt: unknown, request?: AgentComputerWindowInputRequest): { dispatched: false | 'unknown'; code: string; releaseState: 'confirmed' | 'unconfirmed' | 'not-required' } {
  const maximumEvents = request?.operation === 'typeText' ? unicodeTextEventCount(request.text!)
    : request?.operation === 'scroll' ? 1 : 256;
  const source = fields(receipt, ['ok', 'dispatched', 'error'], ['eventCount', 'releaseSent', 'method']);
  const error = fields(source.error, ['code', 'message']);
  const code = boundedString(error.code, 64);
  boundedString(error.message, 512, true);
  if (source.ok !== false || !/^[a-z][a-z0-9_]*$/u.test(code)
    || (source.dispatched !== false && source.dispatched !== 'unknown')) throw new Error('invalid failure');
  const hasRelease = ['eventCount', 'releaseSent', 'method'].some(key => key in source);
  if (hasRelease && (source.dispatched !== 'unknown' || source.method !== 'CGEventPostToPid'
    || typeof source.releaseSent !== 'boolean')) throw new Error('invalid failure release');
  if (hasRelease) integer(source.eventCount, 1, maximumEvents);
  return { dispatched: source.dispatched, code,
    releaseState: source.dispatched === false ? 'not-required' : hasRelease && source.releaseSent === true ? 'confirmed' : 'unconfirmed' };
}

/** Exact success receipt; a posted sequence does not prove application consumption. */
export function parseAgentComputerWindowInputReceipt(receipt: unknown,
  request: AgentComputerWindowInputRequest): AgentComputerWindowInputReceipt {
  const source = fields(receipt, ['ok', 'dispatched', 'method', 'eventCount', 'releaseSent'], ['completionWindowId']);
  const eventCount = integer(source.eventCount, request.operation === 'scroll' ? 1 : 2, request.operation === 'typeText' ? 1_024 : 256);
  if (source.ok !== true || source.dispatched !== true || source.method !== 'CGEventPostToPid' || source.releaseSent !== true
    || (request.operation === 'drag' ? eventCount < 10 || eventCount > 33
      : request.operation === 'typeText' ? eventCount !== unicodeTextEventCount(request.text!)
        : eventCount !== (request.operation === 'doubleClick' ? 4 : request.operation === 'scroll' ? 1 : 2))) throw new Error('invalid dispatch');
  let completionWindowId: number | undefined;
  if ('completionWindowId' in source) {
    completionWindowId = integer(source.completionWindowId, 1, 0xffffffff);
    if (request.profile !== 'directed-v1' || request.operation !== 'rightClick'
      || request.completionWindow?.windowId !== completionWindowId) throw new Error('unbound completion window');
  }
  return { dispatched: true, method: 'CGEventPostToPid', eventCount, releaseSent: true,
    ...(completionWindowId ? { completionWindowId } : {}) };
}

/** Read-only readiness; the caller owns the single-window grant and freezes the returned profile. */
export async function getAgentComputerWindowInputStatus(window: AgentComputerWindowIdentity, signal: AbortSignal): Promise<AgentComputerWindowInputStatus> {
  signal.throwIfAborted();
  let identity: AgentComputerWindowIdentity;
  try { identity = prepareAgentComputerWindowInputWindow(window); }
  catch { throw new AgentComputerWindowInputError('窗口输入身份无效，请重新选择窗口', 'not-dispatched', 'not-required'); }
  const result = await runInputHelper('--window-input-check', { window: identity }, signal);
  signal.throwIfAborted();
  try {
    if (result.code !== 0) {
      const failed = parseAgentComputerWindowInputFailure(result.receipt);
      if (failed.dispatched === false && ['invalid_arguments', 'unsupported_receiver'].includes(failed.code)) {
        return { ready: false, operations: [], reason: 'unsupported_receiver' };
      }
      throw new Error('failed check');
    }
    const source = fields(result.receipt, ['ok', 'ready', 'operations'], ['profile', 'reason', 'focusToken']);
    if (source.ok !== true || typeof source.ready !== 'boolean') throw new Error('invalid check');
    const reason = 'reason' in source ? boundedString(source.reason, 64) : undefined;
    if (reason && !refusalReasons.has(reason)) throw new Error('invalid reason');
    if (source.ready) {
      if (reason !== undefined) throw new Error('ready refusal');
      const operations = normalizeWindowInputOperations(source.operations);
      if (!operations.includes('typeText') && 'focusToken' in source) throw new Error('unexpected private focus token');
      return { ready: true, profile: profile(source.profile), operations,
        ...(operations.includes('typeText') ? { focusToken: focusToken(source.focusToken) } : {}) };
    }
    if ('profile' in source || 'focusToken' in source || !Array.isArray(source.operations) || source.operations.length !== 0
      || Reflect.ownKeys(source.operations).length !== 1) throw new Error('invalid unavailable check');
    return { ready: false, operations: [], ...(reason ? { reason } : {}) };
  } catch { throw new AgentComputerWindowInputError('窗口输入检查回执无效，请重新观察', 'not-dispatched', 'not-required'); }
}

/** One directed event sequence. Native revalidates the window, receiver and frozen profile before each dispatch. */
export async function inputAgentComputerWindow(input: AgentComputerWindowInputRequest, signal: AbortSignal,
  onPointerEvent?: (event: AgentComputerWindowInputPointerEvent) => void): Promise<AgentComputerWindowInputReceipt> {
  signal.throwIfAborted();
  let request: AgentComputerWindowInputRequest;
  try { request = prepareAgentComputerWindowInputRequest(input); }
  catch { throw new AgentComputerWindowInputError('窗口输入请求无效，请重新观察窗口', 'not-dispatched', 'not-required'); }
  const result = await runInputHelper('--window-input', request, signal,
    onPointerEvent ? pointerFeedback(request, onPointerEvent) : undefined);
  try {
    if (result.code !== 0 || (result.receipt as { ok?: unknown } | null)?.ok === false) {
      const failure = parseAgentComputerWindowInputFailure(result.receipt, request);
      throw new AgentComputerWindowInputError(failure.dispatched === false
        ? '窗口输入在派发前拒绝，请重新观察窗口'
        : failure.releaseState === 'confirmed' ? '窗口输入结果未知，对应抬键/抬鼠标事件已发送；请重新观察，勿重复操作'
          : '窗口输入结果未知，抬键/抬鼠标回执未确认；请重新观察，勿重复操作',
      failure.dispatched === false ? 'not-dispatched' : 'unknown', failure.releaseState);
    }
    return parseAgentComputerWindowInputReceipt(result.receipt, request);
  } catch (error) {
    if (error instanceof AgentComputerWindowInputError) throw error;
    throw new AgentComputerWindowInputError('窗口输入回执无效，抬键/抬鼠标回执未确认；请重新观察，勿重复操作', 'unknown', 'unconfirmed');
  }
}
