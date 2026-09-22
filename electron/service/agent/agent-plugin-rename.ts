import { createHash, randomUUID } from 'node:crypto';
import type { AgentPluginToolSource, AgentFileAuthorityNodeSnapshotV1, AgentToolResult } from '../../../src/shared/agent/agent.types';
import { normalizeAgentPluginRenamePreparedActionPublicV1 } from '../../../src/shared/agent/agent-prepared-action';
import { createPluginMetadataCallAuthority, type PluginToolRuntime } from '../extensions/plugin-tool-runtime';
import type { MetadataResourceAuthority } from '../extensions/resource-broker';
import type { PluginManager } from '../extensions/plugin-manager';
import { validateToolInput } from '../extensions/tool-schema';
import { agentFileAuthorityBroker, type AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import { hashAgentToolInputForPreparation, type AgentMainCommitSettlement, type AgentToolMainPreparationResult, type AgentToolMainPreparedExecution } from './agent-tool-registry';
import { createPluginRenameTransport, RenameTransportError, type ConditionalRenameRequest, type ConditionalRenameReceipt } from './plugin-rename-transport';

export interface AgentPluginRenameRequest {
  source: AgentPluginToolSource; input: unknown; authority: AgentFileAuthorityBrokerRequestInput;
  aiDestinationId: string; assertCurrent(signal: AbortSignal): Promise<void>;
}
type FileFact = { nodeId: number; parentId: number; name: string; ext: string; updatedAt: string };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fileName(name: string) {
  return !!name && name === name.trim() && name !== '.' && name !== '..' && !/[<>:"/\\|?*]/u.test(name)
    && !Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !name.endsWith('.') && Buffer.byteLength(name) <= 240;
}
function fullName(fact: Pick<FileFact, 'name' | 'ext'>) { return fact.ext ? `${fact.name}.${fact.ext}` : fact.name; }
function facts(nodes: readonly AgentFileAuthorityNodeSnapshotV1[], nodeIds: readonly number[], libraryId: number): FileFact[] {
  if (nodes.length !== nodeIds.length) throw new Error('重命名目标数量已变化');
  return nodes.map((node, i) => {
    if (node.id !== nodeIds[i] || node.libraryId !== libraryId || node.type !== 'file' || !Number.isSafeInteger(node.parentId) || node.parentId <= 0
      || typeof node.updatedAt !== 'string' || !Number.isFinite(Date.parse(node.updatedAt))) throw new Error('重命名目标身份无效');
    const result = { nodeId: node.id, parentId: node.parentId, name: node.name, ext: node.ext ?? '', updatedAt: node.updatedAt };
    if (!fileName(fullName(result))) throw new Error('目标文件名不适合批量重命名');
    return result;
  });
}
function operationId(value: unknown) {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function committedResult(receipt: ConditionalRenameReceipt): AgentToolResult {
  return { ok: true, message: `已原子重命名 ${receipt.items.length} 个文件`, data: { mutationCommitState: 'committed', operationId: receipt.operationId,
    libraryId: receipt.libraryId, atomic: true, replayed: receipt.replayed, affectedParentIds: receipt.affectedParentIds,
    items: receipt.items.map(item => ({ nodeId: item.nodeId, parentId: item.parentId, oldName: fullName(item.previous), newName: fullName(item.current), name: item.current.name, ext: item.current.ext, updatedAt: item.current.updatedAt, status: 'committed' })) } };
}
export function createAgentPluginRenameService(options: {
  manager: PluginManager; runtimeFor: (request: AgentPluginRenameRequest) => PluginToolRuntime;
  request?: typeof agentFileAuthorityBroker.request;
  transport?: ReturnType<typeof createPluginRenameTransport>;
}) {
  const requestAuthority = options.request ?? agentFileAuthorityBroker.request;
  const transportFor = (request: AgentPluginRenameRequest) => options.transport ?? createPluginRenameTransport({ apiBaseUrl: request.authority.ownerScope.backendScope });
  async function read(request: AgentPluginRenameRequest, nodeIds: number[], includeCredentials: boolean, signal: AbortSignal) {
    await request.assertCurrent(signal);
    const response = await requestAuthority({ ...request.authority, signal, operation: { operation: 'rename-library-files', nodeIds, includeCredentials } });
    if (response.operation !== 'rename-library-files' || response.version !== 1) throw new Error('重命名授权响应无效');
    const files = facts(response.nodes, nodeIds, request.authority.libraryId);
    await request.assertCurrent(signal);
    if (includeCredentials && !response.credentials) throw new Error('重命名提交缺少当前登录授权');
    return { files, credentials: response.credentials };
  }
  return {
    async prepare(request: AgentPluginRenameRequest): Promise<AgentToolMainPreparationResult> {
      const source = request.source; const spec = options.manager.resolveTool(source.toolId, source.packageFingerprint);
      if (spec.tool.kind !== 'rename-proposal' || spec.registrationId !== source.registrationId || spec.plugin.id !== source.pluginId || spec.plugin.version !== source.pluginVersion || spec.plugin.fingerprint !== source.packageFingerprint) throw new Error('重命名插件身份已变化');
      validateToolInput(spec.tool, request.input);
      const input = request.input; const nodeIds = [...input.resources as number[]];
      if (request.authority.operation.operation !== 'rename-library-files' || JSON.stringify(request.authority.operation.nodeIds) !== JSON.stringify(nodeIds)) throw new Error('重命名资源范围不匹配');
      const signal = request.authority.signal;
      const initial = await read(request, nodeIds, false, signal);
      const revision = hash(initial.files);
      const ids: string[] = initial.files.map(() => randomUUID());
      const resource: MetadataResourceAuthority = Object.freeze({ kind: 'metadata', accountScope: request.authority.ownerScope.accountScope,
        libraryId: request.authority.libraryId, revision, files: initial.files.map((file, index) => Object.freeze({ id: ids[index], name: fullName(file) })),
        authorize: async (operationSignal: AbortSignal) => { await request.assertCurrent(operationSignal); return true; },
        currentRevision: async (operationSignal: AbortSignal) => hash((await read(request, nodeIds, false, operationSignal)).files),
      });
      const capability = createPluginMetadataCallAuthority({ pluginId: source.pluginId, toolId: source.toolId, packageFingerprint: source.packageFingerprint,
        nodeIds, accountScope: request.authority.ownerScope.accountScope, backendScope: request.authority.ownerScope.backendScope,
        libraryId: request.authority.libraryId, sessionId: request.authority.sessionId, runId: request.authority.runId,
        toolRunId: request.authority.toolRunId, aiDestinationId: request.aiDestinationId }, resource, signal, request.assertCurrent);
      const result = await options.runtimeFor(request).executeRenameProposal(source.toolId, source.packageFingerprint, input, capability);
      const changes = result.output.changes.map(change => {
        const index = ids.indexOf(change.id); if (index < 0) throw new Error('插件返回了未授权目标');
        const old = initial.files[index]; const suffix = old.ext ? '.' + old.ext : '';
        if (!fileName(change.name) || (suffix && !change.name.endsWith(suffix))) throw new Error('提案含非法名称或修改了扩展名');
        const name = suffix ? change.name.slice(0, -suffix.length) : change.name;
        if (!name || !fileName(name) || (!suffix && change.name.includes('.') && !old.name.includes('.'))) throw new Error('首期提案必须保留文件扩展名');
        return { nodeId: old.nodeId, parentId: old.parentId, oldName: fullName(old), newName: change.name,
          name, expected: { name: old.name, ext: old.ext, parentId: old.parentId, updatedAt: old.updatedAt } };
      }).filter(change => change.oldName !== change.newName).sort((a, b) => a.nodeId - b.nodeId);
      if (!changes.length) throw new Error('规则没有产生名称变化，未提交任何改名');
      const body: ConditionalRenameRequest = { libraryId: request.authority.libraryId,
        operationId: operationId([request.authority.ownerScope, request.authority.toolRunId, source, changes]),
        items: changes.map(({ nodeId, name, expected }) => ({ nodeId, name, expected })) };
      const action = normalizeAgentPluginRenamePreparedActionPublicV1({ kind: 'plugin.rename', version: 1, libraryId: body.libraryId,
        operationId: body.operationId, pluginId: source.pluginId, pluginVersion: source.pluginVersion, packageFingerprint: source.packageFingerprint,
        items: changes.map(({ nodeId, parentId, oldName, newName }) => ({ nodeId, parentId, oldName, newName })) });
      const verified = await read(request, nodeIds, true, signal);
      if (hash(verified.files) !== revision) throw new Error('提案期间目标已变化，请重新准备');
      const transport = transportFor(request);
      await transport.verifyActor(verified.credentials!, request.authority.ownerScope, signal);
      await transport.dryRun(body, verified.credentials!, signal);
      await request.assertCurrent(signal);
      if (!options.manager.stillToolAllowed(source.toolId, source.packageFingerprint)) throw new Error('重命名提案授权已撤销');
      return { publicAction: action, binding: { request: body, source }, snapshotMaterial: { request: body, source },
        decision: { behavior: 'ask', risk: 'write', preview: { title: `确认插件重命名 ${changes.length} 个文件`,
          description: `插件 ${source.pluginId} 生成了以下提案。仅修改文件名主体、保留扩展名；任一冲突整批不提交。`, risk: 'write',
          details: changes.map(item => ({ label: item.oldName, value: item.newName })) } } };
    },
    async execute(request: AgentPluginRenameRequest, preparation: AgentToolMainPreparedExecution, commit: AgentMainCommitSettlement): Promise<AgentToolResult> {
      const action = normalizeAgentPluginRenamePreparedActionPublicV1(preparation.publicAction);
      const bound = preparation.binding as { request?: ConditionalRenameRequest; source?: AgentPluginToolSource };
      const body = structuredClone(bound.request);
      if (!body || JSON.stringify(bound.source) !== JSON.stringify(request.source) || action.operationId !== body.operationId || action.libraryId !== request.authority.libraryId
        || preparation.identity.toolRunId !== request.authority.toolRunId || preparation.identity.runId !== request.authority.runId
        || preparation.identity.sessionId !== request.authority.sessionId || preparation.identity.aiDestinationIdentity !== request.aiDestinationId) throw new Error('重命名批准与执行身份不匹配');
      const identity = preparation.identity;
      const resources = (request.input as { resources?: unknown })?.resources;
      if (!Array.isArray(resources) || new Set(resources).size !== resources.length
        || request.authority.operation.operation !== 'rename-library-files'
        || JSON.stringify(request.authority.operation.nodeIds) !== JSON.stringify(resources)
        || body.libraryId !== request.authority.libraryId || identity.libraryId !== body.libraryId
        || identity.ownerWebContentsId !== request.authority.sender.id
        || identity.ownerScope.accountScope !== request.authority.ownerScope.accountScope
        || identity.ownerScope.backendScope !== request.authority.ownerScope.backendScope
        || identity.toolName !== request.source.toolId || identity.toolRegistrationId !== request.source.registrationId
        || identity.toolInputHash !== hashAgentToolInputForPreparation(request.input)
        || action.pluginId !== request.source.pluginId || action.pluginVersion !== request.source.pluginVersion || action.packageFingerprint !== request.source.packageFingerprint
        || action.items.length !== body.items.length || body.items.some((item, index) => !resources.includes(item.nodeId)
          || action.items[index].nodeId !== item.nodeId || action.items[index].parentId !== item.expected.parentId
          || action.items[index].oldName !== fullName(item.expected) || action.items[index].newName !== fullName({ name: item.name, ext: item.expected.ext }))) throw new Error('批准的重命名目标或来源已变化');
      const nodeIds = body.items.map(item => item.nodeId);
      const verified = await read(request, nodeIds, true, request.authority.signal);
      if (verified.files.some((file, index) => JSON.stringify({ name: file.name, ext: file.ext, parentId: file.parentId, updatedAt: file.updatedAt }) !== JSON.stringify(body.items[index].expected))) throw new Error('批准后的文件已经变化，未提交');
      if (!options.manager.stillToolAllowed(request.source.toolId, request.source.packageFingerprint)) throw new Error('插件已停用或更新，未提交');
      const transport = transportFor(request);
      await transport.verifyActor(verified.credentials!, request.authority.ownerScope, request.authority.signal);
      await request.assertCurrent(request.authority.signal);
      const fallback: AgentToolResult = { ok: false, message: '改名结果尚不能确认，请按操作ID核对，勿重复提交新操作',
        data: { mutationCommitState: 'commit_unknown', operationId: body.operationId, libraryId: body.libraryId, atomic: true } };
      commit.begin(fallback);
      // 提交后用独立、有界的收尾预算：取消不能抹掉服务端已提交事实。
      let outcome: AgentToolResult;
      try { outcome = committedResult(await transport.commit(body, verified.credentials!, AbortSignal.timeout(15000))); }
      catch (error) {
        if (error instanceof RenameTransportError && error.commitState === 'uncommitted') outcome = { ok: false, message: '改名未提交：目标冲突、条件变化或服务端拒绝', data: { ...fallback.data as object, mutationCommitState: 'uncommitted' } };
        else {
          const receipt = await transport.status(body, verified.credentials!, AbortSignal.timeout(10000)).catch(() => null);
          outcome = receipt ? committedResult(receipt) : fallback;
        }
      }
      commit.settle(outcome);
      return outcome;
    },
  };
}
