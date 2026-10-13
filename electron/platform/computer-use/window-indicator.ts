import { spawn } from 'node:child_process';
import type { WindowInputPoint } from '../../../src/shared/computer-use/window-input-contract';
import { resolveAgentComputerHelperPath, type AgentComputerWindowIdentity } from './desktop-computer';

export interface AgentComputerWindowIndicatorRequest {
  window: AgentComputerWindowIdentity;
  operation: 'click' | 'rightClick' | 'doubleClick' | 'drag';
  /** Global screen points within the frozen window; never the system pointer. */
  point: WindowInputPoint;
  endPoint?: WindowInputPoint;
  /** Main-owned visual color only. Omission uses the native #5a9e7c fallback. */
  accentColor?: string;
}

export interface AgentComputerWindowIndicatorLease {
  /** The native helper scheduled a display, not proof of continuous visibility. */
  shown: boolean;
  /** True only after actual process exit/close, or when no child was spawned. Never rejects. */
  closed: Promise<boolean>;
  /** Updates the same native surface; false requires confirmed cleanup before input. */
  update?(request: AgentComputerWindowIndicatorRequest): Promise<boolean>;
  dispose(): void;
}

export const UNCONFIRMED_WINDOW_INDICATOR_CLOSE_NOTICE = '鼠标图案关闭未确认，Agent 鼠标操作已暂停；请重启应用后再操作。';

/** Main-only lifecycle failure. Never use a kill request as a closure receipt. */
export class AgentComputerWindowIndicatorCloseError extends Error {
  constructor() {
    super(UNCONFIRMED_WINDOW_INDICATOR_CLOSE_NOTICE);
    this.name = 'AgentComputerWindowIndicatorCloseError';
  }
}

const noIndicator: AgentComputerWindowIndicatorLease = Object.freeze({ shown: false, closed: Promise.resolve(true), dispose() {} });
// Queued child/pipe errors may arrive after close or destroy. This handler has no
// lease, signal or runtime closure; the temporary emitters can still be collected.
const ignoreTerminatedError = () => {};

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
    || !required.includes(key) && !optional.includes(key))) throw new Error('invalid fields');
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key as string];
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid property');
    return [key, descriptor.value];
  }));
}

function integer(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('invalid identity');
  return value;
}

function label(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string' || !allowEmpty && !value || Buffer.byteLength(value, 'utf8') > 256
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
    || [...value].some(character => {
      const code = character.codePointAt(0)!;
      return code < 32 || code >= 127 && code <= 159 || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069;
    })) throw new Error('invalid label');
  return value;
}

function windowIdentity(value: unknown): AgentComputerWindowIdentity {
  const source = fields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds'], ['title', 'applicationLabel', 'windowLabel']);
  const bounds = fields(source.bounds, ['x', 'y', 'width', 'height']);
  if (Object.values(bounds).some(number => typeof number !== 'number' || !Number.isFinite(number))
    || Math.abs(Number(bounds.x)) > 10_000_000 || Math.abs(Number(bounds.y)) > 10_000_000
    || Number(bounds.width) <= 0 || Number(bounds.height) <= 0 || Number(bounds.width) > 100_000
    || Number(bounds.height) > 100_000 || source.layer !== 0) throw new Error('invalid geometry');
  for (const key of ['applicationLabel', 'windowLabel'] as const) if (key in source) label(source[key], false);
  return {
    windowId: integer(source.windowId, 0xffffffff), pid: integer(source.pid, 0x7fffffff),
    processStartedAt: integer(source.processStartedAt, Number.MAX_SAFE_INTEGER), layer: 0,
    bounds: { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) },
    ...('title' in source ? { title: label(source.title, true) } : {}),
  };
}

function point(value: unknown, window: AgentComputerWindowIdentity): WindowInputPoint {
  const source = fields(value, ['x', 'y']);
  const bounds = window.bounds;
  if (typeof source.x !== 'number' || typeof source.y !== 'number' || !Number.isFinite(source.x) || !Number.isFinite(source.y)
    || Math.abs(source.x) > 10_000_000 || Math.abs(source.y) > 10_000_000
    || source.x < bounds.x || source.x >= bounds.x + bounds.width
    || source.y < bounds.y || source.y >= bounds.y + bounds.height) throw new Error('point outside window');
  return { x: source.x, y: source.y };
}

function request(input: unknown): AgentComputerWindowIndicatorRequest {
  const source = fields(input, ['window', 'operation', 'point'], ['endPoint', 'accentColor']);
  const window = windowIdentity(source.window);
  const start = point(source.point, window);
  let appearance: Pick<AgentComputerWindowIndicatorRequest, 'accentColor'> = {};
  if ('accentColor' in source) {
    if (typeof source.accentColor !== 'string' || source.accentColor.length !== 7
      || !/^#[0-9a-fA-F]{6}$/u.test(source.accentColor)) throw new Error('invalid visual color');
    appearance = { accentColor: source.accentColor.toLowerCase() };
  }
  if (source.operation === 'drag') {
    fields(input, ['window', 'operation', 'point', 'endPoint'], ['accentColor']);
    const end = point(source.endPoint, window);
    if (start.x === end.x && start.y === end.y) throw new Error('equal drag endpoints');
    return { window, operation: 'drag', point: start, endPoint: end, ...appearance };
  }
  fields(input, ['window', 'operation', 'point'], ['accentColor']);
  if (source.operation !== 'click' && source.operation !== 'rightClick' && source.operation !== 'doubleClick') throw new Error('invalid operation');
  return { window, operation: source.operation, point: start, ...appearance };
}

/** Main-only visual lease, kept alive by its Run owner. No absolute display timeout. */
export async function showAgentComputerWindowIndicator(input: AgentComputerWindowIndicatorRequest,
  signal: AbortSignal): Promise<AgentComputerWindowIndicatorLease> {
  signal.throwIfAborted();
  if (process.platform !== 'darwin') return noIndicator;
  let normalized: AgentComputerWindowIndicatorRequest;
  try { normalized = request(input); } catch { signal.throwIfAborted(); return noIndicator; }
  const lease = await new Promise<AgentComputerWindowIndicatorLease>(resolve => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(resolveAgentComputerHelperPath(), ['--window-indicator'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { signal.throwIfAborted(); resolve(noIndicator); return; }
    let settled = false;
    let stopping = false;
    let finished = false;
    let detached = false;
    let pendingUpdate: ((shown: boolean) => void) | undefined;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let output = Buffer.alloc(0);
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let confirmClosed!: (confirmed: boolean) => void;
    const closed = new Promise<boolean>(resolveClosed => { confirmClosed = resolveClosed; });
    const startupTimer = setTimeout(() => stop(), 1_000);
    startupTimer.unref();

    const settle = (shown = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (shown) {
        heartbeatTimer = setInterval(() => {
          if (stopping || finished) return;
          try { if (!child.stdin!.write('\n')) stop(); } catch { stop(); }
        }, 1_000);
        heartbeatTimer.unref();
      }
      resolve({ get shown() { return shown && !stopping && !finished; }, closed, update, dispose: stop });
    };
    const detach = () => {
      if (detached) return;
      detached = true;
      clearTimeout(startupTimer); clearInterval(heartbeatTimer); clearTimeout(updateTimer); clearTimeout(killTimer); clearTimeout(exitTimer);
      signal.removeEventListener('abort', cancel);
      for (const emitter of [child, child.stdin!, child.stdout!, child.stderr!]) emitter.on('error', ignoreTerminatedError);
      child.removeListener('error', failed);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
      child.stdin!.removeListener('error', failed);
      child.stdout!.removeListener('error', failed);
      child.stderr!.removeListener('error', failed);
      child.stdout!.removeListener('data', onData);
      // Continue draining while a killed process closes its pipes; no accumulated output.
      child.stdout!.resume();
    };
    const finish = (confirmed: boolean) => {
      if (finished) return;
      finished = true;
      settle();
      pendingUpdate?.(false); pendingUpdate = undefined;
      output = Buffer.alloc(0);
      detach();
      child.stdin!.destroy(); child.stdout!.destroy(); child.stderr!.destroy();
      confirmClosed(confirmed);
    };
    const hardStop = () => {
      if (finished) return;
      try { child.kill('SIGKILL'); } catch { /* Sending a signal does not prove process exit. */ }
      if (finished) return;
      exitTimer = setTimeout(() => finish(false), 300);
      exitTimer.unref();
    };
    const stop = () => {
      if (stopping || finished) return;
      stopping = true;
      clearTimeout(startupTimer); clearInterval(heartbeatTimer); clearTimeout(updateTimer);
      pendingUpdate?.(false); pendingUpdate = undefined;
      signal.removeEventListener('abort', cancel);
      output = Buffer.alloc(0);
      settle();
      killTimer = setTimeout(hardStop, 300);
      killTimer.unref();
      try { child.stdin!.end(); } catch { /* TERM remains available. */ }
      if (!finished) try { child.kill('SIGTERM'); } catch { /* Hard stop remains bounded. */ }
    };
    const update = async (input: AgentComputerWindowIndicatorRequest): Promise<boolean> => {
      if (!settled || stopping || finished || pendingUpdate) return false;
      let next: AgentComputerWindowIndicatorRequest;
      try {
        next = request(input);
        if (JSON.stringify(next.window) !== JSON.stringify(normalized.window)) throw new Error('changed window');
      } catch { stop(); return false; }
      return new Promise<boolean>(resolveUpdate => {
        pendingUpdate = resolveUpdate;
        updateTimer = setTimeout(stop, 1_000); updateTimer.unref();
        try { if (!child.stdin!.write(`${JSON.stringify(next)}\n`)) stop(); } catch { stop(); }
      });
    };
    const cancel = () => stop();
    const failed = () => stop();
    const onExit = () => finish(true);
    const onClose = () => finish(true);
    const onData = (bytes: Buffer) => {
      if (stopping || finished) return;
      // One bounded ACK per request. Heartbeats never generate output.
      if (settled && !pendingUpdate || output.length + bytes.length >= 512) { stop(); return; }
      output = Buffer.concat([output, bytes]);
      const newline = output.indexOf(10);
      if (newline < 0) return;
      try {
        const trailing = output.subarray(newline + 1);
        if (trailing.some(byte => ![9, 10, 13, 32].includes(byte))) throw new Error('invalid trailing output');
        const receipt = fields(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output.subarray(0, newline))), ['ok', 'shown']);
        if (receipt.ok !== true || typeof receipt.shown !== 'boolean') throw new Error('invalid ready');
        output = Buffer.alloc(0);
        if (signal.aborted || !receipt.shown) { stop(); return; }
        if (!settled) settle(true);
        else {
          clearTimeout(updateTimer);
          const resolveUpdate = pendingUpdate; pendingUpdate = undefined;
          resolveUpdate?.(true);
        }
      } catch { stop(); }
    };

    child.on('error', failed); child.once('exit', onExit); child.once('close', onClose);
    child.stdin!.on('error', failed); child.stdout!.on('error', failed); child.stderr!.on('error', failed);
    child.stdout!.on('data', onData); child.stderr!.resume();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    try { if (!child.stdin!.write(`${JSON.stringify(normalized)}\n`)) stop(); } catch { failed(); }
  });
  if (signal.aborted) {
    lease.dispose();
    // Do not release the caller's execution barrier while an already-spawned
    // cancelled visual is still within its bounded termination window.
    if (!await lease.closed) throw new AgentComputerWindowIndicatorCloseError();
    signal.throwIfAborted();
  }
  return lease;
}
