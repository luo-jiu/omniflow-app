import { randomUUID, createHash } from 'node:crypto';
import { LIMITS, type PluginMetadataFile, type ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import type { PluginManifest, PluginToolContribution } from './manifest';
import { validateToolOutput } from './tool-schema';
import { decodeFileOutput } from './file-output';

export interface PluginToolExecution {
  contribution: PluginToolContribution;
  invocationId: string;
  input: Readonly<Record<string, unknown>>;
  complete(output: unknown): void;
  reject(error: PluginFault): void;
  fail(code: 'INVALID_INPUT' | 'UNSUPPORTED_FORMAT' | 'FAILED'): void;
}

export class PluginFault extends Error { constructor(readonly code: string, message: string) { super(message); } }
export interface OpenedResourceAuthority {
  readonly accountScope: string; readonly libraryId: number; readonly nodeId: number;
  readonly name: string; readonly size: number; readonly revision: string;
  readonly directory?: { type: 'COMIC'; entries: readonly { id: string; name: string; size: number; mimeType: string }[]; open(entryId: string, signal: AbortSignal): Promise<OpenedResourceAuthority> };
  // Host-owned authorization must include user permission and actual node/library membership.
  authorize(signal: AbortSignal): Promise<boolean>;
  currentRevision(signal: AbortSignal): Promise<string>;
  readRange(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
}
/** Metadata grants contain no readable object, download URL or fabricated single-file identity. */
export interface MetadataResourceAuthority {
  readonly kind: 'metadata';
  readonly accountScope: string; readonly libraryId: number; readonly revision: string;
  readonly files: readonly Readonly<PluginMetadataFile>[];
  authorize(signal: AbortSignal): Promise<boolean>;
  currentRevision(signal: AbortSignal): Promise<string>;
}
export type PluginResourceAuthority = OpenedResourceAuthority | MetadataResourceAuthority;
export function isMetadataResourceAuthority(resource: PluginResourceAuthority): resource is MetadataResourceAuthority {
  return 'kind' in resource && resource.kind === 'metadata';
}
export function validateMetadataResourceAuthority(resource: MetadataResourceAuthority): void {
  if (resource.kind !== 'metadata' || typeof resource.accountScope !== 'string' || !resource.accountScope || resource.accountScope.length > 256
    || !integer(resource.libraryId, 1, Number.MAX_SAFE_INTEGER) || typeof resource.revision !== 'string' || !resource.revision || resource.revision.length > 256
    || !Array.isArray(resource.files) || !integer(resource.files.length, 1, 50) || new Set(resource.files.map(file => file?.id)).size !== resource.files.length
    || resource.files.some(file => !object(file) || Object.keys(file).length !== 2
      || typeof file.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(file.id)
      || typeof file.name !== 'string' || !file.name || file.name.length > 512)
    || typeof resource.authorize !== 'function' || typeof resource.currentRevision !== 'function') throw new Error('Invalid host metadata scope');
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
  private invocationDelivered = false;
  private toolTerminal: 'open' | 'pending' | 'settled' = 'open';
  private toolTerminalOwner?: object;
  private usedBytes = 0;
  private children = new Map<string, OpenedResourceAuthority>();
  private openingChildren = 0;
  private seen = new Set<string>();
  private inFlight = new Map<string, AbortController>();
  private windowStart = 0;
  private windowCount = 0;
  private heartbeatNonce = '';
  private lastPong = Date.now();
  readonly settingsScope: string;
  readonly stateScope: string;
  constructor(readonly manifest: PluginManifest, readonly resource: PluginResourceAuthority, private theme: ThemeSnapshot,
    private settings: PluginSettingsAccess, private diagnostic: (event: { method: string; code: string; elapsedMs: number; requestTag?: string }) => void = () => undefined, private readingState: PluginReadingStateStore = new PluginReadingStateMemory(), private execution?: PluginToolExecution) {
    if (isMetadataResourceAuthority(resource)) {
      validateMetadataResourceAuthority(resource);
      if (execution?.contribution.kind !== 'rename-proposal' || !manifest.permissions.includes('agent.tools')
        || !manifest.permissions.includes('resource.rename.propose') || manifest.permissions.includes('resource.read') || manifest.permissions.includes('directory.read')) throw new Error('Invalid Tool metadata scope');
    } else {
      if (!resource.accountScope || !integer(resource.libraryId, 1, Number.MAX_SAFE_INTEGER) || !integer(resource.nodeId, 1, Number.MAX_SAFE_INTEGER)
        || !integer(resource.size, 0, LIMITS.readTotalBytes) || !resource.revision || resource.revision.length > 256 || resource.name.length > 512) throw new Error('Invalid host resource scope');
      if (execution && (execution.contribution.kind === 'rename-proposal' || resource.directory || !manifest.permissions.includes('agent.tools') || !manifest.permissions.includes('resource.read'))) throw new Error('Invalid Tool resource scope');
      if (execution?.contribution.kind === 'file-output' && !manifest.permissions.includes('resource.output.propose')) throw new Error('Invalid file output scope');
    }
    this.theme = validateTheme(theme);
    this.settingsScope = JSON.stringify([manifest.id, resource.accountScope, resource.libraryId]);
    this.stateScope = execution || isMetadataResourceAuthority(resource) ? '' : JSON.stringify([manifest.id, resource.accountScope, resource.libraryId, resource.nodeId, manifest.viewers[0].id, resource.revision]);
  }
  setReadGrant(granted: boolean) { this.granted = granted; if (!granted) { this.children.clear(); for (const controller of this.inFlight.values()) controller.abort(); } }
  setTheme(theme: ThemeSnapshot) { const next = validateTheme(theme); if (next.revision <= this.theme.revision) return false; this.theme = next; return true; }
  get isReady() { return this.ready; }
  get alive() { return this.active; }
  heartbeat() { this.heartbeatNonce = randomUUID(); return { version: 1, type: 'heartbeat', nonce: this.heartbeatNonce }; }
  get heartbeatExpired() { return Date.now() - this.lastPong > LIMITS.heartbeatTimeoutMs; }
  dispose() { this.children.clear(); this.active = false; this.granted = false; for (const controller of this.inFlight.values()) controller.abort(); }
  private checkActive(signal?: AbortSignal) {
    if (!this.active) throw new PluginFault('UNAVAILABLE', 'Instance stopped');
    if (signal?.aborted) throw new PluginFault('CANCELLED', 'Request cancelled');
  }
  async exchange(raw: unknown): Promise<string> {
    let id = ''; let method = 'invalid'; const start = Date.now();
    const requestOwner = {}; // 每次exchange独立；复用同一requestId也不能取得终态所有权。
    try {
      this.checkActive();
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > (this.execution?.contribution.kind === 'file-output' ? LIMITS.fileOutputRequestBytes : this.execution ? LIMITS.toolRequestBytes : LIMITS.requestBytes)) throw new PluginFault('LIMIT', 'Request too large');
      let request: unknown;
      try { request = JSON.parse(raw); } catch { throw new PluginFault('BAD_REQUEST', 'Invalid JSON'); }
      if (!object(request) || request.version !== 1 || typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.id)
        || typeof request.method !== 'string' || !object(request.params) || Object.keys(request).length !== 4) throw new PluginFault('BAD_REQUEST', 'Invalid request envelope');
      id = request.id; method = request.method;
      if (Buffer.byteLength(raw) > (this.execution?.contribution.kind === 'file-output' && method === 'tool.output.complete' ? LIMITS.fileOutputRequestBytes : this.execution && method === 'tool.complete' ? LIMITS.toolRequestBytes : LIMITS.requestBytes)) throw new PluginFault('LIMIT', 'Request too large');
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
      if (++this.windowCount > LIMITS.requestsPerSecond || this.seen.size >= (!isMetadataResourceAuthority(this.resource) && this.resource.directory ? LIMITS.directoryRequests : LIMITS.requestsPerInstance) || this.inFlight.size >= LIMITS.concurrentRequests) throw new PluginFault('LIMIT', 'Request budget exceeded');
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
        const value = await Promise.race([this.execute(method, params, controller.signal, requestOwner), interrupted]);
        this.checkActive(controller.signal);
        const response = JSON.stringify({ version: 1, id, ok: true, value });
        if (Buffer.byteLength(response) > LIMITS.responseBytes) throw new PluginFault('LIMIT', 'Response too large');
        this.diagnostic({ method, code: 'OK', elapsedMs: Date.now() - start, requestTag: createHash('sha256').update(id).digest('hex').slice(0,12) });
        return response;
      } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', abort); this.inFlight.delete(id); }
    } catch (error) {
      const fault = error instanceof PluginFault ? error : new PluginFault('INTERNAL', 'Host request failed');
      if (this.execution && this.toolTerminal === 'pending' && this.toolTerminalOwner === requestOwner) {
        this.toolTerminal = 'settled'; this.execution.reject(fault);
      }
      const messages: Record<string, string> = { BAD_REQUEST: 'Invalid request', LIMIT: 'Capability limit reached', FORBIDDEN: 'Access denied', UNAVAILABLE: 'Instance unavailable', CANCELLED: 'Request cancelled', TIMEOUT: 'Request timed out', CONTENT_CHANGED: 'Resource changed', CONFLICT: 'Setting revision changed', UNSUPPORTED: 'Capability unavailable', INTERNAL: 'Host request failed' };
      const code = Object.prototype.hasOwnProperty.call(messages, fault.code) ? fault.code : 'INTERNAL';
      const safeMethod = ['context.get', 'tool.invocation', 'tool.complete', 'tool.output.complete', 'tool.fail', 'directory.list', 'directory.open', 'resource.release', 'resource.read', 'settings.get', 'settings.set', 'state.get', 'state.set', 'lifecycle.ready', 'lifecycle.pong', 'request.cancel'].includes(method) ? method : 'unknown';
      this.diagnostic({ method: safeMethod, code, elapsedMs: Date.now() - start, requestTag: id ? createHash('sha256').update(id).digest('hex').slice(0,12) : undefined });
      return JSON.stringify({ version: 1, id, ok: false, error: { code, message: messages[code] } });
    }
  }
  private async execute(method: string, params: Record<string, unknown>, signal: AbortSignal, requestOwner: object): Promise<unknown> {
    if (method === 'context.get') {
      fields(params, []);
      if (isMetadataResourceAuthority(this.resource)) return { kind: 'tool', pluginId: this.manifest.id, toolId: this.execution!.contribution.id,
        capabilities: ['resource.rename.propose', 'tool.invoke', 'lifecycle'], resource: null, readGranted: false, theme: this.theme };
      if (this.execution) return { kind: 'tool', pluginId: this.manifest.id, toolId: this.execution.contribution.id,
        capabilities: ['resource.read', ...(this.execution.contribution.kind === 'file-output' ? ['resource.output.propose'] : []), 'tool.invoke', 'lifecycle'],
        ...(this.execution.contribution.kind === 'file-output' ? { output: structuredClone(this.execution.contribution.output) } : {}),
        resource: { handle: this.handle, name: this.resource.name, size: this.resource.size, revision: this.resource.revision }, readGranted: this.granted, theme: this.theme };
      return { pluginId: this.manifest.id, viewerId: this.manifest.viewers[0].id, capabilities: [...(this.resource.directory ? ['directory.read'] : []), 'resource.read', 'settings', 'state', 'theme', 'lifecycle'], resource: { ...(this.resource.directory ? { kind: 'directory' } : {}), handle: this.handle, name: this.resource.name, size: this.resource.size, revision: this.resource.revision },
        readGranted: this.granted && this.manifest.permissions.includes('resource.read'), theme: this.theme };
    }
    if (method === 'lifecycle.ready') { fields(params, []); this.ready = true; this.lastPong = Date.now(); return null; }
    if (method === 'lifecycle.pong') { fields(params, ['nonce']); if (params.nonce !== this.heartbeatNonce) throw new PluginFault('BAD_REQUEST', 'Invalid heartbeat'); this.lastPong = Date.now(); return null; }
    if (!this.ready) throw new PluginFault('UNAVAILABLE', 'Instance not ready');
    if (this.execution) {
      if (this.toolTerminal !== 'open') throw new PluginFault('UNAVAILABLE', 'Tool already settled');
      if (method === 'tool.invocation' || method === 'tool.complete' || method === 'tool.output.complete' || method === 'tool.fail') {
        fields(params, method === 'tool.invocation' ? [] : method === 'tool.complete' ? ['invocationId', 'output'] : method === 'tool.output.complete' ? ['invocationId', 'mediaType', 'base64'] : ['invocationId', 'code']);
        if (method !== 'tool.invocation' && (!this.invocationDelivered || params.invocationId !== this.execution.invocationId)) throw new PluginFault('FORBIDDEN', 'Invalid invocation');
        let fileOutput: unknown;
        if (method === 'tool.complete') {
          if (this.execution.contribution.kind === 'file-output') throw new PluginFault('UNSUPPORTED', 'File output requires its dedicated completion');
          try { validateToolOutput(this.execution.contribution, params.output); } catch { throw new PluginFault('BAD_REQUEST', 'Invalid Tool result'); }
        }
        if (method === 'tool.output.complete') {
          if (this.execution.contribution.kind !== 'file-output') throw new PluginFault('UNSUPPORTED', 'File output capability unavailable');
          try { fileOutput = decodeFileOutput(this.execution.contribution, params.mediaType, params.base64); }
          catch { throw new PluginFault('BAD_REQUEST', 'Invalid file output'); }
        }
        if (method === 'tool.fail' && !['INVALID_INPUT', 'UNSUPPORTED_FORMAT', 'FAILED'].includes(String(params.code))) throw new PluginFault('BAD_REQUEST', 'Invalid Tool error');
        if (method !== 'tool.invocation') { this.toolTerminal = 'pending'; this.toolTerminalOwner = requestOwner; }
        if (!this.granted || !await this.resource.authorize(signal)) throw new PluginFault('FORBIDDEN', 'Tool access revoked');
        if (await this.resource.currentRevision(signal) !== this.resource.revision) throw new PluginFault('CONTENT_CHANGED', 'Tool resource changed');
        this.checkActive(signal);
        if (!this.granted) throw new PluginFault('FORBIDDEN', 'Tool access revoked');
        if (method === 'tool.invocation') {
          this.invocationDelivered = true;
          return { invocationId: this.execution.invocationId, toolId: this.execution.contribution.id, input: this.execution.input };
        }
        this.toolTerminal = 'settled';
        if (method === 'tool.complete') this.execution.complete(structuredClone(params.output));
        else if (method === 'tool.output.complete') this.execution.complete(fileOutput);
        else this.execution.fail(params.code as 'INVALID_INPUT' | 'UNSUPPORTED_FORMAT' | 'FAILED');
        return null;
      }
      if (isMetadataResourceAuthority(this.resource) || method !== 'resource.read') throw new PluginFault('UNSUPPORTED', 'Tool capability unavailable');
      if (!this.invocationDelivered) throw new PluginFault('UNAVAILABLE', 'Invocation not started');
    }
    if (isMetadataResourceAuthority(this.resource)) throw new PluginFault('UNSUPPORTED', 'Metadata capability unavailable');
    if (method === 'directory.list' || method === 'directory.open') {
      fields(params, method === 'directory.list' ? ['handle', 'offset'] : ['handle', 'entryId']);
      const directory = this.resource.directory;
      if (!directory || params.handle !== this.handle || !this.granted || !this.manifest.permissions.includes('directory.read')
        || !this.manifest.permissions.includes('resource.read')) throw new PluginFault('FORBIDDEN', 'Directory not granted');
      if (!await this.resource.authorize(signal)) throw new PluginFault('FORBIDDEN', 'Access denied');
      this.checkActive(signal);
      if (!this.granted) throw new PluginFault('FORBIDDEN', 'Grant revoked');
      if (await this.resource.currentRevision(signal) !== this.resource.revision) throw new PluginFault('CONTENT_CHANGED', 'Directory changed');
      this.checkActive(signal);
      if (method === 'directory.list') {
        if (!integer(params.offset, 0, directory.entries.length)) throw new PluginFault('BAD_REQUEST', 'Invalid offset');
        const entries = directory.entries.slice(params.offset, params.offset + LIMITS.directoryPageSize);
        return { entries, nextOffset: params.offset + entries.length, eof: params.offset + entries.length === directory.entries.length, revision: this.resource.revision };
      }
      if (typeof params.entryId !== 'string' || !directory.entries.some(entry => entry.id === params.entryId)) throw new PluginFault('FORBIDDEN', 'Unknown entry');
      if (this.children.size + this.openingChildren >= LIMITS.directoryHandles) throw new PluginFault('LIMIT', 'Handle quota exceeded');
      this.openingChildren++;
      try {
        const child = await directory.open(params.entryId, signal);
        this.checkActive(signal);
        if (!this.granted || !await this.resource.authorize(signal)) throw new PluginFault('FORBIDDEN', 'Access revoked');
        this.checkActive(signal);
        if (child.directory || child.accountScope !== this.resource.accountScope || child.libraryId !== this.resource.libraryId
          || !integer(child.size, 0, LIMITS.readTotalBytes)) throw new PluginFault('FORBIDDEN', 'Invalid child scope');
        const handle = randomUUID(); this.children.set(handle, child);
        return { kind: 'file', handle, name: child.name, size: child.size, revision: child.revision };
      } finally { this.openingChildren--; }
    }
    if (method === 'resource.release') {
      fields(params, ['handle']);
      if (typeof params.handle !== 'string' || !this.children.delete(params.handle)) throw new PluginFault('FORBIDDEN', 'Unknown handle');
      return null;
    }
    if (method === 'resource.read') {
      fields(params, ['handle', 'offset', 'length']);
      const resource = params.handle === this.handle && !this.resource.directory ? this.resource : this.children.get(String(params.handle));
      if (!resource || !this.granted || !this.manifest.permissions.includes('resource.read')) throw new PluginFault('FORBIDDEN', 'Resource read not granted');
      if (!integer(params.offset, 0, resource.size) || !integer(params.length, 1, LIMITS.readChunkBytes)) throw new PluginFault('BAD_REQUEST', 'Invalid range');
      const length = Math.min(params.length, resource.size - params.offset);
      if (this.usedBytes + length > (this.resource.directory ? LIMITS.directoryReadTotalBytes : LIMITS.readTotalBytes)) throw new PluginFault('LIMIT', 'Read budget exhausted');
      this.usedBytes += length;
      if (!await this.resource.authorize(signal) || (resource !== this.resource && !await resource.authorize(signal))) throw new PluginFault('FORBIDDEN', 'User or resource access denied');
      this.checkActive(signal);
      if (!this.granted) throw new PluginFault('FORBIDDEN', 'Grant revoked');
      if (await resource.currentRevision(signal) !== resource.revision) throw new PluginFault('CONTENT_CHANGED', 'Resource changed');
      const bytes = await resource.readRange(params.offset, length, signal);
      this.checkActive(signal);
      if (!this.granted || !await this.resource.authorize(signal) || (resource !== this.resource && !await resource.authorize(signal))) throw new PluginFault('FORBIDDEN', 'Access revoked');
      if (await resource.currentRevision(signal) !== resource.revision) throw new PluginFault('CONTENT_CHANGED', 'Resource changed');
      this.checkActive(signal);
      if (this.resource.directory && this.children.get(String(params.handle)) !== resource) throw new PluginFault('FORBIDDEN', 'Handle released');
      if (bytes.byteLength !== length) throw new PluginFault('INTERNAL', 'Incomplete resource read');
      return { base64: Buffer.from(bytes).toString('base64'), nextOffset: params.offset + length, eof: params.offset + length === resource.size, revision: resource.revision };
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
