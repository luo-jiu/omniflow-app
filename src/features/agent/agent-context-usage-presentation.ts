import type { AIServiceProfile } from '@/features/ai-services/ai-service.types';
import type { AgentReasoningEffort, AgentRunSnapshot } from '@/shared/agent/agent.types';

/** Only the latest run can describe this conversation's retained context. */
export function selectAgentContextUsageRun({ runs, sessionId, model, reasoningEffort, profile }: {
  runs: readonly AgentRunSnapshot[];
  sessionId: string | null;
  model: string;
  reasoningEffort: AgentReasoningEffort;
  profile: AIServiceProfile | null;
}): AgentRunSnapshot | undefined {
  if (!sessionId || !profile) return undefined;
  const latest = runs.reduce<AgentRunSnapshot | undefined>((current, run) => {
    if (run.sessionId !== sessionId) return current;
    return !current || run.createdAt > current.createdAt
      || (run.createdAt === current.createdAt && run.id > current.id) ? run : current;
  }, undefined);
  if (!latest || latest.model !== model || latest.profileId !== profile.id
    || (latest.requestedReasoningEffort ?? latest.reasoningEffort) !== reasoningEffort) return undefined;
  // Editing credentials/endpoint under the same profile ID invalidates old measurements.
  if (Date.parse(profile.updatedAt) > Date.parse(latest.createdAt)) return undefined;
  return latest;
}
