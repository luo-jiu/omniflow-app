import { createHash } from 'node:crypto';
import type { PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
import type { ManagedPlugin } from '../../../src/shared/plugin-management';
import { toAgentProviderToolName } from '../agent/agent-provider-tool-name';

export interface PluginToolRegistration {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly fingerprint: string;
  readonly registrationId: string;
  readonly providerName: string;
  readonly contribution: PluginToolContribution;
}

/** Run 组合目录在发出模型请求前统一校验，不能覆盖已有的内置或插件 Tool。 */
export function assertPluginToolNames(tools: ReadonlyArray<Pick<PluginToolContribution, 'id'>>, reservedToolNames: readonly string[] = []): void {
  const canonical = new Set<string>();
  const provider = new Map<string, string>();
  for (const id of [...reservedToolNames, ...tools.map(tool => tool.id)]) {
    if (canonical.has(id)) throw new Error('DUPLICATE_TOOL_ID');
    canonical.add(id);
    const name = toAgentProviderToolName(id);
    if (provider.has(name)) throw new Error('PLUGIN_TOOL_PROVIDER_NAME_CONFLICT');
    provider.set(name, id);
  }
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** 安装批准只选择能力，不代替当前调用的资源范围或实际改名批准。 */
export function isPluginToolAllowed(plugin: ManagedPlugin, contribution: PluginToolContribution): boolean {
  if (!plugin.enabled || plugin.blockedReason || !plugin.toolApproved || !plugin.permissions.includes('agent.tools')) return false;
  return contribution.kind === 'rename-proposal'
    ? Boolean(plugin.renameApproved && plugin.permissions.includes('resource.rename.propose'))
    : contribution.kind === 'file-output'
      ? Boolean(plugin.readApproved && plugin.outputApproved && plugin.permissions.includes('resource.read') && plugin.permissions.includes('resource.output.propose'))
    : Boolean(plugin.readApproved && plugin.permissions.includes('resource.read'));
}

/** 这里只冻结候选贡献与代码身份，不注册执行器，也不授予某个 Agent Run 文件权限。 */
export function createPluginToolSnapshot(plugins: readonly ManagedPlugin[], reservedToolNames: readonly string[] = []): readonly PluginToolRegistration[] {
  const registrations = plugins.flatMap(plugin => (plugin.agentTools ?? []).filter(contribution => isPluginToolAllowed(plugin, contribution)).map(contribution => ({
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      fingerprint: plugin.fingerprint,
      // 包指纹包含执行代码；同名声明不能把旧 Run 偷换成新实现。
      registrationId: `plugin-tool:${createHash('sha256').update(JSON.stringify(['omniflow-agent-tool-v1', plugin.id, plugin.version, plugin.fingerprint, contribution.id])).digest('hex')}`,
      providerName: toAgentProviderToolName(contribution.id),
      contribution: structuredClone(contribution),
    })));
  assertPluginToolNames(registrations.map(item => item.contribution), reservedToolNames);
  return freezeDeep(registrations);
}
