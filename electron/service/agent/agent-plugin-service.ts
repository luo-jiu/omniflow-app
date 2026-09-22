import { createAgentPluginRenameService, type AgentPluginRenameRequest } from './agent-plugin-rename';
import { createAgentPluginFileOutputService, type AgentPluginFileOutputRequest } from './agent-plugin-file-output';
import type { AgentToolMainPreparedExecution, AgentMainCommitSettlement } from './agent-tool-registry';
import { BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import type { AgentPluginToolSource, AgentToolResult } from '../../../src/shared/agent/agent.types';
import type { PluginManager } from '../extensions/plugin-manager';
import type { PluginToolRegistration } from '../extensions/plugin-tool-catalog';
import { PluginDevelopmentHost } from '../extensions/isolated-view';
import { PluginFault } from '../extensions/resource-broker';
import { createPluginToolCallAuthority, PluginToolRuntime } from '../extensions/plugin-tool-runtime';
import { validateToolInput } from '../extensions/tool-schema';
import { normalizeAgentPluginToolSource } from './agent-plugin-source';
import { openAgentPluginResource } from './agent-plugin-resource';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';

export interface AgentPluginToolRequest {
  readonly source: AgentPluginToolSource;
  readonly input: unknown;
  readonly authority: AgentFileAuthorityBrokerRequestInput;
  readonly aiDestinationId: string;
  readonly assertCurrent: (signal: AbortSignal) => Promise<void>;
}
export interface AgentPluginServiceOptions {
  manager: PluginManager;
  getMainWindow(): BrowserWindow | null;
  preloadPath?: string;
  openResource?: typeof openAgentPluginResource;
}

/** 插件执行只从主进程的 Agent 调用上下文进入，无 renderer launch IPC。 */
export function createAgentPluginService(options: AgentPluginServiceOptions) {
  let current: { parent: BrowserWindow; host: PluginDevelopmentHost; runtime: PluginToolRuntime } | undefined;
  let disposed = false;
  const calls = new Set<AbortController>();
  const checkSender = (sender: WebContents) => {
    const parent = options.getMainWindow();
    if (disposed || !parent || parent.isDestroyed() || sender.isDestroyed() || parent.webContents !== sender) throw new PluginFault('FORBIDDEN', 'Agent window unavailable');
    return parent;
  };
  const runtimeFor = (sender: WebContents) => {
    const parent = checkSender(sender);
    if (!current || current.parent !== parent) {
      current?.runtime.dispose(); current?.host.dispose();
      const host = new PluginDevelopmentHost(parent, options.preloadPath ?? path.join(process.env.APP_ROOT ?? '', 'dist-plugins/plugin-preload.cjs'));
      current = { parent, host, runtime: new PluginToolRuntime(options.manager, host) };
    }
    return current.runtime;
  };
  const detach = options.manager.attachRuntime((id, reason) => {
    outputs.revoke(id);
    // Pending resource acquisition is also part of a call; its per-package filter lives below.
    for (const controller of calls) {
      if (!id || callOwners.get(controller) === id) controller.abort(reason === 'fault' ? new PluginFault('UNAVAILABLE', 'Plugin instance failed') : undefined);
    }
  });
  const callOwners = new WeakMap<AbortController, string>();
  const renames = createAgentPluginRenameService({ manager: options.manager, runtimeFor: request => runtimeFor(request.authority.sender) });
  const outputs = createAgentPluginFileOutputService({ manager: options.manager, runtimeFor: request => runtimeFor(request.authority.sender), openResource: options.openResource });
  async function renameCall<T, Request extends AgentPluginRenameRequest>(request: Request,
    action: (bound: Request, commit?: AgentMainCommitSettlement) => Promise<T>, commit?: AgentMainCommitSettlement): Promise<T> {
    normalizeAgentPluginToolSource(request.source); checkSender(request.authority.sender);
    const controller = new AbortController(); calls.add(controller); callOwners.set(controller, request.source.pluginId);
    const signal = AbortSignal.any([controller.signal, request.authority.signal]);
    let committing = false; let rejectAbort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => { if (!committing) reject(signal.reason instanceof PluginFault ? signal.reason : new PluginFault('CANCELLED', 'Plugin rename cancelled')); };
      signal.addEventListener('abort', rejectAbort, { once: true }); if (signal.aborted) rejectAbort();
    });
    void interrupted.catch(() => undefined);
    const assertCurrent = async (operationSignal: AbortSignal) => {
      signal.throwIfAborted(); operationSignal.throwIfAborted(); checkSender(request.authority.sender);
      if (!options.manager.stillToolAllowed(request.source.toolId, request.source.packageFingerprint)) throw new PluginFault('FORBIDDEN', 'Rename capability revoked');
      await request.assertCurrent(operationSignal);
      signal.throwIfAborted(); operationSignal.throwIfAborted(); checkSender(request.authority.sender);
      if (!options.manager.stillToolAllowed(request.source.toolId, request.source.packageFingerprint)) throw new PluginFault('FORBIDDEN', 'Rename capability changed');
    };
    const settlement = commit ? { begin: (fallback: AgentToolResult) => { signal.throwIfAborted(); commit.begin(fallback); committing = true; }, settle: (result: AgentToolResult) => commit.settle(result) } : undefined;
    try {
      const result = await Promise.race([action({ ...request, authority: { ...request.authority, signal }, assertCurrent }, settlement), interrupted]);
      if (!committing) await Promise.race([assertCurrent(signal), interrupted]);
      return result;
    } finally { signal.removeEventListener('abort', rejectAbort); calls.delete(controller); controller.abort(); }
  }

  return {
    snapshot(reservedNames: readonly string[] = []): readonly PluginToolRegistration[] {
      return disposed ? [] : options.manager.toolSnapshot(reservedNames);
    },
    prepareRename(request: AgentPluginRenameRequest) { return renameCall(request, bound => renames.prepare(bound)); },
    executeRename(request: AgentPluginRenameRequest, preparation: AgentToolMainPreparedExecution, commit: AgentMainCommitSettlement) {
      return renameCall(request, (bound, settlement) => renames.execute(bound, preparation, settlement!), commit);
    },
    prepareFileOutput(request: AgentPluginFileOutputRequest) { return renameCall(request, bound => outputs.prepare(bound)); },
    releaseOutputs(runId: string, toolRunId?: string) { return outputs.releaseRun(runId, toolRunId); },
    executeFileOutput(request: AgentPluginFileOutputRequest, preparation: AgentToolMainPreparedExecution, commit: AgentMainCommitSettlement) {
      return renameCall(request, (bound, settlement) => outputs.execute(bound, preparation, settlement!), commit);
    },
    async execute(request: AgentPluginToolRequest): Promise<AgentToolResult> {
      const source = normalizeAgentPluginToolSource(request.source);
      checkSender(request.authority.sender);
      const spec = options.manager.resolveTool(source.toolId, source.packageFingerprint);
      if (spec.registrationId !== source.registrationId || spec.plugin.id !== source.pluginId || spec.plugin.version !== source.pluginVersion) throw new PluginFault('FORBIDDEN', 'Plugin registration changed');
      validateToolInput(spec.tool, request.input);
      const nodeId = (request.input.resource as { nodeId: number }).nodeId;
      if (request.authority.operation.operation !== 'stage-library-node' || request.authority.operation.nodeId !== nodeId) throw new PluginFault('FORBIDDEN', 'Plugin resource mismatch');
      const controller = new AbortController(); calls.add(controller); callOwners.set(controller, source.pluginId);
      const signal = AbortSignal.any([controller.signal, request.authority.signal]);
      let rejectAbort!: () => void;
      const interrupted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(signal.reason instanceof PluginFault ? signal.reason : new PluginFault('CANCELLED', 'Plugin Agent call cancelled'));
        signal.addEventListener('abort', rejectAbort, { once: true });
        if (signal.aborted) rejectAbort();
      });
      void interrupted.catch(() => undefined);
      const wait = <T>(pending: Promise<T>) => Promise.race([pending, interrupted]);
      const assertCurrent = async (operationSignal: AbortSignal) => {
        signal.throwIfAborted(); operationSignal.throwIfAborted();
        checkSender(request.authority.sender);
        if (!options.manager.stillToolAllowed(source.toolId, source.packageFingerprint)) throw new PluginFault('FORBIDDEN', 'Plugin disabled or changed');
        await request.assertCurrent(operationSignal);
        signal.throwIfAborted(); operationSignal.throwIfAborted();
        checkSender(request.authority.sender);
        if (!options.manager.stillToolAllowed(source.toolId, source.packageFingerprint)) throw new PluginFault('FORBIDDEN', 'Plugin disabled or changed');
      };
      try {
        await wait(assertCurrent(signal));
        const resource = await wait((options.openResource ?? openAgentPluginResource)({ ...request.authority, signal }, assertCurrent));
        await wait(assertCurrent(signal));
        const capability = createPluginToolCallAuthority({ pluginId: source.pluginId, toolId: source.toolId, packageFingerprint: source.packageFingerprint,
          accountScope: request.authority.ownerScope.accountScope, backendScope: request.authority.ownerScope.backendScope,
          libraryId: request.authority.libraryId, nodeId, sessionId: request.authority.sessionId,
          runId: request.authority.runId, toolRunId: request.authority.toolRunId, aiDestinationId: request.aiDestinationId }, resource, signal, assertCurrent);
        const result = await wait(runtimeFor(request.authority.sender).execute(source.toolId, source.packageFingerprint, request.input, capability));
        await wait(assertCurrent(signal));
        return { ok: true, message: '插件文件分析已完成', data: { source: result.source, output: result.output } };
      } finally { signal.removeEventListener('abort', rejectAbort); calls.delete(controller); controller.abort(); }
    },
    dispose() {
      if (disposed) return; disposed = true; detach();
      outputs.revoke();
      for (const controller of calls) controller.abort();
      current?.runtime.dispose(); current?.host.dispose(); current = undefined;
    },
  };
}
let service: ReturnType<typeof createAgentPluginService> | undefined;
export function configureAgentPluginService(options: AgentPluginServiceOptions) { service?.dispose(); service = createAgentPluginService(options); }
export function disposeAgentPluginService() { service?.dispose(); service = undefined; }
export function getAgentPluginToolRegistrations(reservedNames: readonly string[] = []) { return service?.snapshot(reservedNames) ?? []; }
export async function releaseAgentPluginOutputs(runId: string, toolRunId?: string) { await service?.releaseOutputs(runId, toolRunId); }
export async function executeAgentPluginTool(request: AgentPluginToolRequest) {
  if (!service) throw new PluginFault('UNAVAILABLE', 'Plugin Agent service unavailable');
  return service.execute(request);
}
export async function prepareAgentPluginFileOutput(request: AgentPluginFileOutputRequest) {
  if (!service) throw new PluginFault('UNAVAILABLE', 'Plugin Agent service unavailable');
  return service.prepareFileOutput(request);
}
export async function executeAgentPluginFileOutput(request: AgentPluginFileOutputRequest, preparation: AgentToolMainPreparedExecution, commit: AgentMainCommitSettlement) {
  if (!service) throw new PluginFault('UNAVAILABLE', 'Plugin Agent service unavailable');
  return service.executeFileOutput(request, preparation, commit);
}

export async function prepareAgentPluginRename(request: AgentPluginRenameRequest) {
  if (!service) throw new PluginFault('UNAVAILABLE', 'Plugin Agent service unavailable');
  return service.prepareRename(request);
}
export async function executeAgentPluginRename(request: AgentPluginRenameRequest, preparation: AgentToolMainPreparedExecution, commit: AgentMainCommitSettlement) {
  if (!service) throw new PluginFault('UNAVAILABLE', 'Plugin Agent service unavailable');
  return service.executeRename(request, preparation, commit);
}
