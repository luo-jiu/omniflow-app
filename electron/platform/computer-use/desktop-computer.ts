import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, desktopCapturer, screen, systemPreferences } from 'electron';
import { normalizeComputerElementOperations, validateComputerText, type ComputerElementOperation } from '../../../src/shared/computer-use/computer-use-contract';

export interface AgentComputerDisplay {
  id: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface AgentComputerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentComputerCandidate {
  path: number[];
  role: string;
  title: string;
  /** Native clicks revalidate the exact value of each supplied semantic field. */
  description?: string;
  subrole?: string;
  identifier?: string;
  bounds: AgentComputerRect;
  /** Missing only on legacy AXPress helper receipts. New helpers always declare capabilities. */
  operations?: ComputerElementOperation[];
  /** Private classification/selection fingerprint; never contains original text. */
  textState?: { subrole: string | null; selection?: { location: number; length: number } };
  orientation?: 'vertical' | 'horizontal';
  /** Frozen AXEnabled presence/value; absence needs a proven native semantic profile. */
  enabledState?: 'enabled' | 'absent';
  /** Private numeric scrollbar fingerprint; not a page or pixel distance. */
  scrollState?: { value: number; minValue: number; maxValue: number };
  /** Private preselected identity route; never a fallback after a failed getter. */
  identityProfile?: 'native-text-identifier-v1' | 'native-scroll-button-v1';
  /** Bound support-list state; only present on the text identifier profile. */
  descriptionDeclared?: boolean;
  /** Complete AX document rectangle, retained when a strict text viewport is clipped. */
  documentBounds?: AgentComputerRect;
  /** Private parent scrollbar fingerprint for real AX page-button actions. */
  scrollButtonState?: { parentBounds: AgentComputerRect; orientation: 'vertical' | 'horizontal' };
}

export interface AgentComputerSetTextRequest {
  target: { window: AgentComputerWindowIdentity; candidate: AgentComputerCandidate };
  operation: 'replaceText' | 'insertText';
  text: string;
}

export interface AgentComputerScrollRequest {
  target: { window: AgentComputerWindowIdentity; candidate: AgentComputerCandidate };
  operation: ComputerElementOperation;
}

export interface AgentComputerWindowIdentity {
  windowId: number;
  pid: number;
  processStartedAt: number;
  layer: number;
  bounds: AgentComputerRect;
  title?: string;
}

export interface AgentComputerSharedWindow extends AgentComputerWindowIdentity {
  applicationLabel: string;
  windowLabel: string;
}

/** Front-to-back windows, including non-actionable windows that block the screenshot point. */
export interface AgentComputerTarget extends Omit<AgentComputerWindowIdentity, 'processStartedAt'> {
  processStartedAt: number | null;
  candidates: AgentComputerCandidate[];
}

export interface AgentComputerWindowTargetObservation {
  target: AgentComputerTarget;
  truncated: boolean;
  /** Optional together for compatibility with older native helpers. */
  axTree?: string;
  axTreeTruncated?: boolean;
  /** Private absolute AX path of a requested local scan; never a public element ID. */
  scope?: { path: number[] };
}

export interface AgentComputerObservationScope {
  anchor: AgentComputerCandidate;
  ancestorLevels: number;
}

export interface AgentComputerPoint {
  x: number;
  y: number;
  button: 'left' | 'right';
  clickCount: 1 | 2;
  target: { window: AgentComputerWindowIdentity; candidate: AgentComputerCandidate };
}

export class AgentComputerInputError extends Error {
  constructor(message: string, readonly dispatchState: 'not-dispatched' | 'unknown') {
    super(message);
    this.name = 'AgentComputerInputError';
  }
}

export function getAgentComputerDisplays(): AgentComputerDisplay[] {
  if (process.platform !== 'darwin') throw new Error('屏幕点击目前仅支持 macOS');
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().slice(0, 16).sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId))
    .map((display, index) => ({
      id: String(display.id),
      label: [...String(display.label || `屏幕 ${index + 1}`)].filter(char => {
        const code = char.codePointAt(0)!;
        return code >= 32 && !(code >= 127 && code <= 159) && !(code >= 0x202a && code <= 0x202e)
          && !(code >= 0x2066 && code <= 0x2069);
      }).join('').slice(0, 160) || `屏幕 ${index + 1}`,
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
    }));
}

export async function captureAgentComputerDisplay(display: AgentComputerDisplay, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (systemPreferences.getMediaAccessStatus('screen') === 'denied') {
    throw new Error('请在 macOS 系统设置 → 隐私与安全性 → 屏幕录制中允许 OmniFlow，再重新启动应用');
  }
  const sources = await new Promise<Awaited<ReturnType<typeof desktopCapturer.getSources>>>((resolve, reject) => {
    const cancel = () => finish(new DOMException('屏幕查看已取消', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('屏幕截图超时，请检查屏幕录制权限后重试')), 15_000);
    timer.unref();
    let settled = false;
    function finish(error?: Error, value?: Awaited<ReturnType<typeof desktopCapturer.getSources>>) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value!);
    }
    signal.addEventListener('abort', cancel, { once: true });
    void desktopCapturer.getSources({
      types: ['screen'], thumbnailSize: { width: 2048, height: 2048 }, fetchWindowIcons: false,
    }).then(value => finish(undefined, value), error => finish(error));
    if (signal.aborted) cancel();
  });
  signal.throwIfAborted();
  const source = sources.find(item => item.display_id === display.id);
  if (!source || source.thumbnail.isEmpty()) throw new Error('未能获取此屏幕；请检查屏幕录制权限后重试');
  return source.thumbnail.toPNG();
}

export function resolveAgentComputerHelperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'computer-use', 'omniflow-click')
    : path.join(app.getAppPath(), 'build', 'native', 'computer-use', `darwin-${process.arch}`, 'omniflow-click');
}

function objectFields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object');
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) {
    throw new Error('invalid fields');
  }
  return Object.fromEntries(keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid property');
    return [key, descriptor.value];
  }));
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('invalid integer');
  return value;
}

function textField(value: unknown, maximumBytes: number, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || Buffer.byteLength(value, 'utf8') > maximumBytes
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('invalid text');
  return value;
}

function rect(value: unknown): AgentComputerRect {
  const fields = objectFields(value, ['x', 'y', 'width', 'height']);
  if (Object.values(fields).some(item => typeof item !== 'number' || !Number.isFinite(item))
    || Math.abs(Number(fields.x)) > 10_000_000 || Math.abs(Number(fields.y)) > 10_000_000
    || Number(fields.width) <= 0 || Number(fields.height) <= 0 || Number(fields.width) > 100_000 || Number(fields.height) > 100_000) {
    throw new Error('invalid rectangle');
  }
  return fields as unknown as AgentComputerRect;
}

function containsRect(outer: AgentComputerRect, inner: AgentComputerRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function candidate(value: unknown): AgentComputerCandidate {
  const fields = objectFields(value, ['path', 'role', 'title', 'bounds'], ['description', 'subrole', 'identifier', 'operations', 'textState', 'orientation', 'enabledState', 'scrollState', 'identityProfile', 'descriptionDeclared', 'documentBounds', 'scrollButtonState']);
  if (!Array.isArray(fields.path) || fields.path.length > 32) throw new Error('invalid path');
  const semantics: Pick<AgentComputerCandidate, 'description' | 'subrole' | 'identifier'> = {};
  for (const name of ['description', 'subrole', 'identifier'] as const) {
    if (!(name in fields)) continue;
    const text = textField(fields[name], name === 'subrole' ? 64 : 256);
    if ([...text].some(char => {
      const code = char.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159)
        || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    })) throw new Error('invalid semantic text');
    semantics[name] = text;
  }
  const operations = fields.operations === undefined ? undefined : normalizeComputerElementOperations(fields.operations);
  const capabilities = operations ?? ['press'];
  let textState: AgentComputerCandidate['textState'];
  if ('textState' in fields) {
    const state = objectFields(fields.textState, ['subrole'], ['selection']);
    const subrole = state.subrole === null ? null : textField(state.subrole, 64);
    if (subrole !== null && [...subrole].some(character => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    })) throw new Error('invalid text classification');
    textState = { subrole };
    if ('selection' in state) {
      const selection = objectFields(state.selection, ['location', 'length']);
      const location = integer(selection.location, 0, Number.MAX_SAFE_INTEGER);
      const length = integer(selection.length, 0, Number.MAX_SAFE_INTEGER - location);
      textState.selection = { location, length };
    }
  }
  const hasText = capabilities.includes('replaceText') || capabilities.includes('insertText');
  if (hasText !== Boolean(textState)
    || (capabilities.includes('insertText') && !textState?.selection)
    || (textState && !((fields.role === 'AXTextField' && ['AXTextField', 'AXSearchField'].includes(textState.subrole || ''))
      || (fields.role === 'AXTextArea' && !textState.subrole?.includes('Secure'))))) throw new Error('invalid text capability');
  const oriented = capabilities.filter(operation => operation.endsWith('Step') || operation.endsWith('Fraction'));
  let orientation: AgentComputerCandidate['orientation'];
  if ('orientation' in fields) {
    if (fields.orientation !== 'vertical' && fields.orientation !== 'horizontal') throw new Error('invalid orientation');
    orientation = fields.orientation;
  }
  if (Boolean(oriented.length) !== Boolean(orientation) || (oriented.length && (fields.role !== 'AXScrollBar'
    || oriented.some(operation => orientation === 'vertical' ? !['scrollUpStep', 'scrollDownStep', 'scrollUpFraction', 'scrollDownFraction'].includes(operation)
      : !['scrollLeftStep', 'scrollRightStep', 'scrollLeftFraction', 'scrollRightFraction'].includes(operation))))) throw new Error('invalid scroll capability');
  let scrollState: AgentComputerCandidate['scrollState'];
  if ('scrollState' in fields) {
    const state = objectFields(fields.scrollState, ['value', 'minValue', 'maxValue']);
    if (![state.value, state.minValue, state.maxValue].every(number => typeof number === 'number' && Number.isFinite(number))) throw new Error('invalid scroll numbers');
    const value = state.value as number; const minValue = state.minValue as number; const maxValue = state.maxValue as number;
    const range = maxValue - minValue;
    if (!(minValue < maxValue && Number.isFinite(range) && range / 10 > 0 && value >= minValue && value <= maxValue)) throw new Error('invalid scroll range');
    scrollState = { value, minValue, maxValue };
  }
  if (capabilities.some(operation => operation.endsWith('Fraction')) !== Boolean(scrollState)) throw new Error('invalid scroll state');
  const bounds = rect(fields.bounds);
  let scrollButtonState: AgentComputerCandidate['scrollButtonState'];
  if ('scrollButtonState' in fields) {
    const state = objectFields(fields.scrollButtonState, ['parentBounds', 'orientation']);
    const parentBounds = rect(state.parentBounds);
    if ((state.orientation !== 'vertical' && state.orientation !== 'horizontal')
      || !containsRect(parentBounds, bounds)) throw new Error('invalid scroll button state');
    scrollButtonState = { parentBounds, orientation: state.orientation };
  }
  let enabledState: AgentComputerCandidate['enabledState'];
  if ('enabledState' in fields) {
    if (fields.enabledState !== 'enabled' && fields.enabledState !== 'absent') throw new Error('invalid enabled state');
    enabledState = fields.enabledState;
    if (enabledState === 'absent' && capabilities.some(operation => !(
      (fields.role === 'AXTextArea' && (operation === 'replaceText' || operation === 'insertText'))
      || (fields.role === 'AXScrollArea' && ['scrollUpPage', 'scrollDownPage', 'scrollLeftPage', 'scrollRightPage'].includes(operation))
      || (fields.role === 'AXButton' && fields.identityProfile === 'native-scroll-button-v1'
        && ['scrollUpPage', 'scrollDownPage', 'scrollLeftPage', 'scrollRightPage'].includes(operation))
    ))) throw new Error('invalid missing enabled capability');
  }
  if (!enabledState && capabilities.some(operation => operation !== 'press')) throw new Error('unbound semantic enabled state');
  let identityProfile: AgentComputerCandidate['identityProfile'];
  let descriptionDeclared: boolean | undefined;
  if ('identityProfile' in fields) {
    if (fields.identityProfile === 'native-text-identifier-v1') {
      if (fields.role !== 'AXTextArea' || fields.title !== ''
        || 'description' in fields || !semantics.identifier?.trim() || !operations || scrollButtonState
        || !capabilities.every(operation => operation === 'replaceText' || operation === 'insertText')
        || !textState || typeof fields.descriptionDeclared !== 'boolean') throw new Error('invalid native text identity profile');
      identityProfile = fields.identityProfile;
      descriptionDeclared = fields.descriptionDeclared;
    } else if (fields.identityProfile === 'native-scroll-button-v1') {
      const expected = semantics.subrole === 'AXIncrementPage'
        ? scrollButtonState?.orientation === 'vertical' ? 'scrollDownPage' : 'scrollRightPage'
        : semantics.subrole === 'AXDecrementPage'
          ? scrollButtonState?.orientation === 'vertical' ? 'scrollUpPage' : 'scrollLeftPage' : undefined;
      if (fields.role !== 'AXButton' || fields.path.length === 0 || enabledState !== 'absent' || !scrollButtonState
        || !operations || operations.length !== 1 || operations[0] !== expected
        || 'description' in fields || 'identifier' in fields
        || [...textField(fields.title, 256)].some(character => {
          const code = character.codePointAt(0)!;
          return code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
        })
        || textState || orientation || scrollState || 'documentBounds' in fields || 'descriptionDeclared' in fields) throw new Error('invalid native scroll button identity profile');
      identityProfile = fields.identityProfile;
    } else throw new Error('invalid identity profile');
  } else if ('descriptionDeclared' in fields) throw new Error('unbound description declaration');
  if (scrollButtonState && identityProfile !== 'native-scroll-button-v1') throw new Error('unbound scroll button state');
  let documentBounds: AgentComputerRect | undefined;
  if ('documentBounds' in fields) {
    documentBounds = rect(fields.documentBounds);
    if (identityProfile !== 'native-text-identifier-v1' || !containsRect(documentBounds, bounds)
      || ['x', 'y', 'width', 'height'].every(key => documentBounds![key as keyof AgentComputerRect] === bounds[key as keyof AgentComputerRect])) throw new Error('invalid clipped text geometry');
  }
  return { path: fields.path.map(index => integer(index, 0, 63)), role: textField(fields.role, 64, false),
    title: textField(fields.title, 256), ...semantics, bounds,
    ...(operations ? { operations } : {}), ...(textState ? { textState } : {}), ...(orientation ? { orientation } : {}), ...(enabledState ? { enabledState } : {}),
    ...(scrollState ? { scrollState } : {}), ...(identityProfile ? { identityProfile } : {}),
    ...(descriptionDeclared === undefined ? {} : { descriptionDeclared }), ...(documentBounds ? { documentBounds } : {}),
    ...(scrollButtonState ? { scrollButtonState } : {}) };
}

function windowIdentity(value: unknown, allowUnknownProcess: boolean): Omit<AgentComputerTarget, 'candidates'> {
  const fields = objectFields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds'], ['title']);
  return { windowId: integer(fields.windowId, 1, 0xffffffff), pid: integer(fields.pid, allowUnknownProcess ? 0 : 1, 0x7fffffff),
    processStartedAt: allowUnknownProcess && fields.processStartedAt === null ? null : integer(fields.processStartedAt, 1, Number.MAX_SAFE_INTEGER),
    layer: integer(fields.layer, 0, 0x7fffffff), bounds: rect(fields.bounds),
    ...(fields.title !== undefined ? { title: textField(fields.title, 256) } : {}) };
}

type HelperMode = '--set-text' | '--scroll' | '--status' | '--parent-activity' | '--request-permission' | '--targets' | '--click' | '--windows' | '--window-targets' | '--window-capture';

async function runHelper(mode: HelperMode, signal: AbortSignal, input?: unknown): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  if (process.platform !== 'darwin') throw new AgentComputerInputError('屏幕点击目前仅支持 macOS', 'not-dispatched');
  const mutation = mode === '--click' || mode === '--set-text' || mode === '--scroll';
  return new Promise((resolve, reject) => {
    const child = spawn(resolveAgentComputerHelperPath(), [mode], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    let size = 0;
    let finished = false;
    let launched = false;
    const settle = (error?: Error, result?: Record<string, unknown>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => {
      // A mutation may already have entered the application's callback. Wait for its
      // receipt on ordinary cancellation; interrupting it cannot undo the action.
      if (mutation) return;
      settle(new DOMException('屏幕操作已取消', 'AbortError'));
      child.kill();
    };
    const timer = setTimeout(() => {
      settle(new AgentComputerInputError(mode === '--window-capture' ? '共享窗口截图超时，请重新查看窗口' : '屏幕输入超时；请重新查看屏幕，勿直接重复点击', mutation ? 'unknown' : 'not-dispatched'));
      child.kill('SIGKILL');
    }, mode === '--parent-activity' ? 500 : mode === '--window-capture' ? 15_000 : 5_000);
    timer.unref();
    signal.addEventListener('abort', cancel, { once: true });
    child.once('spawn', () => { launched = true; });
    child.on('error', () => settle(new AgentComputerInputError(launched && mutation
      ? '屏幕操作回执丢失，请先重新查看窗口' : '屏幕操作组件不可用，请重新构建或安装 OmniFlow', launched && mutation ? 'unknown' : 'not-dispatched')));
    child.stdout.on('data', (bytes: Buffer) => {
      size += bytes.length;
      const maximumOutput = mode === '--parent-activity' ? 512 : mode === '--window-capture' ? 12 * 1024 * 1024
        : mode === '--targets' || mode === '--windows' || mode === '--window-targets' ? 64 * 1024 : 4096;
      if (size > maximumOutput) {
        settle(new AgentComputerInputError('屏幕输入回执无效；请先重新查看屏幕', mutation ? 'unknown' : 'not-dispatched'));
        child.kill('SIGKILL');
      } else output.push(bytes);
    });
    child.stderr.resume();
    child.stdin.on('error', () => { /* The close/error event supplies the authoritative process result. */ });
    child.on('close', code => {
      if (finished) return;
      try {
        const result = JSON.parse(Buffer.concat(output, size).toString('utf8')) as Record<string, unknown>;
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid');
        if (code !== 0 || result.ok === false) {
          const reason = result.error as { code?: string } | undefined;
          const permissionDenied = reason?.code === 'permission_denied';
          settle(new AgentComputerInputError(reason?.code === 'screen_permission_denied'
            ? '请在 macOS 系统设置 → 隐私与安全性 → 屏幕录制中允许 OmniFlow 后重新查看窗口'
            : reason?.code === 'window_capture_unavailable' ? '共享窗口截图需要 macOS 14 或更新版本'
            : permissionDenied
            ? '请在 macOS 系统设置 → 隐私与安全性 → 辅助功能中允许 OmniFlow 后，重新查看屏幕再点击'
            : reason?.code === 'unsupported_action' ? '后台控件操作仅支持左键单击；请重新查看屏幕'
            : '后台控件操作失败；请先重新查看屏幕', result.dispatched === 'unknown' ? 'unknown'
              : result.dispatched === false || permissionDenied ? 'not-dispatched' : 'unknown'));
        } else if (mutation && (result.ok !== true || result.dispatched !== true)) {
          settle(new AgentComputerInputError('未收到操作回执；请先重新查看屏幕', 'unknown'));
        } else settle(undefined, result);
      } catch { settle(new AgentComputerInputError('屏幕输入回执不可读取；请先重新查看屏幕', mutation ? 'unknown' : 'not-dispatched')); }
    });
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
    if (signal.aborted) cancel();
  });
}

export async function statusAgentComputerClick(signal: AbortSignal): Promise<{ available: boolean; accessibilityTrusted: boolean }> {
  const result = await runHelper('--status', signal);
  return { available: result.available === true, accessibilityTrusted: result.accessibilityTrusted === true };
}

/** Optional read-only diagnostic for the directly spawning main process; never an execution gate. */
export async function getAgentComputerParentActivity(signal: AbortSignal): Promise<boolean | undefined> {
  try {
    const result = objectFields(await runHelper('--parent-activity', signal), ['ok', 'known', 'active']);
    if (result.ok !== true || typeof result.known !== 'boolean' || typeof result.active !== 'boolean'
      || (!result.known && result.active)) return undefined;
    return result.known ? result.active : undefined;
  } catch { return undefined; }
}

export async function requestAgentComputerClickPermission(signal: AbortSignal): Promise<void> {
  await runHelper('--request-permission', signal);
}

export async function getAgentComputerTargets(display: AgentComputerDisplay, signal: AbortSignal): Promise<{ targets: AgentComputerTarget[]; truncated: boolean }> {
  signal.throwIfAborted();
  let displayBounds: AgentComputerRect;
  try { displayBounds = rect(display.bounds); }
  catch { throw new AgentComputerInputError('屏幕范围无效，请重新查看屏幕', 'not-dispatched'); }
  if (process.platform === 'darwin') app.setAccessibilitySupportEnabled(true);
  const result = await runHelper('--targets', signal, { displayBounds });
  return parseTargetsReceipt(result);
}

function parseTargetsReceipt(result: Record<string, unknown>): { targets: AgentComputerTarget[]; truncated: boolean } {
  try {
    const fields = objectFields(result, ['ok', 'targets', 'truncated']);
    if (fields.ok !== true || typeof fields.truncated !== 'boolean' || !Array.isArray(fields.targets) || fields.targets.length > 64) throw new Error('invalid targets');
    let count = 0;
    let textBytes = 0;
    const windowIds = new Set<number>();
    const targets = fields.targets.map(value => {
      const fields = objectFields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds', 'candidates'], ['title']);
      const { candidates: rawCandidates, ...rawWindow } = fields;
      const window = windowIdentity(rawWindow, true);
      if (windowIds.has(window.windowId) || !Array.isArray(rawCandidates)) throw new Error('invalid window');
      windowIds.add(window.windowId);
      const candidates = rawCandidates.map(candidate);
      count += candidates.length;
      textBytes += Buffer.byteLength(window.title || '', 'utf8');
      const paths = new Set<string>();
      for (const item of candidates) {
        textBytes += [item.title, item.role, item.description, item.subrole, item.identifier]
          .reduce<number>((bytes, value) => bytes + Buffer.byteLength(value || '', 'utf8'), 0) + Buffer.byteLength(item.textState?.subrole || '', 'utf8');
        const key = item.path.join(',');
        if (paths.has(key) || !containsRect(window.bounds, item.bounds)
          || (item.documentBounds && containsRect(window.bounds, item.documentBounds))) throw new Error('invalid candidate');
        paths.add(key);
      }
      if (count > 128 || textBytes > 12 * 1024 || ((window.layer !== 0 || !window.processStartedAt || !window.pid) && candidates.length)) {
        throw new Error('invalid target budget');
      }
      return { ...window, candidates };
    });
    return { targets, truncated: fields.truncated };
  } catch { throw new AgentComputerInputError('后台控件观察回执无效，请重新查看屏幕', 'not-dispatched'); }
}

function sharedWindowIdentity(value: unknown): AgentComputerWindowIdentity {
  const fields = objectFields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds'], ['title', 'applicationLabel', 'windowLabel']);
  const { applicationLabel, windowLabel, ...identity } = fields;
  if (applicationLabel !== undefined) textField(applicationLabel, 256, false);
  if (windowLabel !== undefined) textField(windowLabel, 256, false);
  const window = windowIdentity(identity, false) as AgentComputerWindowIdentity;
  if (window.layer !== 0) throw new Error('invalid layer');
  return window;
}

function sameWindow(a: AgentComputerWindowIdentity | AgentComputerTarget, b: AgentComputerWindowIdentity): boolean {
  return a.windowId === b.windowId && a.pid === b.pid && a.processStartedAt === b.processStartedAt && a.layer === b.layer
    && a.title === b.title && a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y
    && a.bounds.width === b.bounds.width && a.bounds.height === b.bounds.height;
}

function requestedWindow(value: AgentComputerWindowIdentity): AgentComputerWindowIdentity {
  try { return sharedWindowIdentity(value); }
  catch { throw new AgentComputerInputError('共享窗口身份无效，请重新选择窗口', 'not-dispatched'); }
}

/** Metadata only: this neither captures thumbnails nor opens another application's AX tree. */
export async function getAgentComputerWindows(signal: AbortSignal): Promise<{ windows: AgentComputerSharedWindow[]; truncated: boolean }> {
  const result = await runHelper('--windows', signal);
  try {
    const fields = objectFields(result, ['ok', 'windows', 'truncated']);
    if (fields.ok !== true || typeof fields.truncated !== 'boolean' || !Array.isArray(fields.windows) || fields.windows.length > 64) throw new Error('invalid windows');
    const ids = new Set<number>();
    let textBytes = 0;
    const windows = fields.windows.map(value => {
      const fields = objectFields(value, ['windowId', 'pid', 'processStartedAt', 'layer', 'bounds', 'applicationLabel', 'windowLabel'], ['title']);
      const window = sharedWindowIdentity(fields);
      const applicationLabel = textField(fields.applicationLabel, 256, false);
      const windowLabel = textField(fields.windowLabel, 256, false);
      if (ids.has(window.windowId)) throw new Error('duplicate window');
      ids.add(window.windowId);
      textBytes += Buffer.byteLength(applicationLabel, 'utf8') + Buffer.byteLength(windowLabel, 'utf8') + Buffer.byteLength(window.title || '', 'utf8');
      if (textBytes > 12 * 1024) throw new Error('invalid text budget');
      return { ...window, applicationLabel, windowLabel };
    });
    return { windows, truncated: fields.truncated };
  } catch { throw new AgentComputerInputError('共享窗口列表回执无效，请重新选择窗口', 'not-dispatched'); }
}

/** The caller must already hold a grant for this exact window/process identity. */
export async function getAgentComputerWindowTarget(window: AgentComputerWindowIdentity, signal: AbortSignal,
  scope?: AgentComputerObservationScope): Promise<AgentComputerWindowTargetObservation> {
  signal.throwIfAborted();
  const identity = requestedWindow(window);
  let requestedScope: AgentComputerObservationScope | undefined;
  let expectedScopePath: number[] | undefined;
  if (scope !== undefined) {
    try {
      const fields = objectFields(scope, ['anchor', 'ancestorLevels']);
      // candidate() rejects source and every first-party-only field rather than
      // stripping them and accidentally treating a host control as native AX.
      if (fields.anchor && typeof fields.anchor === 'object' && 'source' in fields.anchor) throw new Error('first-party scope anchor');
      const anchor = candidate(fields.anchor);
      const ancestorLevels = integer(fields.ancestorLevels, 0, Math.min(3, anchor.path.length));
      if (!containsRect(identity.bounds, anchor.bounds)
        || (anchor.documentBounds && containsRect(identity.bounds, anchor.documentBounds))) throw new Error('invalid anchor geometry');
      requestedScope = { anchor, ancestorLevels };
      expectedScopePath = anchor.path.slice(0, anchor.path.length - ancestorLevels);
    } catch { throw new AgentComputerInputError('局部观察锚点或层级无效，请重新观察原生控件', 'not-dispatched'); }
  }
  if (process.platform === 'darwin') app.setAccessibilitySupportEnabled(true);
  const result = await runHelper('--window-targets', signal, { window: identity, ...(requestedScope ? { scope: requestedScope } : {}) });
  try {
    const fields = objectFields(result, ['ok', 'target', 'truncated'], ['axTree', 'axTreeTruncated', 'scope']);
    const parsed = parseTargetsReceipt({ ok: fields.ok, targets: [fields.target], truncated: fields.truncated });
    const target = parsed.targets[0];
    if (!sameWindow(target, identity)) throw new Error('changed window');
    let observedScope: AgentComputerWindowTargetObservation['scope'];
    if (expectedScopePath !== undefined) {
      const scopeFields = objectFields(fields.scope, ['path']);
      if (!Array.isArray(scopeFields.path) || scopeFields.path.length !== expectedScopePath.length
        || scopeFields.path.some((index, offset) => integer(index, 0, 63) !== expectedScopePath![offset])
        || target.candidates.some(item => item.path.length < expectedScopePath!.length
          || expectedScopePath!.some((index, offset) => item.path[offset] !== index))) throw new Error('changed observation scope');
      observedScope = { path: [...expectedScopePath] };
    } else if ('scope' in fields) throw new Error('unexpected observation scope');
    let summary: Pick<AgentComputerWindowTargetObservation, 'axTree' | 'axTreeTruncated'> = {};
    if ('axTree' in fields || 'axTreeTruncated' in fields) {
      const axTree = textField(fields.axTree, 12 * 1024);
      const invalidCharacters = [...axTree].some(char => {
        const code = char.codePointAt(0)!;
        return (code < 32 && code !== 10) || (code >= 127 && code <= 159)
          || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
      });
      if (typeof fields.axTreeTruncated !== 'boolean' || invalidCharacters) {
        throw new Error('invalid AX summary');
      }
      summary = { axTree, axTreeTruncated: fields.axTreeTruncated };
    }
    return { target, truncated: parsed.truncated, ...summary, ...(observedScope ? { scope: observedScope } : {}) };
  } catch { throw new AgentComputerInputError('共享窗口控件回执无效，请重新查看窗口', 'not-dispatched'); }
}

/** Desktop-independent capture of one frozen window; never captures or crops the screen. */
export async function captureAgentComputerWindow(window: AgentComputerWindowIdentity, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const identity = requestedWindow(window);
  if (systemPreferences.getMediaAccessStatus('screen') === 'denied') {
    throw new AgentComputerInputError('请在 macOS 系统设置 → 隐私与安全性 → 屏幕录制中允许 OmniFlow 后重新查看窗口', 'not-dispatched');
  }
  const result = await runHelper('--window-capture', signal, { window: identity });
  signal.throwIfAborted();
  try {
    const fields = objectFields(result, ['ok', 'window', 'pngBase64', 'width', 'height']);
    const actual = windowIdentity(fields.window, false) as AgentComputerWindowIdentity;
    const width = integer(fields.width, 1, 2048);
    const height = integer(fields.height, 1, 2048);
    const encoded = fields.pngBase64;
    if (fields.ok !== true || !sameWindow(actual, identity) || typeof encoded !== 'string' || !encoded.length
      || encoded.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('invalid screenshot');
    const png = Buffer.from(encoded, 'base64');
    if (png.length < 24 || png.length > 8 * 1024 * 1024 || png.toString('base64') !== encoded
      || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR'
      || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error('invalid PNG');
    return png;
  } catch { throw new AgentComputerInputError('共享窗口截图回执无效，请重新查看窗口', 'not-dispatched'); }
}

export async function clickAgentComputerPoint(point: AgentComputerPoint, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (point.button !== 'left' || point.clickCount !== 1) throw new AgentComputerInputError('后台控件操作仅支持左键单击', 'not-dispatched');
  let request: AgentComputerPoint;
  try {
    const fields = objectFields(point, ['x', 'y', 'button', 'clickCount', 'target']);
    const target = objectFields(fields.target, ['window', 'candidate']);
    const window = windowIdentity(target.window, false) as AgentComputerWindowIdentity;
    const element = candidate(target.candidate);
    if (!(element.operations ?? ['press']).includes('press') || window.layer !== 0 || !containsRect(window.bounds, element.bounds)
      || typeof fields.x !== 'number' || typeof fields.y !== 'number' || !Number.isFinite(fields.x) || !Number.isFinite(fields.y)
      || fields.x < element.bounds.x || fields.x >= element.bounds.x + element.bounds.width
      || fields.y < element.bounds.y || fields.y >= element.bounds.y + element.bounds.height) throw new Error('invalid point');
    request = { x: fields.x, y: fields.y, button: 'left', clickCount: 1, target: { window, candidate: element } };
  } catch { throw new AgentComputerInputError('后台控件目标无效，请重新查看屏幕', 'not-dispatched'); }
  await runHelper('--click', signal, request);
}


function semanticTarget(value: unknown): AgentComputerSetTextRequest['target'] {
  const fields = objectFields(value, ['window', 'candidate']);
  const window = windowIdentity(fields.window, false) as AgentComputerWindowIdentity;
  const element = candidate(fields.candidate);
  if (window.layer !== 0 || !containsRect(window.bounds, element.bounds)
    || (element.documentBounds && containsRect(window.bounds, element.documentBounds))) throw new Error('invalid target');
  return { window, candidate: element };
}

/** One native AXValue/AXSelectedText write; no focus, clipboard or key events. */
export async function setAgentComputerText(input: AgentComputerSetTextRequest, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let request: AgentComputerSetTextRequest;
  try {
    const fields = objectFields(input, ['target', 'operation', 'text']);
    if (fields.operation !== 'replaceText' && fields.operation !== 'insertText') throw new Error('invalid operation');
    const target = semanticTarget(fields.target);
    if (!target.candidate.enabledState || !target.candidate.operations?.includes(fields.operation)) throw new Error('unsupported operation');
    const text = validateComputerText(fields.text, fields.operation === 'replaceText' ? 'replace' : 'insert').text;
    request = { target, operation: fields.operation, text };
  } catch { throw new AgentComputerInputError('后台文字目标或内容无效，请重新查看窗口', 'not-dispatched'); }
  await runHelper('--set-text', signal, request);
}

/** Exactly one declared AX page action or scrollbar increment/decrement. */
export async function scrollAgentComputerControl(input: AgentComputerScrollRequest, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let request: AgentComputerScrollRequest;
  try {
    const fields = objectFields(input, ['target', 'operation']);
    const [operation] = normalizeComputerElementOperations([fields.operation]);
    if (!operation.startsWith('scroll')) throw new Error('invalid operation');
    const target = semanticTarget(fields.target);
    if (!target.candidate.enabledState || !target.candidate.operations?.includes(operation)) throw new Error('unsupported operation');
    request = { target, operation };
  } catch { throw new AgentComputerInputError('后台滚动目标无效，请重新查看窗口', 'not-dispatched'); }
  await runHelper('--scroll', signal, request);
}
