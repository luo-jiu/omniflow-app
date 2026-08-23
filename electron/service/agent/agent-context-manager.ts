import crypto from 'node:crypto';

import type {
  AgentMessage,
  AgentOwnerScope,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import { streamAIServiceProfile } from '../aiServiceClient';
import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';
import {
  AGENT_CONVERSATION_SUMMARY_LIMITS,
  buildAgentSummaryPayloadBatch,
  buildAgentSummarySystemPrompt,
  parseAgentConversationSummary,
  prepareAgentSummaryTranscript,
  type AgentConversationSummaryV1,
  type AgentSummaryTranscriptMessage,
} from './agent-conversation-summary';
import {
  createAgentContextProjection,
  resolveAgentContextBudget,
  type AgentContextBudget,
  type AgentContextCompactionCandidate,
  type AgentContextCheckpointProjection,
  type AgentContextProjection,
} from './agent-context-projection';
import type {
  AgentContextCheckpoint,
  AgentContextCheckpointState,
  AgentSessionStore,
} from './agent-session-store';

const MAX_CONSECUTIVE_SUMMARY_FAILURES = 3;
const MAX_SUMMARY_BATCHES_PER_COMPACTION = 4;
const SUMMARY_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

function worstCaseSummaryField(label: string): string[] {
  return Array.from({ length: 8 }, (_, index) => (
    `${label}${index}${'\\'.repeat(148)}`
  ));
}

const WORST_CASE_SUMMARY: AgentConversationSummaryV1 = {
  constraintsAndPreferences: worstCaseSummaryField('c'),
  decisionsAndRationale: worstCaseSummaryField('d'),
  goalsAndIntent: worstCaseSummaryField('g'),
  taskContext: worstCaseSummaryField('t'),
  unresolvedAndNextSteps: worstCaseSummaryField('u'),
  version: 1,
};

interface AgentContextManagerOptions {
  budget?: Partial<AgentContextBudget>;
  createId?: () => string;
  now?: () => string;
  nowMs?: () => number;
  summarize?: typeof streamAIServiceProfile;
}

export interface PrepareAgentContextInput {
  budget?: Partial<AgentContextBudget>;
  fixedInputTokens: number;
  libraryId: number;
  messages: AgentMessage[];
  model: string;
  ownerScope: AgentOwnerScope;
  profileId: string;
  runs: AgentRunSnapshot[];
  runtimeConnection: AIServiceRuntimeConnection;
  sessionId: string;
  signal: AbortSignal;
  store: AgentSessionStore;
  toolActivities: AgentToolActivitySnapshot[];
}

export interface AgentContextManager {
  prepare: (input: PrepareAgentContextInput) => Promise<AgentContextProjection>;
}

function parseCheckpointSummary(
  checkpoint: AgentContextCheckpoint | undefined,
): AgentContextCheckpointProjection | undefined {
  if (!checkpoint || checkpoint.status !== 'completed' || checkpoint.summary === undefined) {
    return undefined;
  }
  try {
    const serialized = typeof checkpoint.summary === 'string'
      ? checkpoint.summary
      : JSON.stringify(checkpoint.summary);
    return {
      id: checkpoint.id,
      summary: parseAgentConversationSummary(serialized),
      throughMessageId: checkpoint.throughMessageId,
    };
  } catch {
    return undefined;
  }
}

function toSummaryTranscript(
  messages: readonly AgentMessage[],
): AgentSummaryTranscriptMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return [];
    }
    return [{
      content: message.content,
      role: message.role,
    }];
  });
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function checkpointProjection(
  id: string,
  throughMessageId: string,
  summary: AgentConversationSummaryV1,
): AgentContextCheckpointProjection {
  return { id, summary, throughMessageId };
}

function summaryBatchCount(
  transcript: readonly AgentSummaryTranscriptMessage[],
): number {
  let batchCount = 0;
  let cursor = 0;
  while (cursor < transcript.length) {
    batchCount += 1;
    if (batchCount > MAX_SUMMARY_BATCHES_PER_COMPACTION) return batchCount;
    cursor = buildAgentSummaryPayloadBatch({
      existingSummary: WORST_CASE_SUMMARY,
      messages: transcript,
      startIndex: cursor,
    }).nextIndex;
  }
  return batchCount;
}

function boundedCompactionCandidate(
  candidate: AgentContextCompactionCandidate,
): AgentContextCompactionCandidate | null {
  const groups: AgentMessage[][] = [];
  candidate.sourceMessages.forEach((message) => {
    const previous = groups.at(-1);
    if (previous?.[0]?.runId && previous[0].runId === message.runId) {
      previous.push(message);
    } else {
      groups.push([message]);
    }
  });

  const selectedMessages: AgentMessage[] = [];
  const selectedRunIds: string[] = [];
  for (const group of groups) {
    const runId = group[0]?.runId;
    if (!runId || group.some(message => message.runId !== runId)) break;
    const nextMessages = [...selectedMessages, ...group];
    const transcript = prepareAgentSummaryTranscript(toSummaryTranscript(nextMessages));
    if (summaryBatchCount(transcript) > MAX_SUMMARY_BATCHES_PER_COMPACTION) break;
    selectedMessages.push(...group);
    selectedRunIds.push(runId);
  }

  const throughMessageId = selectedMessages.at(-1)?.id;
  if (!throughMessageId) return null;
  return {
    ...(candidate.baseCheckpointId
      ? { baseCheckpointId: candidate.baseCheckpointId }
      : {}),
    sourceMessages: selectedMessages,
    sourceRunIds: selectedRunIds,
    throughMessageId,
  };
}

export function createAgentContextManager(
  options: AgentContextManagerOptions = {},
): AgentContextManager {
  const createId = options.createId || (() => crypto.randomUUID());
  const currentTime = options.now || (() => new Date().toISOString());
  const currentTimeMs = options.nowMs || (() => Date.now());
  const summarize = options.summarize || streamAIServiceProfile;
  const failureCooldowns = new Map<string, number>();

  function failureKey(input: PrepareAgentContextInput): string {
    return `${input.sessionId}\u0000${input.profileId}\u0000${input.model}`;
  }

  async function readCheckpointState(
    input: PrepareAgentContextInput,
  ): Promise<AgentContextCheckpointState> {
    return await input.store.readContextCheckpointState(
      input.sessionId,
      input.ownerScope,
      input.libraryId,
    ) || { consecutiveFailureCount: 0 };
  }

  async function prepare(input: PrepareAgentContextInput): Promise<AgentContextProjection> {
    const state = await readCheckpointState(input);
    const checkpoint = parseCheckpointSummary(state.latestCompleted);
    const budget = resolveAgentContextBudget({ ...options.budget, ...input.budget });
    let projection = createAgentContextProjection({
      budget,
      checkpoint,
      fixedInputTokens: input.fixedInputTokens,
      messages: input.messages,
      runs: input.runs,
      toolActivities: input.toolActivities,
    });
    const candidate = projection.compaction
      ? boundedCompactionCandidate(projection.compaction)
      : null;
    const cooldownKey = failureKey(input);
    const cooldownUntil = failureCooldowns.get(cooldownKey) || 0;
    if (!candidate || (
      state.consecutiveFailureCount >= MAX_CONSECUTIVE_SUMMARY_FAILURES
      && cooldownUntil > currentTimeMs()
    )) {
      return projection;
    }

    const checkpointId = createId();
    let started = false;
    try {
      await input.store.beginContextCheckpoint({
        ...(candidate.baseCheckpointId
          ? { baseCheckpointId: candidate.baseCheckpointId }
          : {}),
        id: checkpointId,
        libraryId: input.libraryId,
        model: input.model,
        now: currentTime(),
        ownerScope: input.ownerScope,
        profileId: input.profileId,
        sessionId: input.sessionId,
        throughMessageId: candidate.throughMessageId,
      });
      started = true;
      const transcript = prepareAgentSummaryTranscript(
        toSummaryTranscript(candidate.sourceMessages),
      );
      let cursor = 0;
      let summary = checkpoint?.summary;
      while (cursor < transcript.length) {
        const batch = buildAgentSummaryPayloadBatch({
          existingSummary: summary,
          messages: transcript,
          startIndex: cursor,
        });
        const output = await summarize({
          maxOutputTokens: budget.outputReserveTokens,
          messages: [{ content: batch.payload, role: 'user' }],
          model: input.model,
          profileId: input.profileId,
          reasoningEffort: 'auto',
          systemPrompt: buildAgentSummarySystemPrompt(),
          temperature: 0,
        }, () => undefined, input.runtimeConnection, input.signal, {
          maxContentCharacters: AGENT_CONVERSATION_SUMMARY_LIMITS.modelOutputCharacters,
        });
        summary = parseAgentConversationSummary(output);
        cursor = batch.nextIndex;
      }
      if (!summary) throw new Error('Agent 会话摘要没有生成可发布结果');
      await input.store.completeContextCheckpoint(
        checkpointId,
        summary,
        currentTime(),
      );
      failureCooldowns.delete(cooldownKey);
      projection = createAgentContextProjection({
        budget,
        checkpoint: checkpointProjection(
          checkpointId,
          candidate.throughMessageId,
          summary,
        ),
        fixedInputTokens: input.fixedInputTokens,
        messages: input.messages,
        runs: input.runs,
        toolActivities: input.toolActivities,
      });
      return projection;
    } catch (error) {
      const aborted = isAbortError(error, input.signal);
      if (started) {
        await input.store.failContextCheckpoint(
          checkpointId,
          currentTime(),
          aborted ? 'interrupted' : 'failed',
        ).catch(() => undefined);
      }
      if (aborted) throw error;
      if (state.consecutiveFailureCount + 1 >= MAX_CONSECUTIVE_SUMMARY_FAILURES) {
        failureCooldowns.set(cooldownKey, currentTimeMs() + SUMMARY_FAILURE_COOLDOWN_MS);
      }
      return projection;
    }
  }

  return { prepare };
}
