import type { AgentSessionSummary } from './agent.types';

export type AgentSessionPermissionMode = 'ask' | 'group' | 'full-access';
export interface AgentGroupDirectory { nodeId: number; name: string }
export interface AgentSessionGroup {
  id: string;
  libraryId: number;
  name: string;
  directories: AgentGroupDirectory[];
  access: 'read' | 'read-write';
  revision: number;
  policyRevision: number;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface AgentSessionGroupInput {
  id?: string;
  revision?: number;
  name: string;
  directories: AgentGroupDirectory[];
  access: 'read' | 'read-write';
}
export interface AgentSessionListFilter { archived?: boolean; groupId?: string | null }
export interface AgentSessionDirectorySummary {
  groups: AgentSessionGroup[];
  ungroupedCount: number;
  total: number;
  archivedCount: number;
}
export interface AgentSessionOrganizationInput {
  revision: number;
  groupId: string | null;
  permissionMode: AgentSessionPermissionMode;
}
export interface AgentLibraryAccessSnapshot {
  version: 1;
  mode: AgentSessionPermissionMode;
  groupId: string | null;
  policyRevision: number;
  access: 'read' | 'read-write';
  directories: AgentGroupDirectory[];
}

export function normalizeAgentSessionGroupInput(value: AgentSessionGroupInput): AgentSessionGroupInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['id', 'revision', 'name', 'directories', 'access'].includes(key))) throw new Error('会话组参数无效，不支持嵌套');
  const name = typeof value.name === 'string' ? value.name.replace(/\s+/gu, ' ').trim() : '';
  if (!name || Array.from(name).length > 48) throw new Error('组名需要1至48个字符');
  if (!['read', 'read-write'].includes(value.access) || !Array.isArray(value.directories) || value.directories.length > 32) throw new Error('组目录授权无效');
  const ids = new Set<number>();
  const directories = value.directories.map(item => {
    if (!item || Object.keys(item).some(key => !['nodeId', 'name'].includes(key))
      || !Number.isSafeInteger(item.nodeId) || item.nodeId <= 0 || ids.has(item.nodeId)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 512) throw new Error('目录标识无效或重复');
    ids.add(item.nodeId);
    return { nodeId: item.nodeId, name: item.name.trim() };
  });
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id || value.id.length > 200
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1)) throw new Error('会话组版本无效');
  return { ...(value.id ? { id: value.id, revision: value.revision } : {}), name, access: value.access, directories };
}

export function normalizeAgentSessionPermissionMode(value: unknown): AgentSessionPermissionMode {
  if (value !== 'ask' && value !== 'group' && value !== 'full-access') throw new Error('会话权限模式无效');
  return value;
}

export function pickAgentSessionSummary(value: AgentSessionSummary): AgentSessionSummary {
  return { id: value.id, libraryId: value.libraryId, title: value.title, groupId: value.groupId,
    permissionMode: value.permissionMode, revision: value.revision, archivedAt: value.archivedAt,
    createdAt: value.createdAt, updatedAt: value.updatedAt, messageCount: value.messageCount,
    lastMessagePreview: value.lastMessagePreview, lastRunStatus: value.lastRunStatus };
}
