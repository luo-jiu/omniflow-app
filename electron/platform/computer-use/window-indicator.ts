import { spawn } from 'node:child_process';
import type { WindowInputPoint } from '../../../src/shared/computer-use/window-input-contract';
import { resolveAgentComputerHelperPath, type AgentComputerWindowIdentity } from './desktop-computer';

export interface AgentComputerWindowIndicatorRequest {
  window: AgentComputerWindowIdentity;
  operation: 'click' | 'rightClick' | 'doubleClick' | 'drag';
  /** Global screen points within the frozen window; never the system pointer. */
  point: WindowInputPoint;
  endPoint?: WindowInputPoint;
}

export interface AgentComputerWindowIndicatorLease {
  /** The native helper scheduled a display, not proof of continuous visibility. */
  shown: boolean;
  dispose(): void;
}

const noIndicator: AgentComputerWindowIndicatorLease = Object.freeze({ shown: false, dispose() {} });
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
    bounds: bounds as unknown as AgentComputerWindowIdentity['bounds'],
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
  const source = fields(input, ['window', 'operation', 'point'], ['endPoint']);
  const window = windowIdentity(source.window);
  const start = point(source.point, window);
  if (source.operation === 'drag') {
    fields(input, ['window', 'operation', 'point', 'endPoint']);
    const end = point(source.endPoint, window);
    if (start.x === end.x && start.y === end.y) throw new Error('equal drag endpoints');
    return { window, operation: 'drag', point: start, endPoint: end };
  }
  fields(input, ['window', 'operation', 'point']);
  if (source.operation !== 'click' && source.operation !== 'rightClick' && source.operation !== 'doubleClick') throw new Error('invalid operation');
  return { window, operation: source.operation, point: start };
}

/** Main-only, bounded visual intent. Its absence never changes the actual action receipt. */
export async function showAgentComputerWindowIndicator(input: AgentComputerWindowIndicatorRequest,
  signal: AbortSignal): Promise<AgentComputerWindowIndicatorLease> {
  signal.throwIfAborted();
  if (process.platform !== 'darwin') return noIndicator;
  let normalized: AgentComputerWindowIndicatorRequest;
  try { normalized = request(input); } catch { signal.throwIfAborted(); return noIndicator; }
  const lease = await new Promise<AgentComputerWindowIndicatorLease>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(resolveAgentComputerHelperPath(), ['--window-indicator'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { signal.throwIfAborted(); resolve(noIndicator); return; }
    let settled = false;
    let stopping = false;
    let closed = false;
    let detached = false;
    let size = 0;
    let output = Buffer.alloc(0);
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const startupTimer = setTimeout(() => stop(), 1_000);
    const lifeTimer = setTimeout(() => stop(), 3_000);
    startupTimer.unref(); lifeTimer.unref();

    const settle = (result = noIndicator, aborted = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (aborted) reject(signal.reason); else resolve(result);
    };
    const detach = () => {
      if (detached) return;
      detached = true;
      clearTimeout(startupTimer); clearTimeout(lifeTimer); clearTimeout(killTimer);
      signal.removeEventListener('abort', cancel);
      for (const emitter of [child, child.stdin!, child.stdout!, child.stderr!]) emitter.on('error', ignoreTerminatedError);
      child.removeListener('error', failed);
      child.removeListener('close', onClose);
      child.stdin!.removeListener('error', failed);
      child.stdout!.removeListener('error', failed);
      child.stderr!.removeListener('error', failed);
      child.stdout!.removeListener('data', onData);
      // Continue draining while a killed process closes its pipes; no accumulated output.
      child.stdout!.resume();
    };
    const hardStop = () => {
      if (closed) return;
      try { child.kill('SIGKILL'); } catch { /* Visual-only failure. */ }
      closed = true;
      child.stdin!.destroy(); child.stdout!.destroy(); child.stderr!.destroy();
      detach();
    };
    const stop = () => {
      if (stopping || closed) return;
      stopping = true;
      clearTimeout(startupTimer); clearTimeout(lifeTimer);
      signal.removeEventListener('abort', cancel);
      output = Buffer.alloc(0);
      settle();
      killTimer = setTimeout(hardStop, 300);
      killTimer.unref();
      try { child.stdin!.end(); } catch { /* TERM remains available. */ }
      if (!closed) try { child.kill('SIGTERM'); } catch { /* Hard stop remains bounded. */ }
    };
    const cancel = () => { settle(noIndicator, true); stop(); };
    const failed = () => { if (signal.aborted) cancel(); else stop(); };
    const onClose = () => {
      if (closed) return;
      closed = true;
      settle();
      output = Buffer.alloc(0);
      detach();
    };
    const onData = (bytes: Buffer) => {
      if (stopping || closed) return;
      size += bytes.length;
      if (size > 512) { stop(); return; }
      // Only the first newline-delimited status is accepted; chatter is invalid.
      if (settled) { if (bytes.some(byte => ![9, 10, 13, 32].includes(byte))) stop(); return; }
      output = Buffer.concat([output, bytes]);
      const newline = output.indexOf(10);
      if (newline < 0) return;
      try {
        const trailing = output.subarray(newline + 1);
        if (trailing.some(byte => ![9, 10, 13, 32].includes(byte))) throw new Error('invalid trailing output');
        const receipt = fields(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output.subarray(0, newline))), ['ok', 'shown']);
        if (receipt.ok !== true || typeof receipt.shown !== 'boolean') throw new Error('invalid ready');
        output = Buffer.alloc(0);
        if (signal.aborted) { cancel(); return; }
        if (!receipt.shown) { stop(); return; }
        settle({ shown: true, dispose: stop });
      } catch { stop(); }
    };

    child.on('error', failed); child.once('close', onClose);
    child.stdin!.on('error', failed); child.stdout!.on('error', failed); child.stderr!.on('error', failed);
    child.stdout!.on('data', onData); child.stderr!.resume();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    try { child.stdin!.write(`${JSON.stringify(normalized)}\n`); } catch { failed(); }
  });
  if (signal.aborted) { lease.dispose(); signal.throwIfAborted(); }
  return lease;
}
