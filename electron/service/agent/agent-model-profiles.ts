import type { AIServiceProviderType } from '@/shared/ai-service-provider-types';

export type AgentModelFamily = 'openai-reasoning' | 'openai-standard' | 'claude-effort' | 'claude-standard' | 'deepseek-chat' | 'deepseek-reasoner';
export interface AgentModelProfile {
  readonly id: string;
  readonly provider: AIServiceProviderType;
  readonly family: AgentModelFamily;
}

// Execution compatibility is independent of the exact, connection-listed
// context-window snapshot. Keep its existing aliases and date-ID matching.
const reasoningModels = [
  'gpt-6.1-sol', 'gpt-6', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra',
  'gpt-5.6-luna', 'gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest', 'gpt-5.5',
  'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.2-pro', 'codex-auto-review',
];
const profiles: readonly AgentModelProfile[] = Object.freeze([
  ...reasoningModels.map(id => ({ id, provider: 'openai' as const, family: 'openai-reasoning' as const })),
  ...['gpt-4o', 'gpt-4o-mini', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'].map(id => ({ id, provider: 'openai' as const, family: 'openai-standard' as const })),
  ...['claude-opus-4-6', 'claude-sonnet-4-6'].map(id => ({ id, provider: 'claude' as const, family: 'claude-effort' as const })),
  ...['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-7-sonnet'].map(id => ({ id, provider: 'claude' as const, family: 'claude-standard' as const })),
  { id: 'deepseek-chat', provider: 'deepseek', family: 'deepseek-chat' } as const,
  { id: 'deepseek-reasoner', provider: 'deepseek', family: 'deepseek-reasoner' } as const,
].map(profile => Object.freeze(profile)));

export function findAgentModelProfile(provider: AIServiceProviderType, model: string): AgentModelProfile | undefined {
  const name = model.trim().toLowerCase();
  return profiles.find(profile => profile.provider === provider && profile.id === name)
    || profiles.find(profile => profile.provider === provider && name.startsWith(`${profile.id}-`)
      && (provider === 'claude' ? /^\d{8}$/u : /^\d{4}-\d{2}-\d{2}$/u).test(name.slice(profile.id.length + 1)));
}
