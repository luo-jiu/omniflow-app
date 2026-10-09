import { normalizeAgentLibraryDirectoryPath } from './agent-library-path';

export const AGENT_BUILT_IN_TYPES = ['DEF', 'COMIC', 'ASMR', 'VIDEO', 'AUDIO', 'GALLERY'] as const;
export type AgentBuiltInType = typeof AGENT_BUILT_IN_TYPES[number];
export interface AgentNodeConfig { builtInType: AgentBuiltInType; archiveMode: 0 | 1 }
export interface AgentNodeConfigureInput extends Partial<AgentNodeConfig> { path?: string; nodeId?: number }

/** Unknown / missing server fields remain unknown; never infer DEF for old servers. */
export function normalizeAgentNodeConfigFields(value: unknown): Partial<AgentNodeConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const item = value as Record<string, unknown>;
  return {
    ...(typeof item.builtInType === 'string' && (AGENT_BUILT_IN_TYPES as readonly string[]).includes(item.builtInType)
      ? { builtInType: item.builtInType as AgentBuiltInType } : {}),
    ...(item.archiveMode === 0 || item.archiveMode === 1 ? { archiveMode: item.archiveMode } : {}),
  };
}

export function normalizeAgentNodeConfigureInput(value: unknown): AgentNodeConfigureInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('目录配置参数无效');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['path', 'nodeId', 'builtInType', 'archiveMode'].includes(key))) throw new Error('目录配置包含不支持的参数');
  if ((item.path !== undefined) === (item.nodeId !== undefined)) throw new Error('必须且只能提供 path 或 nodeId');
  if (item.nodeId !== undefined && (!Number.isSafeInteger(item.nodeId) || Number(item.nodeId) <= 0)) throw new Error('节点 ID 必须是正整数');
  const config = normalizeAgentNodeConfigFields(item);
  if (item.builtInType !== undefined && config.builtInType === undefined) throw new Error('不支持的内置类型');
  if (item.archiveMode !== undefined && config.archiveMode === undefined) throw new Error('archiveMode 必须为 0 或 1');
  if (config.builtInType === undefined && config.archiveMode === undefined) throw new Error('请至少提供 builtInType 或 archiveMode');
  if (config.builtInType === 'DEF' && config.archiveMode === 1) throw new Error('普通目录 DEF 不能开启归档模式');
  return {
    ...(item.path !== undefined ? { path: normalizeAgentLibraryDirectoryPath(item.path) } : { nodeId: Number(item.nodeId) }),
    ...config,
    ...(config.builtInType === 'DEF' ? { archiveMode: 0 } : {}),
  };
}

export function resolveAgentNodeConfig(current: Partial<AgentNodeConfig>, input: AgentNodeConfigureInput): AgentNodeConfig {
  if (current.builtInType === undefined || current.archiveMode === undefined) throw new Error('服务端未返回完整的目录类型配置，请更新服务端后重试');
  const builtInType = input.builtInType ?? current.builtInType;
  const archiveMode = input.archiveMode ?? current.archiveMode;
  if (builtInType === 'DEF' && archiveMode === 1) throw new Error('普通目录不能开启归档，请同时指定内置类型');
  return { builtInType, archiveMode };
}
