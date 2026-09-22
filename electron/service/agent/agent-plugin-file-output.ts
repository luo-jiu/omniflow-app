import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { AgentPluginToolSource, AgentToolResult, AgentToolProgress, AgentPluginFileOutputPreparedActionPublicV1 } from '../../../src/shared/agent/agent.types';
import { normalizeAgentPluginFileOutputPreparedActionPublicV1 } from '../../../src/shared/agent/agent-prepared-action';
import type { PluginManager } from '../extensions/plugin-manager';
import { createPluginToolCallAuthority, type PluginToolRuntime } from '../extensions/plugin-tool-runtime';
import { validateToolInput } from '../extensions/tool-schema';
import { openAgentPluginResource } from './agent-plugin-resource';
import { agentFileAuthorityBroker, type AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import { agentMediaArtifactStore, type AgentMediaArtifactStore, type AgentMediaArtifactOwner } from './agent-media-artifact-store';
import { createAgentMediaArtifactUploadManager, type AgentMediaArtifactUploadTarget } from './agent-media-artifact-upload';
import { createAgentMediaUploadControlPlane, AgentMediaUploadControlPlaneError, type AgentMediaUploadControlPlane } from './agent-media-upload-control-plane';
import { hashAgentToolInputForPreparation, type AgentMainCommitSettlement, type AgentToolMainPreparedExecution, type AgentToolMainPreparationResult } from './agent-tool-registry';

const MAX_BYTES = 1024 * 1024;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const uuid = (value: unknown) => {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export interface AgentPluginFileOutputRequest {
  source: AgentPluginToolSource;
  input: unknown;
  authority: AgentFileAuthorityBrokerRequestInput;
  aiDestinationId: string;
  lifetimeSignal: AbortSignal;
  onProgress?: (progress: AgentToolProgress) => void;
  assertCurrent(signal: AbortSignal): Promise<void>;
}
type OutputInput = { resource: { nodeId: number }; destination: { parentId: number; fileName: string } };
interface PreparedOutput {
  key: string;
  inputHash: string;
  pluginId: string;
  source: AgentPluginToolSource;
  sourceRevision: string;
  parentRevision: string;
  action: AgentPluginFileOutputPreparedActionPublicV1;
  artifactId: string;
  owner: AgentMediaArtifactOwner;
  target: AgentMediaArtifactUploadTarget;
  busy: boolean;
  removeListener(): void;
}

/** 正文仅留在受管 artifact；模型、审批与持久历史只有目标及内容摘要。 */
export function createAgentPluginFileOutputService(options: {
  manager: PluginManager;
  runtimeFor(request: AgentPluginFileOutputRequest): PluginToolRuntime;
  request?: typeof agentFileAuthorityBroker.request;
  openResource?: typeof openAgentPluginResource;
  artifactStore?: AgentMediaArtifactStore;
  controlPlane?: AgentMediaUploadControlPlane;
  uploadFactory?: typeof createAgentMediaArtifactUploadManager;
}) {
  const requestAuthority = options.request ?? agentFileAuthorityBroker.request;
  const store = options.artifactStore ?? agentMediaArtifactStore;
  const control = options.controlPlane ?? createAgentMediaUploadControlPlane();
  const outputs = new Map<string, PreparedOutput>();
  const keyFor = (request: AgentPluginFileOutputRequest) => hash([request.authority.ownerScope,
    request.authority.sessionId, request.authority.runId, request.authority.toolRunId, request.authority.sender.id]);

  async function release(record: PreparedOutput) {
    if (record.busy) return;
    if (outputs.get(record.key) === record) outputs.delete(record.key);
    record.removeListener();
    await store.release(record.artifactId, record.owner);
  }
  function validateRequest(request: AgentPluginFileOutputRequest): OutputInput {
    request.authority.signal.throwIfAborted(); request.lifetimeSignal.throwIfAborted();
    const spec = options.manager.resolveTool(request.source.toolId, request.source.packageFingerprint);
    if (spec.tool.kind !== 'file-output' || spec.registrationId !== request.source.registrationId
      || spec.plugin.id !== request.source.pluginId || spec.plugin.version !== request.source.pluginVersion) throw new Error('插件产物来源已变化');
    validateToolInput(spec.tool, request.input);
    const input = request.input as OutputInput;
    if (request.authority.operation.operation !== 'stage-library-node' || request.authority.operation.nodeId !== input.resource.nodeId) {
      throw new Error('插件产物来源不在授权范围');
    }
    return input;
  }
  async function destination(request: AgentPluginFileOutputRequest, input: OutputInput, size: number,
    mediaType: string, includeCredentials: boolean, providerId?: string) {
    await request.assertCurrent(request.authority.signal);
    const result = await requestAuthority({ ...request.authority, operation: { operation: 'publish-library-file',
      parentId: input.destination.parentId, fileName: input.destination.fileName, fileSize: size,
      contentType: mediaType, includeCredentials, ...(providerId ? { providerId } : {}) } });
    if (result.operation !== 'publish-library-file' || result.parent.type !== 'dir'
      || result.parent.id !== input.destination.parentId || result.parent.libraryId !== request.authority.libraryId
      || (providerId && result.providerId !== providerId) || (includeCredentials && !result.credentials)) throw new Error('插件产物目标已变化');
    await request.assertCurrent(request.authority.signal);
    return { ...result, revision: hash([result.parent.id, result.parent.parentId, result.parent.name, result.parent.updatedAt, result.providerId]) };
  }
  const resultFor = (record: PreparedOutput, state: 'committed' | 'uncommitted' | 'commit_unknown', node?: { id: number; name: string; ext?: string }): AgentToolResult => ({
    ok: state === 'committed',
    message: state === 'committed' ? `已保存插件处理结果：${record.action.fileName}`
      : state === 'uncommitted' ? '文件未提交，原文件保持不变' : '文件保存结果尚不能确认，请查询原操作回执，勿重复创建文件',
    data: { mutationCommitState: state, uploadCommitState: state, operationId: record.action.operationId, libraryId: record.action.libraryId,
      fileName: record.action.fileName, mediaType: record.action.mediaType, sizeBytes: record.action.sizeBytes,
      sha256: record.action.sha256, ...(node ? { node,
        destination: { kind: 'library', nodeId: node.id, parentId: record.action.parentId },
        affectedParentIds: [record.action.parentId] } : {}) },
  });

  return {
    async prepare(request: AgentPluginFileOutputRequest): Promise<AgentToolMainPreparationResult> {
      const input = validateRequest(request);
      await request.assertCurrent(request.authority.signal);
      const resource = await (options.openResource ?? openAgentPluginResource)(request.authority, request.assertCurrent);
      const key = keyFor(request);
      const inputHash = hashAgentToolInputForPreparation(request.input);
      let record = outputs.get(key);
      if (record && (record.sourceRevision !== resource.revision || record.inputHash !== inputHash
        || hash(record.source) !== hash(request.source))) { await release(record); record = undefined; }
      if (!record) {
        const capability = createPluginToolCallAuthority({ ...request.source,
          accountScope: request.authority.ownerScope.accountScope, backendScope: request.authority.ownerScope.backendScope,
          libraryId: request.authority.libraryId, nodeId: input.resource.nodeId, sessionId: request.authority.sessionId,
          runId: request.authority.runId, toolRunId: request.authority.toolRunId, aiDestinationId: request.aiDestinationId },
        resource, request.authority.signal, request.assertCurrent);
        const output = (await options.runtimeFor(request).executeFileOutput(request.source.toolId,
          request.source.packageFingerprint, request.input, capability)).output;
        const bytes = Buffer.from(output.text, 'utf8');
        if (!bytes.length || bytes.length > MAX_BYTES || !['text/csv', 'application/json'].includes(output.mediaType)) throw new Error('插件产物格式或大小无效');
        const target = await destination(request, input, bytes.length, output.mediaType, false);
        const sha256 = digest(bytes);
        const action = normalizeAgentPluginFileOutputPreparedActionPublicV1({ kind: 'plugin.file-output', version: 1,
          libraryId: request.authority.libraryId, sourceNodeId: input.resource.nodeId,
          parentId: input.destination.parentId, fileName: input.destination.fileName, providerId: target.providerId,
          mediaType: output.mediaType, sizeBytes: bytes.length, sha256, pluginId: request.source.pluginId,
          pluginVersion: request.source.pluginVersion, packageFingerprint: request.source.packageFingerprint,
          operationId: uuid([key, inputHash, request.source, resource.revision, target.revision, sha256]) });
        const owner: AgentMediaArtifactOwner = { executionId: request.authority.toolRunId,
          ownerScope: request.authority.ownerScope, ownerWebContentsId: request.authority.sender.id,
          runId: request.authority.runId, sessionId: request.authority.sessionId };
        const artifact = await store.create(action.fileName, owner, { maxBytes: MAX_BYTES })
          .catch(() => { throw new Error('插件产物暂存不可用，请检查本机可用空间后重试'); });
        try {
          try {
            await writeFile(artifact.filePath, bytes, { flag: 'wx', mode: 0o600 });
            await store.finalize(artifact.artifactId);
          } catch { throw new Error('插件产物暂存失败，未提交文件'); }
          await request.assertCurrent(request.authority.signal);
          if (await resource.currentRevision(request.authority.signal) !== resource.revision) throw new Error('处理期间源文件已变化');
          record = { key, inputHash, pluginId: request.source.pluginId, source: structuredClone(request.source),
            sourceRevision: resource.revision, parentRevision: target.revision, action, artifactId: artifact.artifactId,
            owner, target: { conflictPolicy: 'error', contentType: action.mediaType, fileName: action.fileName,
              libraryId: action.libraryId, parentId: action.parentId, storageProvider: action.providerId },
            busy: false, removeListener: () => undefined };
          const outputRecord = record;
          const dispose = () => { void release(outputRecord).catch(() => undefined); };
          request.lifetimeSignal.addEventListener('abort', dispose, { once: true });
          record.removeListener = () => request.lifetimeSignal.removeEventListener('abort', dispose);
          outputs.set(key, record);
          request.lifetimeSignal.throwIfAborted();
        } catch (error) {
          await store.release(artifact.artifactId, owner).catch(() => undefined);
          if (record) await release(record).catch(() => undefined);
          throw error;
        }
      }
      const prepared = record;
      const target = await destination(request, input, prepared.action.sizeBytes, prepared.action.mediaType, false, prepared.action.providerId);
      if (target.revision !== prepared.parentRevision) { await release(prepared); throw new Error('目标目录已变化，请重新准备产物'); }
      await store.withOwnedFile(prepared.artifactId, prepared.owner, async file => {
        if (digest(await file.fileHandle.readFile()) !== prepared.action.sha256) throw new Error('插件产物已变化');
      }).catch(() => { throw new Error('插件产物已变化或暂存不可用，请重新准备'); });
      return { publicAction: prepared.action,
        binding: { artifactId: prepared.artifactId, sourceRevision: prepared.sourceRevision, parentRevision: prepared.parentRevision,
          inputHash, source: request.source, action: prepared.action },
        snapshotMaterial: { sourceRevision: prepared.sourceRevision, parentRevision: prepared.parentRevision, sha256: prepared.action.sha256 },
        decision: { behavior: 'ask', risk: 'write', preview: { title: '保存插件处理结果', risk: 'write',
          description: '确认在目标目录创建新文件。源文件保持不变，同名冲突不会覆盖。',
          details: [{ label: '来源文件', value: resource.name }, { label: '目标目录', value: target.parent.name },
            { label: '文件名', value: prepared.action.fileName }, { label: '大小', value: `${prepared.action.sizeBytes} 字节` },
            { label: '来源插件', value: request.source.pluginId }] } } };
    },

    async execute(request: AgentPluginFileOutputRequest, preparation: AgentToolMainPreparedExecution,
      commit: AgentMainCommitSettlement): Promise<AgentToolResult> {
      const input = validateRequest(request);
      const action = normalizeAgentPluginFileOutputPreparedActionPublicV1(preparation.publicAction);
      const record = outputs.get(keyFor(request));
      const identity = preparation.identity;
      const binding = preparation.binding;
      if (!record || record.busy || hash(record.action) !== hash(action) || binding.artifactId !== record.artifactId
        || binding.sourceRevision !== record.sourceRevision || binding.parentRevision !== record.parentRevision
        || binding.inputHash !== record.inputHash || hash(binding.source) !== hash(request.source)
        || hash(binding.action) !== hash(action) || record.inputHash !== hashAgentToolInputForPreparation(request.input)
        || identity.toolRunId !== request.authority.toolRunId || identity.runId !== request.authority.runId
        || identity.sessionId !== request.authority.sessionId || identity.libraryId !== action.libraryId
        || identity.ownerWebContentsId !== request.authority.sender.id || hash(identity.ownerScope) !== hash(request.authority.ownerScope)
        || identity.aiDestinationIdentity !== request.aiDestinationId || identity.toolRegistrationId !== request.source.registrationId
        || identity.toolName !== request.source.toolId || identity.toolInputHash !== record.inputHash) throw new Error('插件产物批准身份无效或已过期');
      record.busy = true;
      let started = false;
      try {
        const target = await destination(request, input, action.sizeBytes, action.mediaType, true, action.providerId);
        if (target.revision !== record.parentRevision) throw new Error('批准后的目标目录已变化');
        const verifySource = async () => {
          validateRequest(request); await request.assertCurrent(request.authority.signal);
          const resource = await (options.openResource ?? openAgentPluginResource)(request.authority, request.assertCurrent);
          if (resource.revision !== record.sourceRevision) throw new Error('批准后的源文件已变化');
        };
        await verifySource();
        const validateNode = (raw: unknown) => {
          const node = raw as Record<string, unknown> | null;
          const name = node?.ext ? `${node.name}.${node.ext}` : node?.name;
          if (!node || !Number.isSafeInteger(node.id) || Number(node.id) <= 0 || node.id === action.sourceNodeId || node.type !== 'file'
            || node.libraryId !== action.libraryId || node.parentId !== action.parentId || name !== action.fileName
            || node.fileSize !== action.sizeBytes || node.storageProvider !== action.providerId
            || String(node.mimeType || '').split(';')[0].trim().toLowerCase() !== action.mediaType) {
            throw new AgentMediaUploadControlPlaneError('invalid_response');
          }
          return raw;
        };
        const boundControl: AgentMediaUploadControlPlane = { ...control,
          complete: async (...args) => validateNode(await control.complete(...args)),
          reconcile: async (...args) => {
            const status = await control.reconcile(...args);
            return status.state === 'committed' ? { state: 'committed', node: validateNode(status.node) } : { state: 'unknown' };
          } };
        const user = /^user:([1-9]\d*)$/.exec(request.authority.ownerScope.accountScope);
        if (!user) throw new Error('当前上传账号身份无效');
        const manager = (options.uploadFactory ?? createAgentMediaArtifactUploadManager)({ artifactStore: store, controlPlane: boundControl });
        const outcome = await manager.upload({ artifactId: record.artifactId, owner: record.owner, target: record.target,
          credentials: target.credentials!, expectedUserId: Number(user[1]), operationId: action.operationId,
          signal: request.authority.signal, beforeCommit: async () => {
            await verifySource();
            const latest = await destination(request, input, action.sizeBytes, action.mediaType, false, action.providerId);
            if (latest.revision !== record.parentRevision) throw new Error('提交前目标目录已变化');
          }, onSettlementStarted: () => { commit.begin(resultFor(record, 'commit_unknown')); started = true; },
          onProgress: (current, total) => request.onProgress?.({ message: '上传插件处理结果', percent: total > 0 ? Math.floor(current * 100 / total) : 0 }) });
        const result = resultFor(record, outcome.commitState, outcome.commitState === 'committed' ? outcome.node : undefined);
        if (started) commit.settle(result);
        return result;
      } catch {
        if (!started) {
          request.authority.signal.throwIfAborted();
          throw new Error('插件文件提交前验证或上传失败，未提交文件');
        }
        const unknown = resultFor(record, 'commit_unknown');
        commit.settle(unknown);
        return unknown;
      } finally { record.busy = false; await release(record).catch(() => undefined); }
    },
    revoke(pluginId?: string) {
      for (const output of outputs.values()) if (!pluginId || output.pluginId === pluginId) void release(output).catch(() => undefined);
    },
    async releaseRun(runId: string, toolRunId?: string) {
      await Promise.all([...outputs.values()].filter(output => output.owner.runId === runId
        && (!toolRunId || output.owner.executionId === toolRunId)).map(release));
    },
  };
}
