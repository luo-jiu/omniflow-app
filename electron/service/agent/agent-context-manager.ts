import crypto from 'node:crypto';
import { attachmentManifest } from '../../../src/shared/agent/agent-attachments';

import type {
  AgentMessage,
  AgentOwnerScope,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import { isAgentConversationMessage } from '../../../src/shared/agent/agent.types';
import { streamAIServiceProfile } from '../aiServiceClient';
import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';
import {
  AGENT_CONVERSATION_SUMMARY_MAX_OUTPUT_TOKENS,
  AGENT_CONVERSATION_SUMMARY_LIMITS,
  buildAgentSummaryPayloadBatch,
  buildAgentSummarySystemPrompt,
  parseAgentConversationSummary,
  prepareAgentSummaryTranscript,
  type AgentConversationSummaryV1,
  type AgentSummaryPayloadBatch,
  type AgentSummaryTranscriptMessage,
} from './agent-conversation-summary';
import {
  createAgentContextProjection,
  estimateAgentProviderTurnTokens,
  getAgentProviderRequestTokenLimit,
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

function worstCaseSummaryField(bound: 'characters' | 'tokens'): string[] {
  return Array.from({ length: 8 }, (_, index) => bound === 'tokens'
    ? `${String.fromCharCode(0x4e00 + index)}${'文'.repeat(149)}`
    : `${'\\'.repeat(149 - index)}${'"'.repeat(index + 1)}`);
}

const WORST_CASE_SUMMARY: AgentConversationSummaryV1 = {
  constraintsAndPreferences: worstCaseSummaryField('characters'),
  decisionsAndRationale: worstCaseSummaryField('characters'),
  goalsAndIntent: worstCaseSummaryField('characters'),
  taskContext: worstCaseSummaryField('characters'),
  unresolvedAndNextSteps: worstCaseSummaryField('characters'),
  version: 1,
};

// Summary normalization removes controls and repairs lone surrogates. Escaped
// ASCII bounds JSON length; non-ASCII bounds the local token estimate.
const WORST_CASE_TOKEN_SUMMARY: AgentConversationSummaryV1 = {
  constraintsAndPreferences: worstCaseSummaryField('tokens'),
  decisionsAndRationale: worstCaseSummaryField('tokens'),
  goalsAndIntent: worstCaseSummaryField('tokens'),
  taskContext: worstCaseSummaryField('tokens'),
  unresolvedAndNextSteps: worstCaseSummaryField('tokens'),
  version: 1,
};

interface AgentSummaryRequestBudget {
  inputTokenLimit: number;
  maxOutputTokens: number;
  systemPrompt: string;
}

function buildBudgetedSummaryPayloadBatch(
  input: Parameters<typeof buildAgentSummaryPayloadBatch>[0],
  budget: AgentSummaryRequestBudget,
): AgentSummaryPayloadBatch | undefined {
  let endIndex = input.messages.length;
  while (endIndex > input.startIndex) {
    let batch: AgentSummaryPayloadBatch;
    try {
      batch = buildAgentSummaryPayloadBatch({ ...input, messages: input.messages.slice(0, endIndex) });
    } catch (error) {
      if (error instanceof Error && error.message === 'Agent 会话摘要单条 transcript 无法放入安全 payload') return undefined;
      throw error;
    }
    const tokens = estimateAgentProviderTurnTokens({
      messages: [{ content: batch.payload, role: 'user' }],
      systemPrompt: budget.systemPrompt,
      tools: [],
    });
    if (tokens <= budget.inputTokenLimit) return batch;
    endIndex = batch.nextIndex - 1;
  }
  return undefined;
}

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
    if (!isAgentConversationMessage(message)) return [];
    return [{
      content: message.content + attachmentManifest(message.attachments || [], false),
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
  budget: AgentSummaryRequestBudget,
): number {
  let batchCount = 0;
  let cursor = 0;
  while (cursor < transcript.length) {
    batchCount += 1;
    if (batchCount > MAX_SUMMARY_BATCHES_PER_COMPACTION) return batchCount;
    const characterBatch = buildBudgetedSummaryPayloadBatch({
      existingSummary: WORST_CASE_SUMMARY, messages: transcript, startIndex: cursor,
    }, budget);
    const tokenBatch = buildBudgetedSummaryPayloadBatch({
      existingSummary: WORST_CASE_TOKEN_SUMMARY, messages: transcript, startIndex: cursor,
    }, budget);
    if (!characterBatch || !tokenBatch) return MAX_SUMMARY_BATCHES_PER_COMPACTION + 1;
    cursor = Math.min(characterBatch.nextIndex, tokenBatch.nextIndex);
  }
  return batchCount;
}

function boundedCompactionCandidate(
  candidate: AgentContextCompactionCandidate,
  budget: AgentSummaryRequestBudget,
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
    if (summaryBatchCount(transcript, budget) > MAX_SUMMARY_BATCHES_PER_COMPACTION) break;
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
    const maxOutputTokens = Math.min(AGENT_CONVERSATION_SUMMARY_MAX_OUTPUT_TOKENS, budget.outputReserveTokens);
    const summaryBudget: AgentSummaryRequestBudget = {
      inputTokenLimit: getAgentProviderRequestTokenLimit({ ...budget, outputReserveTokens: maxOutputTokens }),
      maxOutputTokens,
      systemPrompt: buildAgentSummarySystemPrompt(),
    };
    let projection = createAgentContextProjection({
      budget,
      checkpoint,
      fixedInputTokens: input.fixedInputTokens,
      messages: input.messages,
      runs: input.runs,
      toolActivities: input.toolActivities,
    });
    const candidate = projection.compaction
      ? boundedCompactionCandidate(projection.compaction, summaryBudget)
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
      let batchCount = 0;
      let summary = checkpoint?.summary;
      while (cursor < transcript.length) {
        if (batchCount >= MAX_SUMMARY_BATCHES_PER_COMPACTION) {
          throw new Error('Agent 会话摘要超过单次压缩批数限制');
        }
        const batch = buildBudgetedSummaryPayloadBatch({
          existingSummary: summary,
          messages: transcript,
          startIndex: cursor,
        }, summaryBudget);
        if (!batch) throw new Error('Agent 会话摘要单条 transcript 超过模型上下文预算');
        batchCount += 1;
        const output = await summarize({
          maxOutputTokens: summaryBudget.maxOutputTokens,
          messages: [{ content: batch.payload, role: 'user' }],
          model: input.model,
          profileId: input.profileId,
          reasoningEffort: 'auto',
          systemPrompt: summaryBudget.systemPrompt,
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
