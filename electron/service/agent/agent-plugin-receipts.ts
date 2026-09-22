import type { WebContents } from 'electron';
import type { AgentPluginOperationReconcileRequest, AgentToolActivitySnapshot, AgentToolResult } from '../../../src/shared/agent/agent.types';
import { normalizeAgentPreparedActionPublic } from '../../../src/shared/agent/agent-prepared-action';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import type { AgentSessionStore } from './agent-session-store';
import { createPluginRenameTransport } from './plugin-rename-transport';
import { createAgentMediaUploadControlPlane } from './agent-media-upload-control-plane';

const API_BASE = typeof __OMNIFLOW_API_BASE_URL__ === 'string' ? __OMNIFLOW_API_BASE_URL__ : 'http://127.0.0.1:8850/api';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const inFlight = new Set<string>();

export function createAgentPluginReceiptService(options: {
  apiBaseUrl: string;
  rename?: Pick<ReturnType<typeof createPluginRenameTransport>, 'verifyActor' | 'statusForAction'>;
  upload?: Pick<ReturnType<typeof createAgentMediaUploadControlPlane>, 'verifyAccount' | 'reconcile'>;
  now?: () => string;
}) {
  const rename = options.rename ?? createPluginRenameTransport({ apiBaseUrl: options.apiBaseUrl });
  const upload = options.upload ?? createAgentMediaUploadControlPlane({ apiBaseUrl: options.apiBaseUrl });
  return async (store: AgentSessionStore, sender: Pick<WebContents, 'id' | 'isDestroyed'>, input: AgentPluginOperationReconcileRequest): Promise<AgentToolActivitySnapshot> => {
    const value = record(input);
    if (Object.keys(value).length !== 6 || Object.keys(value).some(key => !['ownerScope', 'libraryId', 'sessionId', 'toolRunId', 'expectedRevision', 'credentials'].includes(key))
      || !positive(value.libraryId) || !positive(value.expectedRevision)
      || typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 200
      || typeof value.toolRunId !== 'string' || !value.toolRunId || value.toolRunId.length > 200) throw new Error('回执查询请求无效');
    const owner = normalizeAgentOwnerScope(input.ownerScope);
    const fixedOwner = normalizeAgentOwnerScope({ ...owner, backendScope: options.apiBaseUrl });
    if (owner.backendScope !== fixedOwner.backendScope || !/^user:[1-9]\d*$/u.test(owner.accountScope)) throw new Error('回执查询账号或后端环境不匹配');
    const credentials = record(input.credentials);
    if (Object.keys(credentials).length !== 2 || typeof credentials.token !== 'string' || !credentials.token || credentials.token.length > 32768
      || typeof credentials.username !== 'string' || !credentials.username || credentials.username.length > 256
      || /[\p{Cc}]/u.test(credentials.token + credentials.username)) throw new Error('回执查询登录凭据无效');
    const authentication = { token: credentials.token, username: credentials.username };
    const request = { ownerScope: owner, libraryId: input.libraryId, sessionId: input.sessionId, toolRunId: input.toolRunId, expectedRevision: input.expectedRevision };
    const key = JSON.stringify([owner, request.libraryId, request.sessionId, request.toolRunId]);
    if (inFlight.has(key) || inFlight.size >= 8) throw new Error('该回执正在查询，请稍候');
    inFlight.add(key);
    try {
      if (sender.isDestroyed()) throw new Error('回执查询窗口已关闭');
      const session = await store.getSession(request.sessionId, owner, request.libraryId, true);
      const activity = session?.toolActivities.find(item => item.id === request.toolRunId);
      if (!activity || activity.revision !== request.expectedRevision) throw new Error('回执查询记录已变化，请刷新后重试');
      const source = activity.pluginSource;
      const action = normalizeAgentPreparedActionPublic(activity.preparation?.action);
      if (!source || (action.kind !== 'plugin.rename' && action.kind !== 'plugin.file-output') || action.libraryId !== request.libraryId
        || source.toolId !== activity.call.name || source.pluginId !== action.pluginId || source.pluginVersion !== action.pluginVersion
        || source.packageFingerprint !== action.packageFingerprint || activity.approval?.status !== 'approved'
        || !['completed', 'failed', 'cancelled', 'interrupted'].includes(activity.status)) throw new Error('该记录不支持查询插件操作回执');
      const previous = record(activity.result?.data);
      const previousState = action.kind === 'plugin.rename' ? previous.mutationCommitState : previous.uploadCommitState;
      const signal = AbortSignal.timeout(30_000);
      if (action.kind === 'plugin.rename') await rename.verifyActor(authentication, owner, signal);
      else await upload.verifyAccount(authentication, Number(owner.accountScope.slice(5)), signal);
      if (previousState === 'committed' && activity.result?.ok === true) return activity;
      if (previousState === 'uncommitted') throw new Error('该操作已有明确未提交回执');
      let result: AgentToolResult;
      if (action.kind === 'plugin.rename') {
        const receipt = await rename.statusForAction(action, authentication, signal);
        result = receipt ? { ok: true, message: `已查询回执：原子改名 ${receipt.items.length} 个文件已提交`, data: {
          mutationCommitState: 'committed', operationId: action.operationId, libraryId: action.libraryId, atomic: true,
          affectedParentIds: receipt.affectedParentIds, items: receipt.items.map(item => ({ nodeId: item.nodeId, parentId: item.parentId,
            name: item.current.name, ext: item.current.ext, updatedAt: item.current.updatedAt, status: 'committed' })),
        } } : { ok: false, message: '尚未查到改名回执，提交结果仍未知；请勿重复提交新操作', data: {
          mutationCommitState: 'commit_unknown', operationId: action.operationId, libraryId: action.libraryId, atomic: true,
        } };
      } else {
        const receipt = await upload.reconcile(authentication, action.operationId, signal);
        // Older servers called an in-flight pending upload "uncommitted"; absence is never proof of rejection.
        const state = receipt.state === 'committed' ? 'committed' : 'commit_unknown';
        const data = { mutationCommitState: state, uploadCommitState: state, operationId: action.operationId, libraryId: action.libraryId };
        if (state === 'committed') {
          const node = record(receipt.node);
          const extension = action.mediaType === 'text/csv' ? 'csv' : 'json';
          if (!positive(node.id) || node.id === action.sourceNodeId || node.libraryId !== action.libraryId || node.parentId !== action.parentId || node.type !== 'file'
            || node.ext !== extension || typeof node.name !== 'string' || `${node.name}.${node.ext}` !== action.fileName
            || node.storageProvider !== action.providerId || node.fileSize !== action.sizeBytes
            || typeof node.mimeType !== 'string' || node.mimeType.split(';')[0].trim().toLowerCase() !== action.mediaType) throw new Error('上传回执文件与已批准目标不匹配，未改变结算状态');
          result = { ok: true, message: `已查询回执：${action.fileName} 已保存`, data: { ...data,
            destination: { kind: 'library', nodeId: node.id, parentId: action.parentId }, createdNodeId: node.id,
            fileName: action.fileName, name: action.fileName, mediaType: action.mediaType, sizeBytes: action.sizeBytes,
            sha256: action.sha256, affectedParentIds: [action.parentId] } };
        } else result = { ok: false, message: '上传回执仍未知或已过期，请勿重复提交新操作', data };
      }
      signal.throwIfAborted();
      if (sender.isDestroyed()) throw new Error('回执查询窗口已关闭');
      return store.reconcilePluginToolRun({ ...request, operationId: action.operationId, result, checkedAt: options.now?.() ?? new Date().toISOString() });
    } finally { inFlight.delete(key); }
  };
}

export async function reconcileAgentPluginOperation(store: AgentSessionStore, sender: WebContents, input: AgentPluginOperationReconcileRequest): Promise<AgentToolActivitySnapshot> {
  return createAgentPluginReceiptService({ apiBaseUrl: API_BASE })(store, sender, input);
}
