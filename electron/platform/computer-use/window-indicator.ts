import { spawn } from 'node:child_process';
import type { WindowInputPoint } from '../../../src/shared/computer-use/window-input-contract';
import { resolveAgentComputerHelperPath, type AgentComputerWindowIdentity } from './desktop-computer';

export interface AgentComputerWindowIndicatorRequest {
  window: AgentComputerWindowIdentity;
  /** Private, AX-proven popup surface. The original window remains the grant and stacking anchor. */
  menuSurface?: AgentComputerWindowIdentity;
  operation: 'click' | 'rightClick' | 'doubleClick' | 'drag';
  /** Global screen points within the frozen window or proven menu; never the system pointer. */
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
  /** Refreshes only the visual binding after main obtains a new exact observation target. */
  syncTarget?(window: AgentComputerWindowIdentity): Promise<boolean>;
  /** Actual posted mouse phases, never a preplayed trajectory or an input receipt. */
  pointerEvent?(event: AgentComputerWindowPointerEvent): void;
  /** Clears only visual press state after input settles, even if feedback was lost. */
  inputSettled?(): void;
  /** Private native surface identity for a subsequent target-bound capture. */
  snapshot?(): Promise<AgentComputerWindowIdentity | undefined>;
  /** Normal visual ending only; closed still waits for actual helper exit. */
  hide?(): void;
  dispose(): void;
}

export interface AgentComputerWindowPointerEvent {
  phase: 'down' | 'move' | 'up';
  point: WindowInputPoint;
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

function windowIdentity(value: unknown, layer = 0): AgentComputerWindowIdentity {
  const source = fields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds'], ['title', 'applicationLabel', 'windowLabel']);
  const bounds = fields(source.bounds, ['x', 'y', 'width', 'height']);
  if (Object.values(bounds).some(number => typeof number !== 'number' || !Number.isFinite(number))
    || Math.abs(Number(bounds.x)) > 10_000_000 || Math.abs(Number(bounds.y)) > 10_000_000
    || Number(bounds.width) <= 0 || Number(bounds.height) <= 0 || Number(bounds.width) > 100_000
    || Number(bounds.height) > 100_000 || source.layer !== layer) throw new Error('invalid geometry');
  for (const key of ['applicationLabel', 'windowLabel'] as const) if (key in source) label(source[key], false);
  return {
    windowId: integer(source.windowId, 0xffffffff), pid: integer(source.pid, 0x7fffffff),
    processStartedAt: integer(source.processStartedAt, Number.MAX_SAFE_INTEGER), layer,
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
  const source = fields(input, ['window', 'operation', 'point'], ['endPoint', 'accentColor', 'menuSurface']);
  const window = windowIdentity(source.window);
  const menuSurface = source.menuSurface === undefined ? undefined : windowIdentity(source.menuSurface, 101);
  if (menuSurface && (source.operation !== 'click' || menuSurface.windowId === window.windowId
    || menuSurface.pid !== window.pid || menuSurface.processStartedAt !== window.processStartedAt)) throw new Error('invalid menu binding');
  const start = point(source.point, menuSurface ?? window);
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
  fields(input, ['window', 'operation', 'point'], ['accentColor', 'menuSurface']);
  if (source.operation !== 'click' && source.operation !== 'rightClick' && source.operation !== 'doubleClick') throw new Error('invalid operation');
  return { window, operation: source.operation, point: start, ...appearance, ...(menuSurface ? { menuSurface } : {}) };
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
    let hiding = false;
    let finished = false;
    let detached = false;
    let pendingUpdate: ((shown: boolean) => void) | undefined;
    let pendingTarget: AgentComputerWindowIdentity | undefined;
    let pendingPlan: AgentComputerWindowIndicatorRequest | undefined;
    let pendingSnapshot: ((window: AgentComputerWindowIdentity | undefined) => void) | undefined;
    let pointerSequence = 0;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let output = Buffer.alloc(0);
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let confirmClosed!: (confirmed: boolean) => void;
    const closed = new Promise<boolean>(resolveClosed => { confirmClosed = resolveClosed; });
    // Native startup allows 800ms registration + 440ms fade within 1400ms;
    // leave another 200ms for process launch, pipe delivery and scheduling.
    const startupTimer = setTimeout(() => stop(), 1_600);
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
      resolve({ get shown() { return shown && !stopping && !finished; }, closed, update, syncTarget, pointerEvent, inputSettled, snapshot, hide, dispose: stop });
    };
    const detach = () => {
      if (detached) return;
      detached = true;
      clearTimeout(startupTimer); clearInterval(heartbeatTimer); clearTimeout(updateTimer);
      clearTimeout(fadeTimer); clearTimeout(killTimer); clearTimeout(exitTimer);
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
      pendingTarget = undefined;
      pendingPlan = undefined;
      pendingSnapshot?.(undefined); pendingSnapshot = undefined;
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
    const beginClosing = () => {
      stopping = true;
      clearTimeout(startupTimer); clearInterval(heartbeatTimer); clearTimeout(updateTimer);
      pendingUpdate?.(false); pendingUpdate = undefined;
      pendingTarget = undefined;
      pendingPlan = undefined;
      pendingSnapshot?.(undefined); pendingSnapshot = undefined;
      output = Buffer.alloc(0);
      settle();
    };
    const stop = () => {
      if (finished || stopping && !hiding) return;
      hiding = false;
      beginClosing();
      clearTimeout(fadeTimer);
      signal.removeEventListener('abort', cancel);
      // Immediate failures retain the original 300ms TERM + 300ms KILL wait.
      killTimer = setTimeout(hardStop, 300); killTimer.unref();
      try { child.stdin!.end(); } catch { /* TERM remains available. */ }
      if (!finished) try { child.kill('SIGTERM'); } catch { /* Hard stop remains bounded. */ }
    };
    const hide = () => {
      if (finished || stopping) return;
      if (!settled || signal.aborted) { stop(); return; }
      hiding = true;
      beginClosing();
      // Keep abort/error listeners: either can upgrade a fade to immediate
      // EOF/TERM. Normal 440ms animation has its own bounded grace period.
      fadeTimer = setTimeout(stop, 650); fadeTimer.unref();
      try { if (!child.stdin!.write('{"hide":true}\n')) stop(); } catch { stop(); }
    };
    const update = async (input: AgentComputerWindowIndicatorRequest): Promise<boolean> => {
      if (!settled || stopping || finished || pendingUpdate || pendingSnapshot) return false;
      let next: AgentComputerWindowIndicatorRequest;
      try {
        next = request(input);
        if (JSON.stringify(next.window) !== JSON.stringify(normalized.window)) throw new Error('changed window');
      } catch { stop(); return false; }
      return new Promise<boolean>(resolveUpdate => {
        pendingUpdate = resolveUpdate;
        pendingPlan = next;
        // Eight segments need up to 9*150ms placements + 650ms movement +
        // 8*16ms endpoint ticks. Native caps the complete route at 2800ms;
        // retain another 200ms for pipe delivery and host scheduling.
        updateTimer = setTimeout(stop, 3_000); updateTimer.unref();
        try { if (!child.stdin!.write(`${JSON.stringify(next)}\n`)) stop(); } catch { stop(); }
      });
    };
    const syncTarget = async (input: AgentComputerWindowIdentity): Promise<boolean> => {
      if (!settled || stopping || finished || pendingUpdate || pendingSnapshot || signal.aborted) return false;
      let target: AgentComputerWindowIdentity;
      try {
        target = windowIdentity(input);
        if (target.windowId !== normalized.window.windowId || target.pid !== normalized.window.pid
          || target.processStartedAt !== normalized.window.processStartedAt || target.layer !== normalized.window.layer) {
          throw new Error('changed attachment');
        }
      } catch { stop(); return false; }
      return new Promise<boolean>(resolveTarget => {
        pendingUpdate = resolveTarget;
        pendingTarget = target;
        // Native revalidates the supplied target and moves only its own panel.
        // The new snapshot bounds take effect after that acknowledgement.
        updateTimer = setTimeout(stop, 1_200); updateTimer.unref();
        try { if (!child.stdin!.write(`${JSON.stringify({ target })}\n`)) stop(); } catch { stop(); }
      });
    };
    const pointerEvent = (input: AgentComputerWindowPointerEvent): void => {
      if (!settled || stopping || finished || pendingTarget || signal.aborted) return;
      try {
        const event = fields(input, ['phase', 'point']);
        if (!['down', 'move', 'up'].includes(event.phase as string) || pointerSequence >= Number.MAX_SAFE_INTEGER) throw new Error('invalid pointer phase');
        const position = point(event.point, normalized.window);
        if (!child.stdin!.write(`${JSON.stringify({ pointer: { sequence: ++pointerSequence, phase: event.phase, point: position } })}\n`)) stop();
      } catch { stop(); }
    };
    const snapshot = async (): Promise<AgentComputerWindowIdentity | undefined> => {
      if (!settled || stopping || finished || pendingUpdate || pendingSnapshot || signal.aborted) return undefined;
      return new Promise(resolveSnapshot => {
        pendingSnapshot = resolveSnapshot;
        // Native allows 900ms for spring settlement and exact frame validation.
        updateTimer = setTimeout(stop, 1_200); updateTimer.unref();
        try { if (!child.stdin!.write(`${JSON.stringify({ snapshot: true })}\n`)) stop(); } catch { stop(); }
      });
    };
    const inputSettled = (): void => {
      if (!settled || stopping || finished || signal.aborted) return;
      try { if (!child.stdin!.write(`${JSON.stringify({ inputSettled: true })}\n`)) stop(); } catch { stop(); }
    };
    const cancel = () => stop();
    const failed = () => stop();
    const onExit = () => finish(true);
    const onClose = () => finish(true);
    const onData = (bytes: Buffer) => {
      if (stopping || finished) return;
      // One bounded ACK per request. Heartbeats never generate output.
      if (settled && !pendingUpdate && !pendingSnapshot || output.length + bytes.length >= (pendingSnapshot ? 2_048 : 512)) { stop(); return; }
      output = Buffer.concat([output, bytes]);
      const newline = output.indexOf(10);
      if (newline < 0) return;
      try {
        const trailing = output.subarray(newline + 1);
        if (trailing.some(byte => ![9, 10, 13, 32].includes(byte))) throw new Error('invalid trailing output');
        const receipt = fields(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output.subarray(0, newline))), ['ok', 'shown'], pendingSnapshot ? ['window'] : []);
        if (receipt.ok !== true || typeof receipt.shown !== 'boolean') throw new Error('invalid ready');
        output = Buffer.alloc(0);
        if (signal.aborted) { stop(); return; }
        if (!receipt.shown) {
          if (pendingSnapshot && !('window' in receipt)) {
            // A live attachment can be temporarily hidden in another Space,
            // or waiting for main to synchronize changed window geometry.
            clearTimeout(updateTimer);
            const resolveSnapshot = pendingSnapshot; pendingSnapshot = undefined;
            resolveSnapshot(undefined);
          } else stop();
          return;
        }
        if (!settled) settle(true);
        else if (pendingSnapshot) {
          const raw = fields(receipt.window, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds'], ['title']);
          if (raw.layer !== (normalized.menuSurface ? 102 : normalized.window.layer)) throw new Error('invalid pointer layer');
          const surface = windowIdentity({ ...raw, layer: 0 });
          const bounds = normalized.window.bounds;
          if (surface.pid !== child.pid || surface.windowId === normalized.window.windowId
            || surface.windowId === normalized.menuSurface?.windowId) throw new Error('invalid pointer identity');
          if (normalized.menuSurface) {
            // The fixed native glyph may overhang a short menu. Only its own
            // small surface around the validated hotspot is capture eligible.
            const hotspot = normalized.point;
            if (raw.layer !== 102 || surface.bounds.width > 36 || surface.bounds.height > 36
              || hotspot.x < surface.bounds.x || hotspot.x >= surface.bounds.x + surface.bounds.width
              || hotspot.y < surface.bounds.y || hotspot.y >= surface.bounds.y + surface.bounds.height) throw new Error('invalid menu pointer surface');
          } else if (surface.bounds.width > 128 || surface.bounds.height > 128
            || surface.bounds.x < bounds.x || surface.bounds.y < bounds.y
            || surface.bounds.x + surface.bounds.width > bounds.x + bounds.width
            || surface.bounds.y + surface.bounds.height > bounds.y + bounds.height) throw new Error('invalid pointer surface');
          clearTimeout(updateTimer);
          const resolveSnapshot = pendingSnapshot; pendingSnapshot = undefined;
          resolveSnapshot({ ...surface, layer: raw.layer });
        } else {
          clearTimeout(updateTimer);
          if (pendingTarget) {
            normalized = { ...normalized, window: pendingTarget };
            pendingTarget = undefined;
          }
          if (pendingPlan) {
            normalized = pendingPlan;
            pendingPlan = undefined;
          }
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
