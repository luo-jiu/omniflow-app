import type { AgentTool } from '../agent-tool-registry';
const properties = { id: { type: 'string', pattern: '^[a-f0-9-]{36}$' }, page: { type: 'integer', minimum: 1 } };
export const attachmentInspectTool: AgentTool = {
  name: 'attachment.inspect', risk: 'read', description: '检查附件格式、大小、PDF 页数和实际支持的读取/查看操作。检查成功不表示正文已读取。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: properties.id } },
  async execute(input, context) {
    if (!context.operateAttachment) throw new Error('当前会话没有附件处理能力');
    return { ok: true, message: '已检查附件', data: await context.operateAttachment('inspect', input as { id: string }) };
  },
};
export const attachmentViewTool: AgentTool = {
  name: 'attachment.view', risk: 'read', description: '查看附件图片或指定 PDF 页面的真实图像。PDF page 从1开始，默认第1页；用于扫描页、图表、版式。工具会返回视觉输入，不把 PDF 二进制当正文。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties },
  async execute(input, context) {
    if (!context.operateAttachment) throw new Error('当前会话没有附件处理能力');
    return { ok: true, message: '已查看附件页面', data: await context.operateAttachment('view', input as { id: string }) };
  },
};
