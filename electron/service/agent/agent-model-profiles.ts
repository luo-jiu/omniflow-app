import type { AIServiceProviderType } from '@/shared/ai-service-provider-types';

export type AgentModelFamily = 'openai-reasoning' | 'openai-standard' | 'claude-effort' | 'claude-standard' | 'deepseek-chat' | 'deepseek-reasoner';
export interface AgentModelProfile {
  readonly id: string;
  readonly provider: AIServiceProviderType;
  readonly family: AgentModelFamily;
  readonly context?: readonly [number, number];
}

// Local Codex catalog 4b0d9669cc (2026-09-08). These are client defaults,
// not proof that an identically named model behind a gateway has the same limits.
const reasoningContexts: Readonly<Record<string, readonly [number, number]>> = {
  'gpt-6-astra': [272_000, 872_000],
  'gpt-5.6-sol': [272_000, 872_000], 'gpt-5.6-terra': [272_000, 872_000],
  'gpt-5.6-luna': [272_000, 872_000], 'gpt-daybreak-blue-latest': [272_000, 872_000],
  'gpt-daybreak-red-latest': [372_000, 372_000], 'gpt-5.5': [272_000, 272_000],
  'gpt-5.4': [272_000, 1_000_000], 'gpt-5.4-mini': [272_000, 272_000],
  'gpt-5.2': [272_000, 272_000], 'codex-auto-review': [272_000, 872_000],
};
const profiles: readonly AgentModelProfile[] = Object.freeze([
  ...Object.entries(reasoningContexts).map(([id, context]) => ({ id, provider: 'openai' as const, family: 'openai-reasoning' as const, context: Object.freeze(context) })),
  ...['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'].map(id => ({ id, provider: 'openai' as const, family: 'openai-standard' as const })),
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
