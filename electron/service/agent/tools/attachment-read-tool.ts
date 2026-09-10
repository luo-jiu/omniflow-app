import type { AgentTool } from '../agent-tool-registry';
export const attachmentReadTool: AgentTool = {
  name: 'attachment.read', risk: 'read',
  description: '读取附件正文。PDF/PPTX 用 page 指定一页；XLSX 用 sheet 名称和 range(A1:H100)选单元格，输出区分公式与缓存值。offset/column 从1开始，hasMore 时原条件带 nextOffset/nextColumn/revision 续读；hasMorePages 用 nextPage。扫描页或图表可用 attachment.view。',
  presentation: { groupKind: 'resource-read', operationKind: 'read' },
  inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    page: { type: 'integer', minimum: 1 },
    sheet: { type: 'string', minLength: 1, maxLength: 128 }, range: { type: 'string', minLength: 2, maxLength: 40 },
    offset: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1 }, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  async execute(input, context) {
    if (!context.readAttachment) throw new Error('当前会话没有附件读取能力');
    return { ok: true, data: await context.readAttachment(input as { id: string }), message: '已读取附件' };
  },
};
