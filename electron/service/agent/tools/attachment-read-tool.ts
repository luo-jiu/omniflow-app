import type { AgentTool } from '../agent-tool-registry';
export const attachmentReadTool: AgentTool = {
  name: 'attachment.read', risk: 'read',
  description: '按行读取附件文本或 DOCX 正文；PDF 用 page 指定一页。offset/column 从1开始，hasMore 时用 nextOffset/nextColumn/revision 续读本页，hasMorePages 时用 nextPage 读下一页。无正文的扫描页使用 attachment.view。',
  presentation: { groupKind: 'resource-read', operationKind: 'read' },
  inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    page: { type: 'integer', minimum: 1 },
    offset: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1 }, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  async execute(input, context) {
    if (!context.readAttachment) throw new Error('当前会话没有附件读取能力');
    return { ok: true, data: await context.readAttachment(input as { id: string }), message: '已读取附件' };
  },
};
