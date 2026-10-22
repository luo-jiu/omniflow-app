import type { AgentTool } from '../agent-tool-registry';

const METADATA_RECONCILIATION_TOOLS = new Set([
  'directory.create', 'file.copy', 'file.move', 'file.rename', 'file.delete', 'recycle.restore',
]);

export const operationVerifyTool: AgentTool = {
  name: 'operation.verify', risk: 'read', timeoutMs: 30000,
  description: '按operationId核对一次内外文件操作的持久化回执，无修改回执明确返回未提交。仅资料库节点元数据操作可额外传nodeId与expectedExists核对存在/父目录/名称；这些元数据不能确认file.write/patch正文提交。正文未知须file.read核对当前版本，不能证明某次操作提交或自动重放写入。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['operationId'], properties: {
    operationId: { type: 'string', minLength: 1, maxLength: 200 }, nodeId: { type: 'integer', minimum: 1 },
    expectedExists: { type: 'boolean' }, expectedParentId: { type: 'integer', minimum: 0 }, expectedName: { type: 'string', maxLength: 512 },
  }, dependencies: { nodeId: ['expectedExists'], expectedExists: ['nodeId'],
    expectedParentId: ['nodeId', 'expectedExists'], expectedName: ['nodeId', 'expectedExists'] } },
  async execute(input, context) {
    const query = input as { operationId: string; nodeId?: number; expectedExists?: boolean; expectedParentId?: number; expectedName?: string };
    let journalStatus = 'unknown';
    try {
      const journal = await context.readOperationJournal?.(query.operationId, context.signal);
      journalStatus = journal?.status || 'unknown';
      const receiptData = journal?.result?.data && typeof journal.result.data === 'object' && !Array.isArray(journal.result.data)
        ? journal.result.data as Record<string, unknown> : undefined;
      if (journal?.status === 'uncommitted') {
        const unchanged = receiptData?.outcome === 'unchanged' && receiptData.changed === false;
        return { ok: true, message: unchanged ? '内容未变化，未发生写入' : `账本显示操作 ${query.operationId} 未提交`, data: {
          operationId: query.operationId, status: 'not_committed', journalStatus: journal.status, node: null,
          ...(unchanged ? { outcome: 'unchanged', changed: false } : {}),
        } };
      }
      if (journal?.status === 'committed') return { ok: true, message: `账本确认操作 ${query.operationId} 已提交`,
        data: { operationId: query.operationId, status: 'committed', journalStatus: journal.status, node: null } };
      const fileContentMutation = !!journal && ['file.write', 'file.patch'].includes(journal.toolName);
      if (journal?.receiptIssue || fileContentMutation) {
        return { ok: true, message: journal.receiptIssue ? '操作回执无效或互相冲突，提交结果仍待核对；勿自动重试'
          : '文件正文的提交结果仍未知；请 file.read 核对当前版本，节点元数据不能证明本次写入已提交，勿自动重试',
        data: { operationId: query.operationId, status: 'commit_unknown', journalStatus: journal.status, node: null,
          ...(journal.receiptIssue ? { receiptIssue: journal.receiptIssue } : {}),
          nextAction: fileContentMutation ? 'verify_content' : 'verify_receipt', retryAllowed: false } };
      }
      if (!journal || !METADATA_RECONCILIATION_TOOLS.has(journal.toolName)
        || query.nodeId === undefined || query.expectedExists === undefined) return {
        ok: true, message: '没有明确提交回执，提交结果仍待核对；勿自动重试', data: {
          operationId: query.operationId, status: 'commit_unknown', journalStatus: journal?.status || 'unknown',
          node: null, nextAction: 'verify_receipt', retryAllowed: false,
        },
      };
      if (!context.readLibraryMetadata) return { ok: false, message: '当前运行时未接入资料库核对', data: {
        operationId: query.operationId, status: 'commit_unknown', journalStatus, node: null,
        nextAction: 'verify_receipt', retryAllowed: false,
      } };
      const result = await context.readLibraryMetadata({ kind: 'stat', nodeId: query.nodeId }, context.signal);
      const node = result.node;
      const matches = query.expectedExists && Boolean(node)
        && (query.expectedParentId === undefined || node!.parentId === query.expectedParentId)
        && (query.expectedName === undefined || `${node!.name}${node!.ext ? `.${node!.ext}` : ''}` === query.expectedName);
      const committed = query.expectedExists ? matches : !node;
      return { ok: true, message: `已核对操作 ${query.operationId}`, data: { operationId: query.operationId, status: committed ? 'committed' : 'not_committed', journalStatus: journal?.status || 'unknown', node: node || null } };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '操作结果仍无法确认', data: {
        operationId: query.operationId, status: 'commit_unknown', journalStatus, node: null,
        nextAction: 'verify_receipt', retryAllowed: false,
      } };
    }
  },
};
