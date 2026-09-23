import { createHash, randomUUID } from 'node:crypto';
import { BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import type { AgentToolResult } from '../../../src/shared/agent/agent.types';
import type { PluginCommandExecution, PluginCommandExecutionRequest, PluginCommandPrepareRequest, PluginCommandReconcileRequest, PluginCommandScope } from '../../../src/shared/plugins/manual-command.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { normalizeAgentPreparedActionPublic } from '../../../src/shared/agent/agent-prepared-action';
import { createAgentFileAuthorityBroker, type AgentFileAuthorityBrokerRequestInput } from '../agent/agent-file-authority-broker';
import { createAgentPluginRenameService, type AgentPluginRenameRequest } from '../agent/agent-plugin-rename';
import { createAgentPluginFileOutputService } from '../agent/agent-plugin-file-output';
import { openAgentPluginResource } from '../agent/agent-plugin-resource';
import { hashAgentToolInputForPreparation, type AgentToolMainPreparationResult, type AgentToolMainPreparedExecution } from '../agent/agent-tool-registry';
import { createPluginRenameTransport } from '../agent/plugin-rename-transport';
import { createAgentMediaUploadControlPlane } from '../agent/agent-media-upload-control-plane';
import { queryApprovedPluginOperationReceipt } from '../agent/agent-plugin-receipts';
import { PluginDevelopmentHost } from './isolated-view';
import { createPluginToolCallAuthority, PluginToolRuntime } from './plugin-tool-runtime';
import { PluginManager } from './plugin-manager';
import { PluginCommandStore } from './plugin-command-store';
import { validateToolInput } from './tool-schema';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isPositive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'commit-unknown']);
const sameScope = (a: PluginCommandScope, b: PluginCommandScope) => a.libraryId === b.libraryId
  && a.ownerScope.accountScope === b.ownerScope.accountScope && a.ownerScope.backendScope === b.ownerScope.backendScope;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件命令请求无效');
  return value as Record<string, unknown>;
};
const exact = (value: unknown, keys: string[]) => {
  const result = object(value);
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error('插件命令请求包含未知字段');
  return result;
};
interface ActiveExecution {
  record: PluginCommandExecution;
  sender: WebContents;
  input: Record<string, unknown>;
  nodeIds: number[];
  destination?: { parentId: number; fileName: string };
  kind: string;
  controller: AbortController;
  preparation?: AgentToolMainPreparationResult;
  commitStarted: boolean;
  busy: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export interface PluginCommandServiceOptions {
  manager: PluginManager;
  getMainWindow(): BrowserWindow | null;
  store: PluginCommandStore;
  apiBaseUrl: string;
  preloadPath?: string;
}

/** Manual owner + lifetime. Legacy run/session fields below are opaque adapter correlation keys only. */
export function createPluginCommandService(options: PluginCommandServiceOptions) {
  const active = new Map<string, ActiveExecution>();
  const querying = new Set<string>();
  const broker = createAgentFileAuthorityBroker({ requestChannel: 'plugin-commands:file-authority:requested' });
  let current: { parent: BrowserWindow; host: PluginDevelopmentHost; runtime: PluginToolRuntime } | undefined;
  let disposed = false;
  const backendScope = normalizeAgentOwnerScope({ accountScope: 'user:1', backendScope: options.apiBaseUrl }).backendScope;
  // Services share the same sandbox and file contracts, but resolve only command-approved contributions.
  const manager = new Proxy(options.manager, {
    get(target, property) {
      if (property === 'resolveTool') return (id: string, fingerprint?: string) => target.resolveTool(id, fingerprint, 'command');
      if (property === 'stillToolAllowed') return (id: string, fingerprint: string) => target.stillToolAllowed(id, fingerprint, 'command');
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  function scope(input: PluginCommandScope): PluginCommandScope {
    const ownerScope = normalizeAgentOwnerScope(input?.ownerScope);
    if (!isPositive(input?.libraryId) || ownerScope.backendScope !== backendScope || !/^user:[1-9]\d*$/u.test(ownerScope.accountScope)) throw new Error('插件命令账号或资料库无效');
    return { ownerScope, libraryId: input.libraryId };
  }
  function checkSender(sender: WebContents) {
    const parent = options.getMainWindow();
    if (disposed || !parent || parent.isDestroyed() || sender.isDestroyed() || sender !== parent.webContents) throw new Error('插件命令窗口已关闭');
    return parent;
  }
  function publish(record: PluginCommandExecution) {
    options.store.save(record);
    const parent = options.getMainWindow();
    if (parent && !parent.isDestroyed() && !parent.webContents.isDestroyed()) {
      try { parent.webContents.send('plugin-commands:changed', structuredClone(record)); } catch { /* Persisted facts survive a closing renderer. */ }
    }
  }
  function update(execution: ActiveExecution, patch: Partial<PluginCommandExecution>) {
    const next = { ...execution.record, ...patch, revision: execution.record.revision + 1, updatedAt: new Date().toISOString() };
    publish(next); execution.record = next;
  }
  function runtimeFor(sender: WebContents) {
    const parent = checkSender(sender);
    if (!current || current.parent !== parent) {
      current?.runtime.dispose(); current?.host.dispose();
      const host = new PluginDevelopmentHost(parent, options.preloadPath ?? path.join(process.env.APP_ROOT ?? '', 'dist-plugins/plugin-preload.cjs'));
      current = { parent, host, runtime: new PluginToolRuntime(manager, host) };
    }
    return current.runtime;
  }
  async function assertCurrent(execution: ActiveExecution, signal: AbortSignal) {
    signal.throwIfAborted(); execution.controller.signal.throwIfAborted(); checkSender(execution.sender);
    const record = execution.record;
    if (active.get(record.id) !== execution || !manager.stillToolAllowed(record.source.toolId, record.source.packageFingerprint)) throw new Error('插件命令授权已失效');
    const resolved = manager.resolveTool(record.source.toolId, record.source.packageFingerprint);
    if (resolved.registrationId !== record.source.registrationId || !resolved.plugin.commands?.some(command => command.id === record.commandId && command.toolId === record.source.toolId)) throw new Error('插件命令已经变化');
  }
  async function authorityRequest(input: AgentFileAuthorityBrokerRequestInput) {
    const execution = active.get(input.toolRunId);
    if (!execution || input.runId !== `manual:${execution.record.id}` || input.sessionId !== input.runId
      || !sameScope(execution.record, input) || execution.sender !== input.sender) throw new Error('插件命令资源授权失效');
    await assertCurrent(execution, input.signal);
    const operation = input.operation;
    if (operation.operation === 'rename-library-files') {
      if (execution.kind !== 'rename-proposal' || operation.nodeIds.some(id => !execution.nodeIds.includes(id))) throw new Error('改名资源不在选择范围');
    } else if (operation.operation === 'stage-library-node') {
      if (execution.kind === 'rename-proposal' || execution.nodeIds.length !== 1 || operation.nodeId !== execution.nodeIds[0]) throw new Error('资源不在选择范围');
    } else if (operation.operation === 'publish-library-file') {
      if (execution.kind !== 'file-output' || operation.parentId !== execution.destination?.parentId || operation.fileName !== execution.destination.fileName) throw new Error('文件目标不在批准范围');
    } else throw new Error('手动插件命令不支持此资源操作');
    const result = await broker.request(input);
    await assertCurrent(execution, input.signal);
    return result;
  }
  const openResource: typeof openAgentPluginResource = (input, check) => openAgentPluginResource(input, check, { request: authorityRequest });
  const renames = createAgentPluginRenameService({ manager, request: authorityRequest, runtimeFor: request => runtimeFor(request.authority.sender) });
  const outputs = createAgentPluginFileOutputService({ manager, request: authorityRequest, openResource, runtimeFor: request => runtimeFor(request.authority.sender) });
  function requestFor(execution: ActiveExecution): AgentPluginRenameRequest {
    const { record } = execution;
    return { source: record.source, input: execution.input, aiDestinationId: `manual:${record.id}`,
      authority: { ownerScope: record.ownerScope, libraryId: record.libraryId, sender: execution.sender,
        sessionId: `manual:${record.id}`, runId: `manual:${record.id}`, toolRunId: record.id, signal: execution.controller.signal,
        operation: execution.kind === 'rename-proposal' ? { operation: 'rename-library-files', nodeIds: execution.nodeIds, includeCredentials: false }
          : { operation: 'stage-library-node', nodeId: execution.nodeIds[0], includeDownloadUrl: true } },
      assertCurrent: signal => assertCurrent(execution, signal) };
  }
  function prepareAction(execution: ActiveExecution) {
    const request = requestFor(execution);
    return execution.kind === 'rename-proposal' ? renames.prepare(request)
      : outputs.prepare({ ...request, lifetimeSignal: execution.controller.signal });
  }
  function release(execution: ActiveExecution) {
    clearTimeout(execution.timer); active.delete(execution.record.id); execution.controller.abort();
    void outputs.releaseRun(`manual:${execution.record.id}`).catch(() => undefined);
  }
  function fail(execution: ActiveExecution) {
    if (execution.commitStarted) return;
    if (!terminal.has(execution.record.status)) update(execution, {
      status: execution.controller.signal.aborted ? 'cancelled' : 'failed',
      message: execution.controller.signal.aborted ? '插件命令已取消，未提交文件修改。' : '插件命令准备或验证失败，未提交文件修改；请检查文件、参数及插件权限后重试。',
    });
  }
  function cancelExecution(execution: ActiveExecution) {
    execution.controller.abort();
    if (!execution.commitStarted) {
      fail(execution);
      if (!execution.busy) release(execution);
    }
  }
  const detach = options.manager.attachRuntime(pluginId => {
    outputs.revoke(pluginId);
    for (const execution of active.values()) if (!pluginId || execution.record.source.pluginId === pluginId) cancelExecution(execution);
  });
  function lookup(sender: WebContents, input: PluginCommandExecutionRequest) {
    checkSender(sender); const bound = scope(input);
    if (typeof input.executionId !== 'string' || !isPositive(input.expectedRevision)) throw new Error('插件命令记录无效');
    const record = options.store.get(input.executionId);
    if (!record || !sameScope(record, bound) || record.revision !== input.expectedRevision) throw new Error('插件命令记录已变化，请刷新后重试');
    const execution = active.get(record.id);
    if (execution && execution.sender !== sender) throw new Error('插件命令不属于当前窗口');
    return { record, execution };
  }
  return {
    completeFileAuthority(sender: WebContents, input: Parameters<typeof broker.complete>[1]) { checkSender(sender); return broker.complete(sender.id, input); },
    list(sender: WebContents, input: PluginCommandScope) {
      checkSender(sender); exact(input, ['ownerScope', 'libraryId']); const bound = scope(input);
      return options.store.all().filter(record => sameScope(record, bound)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async prepare(sender: WebContents, input: PluginCommandPrepareRequest, onCreated?: (execution: PluginCommandExecution) => void): Promise<PluginCommandExecution> {
      checkSender(sender); exact(input, ['ownerScope', 'libraryId', 'pluginId', 'commandId', 'nodeIds', 'parameters', 'destination']);
      const bound = scope(input);
      if (active.size >= 8) throw new Error('正在执行的插件命令过多，请稍后再试');
      const plugin = options.manager.catalog().plugins.find(item => item.id === input.pluginId);
      const command = plugin?.commands?.find(item => item.id === input.commandId);
      if (!plugin || !command) throw new Error('插件命令不存在');
      const resolved = manager.resolveTool(command.toolId, plugin.fingerprint);
      if (!Array.isArray(input.nodeIds) || !input.nodeIds.length || input.nodeIds.length > 50 || input.nodeIds.some(id => !isPositive(id))
        || new Set(input.nodeIds).size !== input.nodeIds.length || (resolved.tool.kind !== 'rename-proposal' && input.nodeIds.length !== 1)) throw new Error('请选择此命令支持的文件数量');
      const parameters = object(input.parameters);
      if (['resource', 'resources', 'destination'].some(key => Object.prototype.hasOwnProperty.call(parameters, key)) || Buffer.byteLength(JSON.stringify(parameters)) > 32 * 1024) throw new Error('插件命令参数无效');
      if (resolved.tool.kind === 'file-output') {
        const target = exact(input.destination, ['parentId', 'fileName']);
        if (!isPositive(target.parentId) || typeof target.fileName !== 'string') throw new Error('请选择输出目录和文件名');
      } else if (input.destination !== undefined) throw new Error('此命令不支持输出目标');
      const toolInput = structuredClone({ ...parameters, ...(resolved.tool.kind === 'rename-proposal'
        ? { resources: input.nodeIds } : { resource: { nodeId: input.nodeIds[0] } }), ...(input.destination ? { destination: input.destination } : {}) });
      validateToolInput(resolved.tool, toolInput);
      const now = new Date().toISOString();
      const record: PluginCommandExecution = { ...bound, id: randomUUID(), revision: 1, commandId: command.id, title: command.title,
        source: { pluginId: plugin.id, pluginVersion: plugin.version, packageFingerprint: plugin.fingerprint, toolId: resolved.tool.id, registrationId: resolved.registrationId },
        status: 'preparing', createdAt: now, updatedAt: now };
      const execution: ActiveExecution = { record, sender, input: toolInput, nodeIds: [...input.nodeIds], destination: input.destination ? structuredClone(input.destination) : undefined,
        kind: resolved.tool.kind ?? 'read-only', controller: new AbortController(), commitStarted: false, busy: true,
        timer: setTimeout(() => cancelExecution(execution), 10 * 60_000) };
      execution.timer.unref?.();
      active.set(record.id, execution);
      try {
        publish(record);
        onCreated?.(structuredClone(record));
        if (execution.kind !== 'rename-proposal' && execution.kind !== 'file-output') {
          const request = requestFor(execution);
          const resource = await openResource(request.authority, request.assertCurrent);
          const capability = createPluginToolCallAuthority({ ...record.source, accountScope: bound.ownerScope.accountScope, backendScope: bound.ownerScope.backendScope,
            libraryId: bound.libraryId, nodeId: input.nodeIds[0], sessionId: request.authority.sessionId, runId: request.authority.runId,
            toolRunId: record.id, aiDestinationId: request.aiDestinationId }, resource, execution.controller.signal, request.assertCurrent);
          const result = await runtimeFor(sender).execute(record.source.toolId, record.source.packageFingerprint, toolInput, capability);
          await assertCurrent(execution, execution.controller.signal);
          update(execution, { status: 'completed', result: { ok: true, message: '插件命令执行完成', data: result.output } });
        } else {
          execution.preparation = await prepareAction(execution);
          await assertCurrent(execution, execution.controller.signal);
          update(execution, { status: 'awaiting-approval', action: execution.preparation.publicAction, preview: execution.preparation.decision.behavior === 'ask' ? execution.preparation.decision.preview : undefined });
        }
      } catch { fail(execution); }
      finally { execution.busy = false; if (terminal.has(execution.record.status)) release(execution); }
      return structuredClone(execution.record);
    },
    async approve(sender: WebContents, input: PluginCommandExecutionRequest): Promise<PluginCommandExecution> {
      exact(input, ['ownerScope', 'libraryId', 'executionId', 'expectedRevision']);
      const { execution } = lookup(sender, input);
      if (!execution || execution.busy || execution.record.status !== 'awaiting-approval' || !execution.preparation) throw new Error('插件提案已经失效，请重新准备');
      execution.busy = true;
      try {
        const previous = execution.preparation;
        const latest = await prepareAction(execution);
        await assertCurrent(execution, execution.controller.signal);
        execution.preparation = latest;
        if (hash([latest.publicAction, latest.snapshotMaterial]) !== hash([previous.publicAction, previous.snapshotMaterial])) {
          update(execution, { action: latest.publicAction, preview: latest.decision.behavior === 'ask' ? latest.decision.preview : undefined, message: '文件或产物已经变化，请重新核对并批准。' });
          return structuredClone(execution.record);
        }
        const request = requestFor(execution);
        const preparation: AgentToolMainPreparedExecution = { binding: latest.binding, publicAction: latest.publicAction,
          preparedActionId: `manual:${execution.record.id}:${execution.record.revision}`, snapshotHash: hash(latest.snapshotMaterial),
          identity: { aiDestinationIdentity: request.aiDestinationId, callId: execution.record.id, libraryId: execution.record.libraryId,
            ownerScope: execution.record.ownerScope, ownerWebContentsId: sender.id, preparedActionId: `manual:${execution.record.id}:${execution.record.revision}`,
            runCapabilityIdentity: `v1:${hash([execution.record.id, execution.record.ownerScope, execution.nodeIds, execution.destination])}`,
            runId: request.authority.runId, sessionId: request.authority.sessionId, toolInputHash: hashAgentToolInputForPreparation(execution.input),
            toolName: execution.record.source.toolId, toolRegistrationId: execution.record.source.registrationId, toolRunId: execution.record.id } };
        update(execution, { status: 'executing', approvedAt: new Date().toISOString(), message: undefined });
        const commit = {
          begin(fallback: AgentToolResult) {
            execution.controller.signal.throwIfAborted();
            // Synchronous, fsynced fallback must exist before any write leaves this process.
            update(execution, { status: 'commit-unknown', result: fallback }); execution.commitStarted = true;
          },
          settle(result: AgentToolResult) {
            const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
            const commitState = execution.kind === 'file-output' ? data.uploadCommitState ?? data.mutationCommitState : data.mutationCommitState;
            update(execution, { status: result.ok ? 'completed' : commitState === 'commit_unknown' ? 'commit-unknown' : 'failed', result });
          },
        };
        const result = execution.kind === 'rename-proposal' ? await renames.execute(request, preparation, commit)
          : await outputs.execute({ ...request, lifetimeSignal: execution.controller.signal }, preparation, commit);
        if (!execution.commitStarted) commit.settle(result);
      } catch { fail(execution); }
      finally { execution.busy = false; if (terminal.has(execution.record.status)) release(execution); }
      return structuredClone(execution.record);
    },
    cancel(sender: WebContents, input: PluginCommandExecutionRequest) {
      exact(input, ['ownerScope', 'libraryId', 'executionId', 'expectedRevision']);
      const { record, execution } = lookup(sender, input);
      if (!execution) return record;
      cancelExecution(execution); return structuredClone(execution.record);
    },
    release(sender: WebContents, input: PluginCommandScope) {
      checkSender(sender); exact(input, ['ownerScope', 'libraryId']); const bound = scope(input);
      for (const execution of active.values()) if (execution.sender === sender && sameScope(execution.record, bound)) cancelExecution(execution);
    },
    releaseOwner(senderId: number) {
      for (const execution of active.values()) if (execution.sender.id === senderId) cancelExecution(execution);
      broker.releaseOwner(senderId);
    },
    async reconcile(sender: WebContents, input: PluginCommandReconcileRequest): Promise<PluginCommandExecution> {
      exact(input, ['ownerScope', 'libraryId', 'executionId', 'expectedRevision', 'credentials']);
      const { record } = lookup(sender, input);
      if (active.has(record.id) || querying.has(record.id) || querying.size >= 8 || record.status !== 'commit-unknown' || !record.approvedAt) throw new Error('此操作尚不能查询回执');
      const credentials = exact(input.credentials, ['token', 'username']);
      if (typeof credentials.token !== 'string' || !credentials.token || credentials.token.length > 32768
        || typeof credentials.username !== 'string' || !credentials.username || credentials.username.length > 256
        || /[\p{Cc}]/u.test(credentials.token + credentials.username)) throw new Error('当前登录凭据无效');
      const authentication = { token: credentials.token, username: credentials.username };
      const action = normalizeAgentPreparedActionPublic(record.action);
      if ((action.kind !== 'plugin.rename' && action.kind !== 'plugin.file-output') || action.libraryId !== record.libraryId
        || action.pluginId !== record.source.pluginId || action.pluginVersion !== record.source.pluginVersion || action.packageFingerprint !== record.source.packageFingerprint) throw new Error('原批准记录无效');
      querying.add(record.id);
      try {
        const signal = AbortSignal.timeout(30_000);
        const rename = createPluginRenameTransport({ apiBaseUrl: options.apiBaseUrl });
        const upload = createAgentMediaUploadControlPlane({ apiBaseUrl: options.apiBaseUrl });
        if (action.kind === 'plugin.rename') await rename.verifyActor(authentication, record.ownerScope, signal);
        else await upload.verifyAccount(authentication, Number(record.ownerScope.accountScope.slice(5)), signal);
        const result = await queryApprovedPluginOperationReceipt(action, authentication, signal, { rename, upload });
        checkSender(sender);
        if (options.store.get(record.id)?.revision !== record.revision) throw new Error('操作记录已经变化');
        const checkedAt = new Date().toISOString();
        const next: PluginCommandExecution = { ...record, result, originalResult: record.originalResult ?? record.result,
          status: result.ok ? 'completed' : 'commit-unknown', revision: record.revision + 1, updatedAt: checkedAt,
          receiptChecks: [...(record.receiptChecks ?? []), { checkedAt, state: result.ok ? 'committed' as const : 'commit_unknown' as const }].slice(-8) };
        publish(next); return next;
      } finally { querying.delete(record.id); }
    },
    dispose() {
      if (disposed) return;
      detach(); for (const execution of active.values()) cancelExecution(execution);
      current?.runtime.dispose(); current?.host.dispose(); current = undefined; disposed = true;
    },
  };
}
