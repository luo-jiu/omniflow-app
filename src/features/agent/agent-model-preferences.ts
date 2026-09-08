import type { AIServiceReasoningEffort } from '@/features/ai-services/ai-service.types';

const AGENT_MODEL_PREFERENCES_KEY = 'agent-model-preferences:v1';
const LEGACY_MODEL_BUDGET_PREFIX = 'agent-model-budget:v1:';

export interface AgentModelPreferences {
  model: string;
  reasoningEffort: AIServiceReasoningEffort;
}

function normalizeReasoningEffort(value: unknown): AIServiceReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'auto';
}

export function loadAgentModelPreferences(): AgentModelPreferences {
  const fallback: AgentModelPreferences = { model: '', reasoningEffort: 'auto' };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    // Retire only the removed Composer preference, leaving other app data intact.
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_MODEL_BUDGET_PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* Unavailable storage cannot re-enable client-side budget overrides. */ }
  const raw = localStorage.getItem(AGENT_MODEL_PREFERENCES_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentModelPreferences>;
    return {
      model: String(parsed.model || ''),
      reasoningEffort: normalizeReasoningEffort(parsed.reasoningEffort),
    };
  } catch {
    localStorage.removeItem(AGENT_MODEL_PREFERENCES_KEY);
    return fallback;
  }
}

export function saveAgentModelPreferences(preferences: AgentModelPreferences): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AGENT_MODEL_PREFERENCES_KEY, JSON.stringify({
    model: String(preferences.model || ''),
    reasoningEffort: normalizeReasoningEffort(preferences.reasoningEffort),
  }));
}
