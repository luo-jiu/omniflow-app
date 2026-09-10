import crypto from 'node:crypto';
import type { AgentAttachmentScope } from '../../../../src/shared/agent/agent-attachments';
import type { AgentAttachmentStore } from '../agent-attachment-store';
import { packAgentTextResult } from '../agent-text-result';
import { runAgentDocument } from './document-runner';
import type { AgentDocumentJob, AgentDocumentResult } from './document.types';

export interface AgentAttachmentQuery { id: string; page?: number; offset?: number; column?: number; limit?: number; revision?: string }
type Processor = (job: AgentDocumentJob, signal: AbortSignal) => Promise<AgentDocumentResult>;
type CachedPage = { imageId: string; fileName: string; sourceAttachmentId: string; page?: number; pageCount?: number; warnings?: string[] };
const renderedPages = new WeakMap<AgentAttachmentStore, Map<string, CachedPage>>();

export async function operateAgentAttachment(store: AgentAttachmentStore, scope: AgentAttachmentScope, sessionId: string,
  operation: 'inspect' | 'read' | 'view', query: AgentAttachmentQuery, signal: AbortSignal, outputTokens: number,
  process: Processor = runAgentDocument) {
  signal.throwIfAborted();
  const { attachment, bytes } = await store.source(scope, query.id, sessionId);
  signal.throwIfAborted();
  if (query.page !== undefined && attachment.format !== 'pdf') throw new Error('只有 PDF 支持 page；文本和 DOCX 请使用 offset/limit');
  if (operation === 'inspect') {
    const facts = attachment.format ? await process({ format: attachment.format, operation: 'inspect', bytes }, signal) : {};
    return { id: attachment.id, fileName: attachment.name, kind: attachment.kind, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes,
      operations: attachment.kind === 'text' ? ['read'] : attachment.kind === 'image' ? ['view']
        : attachment.format === 'pdf' ? ['read', 'view'] : attachment.format === 'docx' ? ['read'] : [],
      ...facts, ...(attachment.kind === 'file' ? { warning: '文件已保存，但当前没有这种格式的读取工具；不能声称已读取正文。' } : {}),
    };
  }
  if (operation === 'read') {
    if (attachment.kind === 'text') return store.read(scope, sessionId, query, outputTokens);
    if (!attachment.format) throw new Error('该附件不能按行读取，请先 attachment.inspect 检查支持的操作');
    const result = await process({ format: attachment.format, operation: 'read', bytes, page: query.page }, signal);
    signal.throwIfAborted();
    const revision = crypto.createHash('sha256').update(bytes).update(`:${attachment.format}:${result.page || 0}`).digest('hex');
    const lines = (result.text || '').split(/\r\n|\n|\r/u);
    if (lines.at(-1) === '') lines.pop();
    return packAgentTextResult({ lines, revision }, { ...query, path: attachment.name }, Math.min(10000, outputTokens), {
      scope: 'attachment', attachmentId: attachment.id,
      ...(result.pageCount ? { page: result.page, pageCount: result.pageCount,
        hasMorePages: Number(result.page) < result.pageCount,
        ...(Number(result.page) < result.pageCount ? { nextPage: Number(result.page) + 1 } : {}),
      } : {}), ...(result.warnings ? { warnings: result.warnings } : {}),
    }).data;
  }
  if (attachment.kind === 'image') return { imageId: attachment.id, fileName: attachment.name };
  if (attachment.format !== 'pdf') throw new Error('当前只能查看图片或渲染 PDF 页面');
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
  const result = await process({ format: 'pdf', operation: 'render', bytes, page: query.page }, signal);
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
