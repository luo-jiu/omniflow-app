export const AGENT_PROVIDER_TOOL_NAME_MAX_LENGTH = 64;
const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function toAgentProviderToolName(name: string): string {
  const canonicalName = String(name || '').trim();
  const providerName = canonicalName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, AGENT_PROVIDER_TOOL_NAME_MAX_LENGTH);
  if (!providerName || !PROVIDER_TOOL_NAME_PATTERN.test(providerName)) {
    throw new Error(`Agent Tool 名称无法转换为 Provider 支持的格式：${canonicalName || '(empty)'}`);
  }
  return providerName;
}
