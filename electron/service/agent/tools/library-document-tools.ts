import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';
import { processAgentDocument } from '../documents/document-engine';
import type { AgentDocumentFormat } from '../documents/document.types';
import { packAgentTextResult } from '../agent-text-result';
import crypto from 'node:crypto';

type Input = { nodeId?: number; path?: string; format?: AgentDocumentFormat; page?: number; sheet?: string; range?: string; offset?: number; limit?: number; revision?: string; filters?: any[]; aggregate?: any };
function input(value: unknown): Input { return value as Input; }
async function formatOf(value: Input, context: AgentToolExecutionContext): Promise<AgentDocumentFormat> {
  let f = value.format;
  if (!f && context.readLibraryMetadata) {
    const node = (await context.readLibraryMetadata({ kind: 'stat', nodeId: value.nodeId }, context.signal)).node;
    f = String(node?.ext || node?.mimeType || '').replace(/^\./u, '').split('/').at(-1) as AgentDocumentFormat;
  }
  if (!f || !['pdf', 'docx', 'xlsx', 'pptx'].includes(f.toLowerCase())) throw new Error('无法从资料库节点推导支持的文档格式，请明确提供 format');
  return f.toLowerCase() as AgentDocumentFormat;
}
async function run(value: unknown, context: AgentToolExecutionContext, operation: 'inspect'|'read'|'render'|'query') {
  const query = input(value);
  let nodeId = query.nodeId;
  if (nodeId === undefined && query.path && context.readLibraryMetadata) {
    nodeId = (await context.readLibraryMetadata({ kind: 'resolve', path: query.path, nodeType: 'file' }, context.signal)).node?.id;
  }
  if (!Number.isSafeInteger(nodeId) || Number(nodeId) < 1) throw new Error('需要有效 nodeId 或资料库绝对路径');
  const resolvedNodeId = Number(nodeId);
  query.nodeId = resolvedNodeId;
  const format = await formatOf(query, context); if (!context.readLibraryDocument) throw new Error('当前运行时未接入资料库文档读取');
  const bytes = await context.readLibraryDocument(resolvedNodeId, context.signal);
  const result = await processAgentDocument({ format, operation, bytes, page: query.page, sheet: query.sheet, range: query.range, filters: query.filters, aggregate: query.aggregate });
  if (operation === 'inspect') return { ok: true, nodeId: query.nodeId, format, ...result };
  if (operation === 'render') {
    if (!context.readLibraryDocumentImage) throw new Error('当前运行时未接入资料库页面图片协议');
    return { ok: true, data: await context.readLibraryDocumentImage({ nodeId: query.nodeId, format, page: query.page }, context.signal) };
  }
  if (result.statistics) return { ok: true, nodeId: query.nodeId, format, ...result };
  const lines = (result.text || '').split(/\r\n|\n|\r/u); if (lines.at(-1) === '') lines.pop();
  if (format !== 'xlsx' && (query.offset !== undefined || query.limit !== undefined)) throw new Error('该文档类型不支持普通行号续读，请使用 PDF/PPTX page');
  const revision = crypto.createHash('sha256').update(bytes).digest('hex');
  if (query.revision && query.revision !== revision) throw new Error('文件内容或节点版本已变化，请从头读取');
  return { ok: true, data: packAgentTextResult({ lines, revision }, { path: String(query.nodeId), offset: format === 'xlsx' ? query.offset : undefined, limit: format === 'xlsx' ? query.limit : undefined }, Math.min(10000, context.readOutputTokenBudget || 10000), { nodeId: query.nodeId, format, page: result.page, pageCount: result.pageCount, warnings: result.warnings }).data };
}
const base = { type: 'object', additionalProperties: false, anyOf: [{ properties: { nodeId: {} }, required: ['nodeId'] }, { properties: { path: {} }, required: ['path'] }], properties: { nodeId: { type: 'integer', minimum: 1 }, path: { type: 'string', minLength: 2, maxLength: 2048 }, format: { type: 'string', enum: ['pdf','docx','xlsx','pptx'] }, page: { type: 'integer', minimum: 1 }, sheet: { type: 'string', minLength: 1 }, range: { type: 'string' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100000 }, revision: { type: 'string' }, filters: { type: 'array', maxItems: 8 }, aggregate: { type: 'object' } } } as const;
export const libraryDocumentTools: AgentTool[] = [
  { name: 'library.document.inspect', risk: 'read', description: '检查资料库内 PDF、DOCX、XLSX、PPTX 的格式和可用操作。先使用 file.stat/file.resolve 确认 nodeId。', inputSchema: base, execute: (v, c) => run(v, c, 'inspect') },
  { name: 'library.document.read', risk: 'read', timeoutMs: 60000, description: '读取资料库内 PDF、DOCX、XLSX、PPTX，复用统一文档引擎；PDF/PPTX 可按 page，XLSX 可按 sheet/range/query。不会向模型暴露下载地址。', inputSchema: base, execute: (v, c) => run(v, c, 'read') },
  { name: 'library.document.query', risk: 'read', timeoutMs: 60000, description: '查询资料库内 XLSX，可按 sheet/range/filter/aggregate。', inputSchema: base, execute: (v, c) => run(v, c, 'query') },
  { name: 'library.document.view', risk: 'read', timeoutMs: 120000, description: '渲染资料库 PDF/PPTX 指定页，返回现有图片协议所需的图片数据，不返回物理路径。', inputSchema: base, execute: (v, c) => run(v, c, 'render') },
];
