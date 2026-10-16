import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { AgentComputerInputError, resolveAgentComputerHelperPath, prepareAgentComputerWindowCapture,
  parseAgentComputerWindowCapture, type AgentComputerWindowCapture,
  type AgentComputerRect, type AgentComputerWindowIdentity } from './desktop-computer';

export type AgentComputerMenuOperation = 'open' | 'press' | 'cancel';
export interface AgentComputerMenuObservation {
  /** Private native references. The Run owner maps these to fresh public IDs. */
  observationId: string;
  items: Array<{ itemId: string; role: string; label: string; bounds: AgentComputerRect; operations: AgentComputerMenuOperation[] }>;
  axTree: string;
  truncated: boolean;
  menus: Array<{ bounds: AgentComputerRect; surface?: AgentComputerWindowIdentity }>;
}
export type AgentComputerMenuCapture = {
  available: true; png: Buffer; width: number; height: number; bounds: AgentComputerRect;
  menuCapture: 'included' | 'none'; cursorIncluded: boolean;
} | { available: false; reason: string };
export type AgentComputerMenuPointer = {
  available: true; observationId: string; itemId: string;
  point: { x: number; y: number };
  /** Native AX ancestry proof; private to the menu and indicator owners. */
  menuSurface?: AgentComputerWindowIdentity;
} | { available: false; reason: string };
export interface AgentComputerMenuSessionLease {
  observe(signal: AbortSignal): Promise<AgentComputerMenuObservation>;
  resolvePointer(request: { observationId: string; itemId: string; operation: AgentComputerMenuOperation },
    signal: AbortSignal): Promise<AgentComputerMenuPointer>;
  action(request: { observationId: string; itemId: string; operation: AgentComputerMenuOperation },
    signal: AbortSignal, onDispatched?: () => void): Promise<void>;
  capture(request: { observationId: string; pointerWindow?: AgentComputerWindowIdentity }, signal: AbortSignal): Promise<AgentComputerMenuCapture>;
  /** Reuses this native process while keeping the frozen ordinary-window scope. */
  captureWindow(request: { pointerWindow?: AgentComputerWindowIdentity }, signal: AbortSignal): Promise<AgentComputerWindowCapture>;
  close(): void;
  /** Actual process termination, never merely a successful kill request. */
  closed: Promise<boolean>;
}
export class AgentComputerMenuSessionCloseError extends AgentComputerInputError {
  constructor() {
    super('菜单会话关闭未确认，已暂停新菜单操作；请重启应用后再操作', 'not-dispatched');
    this.name = 'AgentComputerMenuSessionCloseError';
  }
}
const ignoreTerminatedError = () => {};

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid menu object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
    || !required.includes(key) && !optional.includes(key))) throw new Error('invalid menu fields');
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key as string];
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid menu property');
    return [key, descriptor.value];
  }));
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('invalid menu integer');
  return value;
}
function text(value: unknown, maximum: number, multiline = false): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
    || [...value].some(character => {
      const code = character.codePointAt(0)!;
      return code < 32 && !(multiline && (code === 10 || code === 9)) || code >= 127 && code <= 159
        || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069;
    })) throw new Error('invalid menu text');
  return value;
}
function token(value: unknown): string {
  const result = text(value, 128);
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(result)) throw new Error('invalid menu token');
  return result;
}
function rect(value: unknown): AgentComputerRect {
  const source = fields(value, ['x', 'y', 'width', 'height']);
  if (Object.values(source).some(number => typeof number !== 'number' || !Number.isFinite(number))
    || Math.abs(Number(source.x)) > 10_000_000 || Math.abs(Number(source.y)) > 10_000_000
    || Number(source.width) <= 0 || Number(source.height) <= 0
    || Number(source.width) > 100_000 || Number(source.height) > 100_000) throw new Error('invalid menu rectangle');
  return source as unknown as AgentComputerRect;
}
function windowIdentity(value: unknown, surface = false): AgentComputerWindowIdentity {
  const source = fields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds'], ['title', 'applicationLabel', 'windowLabel']);
  const layer = integer(source.layer, 0, surface ? 2000 : 0);
  for (const key of ['applicationLabel', 'windowLabel'] as const) if (key in source) text(source[key], 256);
  return { windowId: integer(source.windowId, 1, 0xffffffff), pid: integer(source.pid, 1, 0x7fffffff),
    processStartedAt: integer(source.processStartedAt, 1, Number.MAX_SAFE_INTEGER), layer, bounds: rect(source.bounds),
    ...('title' in source ? { title: text(source.title, 256) } : {}) };
}
function sameRect(a: AgentComputerRect, b: AgentComputerRect): boolean {
  return (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(a[key] - b[key]) <= 0.5);
}
function containsPoint(bounds: AgentComputerRect, point: { x: number; y: number }): boolean {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width
    && point.y >= bounds.y && point.y < bounds.y + bounds.height;
}
function sameSurface(a: AgentComputerWindowIdentity, b: AgentComputerWindowIdentity): boolean {
  return a.windowId === b.windowId && a.pid === b.pid && a.processStartedAt === b.processStartedAt
    && a.layer === b.layer && a.title === b.title && sameRect(a.bounds, b.bounds);
}
function operation(value: unknown): AgentComputerMenuOperation {
  if (value !== 'open' && value !== 'press' && value !== 'cancel') throw new Error('invalid menu operation');
  return value;
}
function observation(value: Record<string, unknown>, target: AgentComputerWindowIdentity): AgentComputerMenuObservation {
  const source = fields(value, ['ok', 'requestId', 'observationId', 'items', 'axTree', 'truncated', 'menus']);
  if (!Array.isArray(source.items) || source.items.length > 128 || !Array.isArray(source.menus)
    || source.menus.length > 32 || typeof source.truncated !== 'boolean') throw new Error('invalid menu observation');
  const items = source.items.map(raw => {
    const item = fields(raw, ['itemId', 'role', 'label', 'bounds', 'operations']);
    if (!Array.isArray(item.operations) || item.operations.length > 3) throw new Error('invalid menu operations');
    const operations = item.operations.map(operation);
    if (new Set(operations).size !== operations.length) throw new Error('duplicate menu operation');
    const role = text(item.role, 64);
    if (!/^AX[A-Za-z]{1,60}$/u.test(role)) throw new Error('invalid menu role');
    return { itemId: token(item.itemId), role, label: text(item.label, 256), bounds: rect(item.bounds), operations };
  });
  if (new Set(items.map(item => item.itemId)).size !== items.length) throw new Error('duplicate menu item');
  const menus = source.menus.map(raw => {
    const menu = fields(raw, ['bounds'], ['surface']);
    const bounds = rect(menu.bounds);
    if (!('surface' in menu)) return { bounds };
    const surface = windowIdentity(menu.surface, true);
    if (surface.layer !== 101 || surface.pid !== target.pid || surface.processStartedAt !== target.processStartedAt
      || surface.windowId === target.windowId || !sameRect(bounds, surface.bounds)) throw new Error('unrelated menu surface');
    return { bounds, surface };
  });
  return { observationId: token(source.observationId), items, menus,
    axTree: text(source.axTree, 12 * 1024, true), truncated: source.truncated };
}
function pointerResult(value: Record<string, unknown>, current: AgentComputerMenuObservation,
  item: AgentComputerMenuObservation['items'][number], target: AgentComputerWindowIdentity): AgentComputerMenuPointer {
  if (value.available === false) {
    const source = fields(value, ['ok', 'requestId', 'available', 'reason']);
    return { available: false, reason: token(source.reason) };
  }
  const source = fields(value, ['ok', 'requestId', 'available', 'observationId', 'itemId', 'point'], ['menuSurface']);
  const position = fields(source.point, ['x', 'y']);
  if (source.available !== true || source.observationId !== current.observationId || source.itemId !== item.itemId
    || typeof position.x !== 'number' || !Number.isFinite(position.x)
    || typeof position.y !== 'number' || !Number.isFinite(position.y)) throw new Error('invalid menu pointer');
  const point = { x: position.x, y: position.y };
  if (!containsPoint(item.bounds, point)) throw new Error('pointer outside item');
  const menuSurface = source.menuSurface === undefined ? undefined : windowIdentity(source.menuSurface, true);
  if (menuSurface) {
    if (!current.menus.some(menu => menu.surface && sameSurface(menu.surface, menuSurface))
      || !containsPoint(menuSurface.bounds, point)) throw new Error('unrelated pointer menu');
  } else if (['AXMenu', 'AXMenuItem', 'AXMenuBarItem'].includes(item.role) || !containsPoint(target.bounds, point)) {
    throw new Error('missing pointer menu');
  }
  return { available: true, observationId: current.observationId, itemId: item.itemId, point,
    ...(menuSurface ? { menuSurface } : {}) };
}
function captureResult(value: Record<string, unknown>, current: AgentComputerMenuObservation,
  target: AgentComputerWindowIdentity, pointerWindow?: AgentComputerWindowIdentity): AgentComputerMenuCapture {
  if (value.available === false) {
    const source = fields(value, ['ok', 'requestId', 'available', 'reason']);
    return { available: false, reason: token(source.reason) };
  }
  const source = fields(value, ['ok', 'requestId', 'available', 'observationId', 'bounds', 'width', 'height',
    'pngBase64', 'captureMethod', 'captureScope', 'cursorIncluded']);
  if (source.available !== true || source.observationId !== current.observationId
    || source.captureMethod !== 'included-windows' || source.captureScope !== 'window-menus'
    || typeof source.cursorIncluded !== 'boolean' || source.cursorIncluded !== Boolean(pointerWindow)
    || current.menus.some(menu => !menu.surface)) throw new Error('invalid menu capture scope');
  const areas = [target.bounds, ...current.menus.map(menu => menu.bounds)];
  if (pointerWindow) areas.push(pointerWindow.bounds);
  const x = Math.min(...areas.map(area => area.x)); const y = Math.min(...areas.map(area => area.y));
  const expected = { x, y, width: Math.max(...areas.map(area => area.x + area.width)) - x,
    height: Math.max(...areas.map(area => area.y + area.height)) - y };
  const bounds = rect(source.bounds);
  if (!sameRect(bounds, expected)) throw new Error('unexpected menu capture extent');
  const width = integer(source.width, 1, 2048); const height = integer(source.height, 1, 2048);
  if (Math.abs(width / height - bounds.width / bounds.height) > 0.02) throw new Error('invalid menu capture aspect');
  if (typeof source.pngBase64 !== 'string' || !source.pngBase64.length || source.pngBase64.length > Math.ceil(8 * 1024 * 1024 / 3) * 4
    || source.pngBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(source.pngBase64)) throw new Error('invalid menu PNG');
  const png = Buffer.from(source.pngBase64, 'base64');
  if (png.length < 24 || png.length > 8 * 1024 * 1024 || png.toString('base64') !== source.pngBase64
    || png.readUInt32BE(8) !== 13 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || png.subarray(12, 16).toString('ascii') !== 'IHDR' || png.readUInt32BE(16) !== width
    || png.readUInt32BE(20) !== height) throw new Error('invalid menu PNG dimensions');
  return { available: true, png, width, height, bounds, menuCapture: current.menus.length ? 'included' : 'none',
    cursorIncluded: source.cursorIncluded };
}

/** A Run-owned AX reference session. It neither activates an app nor posts global input. */
export async function createAgentComputerMenuSession(input: AgentComputerWindowIdentity,
  startupSignal: AbortSignal): Promise<AgentComputerMenuSessionLease> {
  startupSignal.throwIfAborted();
  if (process.platform !== 'darwin') throw new Error('应用菜单操作目前仅支持 macOS');
  const target = windowIdentity(input);
  const child = spawn(resolveAgentComputerHelperPath(), ['--window-menu-session'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const emitters: EventEmitter[] = [child, child.stdin, child.stdout, child.stderr];
  let started = false; let stopping = false; let finished = false; let sequence = 0;
  let buffer = Buffer.alloc(0); let stderrBytes = 0;
  let snapshot: AgentComputerMenuObservation | undefined;
  let resolveStartup!: () => void; let rejectStartup!: (error: Error) => void;
  const startup = new Promise<void>((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
  let resolveClosed!: (confirmed: boolean) => void;
  const closed = new Promise<boolean>(resolve => { resolveClosed = resolve; });
  type Pending = { id: string; command: string; sent: boolean; dispatched: boolean;
    signal: AbortSignal; cancel: () => void; timer: ReturnType<typeof setTimeout>;
    resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; onDispatched?: () => void };
  let pending: Pending | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined; let exitTimer: ReturnType<typeof setTimeout> | undefined;
  const failure = (message: string, selected = pending) => new AgentComputerInputError(message,
    selected?.command === 'action' && selected.sent ? 'unknown' : 'not-dispatched');
  function settlePending(error?: Error, value?: Record<string, unknown>) {
    const selected = pending; if (!selected) return;
    pending = undefined; clearTimeout(selected.timer); selected.signal.removeEventListener('abort', selected.cancel);
    if (error) selected.reject(error); else selected.resolve(value!);
  }
  function finish(confirmed: boolean) {
    if (finished) return;
    finished = true; stopping = true; snapshot = undefined;
    clearTimeout(startupTimer); clearInterval(heartbeat); clearTimeout(killTimer); clearTimeout(exitTimer);
    startupSignal.removeEventListener('abort', cancelStartup);
    rejectStartup(new Error('菜单会话已结束'));
    settlePending(failure('菜单会话已结束，请重新观察；结果未知时不要重试动作'));
    buffer = Buffer.alloc(0);
    child.stdout.removeListener('data', onData);
    child.stderr.removeListener('data', onStderr);
    child.removeListener('exit', onExit); child.removeListener('close', onExit);
    for (const stream of emitters) {
      stream.removeListener('error', onError); stream.on('error', ignoreTerminatedError);
    }
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    resolveClosed(confirmed);
  }
  function close() {
    if (stopping || finished) return;
    stopping = true; snapshot = undefined;
    clearInterval(heartbeat); clearTimeout(startupTimer);
    startupSignal.removeEventListener('abort', cancelStartup);
    rejectStartup(new Error('菜单会话已关闭'));
    settlePending(failure('菜单会话已取消；已发送的操作结果未知，请重新观察'));
    killTimer = setTimeout(() => {
      if (finished) return;
      try { child.kill('SIGKILL'); } catch { /* Closure requires an actual process event. */ }
      if (!finished) { exitTimer = setTimeout(() => finish(false), 300); exitTimer.unref(); }
    }, 300); killTimer.unref();
    try { child.stdin.end(); } catch { /* TERM follows. */ }
    if (!finished) try { child.kill('SIGTERM'); } catch { /* Bounded KILL follows. */ }
  }
  function fail(message: string) {
    rejectStartup(new Error(message)); settlePending(failure(message)); close();
  }
  function onData(chunk: Buffer) {
    if (stopping || finished) return;
    const maximum = pending?.command === 'capture' || pending?.command === 'captureWindow' ? 12 * 1024 * 1024 + 4096 : 256 * 1024;
    if (buffer.length + chunk.length > maximum) { fail('菜单 helper 输出超限'); return; }
    buffer = Buffer.concat([buffer, chunk]);
    let newline: number;
    try {
      while ((newline = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
        if (!line.length) throw new Error('empty frame');
        const result: unknown = JSON.parse(line.toString('utf8'));
        if (!started) {
          if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
            const refusal = fields(result, ['ok', 'dispatched', 'error']);
            const error = fields(refusal.error, ['code', 'message']); token(error.code); text(error.message, 1024);
            if (refusal.dispatched !== false) throw new Error('invalid startup refusal');
            fail(`菜单会话启动失败（${error.code}），尚未发送菜单操作`); return;
          }
          const ready = fields(result, ['ok', 'ready']);
          if (ready.ok !== true || ready.ready !== true) throw new Error('not ready');
          started = true; clearTimeout(startupTimer); startupSignal.removeEventListener('abort', cancelStartup);
          resolveStartup(); continue;
        }
        const source = result as Record<string, unknown>;
        if (!source || typeof source !== 'object' || source.requestId !== pending?.id) throw new Error('unmatched menu response');
        if (source.event === 'dispatched') {
          fields(source, ['ok', 'requestId', 'event']);
          if (source.ok !== true || !pending || pending.command !== 'action' || pending.dispatched) throw new Error('invalid dispatch acknowledgement');
          pending.dispatched = true; pending.onDispatched?.(); continue;
        }
        if (source.ok === false) {
          fields(source, ['ok', 'requestId', 'dispatched', 'error']);
          const error = fields(source.error, ['code', 'message']); token(error.code); text(error.message, 1024);
          if (source.dispatched !== false && source.dispatched !== 'unknown'
            || source.dispatched === false && pending?.dispatched) throw new Error('invalid failure receipt');
          if (pending?.command !== 'captureWindow') snapshot = undefined;
          settlePending(new AgentComputerInputError(`菜单操作未完成（${error.code}），请重新观察窗口`,
            source.dispatched === 'unknown' ? 'unknown' : 'not-dispatched'));
        } else if (source.ok === true) {
          if (pending?.command === 'action' && !pending.dispatched) throw new Error('missing dispatch acknowledgement');
          settlePending(undefined, source);
        }
        else throw new Error('invalid menu response');
      }
    } catch { fail('菜单 helper 回执无效；已发送的操作不可自动重放'); }
  }
  function onStderr(chunk: Buffer) { stderrBytes += chunk.length; if (stderrBytes > 64 * 1024) fail('菜单 helper 诊断输出超限'); }
  const cancelStartup = () => close();
  const startupTimer = setTimeout(() => fail('菜单会话启动超时'), 3000); startupTimer.unref();
  const heartbeat = setInterval(() => {
    if (stopping || finished) return;
    try { if (!child.stdin.write('\n')) fail('菜单会话管道阻塞'); } catch { fail('菜单会话连接断开'); }
  }, 750); heartbeat.unref();
  child.stdout.on('data', onData); child.stderr.on('data', onStderr);
  function onError() {
    if (!finished && !stopping) fail('菜单会话进程或管道失败');
  }
  function onExit() { finish(true); }
  for (const stream of emitters) stream.on('error', onError);
  child.once('exit', onExit); child.once('close', onExit);
  startupSignal.addEventListener('abort', cancelStartup, { once: true });
  try { child.stdin.write(`${JSON.stringify({ window: target })}\n`); } catch { fail('菜单会话初始化失败'); }
  if (startupSignal.aborted) close();
  try { await startup; }
  catch (error) {
    close();
    // A failed constructor must keep ownership until exit is confirmed too.
    // Otherwise callers cannot await a lease that was never returned.
    if (!await closed) throw new AgentComputerMenuSessionCloseError();
    startupSignal.throwIfAborted();
    throw error;
  }

  async function request(command: string, input: Record<string, unknown>, signal: AbortSignal,
    onDispatched?: () => void): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (stopping || finished || pending) throw new AgentComputerInputError('菜单会话已关闭或正在处理另一个操作', 'not-dispatched');
    return await new Promise((resolve, reject) => {
      const id = String(++sequence);
      const cancel = () => close();
      const timer = setTimeout(() => fail('菜单操作超时；请重新观察，不要重试未知动作'),
        command === 'capture' || command === 'captureWindow' ? 15000 : 5000);
      timer.unref();
      pending = { id, command, sent: false, dispatched: false, signal, cancel, timer, resolve, reject, onDispatched };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { close(); return; }
      // Once handed to the pipe the native action may happen even if its ACK is lost.
      pending.sent = true;
      try { if (!child.stdin.write(`${JSON.stringify({ requestId: id, command, ...input })}\n`)) fail('菜单会话管道阻塞'); }
      catch { fail('菜单操作发送失败'); }
    });
  }
  return {
    close, closed,
    async captureWindow(input, signal) {
      signal.throwIfAborted();
      const source = fields(input, [], ['pointerWindow']);
      const prepared = prepareAgentComputerWindowCapture(target, source.pointerWindow);
      const result = await request('captureWindow', prepared.pointerWindow ? { pointerWindow: prepared.pointerWindow } : {}, signal);
      signal.throwIfAborted();
      // request() already verifies the request ID. Its framing field is the
      // sole difference from the exact ordinary-window capture receipt.
      const receipt = { ...result }; delete receipt.requestId;
      try { return parseAgentComputerWindowCapture(receipt, prepared); }
      catch (error) { close(); throw error; }
    },
    async observe(signal) {
      snapshot = undefined;
      const result = await request('observe', {}, signal);
      try { snapshot = observation(result, target); return structuredClone(snapshot); }
      catch { close(); throw new AgentComputerInputError('菜单观察回执无效', 'not-dispatched'); }
    },
    async resolvePointer(input, signal) {
      const source = fields(input, ['observationId', 'itemId', 'operation']);
      const selected = { observationId: token(source.observationId), itemId: token(source.itemId), operation: operation(source.operation) };
      const current = snapshot;
      const item = current?.items.find(item => item.itemId === selected.itemId && item.operations.includes(selected.operation));
      if (!current || current.observationId !== selected.observationId || !item) {
        throw new AgentComputerInputError('菜单项已失效或未声明此操作，请重新观察', 'not-dispatched');
      }
      const result = await request('resolvePointer', selected, signal);
      try { return pointerResult(result, current, item, target); }
      catch { close(); throw new AgentComputerInputError('菜单鼠标位置回执无效', 'not-dispatched'); }
    },
    async action(input, signal, onDispatched) {
      const source = fields(input, ['observationId', 'itemId', 'operation']);
      const selected = { observationId: token(source.observationId), itemId: token(source.itemId), operation: operation(source.operation) };
      if (!snapshot || snapshot.observationId !== selected.observationId
        || !snapshot.items.some(item => item.itemId === selected.itemId && item.operations.includes(selected.operation))) {
        throw new AgentComputerInputError('菜单项已失效或未声明此操作，请重新观察', 'not-dispatched');
      }
      signal.throwIfAborted(); snapshot = undefined;
      const result = await request('action', selected, signal, onDispatched);
      try {
        fields(result, ['ok', 'requestId', 'dispatched']);
        if (result.dispatched !== true) throw new Error('invalid action receipt');
      } catch { close(); throw new AgentComputerInputError('菜单操作回执无效，请重新观察而不要重试', 'unknown'); }
    },
    async capture(input, signal) {
      const source = fields(input, ['observationId'], ['pointerWindow']);
      const id = token(source.observationId);
      if (!snapshot || snapshot.observationId !== id) throw new AgentComputerInputError('菜单截图观察已失效', 'not-dispatched');
      const current = snapshot;
      const pointerWindow = source.pointerWindow === undefined ? undefined : windowIdentity(source.pointerWindow, true);
      if (pointerWindow && (pointerWindow.pid === target.pid || ![0, 102].includes(pointerWindow.layer)
        || pointerWindow.bounds.width > 36 || pointerWindow.bounds.height > 36
        || ![target.bounds, ...current.menus.map(menu => menu.bounds)].some(area => {
          const pointer = pointerWindow.bounds;
          return pointer.x < area.x + area.width && pointer.x + pointer.width > area.x
            && pointer.y < area.y + area.height && pointer.y + pointer.height > area.y;
        }))) throw new AgentComputerInputError('菜单鼠标截图范围无效', 'not-dispatched');
      const result = await request('capture', { observationId: id, ...(pointerWindow ? { pointerWindow } : {}) }, signal);
      try { return captureResult(result, current, target, pointerWindow); }
      catch { close(); throw new AgentComputerInputError('菜单截图回执无效', 'not-dispatched'); }
    },
  };
}
