import crypto from 'node:crypto';
import type { WebContents } from 'electron';

import type {
  AgentActionPreview,
  AgentAppContext,
  AgentChatRequest,
  AgentChatStartResult,
  AgentChatStreamEvent,
  AgentInteractionRequest,
  AgentInteractionResponse,
  AgentInteractionSubmissionRequest,
  AgentInteractionSubmissionResult,
  AgentMemoryCursor,
  AgentMemoryDeleteRequest,
  AgentMemoryItem,
  AgentMemoryPage,
  AgentMemoryProposal,
  AgentMemoryUpdateRequest,
  AgentMediaArtifactReleaseRequest,
  AgentMediaArtifactSaveRequest,
  AgentMediaArtifactSaveResult,
  AgentMediaAudioExtractionRequest,
  AgentMediaAudioExtractionResult,
  AgentMessage,
  AgentMediaInspectionRequest,
  AgentOwnerScope,
  AgentPreparedActionPublic,
  AgentPerceptionSnapshot,
  AgentReasoningEffort,
  AgentRunSnapshot,
  AgentSessionCursor,
  AgentSessionPage,
  AgentSessionSnapshot,
  AgentSessionSummary,
  AgentToolActivitySnapshot,
  AgentToolApprovalDecisionRequest,
  AgentToolApprovalDecisionResult,
  AgentToolExecutionCompletion,
  AgentToolExecutionCommit,
  AgentToolExecutionProgressRequest,
  AgentToolPrepareCompletion,
  AgentToolApprovalSnapshot,
  AgentToolProgress,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { normalizeAgentPreparedActionPublic } from '../../../src/shared/agent/agent-prepared-action';
import { streamAIServiceProfile } from '../aiServiceClient';
import {
  resolveAIServiceOutputTokenLimit,
  type AIServiceRuntimeConnection,
} from '../aiServiceClientModel';
import { appendBoundedAIServiceStreamText } from '../aiServiceStreamLimits';
import { aiServiceRunSessionRegistry } from '../aiServiceRunSession';
import { getAIServiceRuntimeProfile } from '../aiServiceStore';
import { streamAgentProviderTurn } from './agent-provider-client';
import type { AgentProviderMessage, AgentProviderToolCall } from './agent-provider-model';
import { createAgentContextManager, type AgentContextManager } from './agent-context-manager';
import {
  assertAgentCurrentRunFitsContext,
  assertAgentProviderTurnFitsContext,
  estimateAgentFixedInputTokens,
  estimateAgentProviderMessagesTokens,
  estimateAgentProviderTurnTokens,
  estimateAgentTextTokens,
  getAgentProviderRequestTokenLimit,
  resolveAgentContextBudget,
  type AgentContextBudget,
} from './agent-context-projection';
import {
  buildAgentFallbackContextMessages,
  buildAgentFallbackSystemPrompt,
  buildAgentSystemPrompt,
} from './agent-prompt-assembler';
import {
  projectAgentChatStreamEventForRenderer,
  projectAgentSessionForRenderer,
} from './agent-renderer-projection';
import { extractAgentMediaAudio } from './agent-media-audio-extractor';
import { agentMediaArtifactStore, type AgentMediaArtifactStore } from './agent-media-artifact-store';
import { saveAgentMediaArtifactAs } from './agent-media-save-as';
import { inspectAgentMediaSource } from './agent-media-inspector';
import { buildAgentMemoryContextMessagesWithinBudget } from './agent-memory-context';
import type { AgentMemoryStore } from './agent-memory-store';
import {
  createStructuredAgentMemoryRetriever,
  type AgentMemoryRetrievalInput,
} from './agent-memory-retriever';
import {
  AGENT_PLAN_CONTROL_TOOL_NAME,
  agentPlanControlTool,
  normalizeAgentRunPlan,
} from './agent-plan-model';
import {
  isAgentSensitiveInteractionRequestError,
  normalizeAgentInteractionRequest,
  normalizeAgentInteractionResponse,
} from './agent-interaction-model';
import { assessAgentToolPermission } from './agent-permission-gate';
import {
  containsAgentSensitiveData,
  sanitizeAgentSensitiveText,
} from './agent-sensitive-data';
import type { AgentRunUpdate, AgentSessionStore } from './agent-session-store';
import { getAgentPersistenceRuntime } from './agent-persistence-runtime';
import {
  createAgentToolBroker,
  normalizeAgentToolResult,
  type AgentToolBroker,
  type AgentToolExecutionOutcome,
} from './agent-tool-broker';
import {
  createAgentToolPrepareBroker,
  type AgentToolPrepareBroker,
} from './agent-tool-prepare-broker';
import { projectAgentToolAuditInput } from './agent-tool-audit';
import {
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS,
  projectAgentToolResultForProvider,
} from './agent-tool-result-projection';
import {
  agentToolRegistry,
  type AgentToolExecutionContext,
  type AgentToolExecutor,
  type AgentToolPermissionDecision,
  type AgentToolPreparationResult,
} from './agent-tool-registry';
import {
  createAgentRunCapabilitySnapshot,
  type AgentRunCapabilitySnapshot,
} from './agent-run-capability-snapshot';
import { createBuiltInAgentCapabilitySnapshot } from './capabilities/agent-capability-runtime';
import type {
  AgentCapabilitySnapshot,
  AgentCapabilitySnapshotRequest,
} from './capabilities/agent-capability.types';
import {
  builtInAgentSkillRegistry,
  ensureBuiltInAgentCapabilities,
} from './skills/agent-skill-runtime';
import { resolveAgentSkillActivationResult } from './skills/skill-activate-tool';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  type AgentSkillSummaryV1,
} from './skills/agent-skill.types';
import { getBuiltInActionTools } from './tools/directory-create-tool';
import { getBuiltInReadTools } from './tools/file-read-tools';
import {
  mediaExtractAudioTool,
  normalizeAgentAudioOutputFormat,
} from './tools/media-extract-audio-tool';
import { mediaInspectTool } from './tools/media-inspect-tool';
import { interactionRequestTool } from './tools/interaction-request-tool';
import { memoryProposeTool } from './tools/memory-propose-tool';

const MAX_TOOL_CALLS = 8;
// One Skill activation turn, eight serial business Tool turns, then a final answer.
const MAX_PROVIDER_TURNS = 10;
const MAX_ASSISTANT_TURN_CHARACTERS = 64_000;
const MAX_ASSISTANT_RUN_CHARACTERS = 64_000;
const MAX_PROVIDER_TOOL_RESULT_TOKENS = 1_024;
const MAX_AGENT_MODEL_CHARACTERS = 200;
const MAX_AGENT_PROFILE_ID_CHARACTERS = 200;
const MAX_AGENT_SESSION_ID_CHARACTERS = 200;
const MAX_AGENT_ACTIVE_TOOL_ID_CHARACTERS = 100;
const MAX_AGENT_DIRECTORY_NAME_CHARACTERS = 500;
const MAX_AGENT_SELECTED_NODE_IDS = 200;
const MAX_AGENT_PROGRESS_MESSAGE_CHARACTERS = 2_000;
const MAX_AGENT_ERROR_MESSAGE_CHARACTERS = 4_000;
const TOOL_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const TOOL_INTERACTION_TIMEOUT_MS = 30 * 60 * 1000;
const AVAILABLE_PERCEPTION_BUDGET_PROBE: AgentPerceptionSnapshot = {
  collectedAt: '',
  selectedNodes: [],
};

[...getBuiltInReadTools(), interactionRequestTool, memoryProposeTool, mediaInspectTool, mediaExtractAudioTool, ...getBuiltInActionTools()].forEach((tool) => {
  if (!agentToolRegistry.get(tool.name)) agentToolRegistry.register(tool);
});
ensureBuiltInAgentCapabilities();

interface ActiveAgentRun {
  controller: AbortController;
  ownerWebContentsId: number;
  runId: string;
}

interface StartingAgentRun {
  controller: AbortController;
  ownerWebContentsId: number;
}

type AgentApprovalOutcome =
  | { activity: AgentToolActivitySnapshot; approved: false }
  | {
      activity: AgentToolActivitySnapshot;
      approved: true;
      execution?: Promise<AgentToolExecutionOutcome>;
    };

interface PendingAgentApproval {
  appContext: AgentAppContext;
  approval: AgentToolApprovalSnapshot;
  executor: AgentToolExecutor;
  executionInput: unknown;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  sender: WebContents;
  onProgress: (progress: AgentToolProgress) => void;
  onCancel: (executionId: string) => void;
  resolving: boolean;
  resolve: (outcome: AgentApprovalOutcome) => void;
  signal: AbortSignal;
  store: AgentSessionStore;
  timeoutMs: number;
  prepared?: {
    current: AgentPreparedRuntime;
    finalize: (requestedAction?: AgentPreparedActionPublic) => Promise<AgentPreparedRuntime>;
  };
}

interface AgentPreparedRuntime {
  action: AgentPreparedActionPublic;
  executionInput: unknown;
  permissionBehavior: 'allow' | 'ask';
  preparedActionId: string;
  preview: AgentActionPreview;
  snapshotHash: string;
}

interface PendingAgentInteraction {
  appContext: AgentAppContext;
  interaction: NonNullable<AgentToolActivitySnapshot['interaction']>;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  runId: string;
  sessionId: string;
  signal: AbortSignal;
  submit: (response: AgentInteractionResponse) => Promise<AgentToolActivitySnapshot>;
}

interface ActiveMediaArtifactSave {
  ownerWebContentsId: number;
  runId: string;
  task: Promise<AgentMediaArtifactSaveResult>;
}

interface AgentOrchestratorOptions {
  approvalTimeoutMs?: number;
  contextBudget?: Partial<AgentContextBudget>;
  contextManager?: AgentContextManager;
  extractMediaAudio?: typeof extractAgentMediaAudio;
  getRuntimeProfile?: (profileId: string) => AIServiceRuntimeConnection;
  getMemoryStore?: () => Promise<AgentMemoryStore>;
  getSessionStore?: () => Promise<AgentSessionStore>;
  inspectMediaSource?: typeof inspectAgentMediaSource;
  interactionTimeoutMs?: number;
  mediaArtifactStore?: Pick<AgentMediaArtifactStore, 'release' | 'releaseOwner' | 'releaseRun'>
    & Partial<Pick<AgentMediaArtifactStore, 'getOwned' | 'touchExecution'>>;
  resolveCapabilitySnapshot?: (
    input: AgentCapabilitySnapshotRequest,
  ) => Promise<AgentCapabilitySnapshot>;
  resolveContextBudget?: (input: {
    model: string;
    providerType: AIServiceRuntimeConnection['providerType'];
  }) => Partial<AgentContextBudget> | undefined;
  runSessionRegistry?: Pick<typeof aiServiceRunSessionRegistry, 'begin' | 'end'>;
  saveMediaArtifactAs?: typeof saveAgentMediaArtifactAs;
  retrieveMemories?: (input: AgentMemoryRetrievalInput) => Promise<AgentMemoryItem[]>;
  toolPrepareBroker?: AgentToolPrepareBroker;
  toolBroker?: AgentToolBroker;
}

function now(): string {
  return new Date().toISOString();
}

function normalizeContext(input: AgentAppContext): AgentAppContext {
  const platform = input?.platform === 'darwin'
    || input?.platform === 'win32'
    || input?.platform === 'linux'
    ? input.platform
    : 'unknown';
  const selectedNodeIds = Array.isArray(input?.selectedNodeIds)
    ? Array.from(new Set(input.selectedNodeIds
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)))
      .slice(0, MAX_AGENT_SELECTED_NODE_IDS)
    : [];
  const directoryId = Number(input?.currentDirectory?.id);
  return {
    activeToolId: String(input?.activeToolId || '')
      .trim()
      .slice(0, MAX_AGENT_ACTIVE_TOOL_ID_CHARACTERS) || undefined,
    currentDirectory: Number.isFinite(directoryId) && directoryId > 0
      ? {
          id: directoryId,
          name: String(input.currentDirectory?.name || '')
            .trim()
            .slice(0, MAX_AGENT_DIRECTORY_NAME_CHARACTERS),
        }
      : undefined,
    libraryId: Number.isFinite(Number(input?.libraryId)) && Number(input.libraryId) > 0
      ? Number(input.libraryId)
      : undefined,
    platform,
    selectedNodeIds,
  };
}

function normalizeReasoningEffort(value: unknown): AgentReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'auto';
}

function estimateContinuationTokensBeforeSideEffects(input: {
  appContext: AgentAppContext;
  capabilities: string[];
  currentPerception: AgentChatRequest['perception'];
  messages: readonly AgentProviderMessage[];
  omittedSkillCount: number;
  skillSummaries: readonly AgentSkillSummaryV1[];
  tools: readonly unknown[];
}): number {
  const perceptionStates = input.currentPerception
    ? [input.currentPerception]
    : [undefined, AVAILABLE_PERCEPTION_BUDGET_PROBE];
  // A renderer Tool may establish perception only after its side effect has committed.
  return Math.max(...perceptionStates.map(perception => estimateAgentProviderTurnTokens({
    messages: input.messages,
    systemPrompt: buildAgentSystemPrompt(
      input.appContext,
      perception,
      input.capabilities,
      input.skillSummaries,
      input.omittedSkillCount,
    ),
    tools: input.tools,
  })));
}

function normalizePerception(
  input: AgentChatRequest['perception'],
): AgentChatRequest['perception'] {
  if (!input || typeof input !== 'object') return undefined;
  const normalizeEntry = (value: unknown) => {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    const id = Number(source.id);
    const name = String(source.name || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !name) return null;
    const type = source.type === 'dir' || source.type === 'file' ? source.type : null;
    if (!type) return null;
    const fileSize = Number(source.fileSize);
    return {
      ...(source.ext ? { ext: String(source.ext).slice(0, 80) } : {}),
      ...(Number.isFinite(fileSize) && fileSize >= 0 ? { fileSize } : {}),
      id,
      ...(source.mimeType ? { mimeType: String(source.mimeType).slice(0, 160) } : {}),
      name: name.slice(0, 500),
      type: type as 'dir' | 'file',
      ...(source.updatedAt ? { updatedAt: String(source.updatedAt).slice(0, 80) } : {}),
    };
  };
  const entries = Array.isArray(input.currentDirectory?.entries)
    ? input.currentDirectory.entries
      .slice(0, 200)
      .map(normalizeEntry)
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeEntry>> => entry !== null)
    : [];
  const selectedNodes = Array.isArray(input.selectedNodes)
    ? input.selectedNodes
      .slice(0, 20)
      .map(normalizeEntry)
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeEntry>> => entry !== null)
    : [];
  const directoryId = Number(input.currentDirectory?.id);
  const directoryName = String(input.currentDirectory?.name || '').trim();
  return {
    ...(Number.isFinite(directoryId) && directoryId > 0 && directoryName
      ? {
          currentDirectory: {
            entryCount: entries.length,
            entries,
            id: directoryId,
            name: directoryName.slice(0, 500),
          },
        }
      : {}),
    selectedNodes,
    collectedAt: String(input.collectedAt || '').slice(0, 80),
  };
}

function normalizeToolProgress(progress: AgentToolProgress): AgentToolProgress {
  const message = sanitizeAgentSensitiveText(
    String(progress?.message || '').slice(0, MAX_AGENT_PROGRESS_MESSAGE_CHARACTERS),
  ).trim() || 'Agent Tool 正在执行';
  const percent = Number(progress?.percent);
  return {
    message,
    ...(Number.isFinite(percent)
      ? { percent: Math.max(0, Math.min(100, percent)) }
      : {}),
  };
}

function normalizeActionPreview(preview: AgentActionPreview): AgentActionPreview {
  const sanitize = (value: unknown, maximum: number): string => (
    sanitizeAgentSensitiveText(String(value || '').slice(0, maximum)).trim()
  );
  const details = Array.isArray(preview.details)
    ? preview.details.slice(0, 20).map(detail => ({
        label: sanitize(detail?.label, 160) || '详情',
        value: sanitize(detail?.value, 500) || '[REDACTED]',
      }))
    : undefined;
  return {
    description: sanitize(preview.description, 1_000) || '请确认是否执行此操作',
    ...(details?.length ? { details } : {}),
    risk: preview.risk,
    title: sanitize(preview.title, 200) || '确认 Agent 操作',
  };
}

function normalizeAgentErrorMessage(error: unknown, fallback: string): string {
  const source = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : fallback;
  return sanitizeAgentSensitiveText(
    source.slice(0, MAX_AGENT_ERROR_MESSAGE_CHARACTERS),
  ).trim() || fallback;
}

function createMessage(
  sessionId: string,
  runId: string,
  role: AgentMessage['role'],
  content: string,
  tool?: { callId: string; name: string },
): AgentMessage {
  return {
    content,
    createdAt: now(),
    id: crypto.randomUUID(),
    role,
    runId,
    sessionId,
    ...(tool ? { toolCallId: tool.callId, toolName: tool.name } : {}),
  };
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Agent 任务已取消');
  error.name = 'AbortError';
  throw error;
}

function isToolProtocolUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    /(tools?|functions?).*(unsupported|not supported|does not support|not support|unknown|unrecognized)/.test(message)
    || /(unsupported|not supported|does not support|not support|unknown|unrecognized).*(tools?|functions?)/.test(message)
  );
}

function sessionTitleFromPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function hashToolInput(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function createPreparedRuntime(
  result: AgentToolPreparationResult,
  expectedToolName: string,
): AgentPreparedRuntime {
  if (result.decision.behavior !== 'ask' && result.decision.behavior !== 'allow') {
    throw new Error('Agent Tool prepare 不能生成拒绝后的执行动作');
  }
  const action = normalizeAgentPreparedActionPublic(result.publicAction);
  if (action.kind !== expectedToolName) {
    throw new Error('Agent prepared action 与 Tool 不匹配');
  }
  const preparedActionId = crypto.randomUUID();
  const snapshotHash = hashToolInput({
    action,
    snapshotMaterial: result.snapshotMaterial ?? null,
  });
  const executionInput = result.executionInput && typeof result.executionInput === 'object'
    && !Array.isArray(result.executionInput)
    ? { ...(result.executionInput as Record<string, unknown>), preparedActionId, snapshotHash }
    : result.executionInput;
  return {
    action,
    executionInput,
    permissionBehavior: result.decision.behavior,
    preparedActionId,
    preview: normalizeActionPreview(
      result.decision.behavior === 'ask'
        ? result.decision.preview
        : {
            description: '执行已经准备完成',
            risk: result.decision.risk,
            title: '执行操作',
          },
    ),
    snapshotHash,
  };
}

function getActivatedSkillId(result: AgentToolResult): string | undefined {
  if (!result.ok || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return undefined;
  }
  const skillId = String((result.data as Record<string, unknown>).skillId || '').trim();
  return skillId || undefined;
}

function sameOwnerScope(left: AgentOwnerScope, right: AgentOwnerScope): boolean {
  return left.accountScope === right.accountScope && left.backendScope === right.backendScope;
}

function abortError(message = 'Agent 任务已取消'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function createAgentOrchestrator(options: AgentOrchestratorOptions = {}) {
  const resolveRuntimeProfile = options.getRuntimeProfile || getAIServiceRuntimeProfile;
  const resolveMemoryStore = options.getMemoryStore || (
    options.getSessionStore
      ? async (): Promise<AgentMemoryStore> => {
          throw new Error('测试运行时未配置长期记忆 Store');
        }
      : async () => (await getAgentPersistenceRuntime()).memoryStore
  );
  const resolveSessionStore = options.getSessionStore
    || (async () => (await getAgentPersistenceRuntime()).sessionStore);
  const retrieveMemories = options.retrieveMemories || (
    options.getSessionStore && !options.getMemoryStore
      ? async () => []
      : async (input: AgentMemoryRetrievalInput) => (
          createStructuredAgentMemoryRetriever(await resolveMemoryStore()).retrieve(input)
        )
  );
  const runSessionRegistry = options.runSessionRegistry || aiServiceRunSessionRegistry;
  const inspectMediaSource = options.inspectMediaSource || inspectAgentMediaSource;
  const extractMediaAudioSource = options.extractMediaAudio || extractAgentMediaAudio;
  const mediaArtifactStore = options.mediaArtifactStore || agentMediaArtifactStore;
  const saveMediaArtifactAs = options.saveMediaArtifactAs || saveAgentMediaArtifactAs;
  const resolveCapabilitySnapshot = options.resolveCapabilitySnapshot
    || createBuiltInAgentCapabilitySnapshot;
  const contextManager = options.contextManager || createAgentContextManager({
    budget: options.contextBudget,
  });
  const approvalTimeoutMs = Math.max(1, options.approvalTimeoutMs || TOOL_APPROVAL_TIMEOUT_MS);
  const interactionTimeoutMs = Math.max(
    1,
    options.interactionTimeoutMs || TOOL_INTERACTION_TIMEOUT_MS,
  );
  const toolBroker = options.toolBroker || createAgentToolBroker({ normalizePerception });
  const toolPrepareBroker = options.toolPrepareBroker || createAgentToolPrepareBroker();
  const activeRuns = new Map<string, ActiveAgentRun>();
  const startingRuns = new Map<string, StartingAgentRun>();
  const startingSessions = new Set<string>();
  const pendingApprovals = new Map<string, PendingAgentApproval>();
  const pendingInteractions = new Map<string, PendingAgentInteraction>();
  const activeMediaArtifactSaves = new Set<ActiveMediaArtifactSave>();
  let shuttingDown = false;

  async function waitForMediaArtifactSaves(predicate: (
    save: ActiveMediaArtifactSave,
  ) => boolean): Promise<void> {
    const tasks = Array.from(activeMediaArtifactSaves)
      .filter(predicate)
      .map(save => save.task);
    if (tasks.length > 0) await Promise.allSettled(tasks);
  }

  function emit(sender: WebContents, event: AgentChatStreamEvent): void {
    if (!sender.isDestroyed()) {
      sender.send('agent:chat:event', projectAgentChatStreamEventForRenderer(event));
    }
  }

  async function updateRunAndEmit(
    sender: WebContents,
    store: AgentSessionStore,
    sessionId: string,
    runId: string,
    update: AgentRunUpdate,
  ): Promise<AgentRunSnapshot> {
    const runSnapshot = await store.updateRun(runId, update);
    emit(sender, {
      run: runSnapshot,
      runId,
      sessionId,
      type: 'run-updated',
    });
    return runSnapshot;
  }

  function waitForApproval(input: {
    appContext: AgentAppContext;
    approval: AgentToolApprovalSnapshot;
    executor: AgentToolExecutor;
    executionInput: unknown;
    ownerScope: AgentOwnerScope;
    ownerWebContentsId: number;
    sender: WebContents;
    onProgress: (progress: AgentToolProgress) => void;
    onCancel: (executionId: string) => void;
    signal: AbortSignal;
    store: AgentSessionStore;
    timeoutMs: number;
    prepared?: PendingAgentApproval['prepared'];
  }): Promise<AgentApprovalOutcome> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const takeSettlement = () => {
        if (settled) return false;
        settled = true;
        cleanup();
        return true;
      };
      const handleAbort = () => {
        if (!takeSettlement()) return;
        void input.store.resolveToolApproval(
          input.approval.approvalId,
          'cancelled',
          now(),
        ).catch(() => undefined).finally(() => reject(abortError()));
      };
      let timer: ReturnType<typeof setTimeout>;
      const handleTimeout = () => {
        const pending = pendingApprovals.get(input.approval.approvalId);
        if (pending?.resolving) {
          timer = setTimeout(handleTimeout, 1_000);
          timer.unref?.();
          return;
        }
        if (!takeSettlement()) return;
        void input.store.resolveToolApproval(
          input.approval.approvalId,
          'expired',
          now(),
        ).catch(() => undefined).finally(() => reject(new Error('用户确认已超时')));
      };
      timer = setTimeout(handleTimeout, approvalTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        input.signal.removeEventListener('abort', handleAbort);
        pendingApprovals.delete(input.approval.approvalId);
      };
      pendingApprovals.set(input.approval.approvalId, {
        ...input,
        resolving: false,
        resolve: (outcome) => {
          if (takeSettlement()) resolve(outcome);
        },
      });
      if (input.signal.aborted) handleAbort();
      else input.signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  async function resolveToolApproval(
    ownerWebContentsId: number,
    input: AgentToolApprovalDecisionRequest,
  ): Promise<AgentToolApprovalDecisionResult> {
    const approvalId = String(input?.approvalId || '').trim();
    const pending = pendingApprovals.get(approvalId);
    if (!pending) throw new Error('Agent 确认请求不存在或已经失效');
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      pending.ownerWebContentsId !== ownerWebContentsId
      || pending.approval.runId !== String(input.runId || '')
      || pending.approval.sessionId !== String(input.sessionId || '')
      || Number(pending.appContext.libraryId) !== Number(input.libraryId)
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权处理该 Agent 确认请求');
    }
    if (pending.signal.aborted) throw abortError();
    if (pending.resolving) throw new Error('Agent 确认请求正在处理');
    pending.resolving = true;

    try {
      const approved = input.approved === true;
      let finalized: AgentPreparedRuntime | undefined;
      let preparedResolution: Parameters<AgentSessionStore['resolveToolApproval']>[3];
      if (approved && pending.prepared) {
        const expectedPreparedActionId = String(input.preparedActionId || '').trim();
        if (
          !expectedPreparedActionId
          || expectedPreparedActionId !== pending.prepared.current.preparedActionId
          || !input.preparedAction
        ) {
          throw new Error('Agent prepared action 已变化，请按最新确认内容重试');
        }
        const requestedAction = normalizeAgentPreparedActionPublic(input.preparedAction);
        if (requestedAction.kind !== pending.approval.call.name) {
          throw new Error('Agent prepared action 与 Tool 不匹配');
        }
        finalized = await pending.prepared.finalize(requestedAction);
        preparedResolution = {
          action: finalized.action,
          approvalInputHash: finalized.snapshotHash,
          approvalPreview: finalized.preview,
          expectedPreparedActionId,
          preparedActionId: finalized.preparedActionId,
          snapshotHash: finalized.snapshotHash,
        };
      } else if (approved && (input.preparedAction || input.preparedActionId)) {
        throw new Error('当前 Agent Tool 不接受 prepared action');
      }
      throwIfAborted(pending.signal);
      const activity = await pending.store.resolveToolApproval(
        approvalId,
        approved ? 'approved' : 'denied',
        now(),
        preparedResolution,
      );
      throwIfAborted(pending.signal);
      if (finalized && pending.prepared) {
        pending.executionInput = finalized.executionInput;
        pending.prepared.current = finalized;
        pending.approval = {
          ...pending.approval,
          preparation: {
            action: finalized.action,
            preparedActionId: finalized.preparedActionId,
            snapshotHash: finalized.snapshotHash,
          },
          preview: finalized.preview,
        };
      }
      await updateRunAndEmit(
        pending.sender,
        pending.store,
        pending.approval.sessionId,
        pending.approval.runId,
        {
          currentStep: approved ? `执行 ${pending.approval.call.name}` : '用户已取消操作',
          status: 'running',
          updatedAt: now(),
        },
      );

      if (!approved) {
        pending.resolve({ activity, approved: false });
        return { approved: false };
      }

      if (pending.executor !== 'renderer') {
        pending.resolve({ activity, approved: true });
        return { approved: true };
      }

      const execution = toolBroker.prepareRendererExecution({
        appContext: pending.appContext,
        executionInput: pending.executionInput,
        ownerScope: pending.ownerScope,
        ownerWebContentsId: pending.ownerWebContentsId,
        onProgress: pending.onProgress,
        onCancel: pending.onCancel,
        runId: pending.approval.runId,
        sessionId: pending.approval.sessionId,
        signal: pending.signal,
        timeoutMs: pending.timeoutMs,
        toolName: pending.approval.call.name,
      });
      pending.resolve({ activity, approved: true, execution: execution.outcome });
      return { approved: true, execution: execution.request };
    } finally {
      if (pendingApprovals.get(approvalId) === pending) pending.resolving = false;
    }
  }

  function waitForInteraction(input: {
    activity: AgentToolActivitySnapshot;
    appContext: AgentAppContext;
    ownerScope: AgentOwnerScope;
    ownerWebContentsId: number;
    sender: WebContents;
    signal: AbortSignal;
    store: AgentSessionStore;
  }): Promise<AgentInteractionResponse> {
    const interaction = input.activity.interaction;
    if (!interaction || interaction.status !== 'pending') {
      throw new Error('Agent Tool 未能创建有效的交互请求');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const takeSettlement = () => {
        if (settled) return false;
        settled = true;
        cleanup();
        return true;
      };
      const emitResolved = (activity: AgentToolActivitySnapshot) => {
        emit(input.sender, {
          activity,
          interactionId: interaction.interactionId,
          runId: input.activity.runId,
          sessionId: input.activity.sessionId,
          type: 'tool-interaction-resolved',
        });
      };
      const settleWithoutResponse = (
        resolution: 'cancelled' | 'expired',
        error: Error,
      ) => {
        if (!takeSettlement()) return;
        void input.store.resolveToolInteraction(
          interaction.interactionId,
          resolution,
          undefined,
          now(),
        ).then((activity) => {
          if (resolution === 'expired') {
            return updateRunAndEmit(
              input.sender,
              input.store,
              input.activity.sessionId,
              input.activity.runId,
              {
                currentStep: `继续执行 ${input.activity.call.name}`,
                status: 'running',
                updatedAt: now(),
              },
            ).then(() => activity);
          }
          return activity;
        }).then((activity) => {
          emitResolved(activity);
        }).catch(() => undefined).finally(() => reject(error));
      };
      const handleAbort = () => settleWithoutResponse('cancelled', abortError());
      const timer = setTimeout(() => {
        settleWithoutResponse('expired', new Error('用户输入已超时'));
      }, interactionTimeoutMs);
      timer.unref?.();
      const cleanup = () => {
        clearTimeout(timer);
        input.signal.removeEventListener('abort', handleAbort);
        pendingInteractions.delete(interaction.interactionId);
      };
      pendingInteractions.set(interaction.interactionId, {
        appContext: input.appContext,
        interaction,
        ownerScope: input.ownerScope,
        ownerWebContentsId: input.ownerWebContentsId,
        runId: input.activity.runId,
        sessionId: input.activity.sessionId,
        signal: input.signal,
        submit: async (response) => {
          if (!takeSettlement()) throw new Error('Agent 交互请求已经处理');
          try {
            const activity = await input.store.resolveToolInteraction(
              interaction.interactionId,
              'submitted',
              response,
              now(),
            );
            await updateRunAndEmit(
              input.sender,
              input.store,
              input.activity.sessionId,
              input.activity.runId,
              {
                currentStep: `继续执行 ${input.activity.call.name}`,
                status: 'running',
                updatedAt: now(),
              },
            );
            emitResolved(activity);
            resolve(response);
            return activity;
          } catch (error) {
            reject(error);
            throw error;
          }
        },
      });
      if (input.signal.aborted) handleAbort();
      else input.signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  async function submitInteraction(
    ownerWebContentsId: number,
    input: AgentInteractionSubmissionRequest,
  ): Promise<AgentInteractionSubmissionResult> {
    const interactionId = String(input?.interactionId || '').trim();
    const pending = pendingInteractions.get(interactionId);
    if (!pending) throw new Error('Agent 交互请求不存在或已经失效');
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      pending.ownerWebContentsId !== ownerWebContentsId
      || pending.runId !== String(input.runId || '')
      || pending.sessionId !== String(input.sessionId || '')
      || Number(pending.appContext.libraryId) !== Number(input.libraryId)
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权提交该 Agent 交互回答');
    }
    if (pending.signal.aborted) throw abortError();
    const response = normalizeAgentInteractionResponse(pending.interaction.request, input.response);
    const activity = await pending.submit(response);
    return { accepted: true, activity };
  }

  function completeToolExecution(
    ownerWebContentsId: number,
    input: AgentToolExecutionCompletion,
  ): boolean {
    return toolBroker.completeRendererExecution(ownerWebContentsId, input);
  }

  function completeToolPreparation(
    ownerWebContentsId: number,
    input: AgentToolPrepareCompletion,
  ): boolean {
    return toolPrepareBroker.completeRenderer(ownerWebContentsId, input);
  }

  function markToolExecutionCommitted(
    ownerWebContentsId: number,
    input: AgentToolExecutionCommit,
  ): boolean {
    return toolBroker.markRendererExecutionCommitted(ownerWebContentsId, input);
  }

  function reportToolExecutionProgress(
    ownerWebContentsId: number,
    input: AgentToolExecutionProgressRequest,
  ): boolean {
    const reported = toolBroker.reportRendererProgress(ownerWebContentsId, input);
    void Promise.resolve(mediaArtifactStore.touchExecution?.({
      executionId: String(input?.executionId || ''),
      ownerScope: input?.ownerScope,
      ownerWebContentsId,
      runId: String(input?.runId || ''),
      sessionId: String(input?.sessionId || ''),
    })).catch(() => undefined);
    return reported;
  }

  function normalizeMediaSourceUrl(input: unknown): string {
    const sourceUrl = String(input || '').trim();
    if (!sourceUrl || sourceUrl.length > 16 * 1024) throw new Error('媒体临时访问链接无效');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      throw new Error('媒体临时访问链接无效');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('媒体临时访问链接仅支持 HTTP(S)');
    }
    return sourceUrl;
  }

  async function inspectMedia(
    ownerWebContentsId: number,
    input: AgentMediaInspectionRequest,
  ): Promise<AgentToolResult> {
    const capability = toolBroker.claimRendererCapability(ownerWebContentsId, {
      capability: 'media.inspect.source',
      executionId: input?.executionId,
      libraryId: Number(input?.libraryId),
      ownerScope: input?.ownerScope,
      runId: input?.runId,
      sessionId: input?.sessionId,
    }, 'media.inspect');
    if (!capability.executionInput || typeof capability.executionInput !== 'object') {
      throw new Error('媒体检查执行参数无效');
    }
    const executionInput = capability.executionInput as Record<string, unknown>;
    const nodeId = Number(executionInput.nodeId);
    const fileName = String(executionInput.fileName || '').trim();
    const libraryId = Number(executionInput.libraryId);
    if (
      !Number.isFinite(nodeId)
      || nodeId <= 0
      || !fileName
      || libraryId !== Number(input.libraryId)
      || nodeId !== Number(input.nodeId)
      || fileName !== String(input.fileName || '').trim()
    ) {
      throw new Error('媒体检查目标与受权节点不匹配');
    }
    const sourceUrl = normalizeMediaSourceUrl(input.sourceUrl);
    return inspectMediaSource({
      fileName,
      ...(executionInput.mimeType ? { mimeType: String(executionInput.mimeType) } : {}),
      nodeId,
      sourceUrl,
    }, capability.signal);
  }

  async function extractMediaAudio(
    ownerWebContentsId: number,
    input: AgentMediaAudioExtractionRequest,
  ): Promise<AgentMediaAudioExtractionResult> {
    const capability = toolBroker.claimRendererCapability(ownerWebContentsId, {
      capability: 'media.extractAudio.source',
      executionId: input?.executionId,
      libraryId: Number(input?.libraryId),
      ownerScope: input?.ownerScope,
      runId: input?.runId,
      sessionId: input?.sessionId,
    }, 'media.extractAudio');
    if (!capability.executionInput || typeof capability.executionInput !== 'object') {
      throw new Error('音频提取执行参数无效');
    }
    const executionInput = capability.executionInput as Record<string, unknown>;
    const nodeId = Number(executionInput.nodeId);
    const fileName = String(executionInput.sourceFileName || '').trim();
    const outputFileName = String(executionInput.outputFileName || '').trim();
    const outputFormat = normalizeAgentAudioOutputFormat({
      format: executionInput.outputFormat,
    });
    const libraryId = Number(executionInput.libraryId);
    if (
      !Number.isFinite(nodeId)
      || nodeId <= 0
      || !fileName
      || !outputFileName
      || libraryId !== Number(input.libraryId)
      || nodeId !== Number(input.nodeId)
      || fileName !== String(input.fileName || '').trim()
      || outputFileName !== String(input.outputFileName || '').trim()
      || outputFormat !== input.outputFormat
    ) {
      throw new Error('音频提取目标与受权节点不匹配');
    }
    return extractMediaAudioSource({
      executionId: input.executionId,
      fileName,
      ...(executionInput.mimeType ? { mimeType: String(executionInput.mimeType) } : {}),
      outputFileName,
      outputFormat,
      ownerScope: normalizeAgentOwnerScope(input.ownerScope),
      ownerWebContentsId,
      runId: input.runId,
      sessionId: input.sessionId,
      sourceUrl: normalizeMediaSourceUrl(input.sourceUrl),
    }, capability.signal, capability.onProgress);
  }

  async function releaseMediaArtifact(
    ownerWebContentsId: number,
    input: AgentMediaArtifactReleaseRequest,
  ): Promise<boolean> {
    return mediaArtifactStore.release(String(input?.artifactId || ''), {
      executionId: String(input?.executionId || ''),
      ownerScope: normalizeAgentOwnerScope(input?.ownerScope),
      ownerWebContentsId,
      runId: String(input?.runId || ''),
      sessionId: String(input?.sessionId || ''),
    });
  }

  async function saveMediaArtifact(
    sender: WebContents,
    input: AgentMediaArtifactSaveRequest,
  ): Promise<AgentMediaArtifactSaveResult> {
    const purpose = input?.purpose === 'destination' || input?.purpose === 'upload_fallback'
      ? input.purpose
      : null;
    const capability = toolBroker.claimRendererCapability(sender.id, {
      capability: 'media.extractAudio.save-local',
      executionId: input?.executionId,
      libraryId: Number(input?.libraryId),
      ownerScope: input?.ownerScope,
      runId: input?.runId,
      sessionId: input?.sessionId,
    }, 'media.extractAudio');
    if (!purpose || !capability.executionInput || typeof capability.executionInput !== 'object') {
      throw new Error('本机保存执行参数无效');
    }
    const executionInput = capability.executionInput as Record<string, unknown>;
    const destination = String(executionInput.destination || '');
    const fallbackPolicy = String(executionInput.fallbackPolicy || '');
    const outputFileName = String(executionInput.outputFileName || '').trim();
    const preparedActionId = String(executionInput.preparedActionId || '').trim();
    const snapshotHash = String(executionInput.snapshotHash || '').trim();
    const purposeAllowed = purpose === 'destination'
      ? destination === 'local'
      : destination === 'library' && fallbackPolicy === 'prompt_local';
    if (
      !purposeAllowed
      || outputFileName !== String(input.defaultFileName || '').trim()
      || !preparedActionId
      || preparedActionId !== String(input.preparedActionId || '').trim()
      || !snapshotHash
      || snapshotHash !== String(input.snapshotHash || '').trim()
    ) {
      throw new Error('本机保存目标与冻结后的 Agent 动作不匹配');
    }
    const owner = {
      executionId: String(input.executionId || ''),
      ownerScope: normalizeAgentOwnerScope(input.ownerScope),
      ownerWebContentsId: sender.id,
      runId: String(input.runId || ''),
      sessionId: String(input.sessionId || ''),
    };
    if (!mediaArtifactStore.getOwned) {
      throw new Error('当前运行时不支持 Agent 本机保存');
    }
    const artifact = mediaArtifactStore.getOwned(String(input.artifactId || ''), owner);
    const task = saveMediaArtifactAs({
      artifact,
      defaultFileName: outputFileName,
      sender,
      signal: capability.signal,
    });
    const activeSave: ActiveMediaArtifactSave = {
      ownerWebContentsId: sender.id,
      runId: String(input.runId || ''),
      task,
    };
    activeMediaArtifactSaves.add(activeSave);
    try {
      return await task;
    } finally {
      activeMediaArtifactSaves.delete(activeSave);
    }
  }

  async function executeToolCall(
    sender: WebContents,
    store: AgentSessionStore,
    sessionId: string,
    runId: string,
    call: AgentProviderToolCall,
    input: AgentChatRequest,
    signal: AbortSignal,
    perception: AgentChatRequest['perception'],
    capabilitySnapshot: AgentRunCapabilitySnapshot,
    activeSkillId: string | undefined,
    onPerception: (next: AgentChatRequest['perception']) => void,
  ): Promise<AgentToolResult> {
    const tool = capabilitySnapshot.getTool(call.name, activeSkillId);
    const registeredTool = capabilitySnapshot.toolSnapshot.get(call.name);
    if (tool && !call.inputError) {
      const schemaValidation = capabilitySnapshot.validateInput(
        tool.name,
        call.input,
        activeSkillId,
        tool.registrationId,
      );
      if (!schemaValidation.ok) {
        call.input = { _omniflowAudit: 'invalid Tool input omitted' };
        return { message: schemaValidation.message, ok: false };
      }
    }
    const toolRunId = crypto.randomUUID();
    let activity: AgentToolActivitySnapshot | undefined;
    let progressWrites = Promise.resolve();
    const persistAndEmitProgress = (rawProgress: AgentToolProgress) => {
      const progress = normalizeToolProgress(rawProgress);
      progressWrites = progressWrites.then(async () => {
        const progressAt = now();
        try {
          activity = await store.updateToolRunProgress(toolRunId, progress, progressAt);
        } catch {
          if (activity) {
            activity = {
              ...activity,
              progress,
              progressUpdatedAt: progressAt,
            };
          }
        }
        try {
          emit(sender, {
            ...(activity ? { activity } : {}),
            callId: call.id,
            progress,
            runId,
            sessionId,
            type: 'tool-progress',
          });
        } catch {
          // Progress delivery is best-effort; the persisted ToolRun remains authoritative.
        }
      });
    };
    const executionContext: AgentToolExecutionContext = {
      activeSkillId,
      appContext: input.appContext,
      onProgress: persistAndEmitProgress,
      perception,
      runCapabilitySnapshot: capabilitySnapshot,
      saveMemoryProposal: async (
        proposal: AgentMemoryProposal,
        operationSignal: AbortSignal,
      ) => {
        const libraryId = Number(input.appContext.libraryId);
        if (proposal.scope === 'library' && (!Number.isSafeInteger(libraryId) || libraryId <= 0)) {
          throw new Error('当前没有可绑定长期记忆的资料库');
        }
        throwIfAborted(operationSignal);
        const memoryStore = await resolveMemoryStore();
        throwIfAborted(operationSignal);
        const saved = await memoryStore.create({
          id: crypto.randomUUID(),
          ...(proposal.scope === 'library' ? { libraryId } : {}),
          now: now(),
          ownerScope: input.ownerScope,
          proposal,
          sourceRunId: runId,
          sourceSessionId: sessionId,
        });
        if (!operationSignal.aborted) return saved;

        const reverted = await memoryStore.delete({
          id: saved.id,
          libraryId,
          ownerScope: input.ownerScope,
          revision: saved.revision,
        });
        if (!reverted) {
          throw new Error('Agent 已取消，但长期记忆写入无法回滚');
        }
        throwIfAborted(operationSignal);
        return saved;
      },
      requestInteraction: async (rawRequest: AgentInteractionRequest) => {
        if (!activity) throw new Error('Agent Tool 尚未建立运行记录');
        const request = normalizeAgentInteractionRequest(rawRequest);
        const interactionId = crypto.randomUUID();
        activity = await store.createToolInteraction(toolRunId, interactionId, request);
        try {
          await updateRunAndEmit(sender, store, sessionId, runId, {
            currentStep: `等待用户输入 ${call.name}`,
            status: 'awaiting_interaction',
            updatedAt: now(),
          });
        } catch (error) {
          activity = await store.resolveToolInteraction(
            interactionId,
            'cancelled',
            undefined,
            now(),
          ).catch(() => activity as AgentToolActivitySnapshot);
          throw error;
        }
        const response = waitForInteraction({
          activity,
          appContext: input.appContext,
          ownerScope: input.ownerScope,
          ownerWebContentsId: sender.id,
          sender,
          signal,
          store,
        });
        emit(sender, {
          activity,
          interactionId,
          runId,
          sessionId,
          type: 'tool-interaction-required',
        });
        return response;
      },
      signal,
    };
    const runToolRegistry = {
      execute: (
        name: string,
        toolInput: unknown,
        toolContext: AgentToolExecutionContext,
        expectedRegistrationId?: string,
      ) => capabilitySnapshot.execute(
        name,
        toolInput,
        toolContext,
        activeSkillId,
        expectedRegistrationId,
      ),
    };
    const cancelRendererExecution = (executionId: string) => emit(sender, {
      executionId,
      runId,
      sessionId,
      type: 'tool-execution-cancelled',
    });
    let omitDeniedAudit = false;
    let preflightDecision: AgentToolPermissionDecision | undefined;
    if (!call.inputError && call.name === interactionRequestTool.name) {
      try {
        call.input = normalizeAgentInteractionRequest(call.input);
      } catch (error) {
        omitDeniedAudit = isAgentSensitiveInteractionRequestError(error);
        preflightDecision = {
          behavior: 'deny',
          message: error instanceof Error ? error.message : '交互请求无效',
          risk: interactionRequestTool.risk,
        };
      }
    }
    const auditProjection = projectAgentToolAuditInput(call.input);
    if (!preflightDecision && (!auditProjection.complete || auditProjection.sensitive)) {
      omitDeniedAudit = call.name === interactionRequestTool.name && auditProjection.sensitive;
      preflightDecision = {
        behavior: 'deny',
        message: auditProjection.sensitive
          ? 'Agent Tool 参数包含不能进入会话的敏感凭据'
          : 'Agent Tool 参数超过安全审计上限',
        risk: registeredTool?.risk || 'external',
      };
    }
    const usesRendererPreparation = Boolean(
      tool?.createRendererPrepareRequest && tool.finalizeRendererPreparation,
    );
    let decision: AgentToolPermissionDecision;
    let rendererExecutionInput: unknown;
    let preparedApproval: PendingAgentApproval['prepared'];
    let approvalId: string | undefined;

    if (!preflightDecision && !call.inputError && tool && usesRendererPreparation) {
      const validation = await tool.validate?.(call.input, executionContext);
      if (validation && !validation.ok) {
        decision = {
          behavior: 'deny',
          message: validation.message,
          risk: tool.risk,
        };
      } else {
        activity = await store.createToolRun({
          callId: call.id,
          id: toolRunId,
          input: call.input,
          now: now(),
          permissionBehavior: tool.risk === 'read' ? 'allow' : 'ask',
          runId,
          status: 'preparing',
          toolKind: tool.kind,
          toolName: call.name,
        });
        emit(sender, {
          activity,
          call: { id: call.id, input: call.input, name: call.name },
          runId,
          sessionId,
          type: 'tool-started',
        });
        await updateRunAndEmit(sender, store, sessionId, runId, {
          currentStep: `准备 ${call.name}`,
          status: 'preparing',
          updatedAt: now(),
        });
        try {
          const prepareInput = tool.createRendererPrepareRequest!(call.input, executionContext);
          const preparation = toolPrepareBroker.prepareRenderer({
            appContext: input.appContext,
            callId: call.id,
            inputHash: hashToolInput(call.input),
            onCancel: prepareId => emit(sender, {
              prepareId,
              runId,
              sessionId,
              type: 'tool-prepare-cancelled',
            }),
            ownerScope: input.ownerScope,
            ownerWebContentsId: sender.id,
            prepareInput,
            runId,
            sessionId,
            signal,
            toolRunId,
            toolName: call.name,
          });
          emit(sender, {
            preparation: preparation.request,
            runId,
            sessionId,
            type: 'tool-prepare-requested',
          });
          const rendererPreparation = await preparation.outcome;
          const finalizePrepared = async (requestedAction?: AgentPreparedActionPublic) => (
            createPreparedRuntime(
              await tool.finalizeRendererPreparation!(
                call.input,
                rendererPreparation,
                requestedAction,
                executionContext,
              ),
              call.name,
            )
          );
          const prepared = await finalizePrepared();
          decision = prepared.permissionBehavior === 'ask'
            ? { behavior: 'ask', preview: prepared.preview, risk: tool.risk }
            : { behavior: 'allow', risk: tool.risk };
          rendererExecutionInput = prepared.executionInput;
          approvalId = prepared.permissionBehavior === 'ask' ? crypto.randomUUID() : undefined;
          preparedApproval = {
            current: prepared,
            finalize: finalizePrepared,
          };
          activity = await store.completeToolPreparation({
            action: prepared.action,
            approvalId: approvalId || crypto.randomUUID(),
            approvalInputHash: prepared.snapshotHash,
            approvalPreview: prepared.preview,
            id: toolRunId,
            permissionBehavior: prepared.permissionBehavior,
            preparedActionId: prepared.preparedActionId,
            snapshotHash: prepared.snapshotHash,
          });
          emit(sender, {
            activity,
            call: { id: call.id, input: call.input, name: call.name },
            runId,
            sessionId,
            type: 'tool-started',
          });
          await updateRunAndEmit(sender, store, sessionId, runId, {
            currentStep: prepared.permissionBehavior === 'ask'
              ? `等待确认 ${call.name}`
              : `执行 ${call.name}`,
            status: prepared.permissionBehavior === 'ask' ? 'awaiting_approval' : 'running',
            updatedAt: now(),
          });
        } catch (error) {
          if (isAbortError(error, signal)) {
            activity = await store.completeToolRun(
              toolRunId,
              { message: 'Agent Tool 准备已取消', ok: false },
              now(),
              'cancelled',
            );
            throw error;
          }
          decision = {
            behavior: 'deny',
            message: normalizeAgentErrorMessage(error, `${call.name} 准备失败`),
            risk: tool.risk,
          };
          await updateRunAndEmit(sender, store, sessionId, runId, {
            currentStep: `${call.name} 准备失败`,
            status: 'running',
            updatedAt: now(),
          });
        }
      }
    } else {
      decision = preflightDecision || (call.inputError
        ? {
            behavior: 'deny' as const,
            message: call.inputError,
            risk: registeredTool?.risk || 'external' as const,
          }
        : tool
          ? await assessAgentToolPermission(tool, call.input, executionContext)
          : {
              behavior: 'deny' as const,
              message: `Agent Tool 不存在：${call.name}`,
              risk: 'external' as const,
            });
      if (
        decision.behavior !== 'deny'
        && (tool?.executor || 'main') === 'renderer'
      ) {
        if (!tool?.createRendererRequest) {
          decision = {
            behavior: 'deny',
            message: `工具 ${call.name} 缺少 Renderer 执行契约`,
            risk: registeredTool?.risk || 'write',
          };
        } else {
          try {
            rendererExecutionInput = tool.createRendererRequest(call.input, executionContext);
          } catch (error) {
            decision = {
              behavior: 'deny',
              message: error instanceof Error ? error.message : `${call.name} 执行参数无效`,
              risk: tool.risk,
            };
          }
        }
      }
    }
    if (decision.behavior === 'ask') {
      decision = {
        ...decision,
        preview: normalizeActionPreview(decision.preview),
      };
    }
    if (decision.behavior === 'deny') {
      const message = sanitizeAgentSensitiveText(String(decision.message || '')).slice(0, 2_000)
        || 'Agent Tool 请求已拒绝';
      decision = { ...decision, message };
      call.input = omitDeniedAudit
        ? { _omniflowAudit: 'sensitive interaction request omitted' }
        : auditProjection.input;
      if (omitDeniedAudit) {
        return { message, ok: false };
      }
    }
    if (!activity) {
      approvalId = decision.behavior === 'ask' ? crypto.randomUUID() : undefined;
      activity = await store.createToolRun({
        ...(approvalId ? { approvalId } : {}),
        ...(decision.behavior === 'ask'
          ? {
              approvalInputHash: hashToolInput(call.input),
              approvalPreview: decision.preview,
            }
          : {}),
        callId: call.id,
        id: toolRunId,
        input: call.input,
        now: now(),
        permissionBehavior: decision.behavior,
        runId,
        status: decision.behavior === 'ask' ? 'awaiting_approval' : 'running',
        toolKind: tool?.kind || registeredTool?.kind || 'business',
        toolName: call.name,
      });
      emit(sender, {
        activity,
        call: { id: call.id, input: call.input, name: call.name },
        runId,
        sessionId,
        type: 'tool-started',
      });
      await updateRunAndEmit(sender, store, sessionId, runId, {
        currentStep: decision.behavior === 'ask'
          ? `等待确认 ${call.name}`
          : `执行 ${call.name}`,
        status: decision.behavior === 'ask' ? 'awaiting_approval' : 'running',
        updatedAt: now(),
      });
    }

    let result: AgentToolResult;
    try {
      if (decision.behavior === 'deny') {
        result = { message: decision.message, ok: false };
      } else if (!tool) {
        result = { message: `Agent Tool 不存在：${call.name}`, ok: false };
      } else if (decision.behavior === 'ask' && approvalId) {
        const approval: AgentToolApprovalSnapshot = {
          approvalId,
          call: { id: call.id, input: call.input, name: call.name },
          ...(preparedApproval
            ? {
                preparation: {
                  action: preparedApproval.current.action,
                  preparedActionId: preparedApproval.current.preparedActionId,
                  snapshotHash: preparedApproval.current.snapshotHash,
                },
              }
            : {}),
          preview: decision.preview,
          runId,
          sessionId,
        };
        const approvalResult = waitForApproval({
          appContext: input.appContext,
          approval,
          executor: tool.executor || 'main',
          executionInput: rendererExecutionInput,
          ownerScope: input.ownerScope,
          ownerWebContentsId: sender.id,
          sender,
          onProgress: executionContext.onProgress,
          onCancel: cancelRendererExecution,
          signal,
          store,
          timeoutMs: Math.max(1_000, tool.timeoutMs || 30_000),
          ...(preparedApproval ? { prepared: preparedApproval } : {}),
        });
        emit(sender, {
          activity,
          approval,
          runId,
          sessionId,
          type: 'tool-approval-required',
        });
        const approved = await approvalResult;
        activity = approved.activity;
        emit(sender, {
          activity,
          approvalId,
          approved: approved.approved,
          runId,
          sessionId,
          type: 'tool-approval-resolved',
        });
        if (!approved.approved) {
          result = { message: `用户取消了 ${decision.preview.title}`, ok: false };
        } else if ((tool.executor || 'main') === 'renderer') {
          if (!approved.execution) throw new Error(`工具 ${call.name} 缺少 Renderer 执行请求`);
          const outcome = await approved.execution;
          if (outcome.perception) onPerception(outcome.perception);
          result = outcome.result;
        } else {
          result = await toolBroker.executeMain(call.name, call.input, {
            ...executionContext,
            perception,
          }, tool.timeoutMs, runToolRegistry);
        }
      } else if ((tool.executor || 'main') === 'renderer') {
        const execution = toolBroker.prepareRendererExecution({
          appContext: input.appContext,
          executionInput: rendererExecutionInput,
          ownerScope: input.ownerScope,
          ownerWebContentsId: sender.id,
          onProgress: executionContext.onProgress,
          onCancel: cancelRendererExecution,
          runId,
          sessionId,
          signal,
          timeoutMs: Math.max(1_000, tool.timeoutMs || 30_000),
          toolName: call.name,
        });
        emit(sender, {
          execution: execution.request,
          runId,
          sessionId,
          type: 'tool-execution-requested',
        });
        const outcome = await execution.outcome;
        if (outcome.perception) onPerception(outcome.perception);
        result = outcome.result;
      } else {
        result = await toolBroker.executeMain(
          call.name,
          call.input,
          executionContext,
          tool.timeoutMs,
          runToolRegistry,
        );
      }
    } catch (error) {
      if (isAbortError(error, signal)) {
        await progressWrites;
        activity = await store.completeToolRun(
          toolRunId,
          { message: 'Agent Tool 已取消', ok: false },
          now(),
          'cancelled',
        );
        throw error;
      }
      result = {
        message: normalizeAgentErrorMessage(error, `${call.name} 执行失败`),
        ok: false,
      };
    }

    result = normalizeAgentToolResult(result);
    await progressWrites;
    activity = await store.completeToolRun(toolRunId, result, now());
    await store.appendMessage(createMessage(
      sessionId,
      runId,
      'tool',
      result.message || (result.ok ? `${call.name} 已完成` : `${call.name} 执行失败`),
      { callId: call.id, name: call.name },
    ));
    emit(sender, {
      activity,
      call: { id: call.id, input: call.input, name: call.name },
      result,
      runId,
      sessionId,
      type: 'tool-completed',
    });
    return result;
  }

  async function executePlanControlCall(
    sender: WebContents,
    store: AgentSessionStore,
    sessionId: string,
    runId: string,
    call: AgentProviderToolCall,
    availableToolNames: ReadonlySet<string>,
  ): Promise<AgentToolResult> {
    if (call.inputError) return { message: call.inputError, ok: false };
    try {
      const createdAt = now();
      const plan = normalizeAgentRunPlan(
        call.input,
        availableToolNames,
        createdAt,
      );
      const runSnapshot = await store.setRunPlan(runId, plan);
      emit(sender, {
        run: runSnapshot,
        runId,
        sessionId,
        type: 'run-updated',
      });
      return {
        data: plan,
        message: `已记录 ${plan.steps.length} 个计划步骤`,
        ok: true,
      };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : 'Agent 计划无效',
        ok: false,
      };
    }
  }

  async function run(
    sender: WebContents,
    store: AgentSessionStore,
    session: AgentSessionSnapshot,
    runId: string,
    input: AgentChatRequest,
    runtimeConnection: AIServiceRuntimeConnection,
    controller: AbortController,
    contextBudget: AgentContextBudget,
    recalledMemories: AgentMemoryItem[],
    capabilitySnapshot: AgentRunCapabilitySnapshot,
  ): Promise<void> {
    const sessionId = session.id;
    let content = '';
    let persistedContentLength = 0;
    const persistPendingAssistantContent = async () => {
      const pendingContent = content.slice(persistedContentLength);
      if (!pendingContent) return;
      await store.appendMessage(createMessage(sessionId, runId, 'assistant', pendingContent));
      persistedContentLength = content.length;
    };
    const appendAndEmitAssistantDelta = (delta: string) => {
      content = appendBoundedAIServiceStreamText(
        content,
        delta,
        MAX_ASSISTANT_RUN_CHARACTERS,
        'Agent 单次运行回答',
      );
      emit(sender, { delta, runId, sessionId, type: 'delta' });
    };
    const readCanonicalRunProjection = async (): Promise<{
      messages?: AgentMessage[];
      run?: AgentRunSnapshot;
      toolActivities?: AgentToolActivitySnapshot[];
    }> => {
      try {
        const snapshot = await store.getSession(
          sessionId,
          input.ownerScope,
          Number(input.appContext.libraryId),
        );
        if (!snapshot) return {};
        const runSnapshot = snapshot.runs.find(item => item.id === runId);
        return {
          messages: snapshot.messages.filter(message => message.runId === runId),
          ...(runSnapshot ? { run: runSnapshot } : {}),
          toolActivities: snapshot.toolActivities.filter(item => item.runId === runId),
        };
      } catch {
        return {};
      }
    };
    try {
      const skillSummaries = capabilitySnapshot.skillSnapshot.listSummaries();
      const omittedSkillCount = capabilitySnapshot.skillSnapshot.omittedSkillCount;
      const getProviderCapabilityView = (activeSkillId?: string) => {
        const visibleTools = capabilitySnapshot.listTools(activeSkillId);
        return {
          availableBusinessToolNames: new Set(
            capabilitySnapshot.listBusinessTools(activeSkillId).map(tool => tool.name),
          ),
          capabilities: visibleTools.map(tool => tool.name),
          providerTools: [agentPlanControlTool, ...visibleTools],
        };
      };
      const initialCapabilityView = getProviderCapabilityView();
      const initialSystemPrompt = buildAgentSystemPrompt(
        input.appContext,
        input.perception,
        initialCapabilityView.capabilities,
        skillSummaries,
        omittedSkillCount,
      );
      const initialFallbackSystemPrompt = buildAgentFallbackSystemPrompt(
        input.appContext,
        input.perception,
      );
      const fallbackContextMessages = buildAgentFallbackContextMessages(input.perception);
      const fixedInputTokens = Math.max(
        estimateAgentFixedInputTokens(
          [initialSystemPrompt],
          initialCapabilityView.providerTools,
        ),
        estimateAgentFixedInputTokens([initialFallbackSystemPrompt], [])
          + estimateAgentProviderMessagesTokens(fallbackContextMessages),
      );
      const contextProjection = await contextManager.prepare({
        budget: contextBudget,
        fixedInputTokens,
        libraryId: Number(input.appContext.libraryId),
        messages: session.messages,
        model: input.model,
        ownerScope: input.ownerScope,
        profileId: input.profileId,
        runs: session.runs,
        runtimeConnection,
        sessionId,
        signal: controller.signal,
        store,
        toolActivities: session.toolActivities,
      });
      const memoryContextMessages = buildAgentMemoryContextMessagesWithinBudget(
        recalledMemories,
        contextProjection.historyBudgetTokens - contextProjection.estimatedHistoryTokens,
      );
      const messages: AgentProviderMessage[] = [
        ...memoryContextMessages,
        ...contextProjection.messages,
      ];
      const plainMessages = messages.map(message => ({
        content: message.content,
        role: message.role as 'user' | 'assistant',
      }));
      let toolCallCount = 0;
      let completed = false;
      let currentPerception = input.perception;
      let activeSkillId: string | undefined;
      const seenToolCallIds = new Set<string>();

      for (let round = 0; round < MAX_PROVIDER_TURNS; round += 1) {
        const roundCapabilityView = getProviderCapabilityView(activeSkillId);
        await updateRunAndEmit(sender, store, sessionId, runId, {
          currentStep: round === 0 ? '请求 AI 服务' : '根据工具结果继续思考',
          status: 'running',
          updatedAt: now(),
        });
        const contentBeforeTurn = content;
        let turn;
        try {
          const systemPrompt = buildAgentSystemPrompt(
            input.appContext,
            currentPerception,
            roundCapabilityView.capabilities,
            skillSummaries,
            omittedSkillCount,
          );
          const providerTurnInput = {
            maxOutputTokens: contextBudget.outputReserveTokens,
            messages,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            systemPrompt,
            tools: roundCapabilityView.providerTools,
          };
          assertAgentProviderTurnFitsContext(
            providerTurnInput,
            contextBudget,
            round === 0 ? '当前 Agent 请求' : `Agent 第 ${round + 1} 轮工具续接请求`,
          );
          turn = await streamAgentProviderTurn(runtimeConnection, providerTurnInput, (delta) => {
            appendAndEmitAssistantDelta(delta);
          }, controller.signal, {
            maxAssistantContentCharacters: Math.min(
              MAX_ASSISTANT_TURN_CHARACTERS,
              contextBudget.outputReserveTokens * 4,
            ),
          });
        } catch (error) {
          if (round !== 0 || content !== contentBeforeTurn || !isToolProtocolUnsupported(error)) {
            throw error;
          }
          const fallbackInput = {
            maxOutputTokens: contextBudget.outputReserveTokens,
            messages: [...fallbackContextMessages, ...plainMessages],
            model: input.model,
            profileId: input.profileId,
            reasoningEffort: input.reasoningEffort,
            systemPrompt: buildAgentFallbackSystemPrompt(input.appContext, currentPerception),
          };
          assertAgentProviderTurnFitsContext(
            { ...fallbackInput, tools: [] },
            contextBudget,
            '当前 Agent 兼容模式请求',
          );
          await streamAIServiceProfile(fallbackInput, (delta) => {
            appendAndEmitAssistantDelta(delta);
          }, runtimeConnection, controller.signal, {
            maxContentCharacters: Math.min(
              MAX_ASSISTANT_TURN_CHARACTERS,
              contextBudget.outputReserveTokens * 4,
            ),
          });
          completed = true;
          break;
        }

        const toolCalls = turn.toolCalls.map((call, callIndex) => {
          let id = call.id || `tool-call-${round + 1}-${callIndex + 1}`;
          if (seenToolCallIds.has(id)) id = `${id}-${round + 1}-${callIndex + 1}`;
          seenToolCallIds.add(id);
          return { ...call, id };
        });
        messages.push({
          content: turn.content,
          role: 'assistant',
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        });
        if (toolCalls.length === 0) {
          completed = true;
          break;
        }
        await persistPendingAssistantContent();
        if (round === MAX_PROVIDER_TURNS - 1) {
          throw new Error('Agent Provider 轮数超过安全上限');
        }
        const activationCalls = toolCalls.filter(
          call => call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME,
        );
        if (activationCalls.length > 0 && toolCalls.length !== 1) {
          const rejection = projectAgentToolResultForProvider({
            message: 'skill.activate 必须独占一次 Tool 调用；本轮所有 Tool 均未执行，请下一轮只调用 skill.activate',
            ok: false,
          }, MAX_PROVIDER_TOOL_RESULT_TOKENS);
          const rejectedToolMessages: AgentProviderMessage[] = toolCalls.map(call => ({
            content: rejection.content,
            name: call.name,
            role: 'tool',
            toolCallId: call.id,
          }));
          assertAgentProviderTurnFitsContext({
            messages: [...messages, ...rejectedToolMessages],
            systemPrompt: buildAgentSystemPrompt(
              input.appContext,
              currentPerception,
              roundCapabilityView.capabilities,
              skillSummaries,
              omittedSkillCount,
            ),
            tools: roundCapabilityView.providerTools,
          }, contextBudget, 'Agent Skill 激活协议拒绝续接请求');
          messages.push(...rejectedToolMessages);
          continue;
        }
        const businessToolCallsInRound = toolCalls.filter(
          call => call.name !== AGENT_PLAN_CONTROL_TOOL_NAME
            && capabilitySnapshot.getToolKind(call.name) !== 'control',
        ).length;
        if (toolCallCount + businessToolCallsInRound > MAX_TOOL_CALLS) {
          throw new Error('Agent 工具调用次数超过安全上限；本轮未执行工具');
        }

        let expectedExclusiveActivationResult: AgentToolResult | undefined;
        let minimumContinuationCapabilityView = roundCapabilityView;
        const exclusiveActivationCall = toolCalls.length === 1
          && toolCalls[0].name === AGENT_SKILL_ACTIVATE_TOOL_NAME
          ? toolCalls[0]
          : undefined;
        if (exclusiveActivationCall && !exclusiveActivationCall.inputError) {
          const activationTool = capabilitySnapshot.getTool(
            exclusiveActivationCall.name,
            activeSkillId,
          );
          const activationInputValidation = activationTool
            ? capabilitySnapshot.validateInput(
                exclusiveActivationCall.name,
                exclusiveActivationCall.input,
                activeSkillId,
                activationTool.registrationId,
              )
            : { ok: false as const };
          if (activationInputValidation.ok) {
            expectedExclusiveActivationResult = resolveAgentSkillActivationResult(
              exclusiveActivationCall.input,
              {
                activeSkillId,
                runCapabilitySnapshot: capabilitySnapshot,
              },
            );
            const expectedActivatedSkillId = getActivatedSkillId(
              expectedExclusiveActivationResult,
            );
            minimumContinuationCapabilityView = getProviderCapabilityView(
              expectedActivatedSkillId || activeSkillId,
            );
          }
        }

        const minimumToolResultMessages: AgentProviderMessage[] = toolCalls.map(call => ({
          content: MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
          name: call.name,
          role: 'tool',
          toolCallId: call.id,
        }));
        const minimumContinuationTokens = estimateContinuationTokensBeforeSideEffects({
          appContext: input.appContext,
          capabilities: minimumContinuationCapabilityView.capabilities,
          currentPerception,
          messages: [...messages, ...minimumToolResultMessages],
          omittedSkillCount,
          skillSummaries,
          tools: minimumContinuationCapabilityView.providerTools,
        });
        const providerRequestLimit = getAgentProviderRequestTokenLimit(contextBudget);
        if (minimumContinuationTokens > providerRequestLimit) {
          throw new Error(
            `Agent 工具调用已占满模型上下文：完整续接协议预计至少 ${minimumContinuationTokens} token，`
            + `当前最多可使用 ${providerRequestLimit} token；本轮未执行工具`,
          );
        }

        for (const [callIndex, call] of toolCalls.entries()) {
          const futureMinimumResultMessages = minimumToolResultMessages.slice(callIndex + 1);
          const currentMinimumResultMessage = minimumToolResultMessages[callIndex];
          const preExecutionMinimumTokens = estimateContinuationTokensBeforeSideEffects({
            appContext: input.appContext,
            capabilities: minimumContinuationCapabilityView.capabilities,
            currentPerception,
            messages: [
              ...messages,
              currentMinimumResultMessage,
              ...futureMinimumResultMessages,
            ],
            omittedSkillCount,
            skillSummaries,
            tools: minimumContinuationCapabilityView.providerTools,
          });
          if (preExecutionMinimumTokens > providerRequestLimit) {
            throw new Error(
              `Agent Tool 结果没有足够的模型上下文预算：完整续接协议至少需要 `
              + `${preExecutionMinimumTokens} token，当前最多可使用 `
              + `${providerRequestLimit} token；当前工具未执行`,
            );
          }
          const expectedActivationResult = call === exclusiveActivationCall
            ? expectedExclusiveActivationResult
            : undefined;
          if (expectedActivationResult) {
            const expectedCapabilityView = minimumContinuationCapabilityView;
            const requestWithEmptyActivationResultTokens = estimateAgentProviderTurnTokens({
              messages: [
                ...messages,
                {
                  content: '',
                  name: call.name,
                  role: 'tool',
                  toolCallId: call.id,
                },
              ],
              systemPrompt: buildAgentSystemPrompt(
                input.appContext,
                currentPerception,
                expectedCapabilityView.capabilities,
                skillSummaries,
                omittedSkillCount,
              ),
              tools: expectedCapabilityView.providerTools,
            });
            const exactActivationResultBudget = Math.min(
              MAX_PROVIDER_TOOL_RESULT_TOKENS,
              providerRequestLimit
                - requestWithEmptyActivationResultTokens
                + estimateAgentTextTokens(''),
            );
            if (exactActivationResultBudget < MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS) {
              throw new Error(
                `Agent Skill 完整说明没有足够的模型上下文预算；当前 Skill 未激活`,
              );
            }
            const expectedProjection = projectAgentToolResultForProvider(
              expectedActivationResult,
              exactActivationResultBudget,
            );
            if (expectedProjection.truncated) {
              throw new Error(
                `Agent Skill 完整说明无法放入当前模型上下文；当前 Skill 未激活`,
              );
            }
          }

          const result = call.name === AGENT_PLAN_CONTROL_TOOL_NAME
            ? await executePlanControlCall(
                sender,
                store,
                sessionId,
                runId,
                call,
                roundCapabilityView.availableBusinessToolNames,
              )
            : await (async () => {
                if (capabilitySnapshot.getToolKind(call.name) !== 'control') {
                  toolCallCount += 1;
                  if (toolCallCount > MAX_TOOL_CALLS) {
                    throw new Error('Agent 工具调用次数超过安全上限');
                  }
                }
                return executeToolCall(
                  sender,
                  store,
                  sessionId,
                  runId,
                  call,
                  input,
                  controller.signal,
                  currentPerception,
                  capabilitySnapshot,
                  activeSkillId,
                  (nextPerception) => {
                    currentPerception = nextPerception;
                  },
                );
              })();
          if (expectedActivationResult) {
            if (stableJson(result) !== stableJson(expectedActivationResult)) {
              throw new Error('Agent Skill 激活结果与预检不一致；当前 Skill 未激活');
            }
            const activatedSkillId = getActivatedSkillId(result);
            if (activatedSkillId) activeSkillId = activatedSkillId;
          }
          const continuationCapabilityView = getProviderCapabilityView(activeSkillId);
          const currentSystemPrompt = buildAgentSystemPrompt(
            input.appContext,
            currentPerception,
            continuationCapabilityView.capabilities,
            skillSummaries,
            omittedSkillCount,
          );
          const emptyCurrentResultMessage: AgentProviderMessage = {
            content: '',
            name: call.name,
            role: 'tool',
            toolCallId: call.id,
          };
          const requestWithEmptyCurrentResultTokens = estimateAgentProviderTurnTokens({
            messages: [
              ...messages,
              emptyCurrentResultMessage,
              ...futureMinimumResultMessages,
            ],
            systemPrompt: currentSystemPrompt,
            tools: continuationCapabilityView.providerTools,
          });
          const resultTokenBudget = Math.min(
            MAX_PROVIDER_TOOL_RESULT_TOKENS,
            providerRequestLimit
              - requestWithEmptyCurrentResultTokens
              + estimateAgentTextTokens(''),
          );
          if (resultTokenBudget < MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS) {
            throw new Error(
              `Agent Tool 结果没有足够的模型上下文预算：至少需要 `
              + `${MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS} token，当前仅剩 `
              + `${Math.max(0, resultTokenBudget)} token`,
            );
          }
          const projectedResult = projectAgentToolResultForProvider(result, resultTokenBudget);
          if (call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME && projectedResult.truncated) {
            throw new Error('Agent Skill 完整说明在 Provider 投影中被截断；已停止当前 Run');
          }
          messages.push({
            content: projectedResult.content,
            name: call.name,
            role: 'tool',
            toolCallId: call.id,
          });
        }
      }

      if (!completed) throw new Error('Agent 未能在安全轮数内完成任务');
      await persistPendingAssistantContent();
      const finishedAt = now();
      await updateRunAndEmit(sender, store, sessionId, runId, {
        currentStep: '已完成',
        finishedAt,
        status: 'completed',
        updatedAt: finishedAt,
      });
      emit(sender, {
        content,
        ...await readCanonicalRunProjection(),
        runId,
        sessionId,
        type: 'completed',
      });
    } catch (error) {
      const finishedAt = now();
      if (isAbortError(error, controller.signal)) {
        await persistPendingAssistantContent();
        await updateRunAndEmit(sender, store, sessionId, runId, {
          currentStep: '已取消',
          finishedAt,
          status: 'cancelled',
          updatedAt: finishedAt,
        });
        emit(sender, {
          content,
          ...await readCanonicalRunProjection(),
          runId,
          sessionId,
          type: 'cancelled',
        });
      } else {
        const message = normalizeAgentErrorMessage(error, 'Agent 请求失败');
        await persistPendingAssistantContent();
        await updateRunAndEmit(sender, store, sessionId, runId, {
          currentStep: '执行失败',
          error: message,
          finishedAt,
          status: 'failed',
          updatedAt: finishedAt,
        });
        emit(sender, {
          content,
          message,
          ...await readCanonicalRunProjection(),
          runId,
          sessionId,
          type: 'error',
        });
      }
    } finally {
      await waitForMediaArtifactSaves(save => save.runId === runId);
      await mediaArtifactStore.releaseRun(runId).catch(() => undefined);
      const active = activeRuns.get(sessionId);
      if (active?.runId === runId) activeRuns.delete(sessionId);
      runSessionRegistry.end(runId, sender.id);
    }
  }

  async function start(sender: WebContents, input: AgentChatRequest): Promise<AgentChatStartResult> {
    if (shuttingDown) throw new Error('Agent 正在退出，暂时不能开始新任务');
    const userPrompt = String(input?.userPrompt || '').trim();
    const profileId = String(input?.profileId || '').trim();
    const model = String(input?.model || '').trim();
    const reasoningEffort = normalizeReasoningEffort(input?.reasoningEffort);
    if (!userPrompt) throw new Error('请求内容不能为空');
    if (userPrompt.length > 100_000) throw new Error('请求内容过长');
    if (containsAgentSensitiveData(userPrompt)) {
      throw new Error('请求中包含 API Key、密码、Cookie、令牌、私钥或其他凭据，请改用对应配置页面管理');
    }
    if (!profileId) throw new Error('请先启用 AI 服务配置');
    if (profileId.length > MAX_AGENT_PROFILE_ID_CHARACTERS) {
      throw new Error('AI 服务配置 ID 过长');
    }
    if (!model) throw new Error('请先选择模型');
    if (model.length > MAX_AGENT_MODEL_CHARACTERS) throw new Error('模型名称过长');

    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    const context = normalizeContext(input.appContext);
    const libraryId = Number(context.libraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      throw new Error('当前 Agent 缺少有效的资料库上下文');
    }
    const perception = normalizePerception(input.perception);
    const requestedSessionId = String(input?.sessionId || '').trim();
    if (requestedSessionId.length > MAX_AGENT_SESSION_ID_CHARACTERS) {
      throw new Error('Agent 会话 ID 过长');
    }
    if (requestedSessionId && (
      activeRuns.has(requestedSessionId)
      || startingSessions.has(requestedSessionId)
    )) {
      throw new Error('Agent 正在处理上一条消息');
    }

    if (requestedSessionId) startingSessions.add(requestedSessionId);
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    startingRuns.set(runId, {
      controller,
      ownerWebContentsId: sender.id,
    });
    let runSessionStarted = false;
    let createdSession = false;
    let runCreated = false;
    let store: AgentSessionStore | null = null;
    let session: AgentSessionSnapshot | null = null;
    try {
      const runtimeConnection = { ...resolveRuntimeProfile(profileId) };
      const contextBudget = resolveAgentContextBudget({
        ...options.contextBudget,
        ...options.resolveContextBudget?.({
          model,
          providerType: runtimeConnection.providerType,
        }),
      });
      resolveAIServiceOutputTokenLimit(contextBudget.outputReserveTokens);
      const toolSnapshot = agentToolRegistry.createSnapshot();
      const skillSnapshot = builtInAgentSkillRegistry.createRunSnapshot();
      const capabilityIds = Array.from(new Set(toolSnapshot.tools.flatMap(tool => [
        ...tool.availability.requiredCapabilities,
        ...tool.availability.optionalCapabilities,
      ])));
      const environmentCapabilitySnapshot = await resolveCapabilitySnapshot({
        capabilityIds,
        libraryId,
        ownerScope,
        signal: controller.signal,
      });
      throwIfAborted(controller.signal);
      const capabilitySnapshot = createAgentRunCapabilitySnapshot({
        capabilitySnapshot: environmentCapabilitySnapshot,
        skillSnapshot,
        toolSnapshot,
      });
      const recalledMemories = await retrieveMemories({
        libraryId,
        ownerScope,
        query: userPrompt,
      }).catch(() => []);
      const preflightVisibleTools = capabilitySnapshot.listTools();
      const preflightTools = [agentPlanControlTool, ...preflightVisibleTools];
      const preflightSkillSummaries = capabilitySnapshot.skillSnapshot.listSummaries();
      const preflightOmittedSkillCount = capabilitySnapshot.skillSnapshot.omittedSkillCount;
      const preflightFallbackContextMessages = buildAgentFallbackContextMessages(perception);
      const preflightFixedInputTokens = Math.max(
        estimateAgentFixedInputTokens([
          buildAgentSystemPrompt(
            context,
            perception,
            preflightVisibleTools.map(tool => tool.name),
            preflightSkillSummaries,
            preflightOmittedSkillCount,
          ),
        ], preflightTools),
        estimateAgentFixedInputTokens([
          buildAgentFallbackSystemPrompt(context, perception),
        ], []) + estimateAgentProviderMessagesTokens(preflightFallbackContextMessages),
      );
      assertAgentCurrentRunFitsContext(
        [{ content: userPrompt, role: 'user' }],
        preflightFixedInputTokens,
        contextBudget,
      );
      runSessionRegistry.begin({
        connection: runtimeConnection,
        ownerWebContentsId: sender.id,
        profileId,
      }, runId);
      runSessionStarted = true;
      store = await resolveSessionStore();
      throwIfAborted(controller.signal);
      session = requestedSessionId
        ? await store.getSession(requestedSessionId, ownerScope, libraryId)
        : null;
      throwIfAborted(controller.signal);
      if (requestedSessionId && !session) {
        throw new Error('Agent 会话不存在或不属于当前资料库');
      }
      const startedAt = now();
      if (!session) {
        session = await store.createSession({
          appContext: context,
          id: crypto.randomUUID(),
          now: startedAt,
          ownerScope,
          title: sessionTitleFromPrompt(userPrompt),
        });
        createdSession = true;
      } else {
        await store.updateSessionContext(session.id, ownerScope, libraryId, context, startedAt);
      }
      throwIfAborted(controller.signal);

      const createdRun = await store.createRun({
        capabilityIdentity: capabilitySnapshot.identity,
        id: runId,
        model,
        now: startedAt,
        profileId,
        reasoningEffort,
        sessionId: session.id,
        skillCatalogRevision: capabilitySnapshot.skillRevision,
        toolCatalogRevision: capabilitySnapshot.toolRevision,
        userPrompt,
      });
      runCreated = true;
      throwIfAborted(controller.signal);
      session = await store.getSession(session.id, ownerScope, libraryId);
      if (!session) throw new Error('Agent 会话初始化失败');
      throwIfAborted(controller.signal);

      startingRuns.delete(runId);
      activeRuns.set(session.id, {
        controller,
        ownerWebContentsId: sender.id,
        runId,
      });
      emit(sender, {
        run: createdRun,
        runId,
        sessionId: session.id,
        type: 'started',
      });
      void run(sender, store, session, runId, {
        appContext: context,
        model,
        ownerScope,
        perception,
        profileId,
        reasoningEffort,
        sessionId: session.id,
        userPrompt,
      }, runtimeConnection, controller, contextBudget, recalledMemories, capabilitySnapshot);
      return { runId, sessionId: session.id };
    } catch (error) {
      if (session && store && isAbortError(error, controller.signal)) {
        if (runCreated) {
          const cancelledAt = now();
          await store.updateRun(runId, {
            currentStep: '已取消',
            finishedAt: cancelledAt,
            status: 'cancelled',
            updatedAt: cancelledAt,
          }).catch(() => undefined);
        } else if (createdSession) {
          await store.deleteSession(session.id, ownerScope, libraryId).catch(() => undefined);
        }
      }
      if (session && activeRuns.get(session.id)?.runId === runId) {
        activeRuns.delete(session.id);
      }
      if (runSessionStarted) runSessionRegistry.end(runId, sender.id);
      throw error;
    } finally {
      startingRuns.delete(runId);
      if (requestedSessionId) startingSessions.delete(requestedSessionId);
    }
  }

  function stop(sessionId: string, ownerWebContentsId: number): boolean {
    const runtime = activeRuns.get(String(sessionId || ''));
    if (!runtime) return false;
    if (runtime.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('当前窗口无权停止该 Agent 会话');
    }
    runtime.controller.abort();
    return true;
  }

  function releaseOwner(ownerWebContentsId: number): void {
    startingRuns.forEach((runtime) => {
      if (runtime.ownerWebContentsId === ownerWebContentsId) {
        runtime.controller.abort();
      }
    });
    activeRuns.forEach((runtime) => {
      if (runtime.ownerWebContentsId === ownerWebContentsId) {
        runtime.controller.abort();
      }
    });
    toolBroker.releaseOwner(ownerWebContentsId);
    toolPrepareBroker.releaseOwner(ownerWebContentsId);
    void waitForMediaArtifactSaves(save => save.ownerWebContentsId === ownerWebContentsId)
      .then(() => mediaArtifactStore.releaseOwner(ownerWebContentsId))
      .catch(() => undefined);
  }

  async function shutdown(timeoutMs = 6_000): Promise<boolean> {
    shuttingDown = true;
    const owners = new Set<number>();
    startingRuns.forEach(runtime => owners.add(runtime.ownerWebContentsId));
    activeRuns.forEach(runtime => owners.add(runtime.ownerWebContentsId));
    activeMediaArtifactSaves.forEach(save => owners.add(save.ownerWebContentsId));
    owners.forEach(releaseOwner);

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (
      startingRuns.size > 0
      || activeRuns.size > 0
      || activeMediaArtifactSaves.size > 0
    ) {
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return true;
  }

  async function listSessions(
    ownerScope: AgentOwnerScope,
    libraryId: number,
    query = '',
    cursor?: AgentSessionCursor,
  ): Promise<AgentSessionPage> {
    return (await resolveSessionStore()).listSessions(
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      query,
      cursor,
    );
  }

  async function getSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<AgentSessionSnapshot> {
    const session = await (await resolveSessionStore()).getSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
    );
    if (!session) throw new Error('Agent 会话不存在或不属于当前资料库');
    return projectAgentSessionForRenderer(session);
  }

  async function renameSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
    title: string,
  ): Promise<AgentSessionSummary> {
    return (await resolveSessionStore()).renameSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      title,
      now(),
    );
  }

  async function deleteSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<boolean> {
    if (activeRuns.has(sessionId) || startingSessions.has(sessionId)) {
      throw new Error('Agent 正在处理消息，暂时不能删除该会话');
    }
    const deleted = await (await resolveSessionStore()).deleteSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
    );
    if (!deleted) throw new Error('Agent 会话不存在或不属于当前资料库');
    return true;
  }

  async function listMemories(
    ownerScope: AgentOwnerScope,
    libraryId: number,
    query = '',
    cursor?: AgentMemoryCursor,
  ): Promise<AgentMemoryPage> {
    return (await resolveMemoryStore()).list(
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      query,
      cursor,
    );
  }

  async function updateMemory(input: AgentMemoryUpdateRequest): Promise<AgentMemoryItem> {
    return (await resolveMemoryStore()).update({
      application: input.application,
      content: input.content,
      id: input.id,
      libraryId: input.libraryId,
      now: now(),
      ownerScope: normalizeAgentOwnerScope(input.ownerScope),
      reason: input.reason,
      revision: input.revision,
      title: input.title,
    });
  }

  async function deleteMemory(input: AgentMemoryDeleteRequest): Promise<boolean> {
    const deleted = await (await resolveMemoryStore()).delete({
      id: input.id,
      libraryId: input.libraryId,
      ownerScope: normalizeAgentOwnerScope(input.ownerScope),
      revision: input.revision,
    });
    if (!deleted) throw new Error('长期记忆已被修改、删除或不属于当前资料库');
    return true;
  }

  return {
    completeToolPreparation,
    completeToolExecution,
    deleteMemory,
    deleteSession,
    extractMediaAudio,
    getSession,
    inspectMedia,
    listMemories,
    listSessions,
    markToolExecutionCommitted,
    releaseMediaArtifact,
    releaseOwner,
    renameSession,
    reportToolExecutionProgress,
    resolveToolApproval,
    saveMediaArtifact,
    shutdown,
    submitInteraction,
    start,
    stop,
    updateMemory,
  };
}

export const agentOrchestrator = createAgentOrchestrator();
