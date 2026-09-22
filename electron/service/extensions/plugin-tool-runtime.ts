import { randomUUID } from 'node:crypto';
import type { PluginRenameProposal } from '../../../packages/plugin-sdk/index.js';
import { PluginFault, isMetadataResourceAuthority, validateMetadataResourceAuthority, type MetadataResourceAuthority, type PluginResourceAuthority, type OpenedResourceAuthority } from './resource-broker';
import { validateToolInput, validateToolOutput } from './tool-schema';
import type { PluginManager } from './plugin-manager';
import type { PluginDevelopmentHost, IsolatedPluginInstance } from './isolated-view';

export interface PluginToolCallBinding {
  pluginId: string; toolId: string; packageFingerprint: string;
  accountScope: string; backendScope: string; libraryId: number; nodeId: number;
  sessionId: string; runId: string; toolRunId: string; aiDestinationId: string;
}
declare const authorityBrand: unique symbol;
export interface PluginToolCallAuthority { readonly [authorityBrand]: true }
export interface PluginMetadataCallBinding extends Omit<PluginToolCallBinding, 'nodeId'> { readonly nodeIds: readonly number[] }
declare const metadataAuthorityBrand: unique symbol;
export interface PluginMetadataCallAuthority { readonly [metadataAuthorityBrand]: true }
type SharedAuthority = { binding: Readonly<Omit<PluginToolCallBinding, 'nodeId'>>; resource: PluginResourceAuthority; signal: AbortSignal; assertCurrent(signal: AbortSignal): Promise<void> };
type Authority = SharedAuthority & { binding: Readonly<PluginToolCallBinding>; resource: OpenedResourceAuthority };
type MetadataAuthority = SharedAuthority & { binding: Readonly<PluginMetadataCallBinding>; resource: MetadataResourceAuthority };
const authorities = new WeakMap<PluginToolCallAuthority, Authority>();
const metadataAuthorities = new WeakMap<PluginMetadataCallAuthority, MetadataAuthority>();

function validBinding(binding: Omit<PluginToolCallBinding, 'nodeId'>): boolean {
  return Boolean(binding && ['accountScope', 'backendScope', 'sessionId', 'runId', 'toolRunId', 'aiDestinationId'].every(key => {
    const value = binding[key as keyof typeof binding]; return typeof value === 'string' && value.length > 0 && value.length <= 256;
  }) && typeof binding.pluginId === 'string' && binding.pluginId.length <= 96
    && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(binding.pluginId)
    && typeof binding.toolId === 'string' && binding.toolId.length <= 128
    && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(binding.toolId) && binding.toolId.startsWith(`${binding.pluginId}.`)
    && typeof binding.packageFingerprint === 'string' && /^[a-f0-9]{64}$/.test(binding.packageFingerprint)
    && Number.isSafeInteger(binding.libraryId) && binding.libraryId > 0);
}

/** 仅可信 main 适配器可签发；字段本身不授予权限，assertCurrent 必须复验真实执行范围。 */
export function createPluginToolCallAuthority(binding: PluginToolCallBinding, resource: OpenedResourceAuthority,
  signal: AbortSignal, assertCurrent: (signal: AbortSignal) => Promise<void>): PluginToolCallAuthority {
  if (!validBinding(binding) || !Number.isSafeInteger(binding.nodeId) || binding.nodeId < 1
    || resource.directory || resource.accountScope !== binding.accountScope || resource.libraryId !== binding.libraryId || resource.nodeId !== binding.nodeId
    || typeof assertCurrent !== 'function') throw new PluginFault('FORBIDDEN', 'Invalid Tool call binding');
  const authority = Object.freeze({}) as PluginToolCallAuthority;
  authorities.set(authority, { binding: Object.freeze({ ...binding }), resource, signal, assertCurrent });
  return authority;
}

export function createPluginMetadataCallAuthority(binding: PluginMetadataCallBinding, resource: MetadataResourceAuthority,
  signal: AbortSignal, assertCurrent: (signal: AbortSignal) => Promise<void>): PluginMetadataCallAuthority {
  try { validateMetadataResourceAuthority(resource); } catch { throw new PluginFault('FORBIDDEN', 'Invalid Tool metadata scope'); }
  if (!validBinding(binding) || !Array.isArray(binding.nodeIds) || !binding.nodeIds.length || binding.nodeIds.length > 50
    || new Set(binding.nodeIds).size !== binding.nodeIds.length || binding.nodeIds.some(id => !Number.isSafeInteger(id) || id < 1)
    || resource.accountScope !== binding.accountScope || resource.libraryId !== binding.libraryId || resource.files.length !== binding.nodeIds.length
    || typeof assertCurrent !== 'function') throw new PluginFault('FORBIDDEN', 'Invalid Tool metadata binding');
  const authority = Object.freeze({}) as PluginMetadataCallAuthority;
  metadataAuthorities.set(authority, {
    binding: Object.freeze({ ...binding, nodeIds: Object.freeze([...binding.nodeIds]) }),
    resource: Object.freeze({ ...resource, files: Object.freeze(resource.files.map(file => Object.freeze({ id: file.id, name: file.name }))) }),
    signal, assertCurrent,
  });
  return authority;
}

export interface PluginToolExecutionResult {
  output: unknown;
  source: Readonly<{ pluginId: string; version: string; fingerprint: string; toolId: string; registrationId: string; nodeId: number; resourceRevision: string }>;
}
export interface PluginRenameProposalExecutionResult {
  output: PluginRenameProposal;
  source: Readonly<{ pluginId: string; version: string; fingerprint: string; toolId: string; registrationId: string; nodeIds: readonly number[]; resourceRevision: string }>;
}

/** main-only 调用入口；AT1 负责真实 Agent 的授权适配、有效目录组合和 ToolRun 持久化。 */
export class PluginToolRuntime {
  private calls = new Map<string, { pluginId: string; controller: AbortController }>();
  private detach: () => void;
  private detachHost: () => void = () => undefined;
  private disposed = false;
  constructor(private manager: PluginManager, private host: PluginDevelopmentHost) {
    this.detach = manager.attachRuntime((pluginId, reason) => {
      for (const call of this.calls.values()) if (!pluginId || pluginId === call.pluginId) call.controller.abort(reason === 'fault' ? new PluginFault('UNAVAILABLE', 'Plugin instance failed') : undefined);
    });
    this.detachHost = host.onDispose(() => this.dispose());
  }
  get size() { return this.calls.size; }
  dispose() { if (this.disposed) return; this.disposed = true; this.detach(); this.detachHost(); for (const call of this.calls.values()) call.controller.abort(); }

  async execute(toolId: string, fingerprint: string, input: unknown, capability: PluginToolCallAuthority): Promise<PluginToolExecutionResult> {
    const authority = authorities.get(capability);
    if (!authority || this.disposed) throw new PluginFault('FORBIDDEN', 'Invalid Tool authority');
    authorities.delete(capability); // 一次调用使用一次能力，不能跨 Run 或重试重放。
    if (toolId !== authority.binding.toolId || fingerprint !== authority.binding.packageFingerprint) throw new PluginFault('FORBIDDEN', 'Tool identity mismatch');
    let spec: ReturnType<PluginManager['resolveTool']>;
    try { spec = this.manager.resolveTool(toolId, fingerprint); }
    catch { throw new PluginFault('FORBIDDEN', 'Tool package unavailable'); }
    if (spec.plugin.id !== authority.binding.pluginId || spec.tool.id !== toolId || spec.plugin.fingerprint !== fingerprint) throw new PluginFault('FORBIDDEN', 'Tool package identity mismatch');
    if (spec.tool.kind === 'rename-proposal') throw new PluginFault('FORBIDDEN', 'Tool requires metadata authority');
    try { validateToolInput(spec.tool, input); } catch { throw new PluginFault('BAD_REQUEST', 'Invalid Tool input'); }
    if ((input.resource as { nodeId: number }).nodeId !== authority.binding.nodeId) throw new PluginFault('FORBIDDEN', 'Resource identity mismatch');
    const { resource: _resource, ...parameters } = input;
    void _resource;
    const output = await this.run(spec, authority, parameters);
    return { output, source: Object.freeze({ pluginId: spec.plugin.id, version: spec.plugin.version, fingerprint,
      toolId, registrationId: spec.registrationId, nodeId: authority.resource.nodeId, resourceRevision: authority.resource.revision }) };
  }

  async executeRenameProposal(toolId: string, fingerprint: string, input: unknown, capability: PluginMetadataCallAuthority): Promise<PluginRenameProposalExecutionResult> {
    const authority = metadataAuthorities.get(capability);
    if (!authority || this.disposed) throw new PluginFault('FORBIDDEN', 'Invalid Tool metadata authority');
    metadataAuthorities.delete(capability);
    if (toolId !== authority.binding.toolId || fingerprint !== authority.binding.packageFingerprint) throw new PluginFault('FORBIDDEN', 'Tool identity mismatch');
    let spec: ReturnType<PluginManager['resolveTool']>;
    try { spec = this.manager.resolveTool(toolId, fingerprint); }
    catch { throw new PluginFault('FORBIDDEN', 'Tool package unavailable'); }
    if (spec.plugin.id !== authority.binding.pluginId || spec.tool.id !== toolId || spec.plugin.fingerprint !== fingerprint
      || spec.tool.kind !== 'rename-proposal') throw new PluginFault('FORBIDDEN', 'Tool package identity mismatch');
    try { validateToolInput(spec.tool, input); } catch { throw new PluginFault('BAD_REQUEST', 'Invalid Tool input'); }
    const nodeIds = input.resources as number[];
    if (nodeIds.length !== authority.binding.nodeIds.length || nodeIds.some((id, index) => id !== authority.binding.nodeIds[index])) throw new PluginFault('FORBIDDEN', 'Metadata resource identity mismatch');
    const { resources: _resources, ...parameters } = input;
    void _resources;
    const output = await this.run(spec, authority, { parameters, files: authority.resource.files }) as PluginRenameProposal;
    return { output, source: Object.freeze({ pluginId: spec.plugin.id, version: spec.plugin.version, fingerprint,
      toolId, registrationId: spec.registrationId, nodeIds: authority.binding.nodeIds, resourceRevision: authority.resource.revision }) };
  }

  private async run(spec: ReturnType<PluginManager['resolveTool']>, authority: SharedAuthority, parameters: Record<string, unknown>): Promise<unknown> {
    const toolId = authority.binding.toolId, fingerprint = authority.binding.packageFingerprint;
    const invocationInput = Object.freeze(structuredClone(parameters));
    const invocationId = randomUUID(); const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, authority.signal]);
    const check = async (requestSignal: AbortSignal) => {
      signal.throwIfAborted(); requestSignal.throwIfAborted();
      if (this.disposed || !this.manager.stillToolAllowed(toolId, fingerprint)) throw new PluginFault('FORBIDDEN', 'Tool grant revoked');
      await authority.assertCurrent(requestSignal);
      signal.throwIfAborted(); requestSignal.throwIfAborted();
      if (!this.manager.stillToolAllowed(toolId, fingerprint)) throw new PluginFault('FORBIDDEN', 'Tool package changed');
    };
    const resource: PluginResourceAuthority = Object.freeze({
      ...authority.resource,
      authorize: async (requestSignal: AbortSignal) => {
        const combined = AbortSignal.any([signal, requestSignal]);
        await check(combined);
        const allowed = await authority.resource.authorize(combined);
        await check(combined); return allowed;
      },
    });
    let instance: IsolatedPluginInstance | undefined;
    let counted = false; let succeeded = false; let stopObserved = false;
    let finish!: (output: unknown) => void; let fail!: (error: unknown) => void;
    const terminal = new Promise<unknown>((resolve, reject) => { finish = resolve; fail = reject; });
    void terminal.catch(() => undefined);
    let interrupt!: (error: PluginFault) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
    void interrupted.catch(() => undefined);
    const wait = <T>(pending: Promise<T>) => Promise.race([pending, interrupted]);
    const abort = () => { const error = signal.reason instanceof PluginFault ? signal.reason : new PluginFault('CANCELLED', 'Tool call cancelled'); fail(error); interrupt(error); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => { const error = new PluginFault('TIMEOUT', 'Tool call timed out'); fail(error); interrupt(error); controller.abort(); }, spec.tool.timeoutMs);
    this.calls.set(invocationId, { pluginId: spec.plugin.id, controller });
    try {
      await wait(check(signal));
      if (!await wait(resource.authorize(signal))) throw new PluginFault('FORBIDDEN', 'Resource access denied');
      // 与取消/超时竞速，未遵守 AbortSignal 的适配器不能令调用永久悬挂。
      const loading = this.host.load(spec.directory, resource, { schemaVersion: 1, revision: 1, mode: 'light', colors: {} }, true, {
        expectedFingerprint: fingerprint, signal,
        toolExecution: { contribution: spec.tool, invocationId, input: invocationInput,
          complete: output => finish(output), reject: error => fail(error), fail: code => fail(new PluginFault(code, 'Plugin Tool failed')) },
        onDiagnostic: event => this.manager.requestFailed(spec.plugin.id, event),
        onStop: reason => {
          stopObserved = true;
          if (reason !== 'completed') { const error = new PluginFault('UNAVAILABLE', 'Tool instance stopped'); fail(error); interrupt(error); }
          this.manager.stopped(spec.plugin.id, reason, counted); counted = false;
        },
      });
      // load 自身会响应 signal 回收；已取消时的迟到实例也不能留存。
      void loading.then(value => { if (signal.aborted) value.stop('cancelled'); }, () => undefined);
      instance = await wait(loading);
      signal.throwIfAborted();
      if (stopObserved) throw new PluginFault('UNAVAILABLE', 'Tool stopped while loading');
      counted = true; this.manager.started(spec.plugin.id);
      const output = await terminal;
      await wait(check(signal));
      if (!await wait(resource.authorize(signal))) throw new PluginFault('FORBIDDEN', 'Resource access revoked');
      if (await wait(resource.currentRevision(signal)) !== resource.revision) throw new PluginFault('CONTENT_CHANGED', 'Resource changed');
      await wait(check(signal));
      validateToolOutput(spec.tool, output);
      if (isMetadataResourceAuthority(resource)) {
        const proposal = output as PluginRenameProposal;
        const ids = new Set(resource.files.map(file => file.id));
        if (new Set(proposal.changes.map(change => change.id)).size !== proposal.changes.length || proposal.changes.some(change => !ids.has(change.id))) throw new PluginFault('BAD_REQUEST', 'Proposal target not granted');
      }
      succeeded = true;
      return structuredClone(output);
    } catch (error) {
      if (error instanceof PluginFault) throw error;
      if (signal.aborted) { await terminal; throw new PluginFault('CANCELLED', 'Tool call cancelled'); }
      throw new PluginFault('UNAVAILABLE', 'Tool call failed');
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); this.calls.delete(invocationId);
      instance?.stop(succeeded ? 'completed' : signal.aborted ? 'cancelled' : 'failed'); controller.abort();
    }
  }
}
