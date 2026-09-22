import { createHash } from 'node:crypto';
import type { AgentPluginToolSource } from '../../../src/shared/agent/agent.types';

export const MAX_PLUGIN_TOOL_SOURCE_BYTES = 1024;
export const PLUGIN_TOOL_SOURCE_FIELDS = [
  'pluginId', 'pluginVersion', 'packageFingerprint', 'toolId', 'registrationId',
] as const;

/** Only main passes this field; model inputs and Tool results are never source authorities. */
export function normalizeAgentPluginToolSource(value: unknown, toolName?: string): AgentPluginToolSource {
  const invalid = () => new Error('Agent Tool 插件来源无效');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== PLUGIN_TOOL_SOURCE_FIELDS.length
    || PLUGIN_TOOL_SOURCE_FIELDS.some(field => (
      !Object.prototype.hasOwnProperty.call(descriptors, field)
      || typeof descriptors[field].value !== 'string'
      || !descriptors[field].enumerable
      || descriptors[field].value !== descriptors[field].value.trim()
    ))) throw invalid();
  const source: AgentPluginToolSource = {
    pluginId: descriptors.pluginId.value,
    pluginVersion: descriptors.pluginVersion.value,
    packageFingerprint: descriptors.packageFingerprint.value,
    toolId: descriptors.toolId.value,
    registrationId: descriptors.registrationId.value,
  };
  if (source.pluginId.length > 96
    || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(source.pluginId)
    || !/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(source.pluginVersion)
    || !/^[a-f0-9]{64}$/.test(source.packageFingerprint)
    || source.toolId.length > 128
    || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(source.toolId)
    || !source.toolId.startsWith(`${source.pluginId}.`)
    || (toolName !== undefined && source.toolId !== toolName)
    || !/^plugin-tool:[a-f0-9]{64}$/.test(source.registrationId)
    || Buffer.byteLength(JSON.stringify(source), 'utf8') > MAX_PLUGIN_TOOL_SOURCE_BYTES
  ) throw invalid();
  // Match plugin-tool-catalog's versioned identity; authorization remains a separate host check.
  const registrationId = `plugin-tool:${createHash('sha256').update(JSON.stringify([
    'omniflow-agent-tool-v1', source.pluginId, source.pluginVersion,
    source.packageFingerprint, source.toolId,
  ])).digest('hex')}`;
  if (source.registrationId !== registrationId) throw invalid();
  return Object.freeze(source);
}
