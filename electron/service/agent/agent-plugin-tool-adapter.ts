import type { PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
import { assertPluginToolNames, type PluginToolRegistration } from '../extensions/plugin-tool-catalog';
import { validateToolInput, validateToolSchemas } from '../extensions/tool-schema';
import { normalizeAgentPluginToolSource } from './agent-plugin-source';
import { toAgentProviderToolName } from './agent-provider-tool-name';
import { createAgentToolRegistry, type AgentTool, type AgentToolRegistrySnapshot } from './agent-tool-registry';

function freezeContribution(contribution: PluginToolContribution): PluginToolContribution {
  validateToolSchemas(contribution.inputSchema, contribution.outputSchema, contribution.kind);
  const clone = structuredClone(contribution);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(clone);
  return clone;
}

/** Compose one Run's catalog without registering into, or recreating, the built-in registry. */
export function createAgentPluginToolSnapshot(
  base: AgentToolRegistrySnapshot,
  registrations: readonly PluginToolRegistration[],
): AgentToolRegistrySnapshot {
  assertPluginToolNames(registrations.map(item => item.contribution), base.tools.map(tool => tool.name));
  const contributions = new Map<string, PluginToolContribution>();
  const registrationIds = new Set(base.tools.map(tool => tool.registrationId));
  const definitions: AgentTool[] = registrations.map((registration) => {
    const contribution = freezeContribution(registration.contribution);
    const source = normalizeAgentPluginToolSource({
      pluginId: registration.pluginId,
      pluginVersion: registration.pluginVersion,
      packageFingerprint: registration.fingerprint,
      toolId: contribution.id,
      registrationId: registration.registrationId,
    }, contribution.id);
    if (registration.providerName !== toAgentProviderToolName(contribution.id)
      || registrationIds.has(source.registrationId)) throw new Error('Agent 插件 Tool 注册身份冲突');
    registrationIds.add(source.registrationId);
    contributions.set(contribution.id, contribution);
    const definition: AgentTool = {
      description: `插件 ${source.pluginId}：${contribution.description}`,
      executor: 'main',
      inputSchema: contribution.inputSchema,
      kind: 'business',
      name: contribution.id,
      pluginSource: source,
      // Host-assigned read semantics; package declarations cannot impersonate other built-ins.
      presentation: { groupKind: 'resource-read', operationKind: 'read' },
      registrationId: source.registrationId,
      risk: 'read',
      timeoutMs: contribution.timeoutMs,
      validate: (input) => {
        try { validateToolInput(contribution, input); return { ok: true }; }
        catch { return { ok: false, message: '插件 Tool 参数不符合输入约束' }; }
      },
      execute: async (input, context) => {
        validateToolInput(contribution, input);
        if (!context.executePluginTool) throw new Error('插件 Tool 执行能力未配置');
        return context.executePluginTool(source, input, context.signal);
      },
    };
    if (contribution.kind === 'rename-proposal') {
      return {
        ...definition,
        pluginOperation: 'rename', risk: 'write', presentation: undefined,
        cancellationSettleTimeoutMs: 45_000,
        prepareMain: async (input, _requestedAction, context) => {
          validateToolInput(contribution, input);
          if (!context.preparePluginRename) throw new Error('插件改名提案准备能力未配置');
          return context.preparePluginRename(source, input, context.signal);
        },
        execute: async (input, context) => {
          validateToolInput(contribution, input);
          if (!context.preparation || !context.commitSettlement || !context.executePluginRename) {
            throw new Error('插件改名缺少已批准的准备结果或宿主提交能力');
          }
          return context.executePluginRename(source, input, context.preparation, context.commitSettlement, context.signal);
        },
      };
    }
    return definition;
  });
  const plugins = createAgentToolRegistry(definitions).createSnapshot();
  const tools = Object.freeze([...base.tools, ...plugins.tools]);
  const ownerFor = (name: string) => contributions.has(String(name || '').trim()) ? plugins : base;
  return Object.freeze({
    revision: base.revision + plugins.revision,
    tools,
    get: (name) => ownerFor(name).get(name),
    list: () => [...tools],
    // In particular, prepared capabilities remain owned by the exact base snapshot.
    sealMainPreparedExecution: (name, input, expectedRegistrationId) => ownerFor(name)
      .sealMainPreparedExecution(name, input, expectedRegistrationId),
    execute: (name, input, context, expectedRegistrationId) => ownerFor(name)
      .execute(name, input, context, expectedRegistrationId),
    validateInput: (name, input, expectedRegistrationId) => {
      const validation = ownerFor(name).validateInput(name, input, expectedRegistrationId);
      if (!validation.ok) return validation;
      const contribution = contributions.get(String(name || '').trim());
      if (contribution) {
        try { validateToolInput(contribution, input); }
        catch { return { ok: false, message: '插件 Tool 参数不符合输入约束' }; }
      }
      return validation;
    },
  } satisfies AgentToolRegistrySnapshot);
}
