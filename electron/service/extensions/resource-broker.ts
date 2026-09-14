import { randomUUID, createHash } from 'node:crypto';
import { LIMITS, type ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import type { PluginManifest } from './manifest';

export class PluginFault extends Error { constructor(readonly code: string, message: string) { super(message); } }
export interface OpenedResourceAuthority {
  readonly accountScope: string; readonly libraryId: number; readonly nodeId: number;
  readonly name: string; readonly size: number; readonly revision: string;
  // Host-owned authorization must include user permission and actual node/library membership.
  authorize(signal: AbortSignal): Promise<boolean>;
  currentRevision(signal: AbortSignal): Promise<string>;
  readRange(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
}
type Setting = { value: unknown; revision: number; schemaVersion: number };
export interface PluginSettingsAccess { get(scope: string, key: string): Setting | null | Promise<Setting | null>; set(scope: string, key: string, value: unknown, expectedRevision: number, schemaVersion: number): Setting | Promise<Setting>; }
export class PluginSettingsMemory implements PluginSettingsAccess {
  private entries = new Map<string, Map<string, Setting>>();
  get(scope: string, key: string): Setting | null { return structuredClone(this.entries.get(scope)?.get(key) ?? null); }
  set(scope: string, key: string, value: unknown, expectedRevision: number, schemaVersion: number): Setting {
    const items = this.entries.get(scope) ?? new Map<string, Setting>();
    const current = items.get(key);
    if ((current?.revision ?? 0) !== expectedRevision) throw new PluginFault('CONFLICT', 'Setting revision changed');
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > LIMITS.settingBytes || (!items.has(key) && items.size >= LIMITS.settingsKeys)) throw new PluginFault('LIMIT', 'Setting limit exceeded');
    const next = { value: JSON.parse(serialized), revision: expectedRevision + 1, schemaVersion };
    const prospective = new Map(items); prospective.set(key, next);
    if (Buffer.byteLength(JSON.stringify([...prospective])) > LIMITS.settingsTotalBytes) throw new PluginFault('LIMIT', 'Settings quota exceeded');
    this.entries.set(scope, prospective);
    return structuredClone(next);
  }
}
export interface PluginReadingStateStore { get(scope: string): Setting | null; set(scope: string, value: unknown, expectedRevision: number, schemaVersion: number): Setting; }
export class PluginReadingStateMemory implements PluginReadingStateStore {
  private entries = new Map<string, Setting>();
  get(scope: string) { return structuredClone(this.entries.get(scope) ?? null); }
  set(scope: string, value: unknown, expectedRevision: number, schemaVersion: number): Setting {
    if ((this.entries.get(scope)?.revision ?? 0) !== expectedRevision) throw new PluginFault('CONFLICT', 'Snapshot revision changed');
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > LIMITS.snapshotBytes || (!this.entries.has(scope) && this.entries.size >= LIMITS.snapshots)) throw new PluginFault('LIMIT', 'Snapshot limit exceeded');
    const next = { value: JSON.parse(serialized), revision: expectedRevision + 1, schemaVersion };
    const prospective = new Map(this.entries); prospective.set(scope, next);
    if (Buffer.byteLength(JSON.stringify([...prospective])) > LIMITS.snapshotsTotalBytes) throw new PluginFault('LIMIT', 'Snapshot total limit exceeded');
    this.entries = prospective;
    return structuredClone(next);
  }
}
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function fields(params: Record<string, unknown>, names: string[]) {
  if (Object.keys(params).length !== names.length || names.some(name => !Object.prototype.hasOwnProperty.call(params, name))) throw new PluginFault('BAD_REQUEST', 'Invalid parameters');
}
function integer(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
function settingKey(value: unknown): value is string { return typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(value); }

export function validateTheme(theme: ThemeSnapshot): ThemeSnapshot {
  if (!theme || theme.schemaVersion !== 1 || !Number.isSafeInteger(theme.revision) || theme.revision < 0
    || !['light', 'dark'].includes(theme.mode) || !object(theme.colors) || Object.keys(theme.colors).length > 128
    || Object.entries(theme.colors).some(([key, value]) => !/^[a-z][a-z0-9.-]{0,63}$/.test(key) || typeof value !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value))) throw new Error('Invalid plugin theme');
  return structuredClone(theme);
}
export class PluginResourceBroker {
  readonly handle = randomUUID();
  private active = true;
  private granted = false;
  private ready = false;
  private usedBytes = 0;
  private seen = new Set<string>();
  private inFlight = new Map<string, AbortController>();
  private windowStart = 0;
  private windowCount = 0;
  private heartbeatNonce = '';
  private lastPong = Date.now();
  readonly settingsScope: string;
  readonly stateScope: string;
  constructor(readonly manifest: PluginManifest, readonly resource: OpenedResourceAuthority, private theme: ThemeSnapshot,
    private settings: PluginSettingsAccess, private diagnostic: (event: { method: string; code: string; elapsedMs: number; requestTag?: string }) => void = () => undefined, private readingState: PluginReadingStateStore = new PluginReadingStateMemory()) {
    if (!resource.accountScope || !integer(resource.libraryId, 1, Number.MAX_SAFE_INTEGER) || !integer(resource.nodeId, 1, Number.MAX_SAFE_INTEGER)
      || !integer(resource.size, 0, LIMITS.readTotalBytes) || !resource.revision || resource.revision.length > 256 || resource.name.length > 512) throw new Error('Invalid host resource scope');
    this.theme = validateTheme(theme);
    this.settingsScope = JSON.stringify([manifest.id, resource.accountScope, resource.libraryId]);
    this.stateScope = JSON.stringify([manifest.id, resource.accountScope, resource.libraryId, resource.nodeId, manifest.viewers[0].id, resource.revision]);
  }
  setReadGrant(granted: boolean) { this.granted = granted; if (!granted) for (const controller of this.inFlight.values()) controller.abort(); }
  setTheme(theme: ThemeSnapshot) { const next = validateTheme(theme); if (next.revision <= this.theme.revision) return false; this.theme = next; return true; }
  get isReady() { return this.ready; }
  get alive() { return this.active; }
  heartbeat() { this.heartbeatNonce = randomUUID(); return { version: 1, type: 'heartbeat', nonce: this.heartbeatNonce }; }
  get heartbeatExpired() { return Date.now() - this.lastPong > LIMITS.heartbeatTimeoutMs; }
  dispose() { this.active = false; this.granted = false; for (const controller of this.inFlight.values()) controller.abort(); }
  private checkActive(signal?: AbortSignal) {
    if (!this.active) throw new PluginFault('UNAVAILABLE', 'Instance stopped');
    if (signal?.aborted) throw new PluginFault('CANCELLED', 'Request cancelled');
  }
  async exchange(raw: unknown): Promise<string> {
    let id = ''; let method = 'invalid'; const start = Date.now();
    try {
      this.checkActive();
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > LIMITS.requestBytes) throw new PluginFault('LIMIT', 'Request too large');
      let request: unknown;
      try { request = JSON.parse(raw); } catch { throw new PluginFault('BAD_REQUEST', 'Invalid JSON'); }
      if (!object(request) || request.version !== 1 || typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.id)
        || typeof request.method !== 'string' || !object(request.params) || Object.keys(request).length !== 4) throw new PluginFault('BAD_REQUEST', 'Invalid request envelope');
      id = request.id; method = request.method;
      const params = request.params;
      if (method === 'lifecycle.pong') {
        fields(params, ['nonce']);
        if (params.nonce !== this.heartbeatNonce) throw new PluginFault('BAD_REQUEST', 'Invalid heartbeat');
        this.lastPong = Date.now();
        return JSON.stringify({ version: 1, id, ok: true, value: null });
      }
      if (method === 'request.cancel') {
        fields(params, ['requestId']);
        if (typeof params.requestId !== 'string' || params.requestId.length > 64) throw new PluginFault('BAD_REQUEST', 'Invalid cancellation');
        this.inFlight.get(params.requestId)?.abort();
        return JSON.stringify({ version: 1, id, ok: true, value: null });
      }
      const now = Date.now();
      if (now - this.windowStart >= 1000) { this.windowStart = now; this.windowCount = 0; }
      if (++this.windowCount > LIMITS.requestsPerSecond || this.seen.size >= LIMITS.requestsPerInstance || this.inFlight.size >= LIMITS.concurrentRequests) throw new PluginFault('LIMIT', 'Request budget exceeded');
      if (this.seen.has(id)) throw new PluginFault('BAD_REQUEST', 'Duplicate request id');
      this.seen.add(id);
      const controller = new AbortController(); this.inFlight.set(id, controller);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let abort!: () => void;
      try {
        const interrupted = new Promise<never>((_resolve, reject) => {
          abort = () => reject(new PluginFault('CANCELLED', 'Request cancelled'));
          controller.signal.addEventListener('abort', abort, { once: true });
          timeout = setTimeout(() => { reject(new PluginFault('TIMEOUT', 'Request timed out')); controller.abort(); }, LIMITS.requestTimeoutMs);
        });
        const value = await Promise.race([this.execute(method, params, controller.signal), interrupted]);
        this.checkActive(controller.signal);
        const response = JSON.stringify({ version: 1, id, ok: true, value });
        if (Buffer.byteLength(response) > LIMITS.responseBytes) throw new PluginFault('LIMIT', 'Response too large');
        this.diagnostic({ method, code: 'OK', elapsedMs: Date.now() - start, requestTag: createHash('sha256').update(id).digest('hex').slice(0,12) });
        return response;
      } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', abort); this.inFlight.delete(id); }
    } catch (error) {
      const fault = error instanceof PluginFault ? error : new PluginFault('INTERNAL', 'Host request failed');
      const messages: Record<string, string> = { BAD_REQUEST: 'Invalid request', LIMIT: 'Capability limit reached', FORBIDDEN: 'Access denied', UNAVAILABLE: 'Instance unavailable', CANCELLED: 'Request cancelled', TIMEOUT: 'Request timed out', CONTENT_CHANGED: 'Resource changed', CONFLICT: 'Setting revision changed', UNSUPPORTED: 'Capability unavailable', INTERNAL: 'Host request failed' };
      const code = Object.prototype.hasOwnProperty.call(messages, fault.code) ? fault.code : 'INTERNAL';
      const safeMethod = ['context.get', 'resource.read', 'settings.get', 'settings.set', 'state.get', 'state.set', 'lifecycle.ready', 'lifecycle.pong', 'request.cancel'].includes(method) ? method : 'unknown';
      this.diagnostic({ method: safeMethod, code, elapsedMs: Date.now() - start, requestTag: id ? createHash('sha256').update(id).digest('hex').slice(0,12) : undefined });
      return JSON.stringify({ version: 1, id, ok: false, error: { code, message: messages[code] } });
    }
  }
  private async execute(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    if (method === 'context.get') {
      fields(params, []);
      return { pluginId: this.manifest.id, viewerId: this.manifest.viewers[0].id, capabilities: ['resource.read', 'settings', 'state', 'theme', 'lifecycle'], resource: { handle: this.handle, name: this.resource.name, size: this.resource.size, revision: this.resource.revision },
        readGranted: this.granted && this.manifest.permissions.includes('resource.read'), theme: this.theme };
    }
    if (method === 'lifecycle.ready') { fields(params, []); this.ready = true; this.lastPong = Date.now(); return null; }
    if (method === 'lifecycle.pong') { fields(params, ['nonce']); if (params.nonce !== this.heartbeatNonce) throw new PluginFault('BAD_REQUEST', 'Invalid heartbeat'); this.lastPong = Date.now(); return null; }
    if (!this.ready) throw new PluginFault('UNAVAILABLE', 'Instance not ready');
    if (method === 'resource.read') {
      fields(params, ['handle', 'offset', 'length']);
      if (params.handle !== this.handle || !this.granted || !this.manifest.permissions.includes('resource.read')) throw new PluginFault('FORBIDDEN', 'Resource read not granted');
      if (!integer(params.offset, 0, this.resource.size) || !integer(params.length, 1, LIMITS.readChunkBytes)) throw new PluginFault('BAD_REQUEST', 'Invalid range');
      const length = Math.min(params.length, this.resource.size - params.offset);
      if (this.usedBytes + length > LIMITS.readTotalBytes) throw new PluginFault('LIMIT', 'Read budget exhausted');
      this.usedBytes += length;
      if (!await this.resource.authorize(signal)) throw new PluginFault('FORBIDDEN', 'User or resource access denied');
      this.checkActive(signal);
      if (!this.granted) throw new PluginFault('FORBIDDEN', 'Grant revoked');
      if (await this.resource.currentRevision(signal) !== this.resource.revision) throw new PluginFault('CONTENT_CHANGED', 'Resource changed');
      const bytes = await this.resource.readRange(params.offset, length, signal);
      this.checkActive(signal);
      if (!this.granted || !await this.resource.authorize(signal)) throw new PluginFault('FORBIDDEN', 'Access revoked');
      if (await this.resource.currentRevision(signal) !== this.resource.revision) throw new PluginFault('CONTENT_CHANGED', 'Resource changed');
      this.checkActive(signal);
      if (bytes.byteLength !== length) throw new PluginFault('INTERNAL', 'Incomplete resource read');
      return { base64: Buffer.from(bytes).toString('base64'), nextOffset: params.offset + length, eof: params.offset + length === this.resource.size, revision: this.resource.revision };
    }
    if (method === 'state.get') { fields(params, []); return this.readingState.get(this.stateScope); }
    if (method === 'state.set') {
      fields(params, ['value', 'expectedRevision', 'schemaVersion']);
      if (!integer(params.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1) || !integer(params.schemaVersion, 1, 100000)) throw new PluginFault('BAD_REQUEST', 'Invalid snapshot');
      this.checkActive(signal);
      return this.readingState.set(this.stateScope, params.value, params.expectedRevision, params.schemaVersion);
    }
    if (method === 'settings.get') { fields(params, ['key']); if (!settingKey(params.key)) throw new PluginFault('BAD_REQUEST', 'Invalid setting key'); return this.settings.get(this.settingsScope, params.key); }
    if (method === 'settings.set') {
      fields(params, ['key', 'value', 'expectedRevision', 'schemaVersion']);
      if (!settingKey(params.key) || !integer(params.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1) || !integer(params.schemaVersion, 1, 100000)) throw new PluginFault('BAD_REQUEST', 'Invalid setting');
      this.checkActive(signal);
      return this.settings.set(this.settingsScope, params.key, params.value, params.expectedRevision, params.schemaVersion);
    }
    throw new PluginFault('UNSUPPORTED', 'Capability unavailable');
  }
}
