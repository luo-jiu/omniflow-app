import type { AgentDirectoryEntry } from './agent.types';
import { normalizeAgentLibraryDirectoryPath } from './agent-library-path';

export interface AgentLibraryQuery {
  kind: 'list' | 'search' | 'resolve' | 'stat';
  nodeId?: number;
  directoryId?: number;
  path?: string;
  keyword?: string;
  nodeType?: 'dir' | 'file';
  tagIds?: number[];
  tagMatchMode?: 'ANY' | 'ALL';
  limit?: number;
  cursor?: string;
}

export interface AgentLibraryNode extends AgentDirectoryEntry {
  libraryId: number;
  parentId: number;
  path?: string;
}

export interface AgentLibraryReadResult {
  libraryId: number;
  node?: AgentLibraryNode;
  directory?: AgentLibraryNode;
  entries?: AgentLibraryNode[];
  hasMore?: boolean;
  nextCursor?: string;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('资料库查询结果无效');
  return input as Record<string, unknown>;
}

export function normalizeAgentLibraryNode(input: unknown, libraryId: number): AgentLibraryNode {
  const item = record(input);
  if (item.libraryId !== libraryId || !Number.isSafeInteger(item.id) || Number(item.id) <= 0
    || !Number.isSafeInteger(item.parentId) || Number(item.parentId) < 0
    || typeof item.name !== 'string' || !item.name || item.name.length > 512
    || (item.type !== 'dir' && item.type !== 'file')) throw new Error('资料库节点身份或范围无效');
  const storage = item.storage ? record(item.storage) : undefined;
  const alias = storage?.providerAlias ?? item.storageProvider;
  const label = storage?.providerLabel ?? item.storageProviderLabel;
  const text = (value: unknown, maximum: number) => typeof value === 'string' && value.length <= maximum ? value : undefined;
  let path: string | undefined;
  if (typeof item.path === 'string' && item.path) {
    try { path = normalizeAgentLibraryDirectoryPath(item.path); } catch { /* Long or corrupt paths remain addressable by ID. */ }
  }
  return {
    id: Number(item.id), libraryId, parentId: Number(item.parentId), name: item.name, type: item.type,
    ...(path ? { path } : {}),
    ...(text(item.ext, 80) ? { ext: String(item.ext) } : {}),
    ...(text(item.mimeType, 256) ? { mimeType: String(item.mimeType) } : {}),
    ...(text(item.updatedAt, 100) ? { updatedAt: String(item.updatedAt) } : {}),
    ...(typeof item.fileSize === 'number' && Number.isSafeInteger(item.fileSize) && item.fileSize >= 0 ? { fileSize: item.fileSize } : {}),
    ...(text(alias, 160) ? { storage: {
      providerAlias: String(alias), ...(text(label, 160) ? { providerLabel: String(label) } : {}),
      availability: storage?.availability === 'available' || storage?.availability === 'unavailable' ? storage.availability : 'unknown',
      ...(text(storage?.observedAt, 100) ? { observedAt: String(storage?.observedAt) } : {}),
    } } : {}),
  };
}

export function normalizeAgentLibraryReadResult(input: unknown, libraryId: number): AgentLibraryReadResult {
  const data = record(input);
  if (data.libraryId !== libraryId || (data.entries !== undefined && (!Array.isArray(data.entries) || data.entries.length > 50))) {
    throw new Error('资料库查询结果范围无效');
  }
  if (data.hasMore !== undefined && typeof data.hasMore !== 'boolean') throw new Error('资料库分页状态无效');
  if (data.hasMore && (typeof data.nextCursor !== 'string' || !data.nextCursor || data.nextCursor.length > 256)) throw new Error('资料库续页游标缺失');
  const result: AgentLibraryReadResult = {
    libraryId,
    ...(data.node ? { node: normalizeAgentLibraryNode(data.node, libraryId) } : {}),
    ...(data.directory ? { directory: normalizeAgentLibraryNode(data.directory, libraryId) } : {}),
    ...(Array.isArray(data.entries) ? { entries: data.entries.map(node => normalizeAgentLibraryNode(node, libraryId)) } : {}),
    ...(typeof data.hasMore === 'boolean' ? { hasMore: data.hasMore } : {}),
    ...(data.hasMore ? { nextCursor: String(data.nextCursor) } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 8_000) {
    throw new Error('当前页元数据过大，请减小 limit 并使用原 cursor 重试；本页未交付，不能跳到下一页');
  }
  return result;
}
