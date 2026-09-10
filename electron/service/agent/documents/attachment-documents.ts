import crypto from 'node:crypto';
import type { AgentAttachmentScope } from '../../../../src/shared/agent/agent-attachments';
import type { AgentAttachmentStore } from '../agent-attachment-store';
import { packAgentTextResult } from '../agent-text-result';
import { runAgentDocument } from './document-runner';
import type { AgentDocumentJob, AgentDocumentResult, AgentSheetFilter, AgentSheetAggregate } from './document.types';
import { findOfficeRenderer } from './office-renderer';

export interface AgentAttachmentQuery { id: string; page?: number; offset?: number; column?: number; limit?: number; revision?: string;
  sheet?: string; range?: string; filters?: AgentSheetFilter[]; aggregate?: AgentSheetAggregate }
type Processor = (job: AgentDocumentJob, signal: AbortSignal) => Promise<AgentDocumentResult>;
type CachedPage = { imageId: string; fileName: string; sourceAttachmentId: string; page?: number; pageCount?: number; warnings?: string[] };
const renderedPages = new WeakMap<AgentAttachmentStore, Map<string, CachedPage>>();

export async function operateAgentAttachment(store: AgentAttachmentStore, scope: AgentAttachmentScope, sessionId: string,
  operation: 'inspect' | 'read' | 'view' | 'query', query: AgentAttachmentQuery, signal: AbortSignal, outputTokens: number,
  process: Processor = runAgentDocument) {
  signal.throwIfAborted();
  const { attachment, bytes } = await store.source(scope, query.id, sessionId);
  signal.throwIfAborted();
  if (query.page !== undefined && attachment.format !== 'pdf' && attachment.format !== 'pptx') throw new Error('只有 PDF/PPTX 支持 page；其他正文请使用 offset/limit');
  if ((query.sheet !== undefined || query.range !== undefined || query.filters !== undefined || query.aggregate !== undefined || operation === 'query') && attachment.format !== 'xlsx') throw new Error('工作表、范围与查询参数仅用于 XLSX');
  if (operation === 'inspect') {
    const facts = attachment.format ? await process({ format: attachment.format, operation: 'inspect', bytes }, signal) : {};
    const canRenderPresentation = attachment.format === 'pptx' && facts.renderAllowed === true && Boolean(await findOfficeRenderer());
    return { id: attachment.id, fileName: attachment.name, kind: attachment.kind, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes,
      operations: attachment.kind === 'text' ? ['read'] : attachment.kind === 'image' ? ['view']
        : attachment.format === 'pdf' || canRenderPresentation ? ['read', 'view'] : attachment.format === 'xlsx' ? ['read', 'query']
          : attachment.format === 'docx' || attachment.format === 'pptx' ? ['read'] : [],
      ...facts,
      ...(attachment.format === 'pptx' ? { renderAvailable: canRenderPresentation,
        warnings: [...(facts.warnings || []), ...(!canRenderPresentation ? ['当前不提供页面渲染；可继续读取文字和备注。'] : [])] } : {}),
      ...(attachment.kind === 'file' ? { warning: '文件已保存，但当前没有这种格式的读取工具；不能声称已读取正文。' } : {}),
    };
  }
  if (operation === 'read' || operation === 'query') {
    if (attachment.kind === 'text') return store.read(scope, sessionId, query, outputTokens);
    if (!attachment.format) throw new Error('该附件不能按行读取，请先 attachment.inspect 检查支持的操作');
    const result = await process({ format: attachment.format, operation, bytes, page: query.page,
      sheet: query.sheet, range: query.range, filters: query.filters, aggregate: query.aggregate }, signal);
    signal.throwIfAborted();
    const hash = crypto.createHash('sha256').update(bytes).update(`:${attachment.format}:${result.page || 0}`);
    if (attachment.format === 'xlsx') hash.update(JSON.stringify({ sheet: result.sheet, range: result.range, filters: query.filters || [], aggregate: query.aggregate || null }));
    const revision = hash.digest('hex');
    if (query.revision && query.revision !== revision) throw new Error('文件内容或查询范围已变化，请从头重新读取');
    const table = attachment.format === 'xlsx' ? { sheet: result.sheet, range: result.range, matchedRows: result.matchedRows, unknownFilterRows: result.unknownFilterRows,
      query: { sheet: result.sheet, range: result.range, filters: query.filters || [] } } : {};
    if (result.statistics) return { scope: 'attachment', attachmentId: attachment.id, fileName: attachment.name, revision,
      ...table, statistics: result.statistics, warnings: result.warnings };
    const lines = (result.text || '').split(/\r\n|\n|\r/u);
    if (lines.at(-1) === '') lines.pop();
    return packAgentTextResult({ lines, revision }, { ...query, path: attachment.name }, Math.min(10000, outputTokens), {
      scope: 'attachment', attachmentId: attachment.id,
      ...table,
      ...(result.pageCount ? { page: result.page, pageCount: result.pageCount,
        hasMorePages: Number(result.page) < result.pageCount,
        ...(Number(result.page) < result.pageCount ? { nextPage: Number(result.page) + 1 } : {}),
      } : {}), ...(result.warnings ? { warnings: result.warnings } : {}),
    }).data;
  }
  if (attachment.kind === 'image') return { imageId: attachment.id, fileName: attachment.name };
  if (attachment.format !== 'pdf' && attachment.format !== 'pptx') throw new Error('当前只能查看图片或渲染 PDF/PPTX 页面');
  const pages = renderedPages.get(store) || new Map<string, CachedPage>();
  renderedPages.set(store, pages);
  const cacheKey = `${sessionId}:${attachment.id}:${query.page ?? 1}`;
  const cached = pages.get(cacheKey);
  if (cached) {
    try {
      await store.resolve(scope, [cached.imageId], sessionId);
      signal.throwIfAborted();
      return { ...cached };
    } catch (error) {
      if (signal.aborted) throw error;
      pages.delete(cacheKey);
    }
  }
  const result = await process({ format: attachment.format, operation: 'render', bytes, page: query.page }, signal);
  signal.throwIfAborted();
  if (!result.png) throw new Error('文档工具没有生成页面图片');
  const image = await store.import({ ...scope, name: `${attachment.name}-page-${result.page}.png`, base64: Buffer.from(result.png).toString('base64') });
  try {
    signal.throwIfAborted();
    await store.bind(scope, [image.id], sessionId);
  } catch (error) { await store.discard(scope, image.id).catch(() => undefined); throw error; }
  const page = { imageId: image.id, fileName: attachment.name, sourceAttachmentId: attachment.id, page: result.page, pageCount: result.pageCount,
    ...(result.warnings?.length ? { warnings: result.warnings } : {}) };
  if (pages.size >= 128) pages.delete(pages.keys().next().value!);
  pages.set(cacheKey, page);
  return { ...page };
}
