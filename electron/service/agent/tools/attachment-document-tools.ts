import type { AgentTool } from '../agent-tool-registry';
const properties = { id: { type: 'string', pattern: '^[a-f0-9-]{36}$' }, page: { type: 'integer', minimum: 1 } };
export const attachmentInspectTool: AgentTool = {
  name: 'attachment.inspect', risk: 'read', description: '检查附件格式、大小、PDF/PPTX 页数、XLSX 工作表和实际支持的操作。检查成功不表示正文已读取。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: properties.id } },
  async execute(input, context) {
    if (!context.operateAttachment) throw new Error('当前会话没有附件处理能力');
    return { ok: true, message: '已检查附件', data: await context.operateAttachment('inspect', input as { id: string }) };
  },
};
export const attachmentViewTool: AgentTool = {
  name: 'attachment.view', risk: 'read', timeoutMs: 120000, description: '查看图片或 PDF/PPTX 指定页的真实图像。page 从1开始，默认第1页；PPTX 需要 inspect 确认可用的 LibreOffice 渲染器，用于扫描页、图表和版式。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties },
  async execute(input, context) {
    if (!context.operateAttachment) throw new Error('当前会话没有附件处理能力');
    return { ok: true, message: '已查看附件页面', data: await context.operateAttachment('view', input as { id: string }) };
  },
};

export const attachmentQueryTool: AgentTool = {
  name: 'attachment.query', risk: 'read', description: '查询 XLSX：指定 sheet/range 后按 filters 同时筛选，可 aggregate 数字列。column 用 A/B/C 列字母，count 仅统计数值。公式只使用缓存值，不重新计算；缺失缓存会标记统计不完整。未指定 aggregate 时返回可分页的匹配行。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['id', 'range'], properties: {
    id: properties.id, sheet: { type: 'string', minLength: 1, maxLength: 128 }, range: { type: 'string', minLength: 2, maxLength: 40 },
    offset: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 }, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    filters: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['column', 'operator', 'value'], properties: {
      column: { type: 'string', pattern: '^[A-Za-z]{1,3}$' }, operator: { type: 'string', enum: ['eq', 'contains', 'gt', 'gte', 'lt', 'lte'] }, value: { anyOf: [{ type: 'string', maxLength: 256 }, { type: 'number' }, { type: 'boolean' }] },
    } } },
    aggregate: { type: 'object', additionalProperties: false, required: ['column', 'operation'], properties: {
      column: { type: 'string', pattern: '^[A-Za-z]{1,3}$' }, operation: { type: 'string', enum: ['sum', 'average', 'min', 'max', 'count'] },
    } },
  } },
  async execute(input, context) {
    if (!context.operateAttachment) throw new Error('当前会话没有附件处理能力');
    return { ok: true, message: '已查询工作表', data: await context.operateAttachment('query', input as { id: string }) };
  },
};
