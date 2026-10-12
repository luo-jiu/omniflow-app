import { prepareAgentPluginRename, executeAgentPluginRename, prepareAgentPluginFileOutput, executeAgentPluginFileOutput, releaseAgentPluginOutputs } from './agent-plugin-service';
import type { AgentPluginRenameRequest } from './agent-plugin-rename';
import type { AgentPluginFileOutputRequest } from './agent-plugin-file-output';
import { reconcileAgentPluginOperation } from './agent-plugin-receipts';
import { createAgentPluginToolSnapshot } from './agent-plugin-tool-adapter';
import { getAgentPluginToolRegistrations, executeAgentPluginTool, type AgentPluginToolRequest } from './agent-plugin-service';
import type { PluginToolRegistration } from '../extensions/plugin-tool-catalog';
import crypto from 'node:crypto';
import { isAgentRendererMutationTool } from '../../../src/shared/agent/agent-library-actions';
import { normalizeAgentNodeConfigFields } from '../../../src/shared/agent/agent-node-config';
import { attachmentManifest } from '../../../src/shared/agent/agent-attachments';
import { getAgentAttachmentStore, hydrateAgentAttachmentImages } from './agent-attachment-runtime';
import { getBuiltInAgentComputerTools } from './tools/computer-tools';
import { keepAgentOwnerRendering, releaseAgentComputerRun } from './computer/agent-computer-service-runtime';
import { operateAgentAttachment } from './documents/attachment-documents';
import { runAgentDocument } from './documents/document-runner';
import { createAgentContextUsageLedger, type AgentContextRequest } from './agent-context-usage-ledger';
import type { AgentContextUsageSnapshot } from '../../../src/shared/agent/agent-context-usage';
import { agentLibraryTextReader, readAgentLibraryText } from './agent-library-text-reader';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { WebContents } from 'electron';

import type {
  AgentActionPreview,
  AgentAppContext,
  AgentAssistantItemSnapshot,
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
  AgentMediaArtifactUploadRequest,
  AgentMediaArtifactUploadResult,
  AgentMediaAudioExtractionRequest,
  AgentMediaAudioExtractionResult,
  AgentMessage,
  AgentNonAssistantMessage,
  AgentMediaInspectionRequest,
  AgentOwnerScope,
  AgentPluginToolSource,
  AgentPluginOperationReconcileRequest,
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
  AgentToolRisk,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import {
  equalAgentPreparedActionPublic,
  normalizeAgentPreparedActionPublic,
} from '../../../src/shared/agent/agent-prepared-action';
import { streamAIServiceProfile } from '../aiServiceClient';
import {
  resolveAIServiceOutputTokenLimit,
  type AIServiceRuntimeConnection,
} from '../aiServiceClientModel';
import {
  AIServiceStreamLimitError,
  appendBoundedAIServiceStreamText,
} from '../aiServiceStreamLimits';
import { aiServiceRunSessionRegistry } from '../aiServiceRunSession';
import { getAIServiceRuntimeProfile } from '../aiServiceStore';
import { streamAgentProviderTurn } from './agent-provider-client';
import { generateAgentSessionTitle, sessionTitleFromPrompt } from './agent-session-title';
import { buildAgentResumeInstruction } from './agent-run-continuation';
import { createAgentLibraryAccessGuard, type AgentLibraryAccessGuard, type AgentAccessApproval } from './agent-library-access';
import { normalizeAgentSessionGroupInput, normalizeAgentSessionPermissionMode, pickAgentSessionSummary,
  type AgentSessionGroupInput, type AgentSessionOrganizationInput, type AgentSessionListFilter,
  type AgentLibraryAccessSnapshot,
} from '../../../src/shared/agent/agent-session-management';
import { AGENT_COMPLETION_CHECK_PROMPT, shouldCheckAgentCompletion } from './agent-completion-check';
import { canResumeInterruptedReadTurn, retryBufferedAgentTransport, waitForAgentRetry } from './agent-transport-retry';
import {
  AGENT_PROVIDER_TOOL_CALL_ID_MAX_LENGTH,
  type AgentProviderMessage,
  type AgentProviderToolCall,
} from './agent-provider-model';
import {
  appendAgentActiveToolResult,
  compactAgentActiveContextToFit,
  markAgentActiveToolResultsConsumed,
  type AgentActiveToolResultRecord,
} from './agent-active-context';
import {
  AGENT_ACTIVE_CONTEXT_SUMMARY_MAX_CHARACTERS,
  AGENT_ACTIVE_CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS,
  AGENT_ACTIVE_CONTEXT_SUMMARY_SYSTEM_PROMPT,
  buildAgentActiveContextSummaryPayload,
  normalizeAgentActiveContextSummary,
} from './agent-active-context-summary';
import { createAgentContextManager, type AgentContextManager } from './agent-context-manager';
import {
  assertAgentCurrentRunFitsContext,
  estimateAgentFixedInputTokens,
  estimateAgentProviderMessagesTokens,
  estimateAgentProviderTurnTokens,
  estimateAgentTextTokens,
  resolveAgentContextBudget,
  type AgentContextBudget,
} from './agent-context-projection';
import { resolveAgentModelContextBudget } from './agent-model-context';
import { agentFileAuthorityBroker, type AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import { normalizeAgentLibraryReadResult, type AgentLibraryReadResult } from '../../../src/shared/agent/agent-library-query';
import { agentModelCatalog } from './agent-model-catalog';
import { resolveAgentAdapterEffort, resolveAgentModelAdapter, restrictAgentToolsForModel, restrictAgentSkillsForModel, type AgentModelAdapter } from './agent-model-adapter';
import type { AgentModelMetadata } from './agent-model-context';
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
import {
  createAgentMediaArtifactUploadManager,
  type AgentMediaArtifactUploadManager,
} from './agent-media-artifact-upload';
import { createAgentMediaUploadControlPlane } from './agent-media-upload-control-plane';
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
  createAgentPlanControlTool,
  normalizeAgentRunPlan,
} from './agent-plan-model';
import {
  isAgentSensitiveInteractionRequestError,
  normalizeAgentInteractionRequest,
  normalizeAgentInteractionResponse,
} from './agent-interaction-model';
import { assessAgentToolPermission, resolveAgentRunPermissionDecision } from './agent-permission-gate';
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
import { createAgentComputerTextAuditSourceResolver, isBuiltinComputerSetTextTool,
  projectAgentComputerTextInput, projectAgentComputerTextPreview, projectAgentComputerTextResult,
  projectAgentToolAuditInput, type AgentComputerTextAuditSourceResolver } from './agent-tool-audit';
import {
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS,
  projectAgentToolResultForProvider,
  type AgentProviderToolResultProjectionOptions,
} from './agent-tool-result-projection';
import {
  agentToolRegistry,
  hashAgentToolInputForPreparation,
  type AgentToolDispatchContext,
  type AgentToolExecutionContext,
  type AgentToolExecutor,
  type AgentToolMainPreparedCapability,
  type AgentToolMainPreparationContext,
  type AgentToolMainPreparationIdentity,
  type AgentToolMainPreparationResult,
  type AgentToolPermissionDecision,
  type AgentToolPreparationResult,
} from './agent-tool-registry';
import {
  createAgentAiDestinationSnapshot,
  type AgentRuntimeProfile,
  type AgentToolMainAiDestinationSnapshot,
} from './agent-ai-destination';
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
import { libraryDocumentTools } from './tools/library-document-tools';
import { libraryBatchTool } from './tools/library-batch-tool';
import { operationVerifyTool } from './tools/operation-verify-tool';
import {
  mediaExtractAudioTool,
  normalizeAgentAudioOutputFormat,
} from './tools/media-extract-audio-tool';
import { mediaInspectTool } from './tools/media-inspect-tool';
import { interactionRequestTool } from './tools/interaction-request-tool';
import { memoryProposeTool } from './tools/memory-propose-tool';
import {
  getAgentShellProviderSnapshotForRun,
  releaseAgentShellRun,
} from './shell/agent-shell-service-runtime';
import { getAgentShellStorageRuntime } from './shell/agent-shell-storage-runtime';
import type {
  AgentShellLogIdentity,
  AgentShellLogReadRequest,
} from './shell/agent-shell-log-store';
import type {
  AgentShellLogPageRequestV1,
  AgentShellLogPageV1,
} from '@/shared/agent/shell/agent-shell.types';
import { AGENT_SHELL_RUN_TOOL_NAME } from '../../../src/shared/agent/shell/agent-shell.types';
import { AGENT_COMPUTER_PROVIDER_RESULT_TOKENS } from './computer/agent-computer-provider-projection';

const AGENT_TOOL_PROGRESS_MAX_CYCLE_LENGTH = 8;
const AGENT_TOOL_PROGRESS_REQUIRED_CYCLE_REPETITIONS = 3;
const AGENT_TOOL_PROGRESS_HISTORY_LIMIT = (
  AGENT_TOOL_PROGRESS_MAX_CYCLE_LENGTH * AGENT_TOOL_PROGRESS_REQUIRED_CYCLE_REPETITIONS
);
const MAX_ASSISTANT_TURN_CHARACTERS = 64_000;
const MAX_ASSISTANT_RUN_CHARACTERS = 64_000;
const MAX_AGENT_PROVIDER_OUTPUT_TOKENS = Math.floor(MAX_ASSISTANT_TURN_CHARACTERS / 4);
const DEFAULT_PROVIDER_TOOL_RESULT_TOKENS = 1_024;
const SKILL_PROVIDER_TOOL_RESULT_TOKENS = 10_000;
const SHELL_PROVIDER_TOOL_RESULT_TOKENS = 40_000;
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

[...getBuiltInReadTools(), ...libraryDocumentTools, libraryBatchTool, operationVerifyTool, interactionRequestTool, memoryProposeTool, mediaInspectTool, mediaExtractAudioTool, ...getBuiltInActionTools(), ...getBuiltInAgentComputerTools()].forEach((tool) => {
  if (!agentToolRegistry.get(tool.name)) agentToolRegistry.register(tool);
});
ensureBuiltInAgentCapabilities();

interface ActiveAgentRun {
  accessGuard?: AgentLibraryAccessGuard;
  releaseAccess?: () => void;
  releaseRendering?: () => void;
  groupKey?: string;
  stoppedByUser?: boolean;
  task?: Promise<void>;
  assistantWriter?: AgentAssistantTurnWriter;
  controller: AbortController;
  ownerWebContentsId: number;
  runId: string;
}

interface StartingAgentRun {
  controller: AbortController;
  ownerWebContentsId: number;
}

type AgentApprovalOutcome =
  | { activity: AgentToolActivitySnapshot; approvalId: string; approved: false }
  | {
      activity: AgentToolActivitySnapshot;
      approvalId: string;
      approved: true;
      execution?: Promise<AgentToolExecutionOutcome>;
      prepared?: AgentPreparedRuntime;
    };

interface PendingAgentApproval {
  verifyAccess?: () => Promise<void>;
  appContext: AgentAppContext;
  approval: AgentToolApprovalSnapshot;
  executor: AgentToolExecutor;
  executionInput: unknown;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  sender: WebContents;
  onProgress: (progress: AgentToolProgress) => void;
  onCancel: (executionId: string) => void;
  pauseTimeout: () => void;
  reject: (error: unknown) => void;
  replaceRound: (approval: AgentToolApprovalSnapshot) => void;
  resolving: boolean;
  resumeTimeout: () => void;
  resolve: (outcome: AgentApprovalOutcome) => void;
  signal: AbortSignal;
  store: AgentSessionStore;
  timeoutMs: number;
  prepared?: {
    current: AgentPreparedRuntime;
    finalize: (
      requestedAction?: AgentPreparedActionPublic,
      preparedActionId?: string,
    ) => Promise<AgentPreparedRuntime>;
  };
}

interface AgentPreparedRuntime {
  action: AgentPreparedActionPublic;
  approvalSemanticsHash: string;
  executionInput: unknown;
  mainPreparationCapability?: AgentToolMainPreparedCapability;
  mainPreparationIdentity?: AgentToolMainPreparationIdentity;
  permissionBehavior: 'allow' | 'ask';
  preparationMode: 'main' | 'renderer';
  preparedActionId: string;
  preview: AgentActionPreview;
  snapshotHash: string;
  stabilityHash: string;
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

interface AgentMediaArtifactFallbackGrant {
  artifactId: string;
  ownerWebContentsId: number;
  runId: string;
  sessionId: string;
}

interface AgentOrchestratorOptions {
  keepOwnerRendering?: (ownerWebContentsId: number) => () => void;
  releasePluginOutputs?: typeof releaseAgentPluginOutputs;
  preparePluginFileOutput?: typeof prepareAgentPluginFileOutput;
  executePluginFileOutput?: typeof executeAgentPluginFileOutput;
  preparePluginRename?: typeof prepareAgentPluginRename;
  executePluginRename?: typeof executeAgentPluginRename;
  getPluginTools?: (reservedNames: readonly string[]) => readonly PluginToolRegistration[];
  executePluginTool?: (request: AgentPluginToolRequest) => Promise<AgentToolResult>;
  generateSessionTitle?: typeof generateAgentSessionTitle;
  attachmentBindings?: Pick<import('./agent-attachment-store').AgentAttachmentStore, 'resolve' | 'bind' | 'rollbackBinding'>;
  readLibraryMetadata?: (input: AgentFileAuthorityBrokerRequestInput) => Promise<AgentLibraryReadResult>;
  readLibraryText?: (input: AgentFileAuthorityBrokerRequestInput) => Promise<Uint8Array>;
  getModelMetadata?: (connection: AIServiceRuntimeConnection, model: string) => Promise<AgentModelMetadata | undefined>;
  getPermissionMode?: () => AgentRunCapabilitySnapshot['shellPermissionMode'];
  approvalTimeoutMs?: number;
  contextBudget?: Partial<AgentContextBudget>;
  contextManager?: AgentContextManager;
  extractMediaAudio?: typeof extractAgentMediaAudio;
  getRuntimeProfile?: (profileId: string) => AgentRuntimeProfile;
  getMemoryStore?: () => Promise<AgentMemoryStore>;
  getSessionStore?: () => Promise<AgentSessionStore>;
  inspectMediaSource?: typeof inspectAgentMediaSource;
  interactionTimeoutMs?: number;
  readShellLogPage?: (request: AgentShellLogReadRequest) => Promise<AgentShellLogPageV1>;
  mediaArtifactStore?: Pick<AgentMediaArtifactStore, 'release' | 'releaseOwner' | 'releaseRun'>
    & Partial<Pick<AgentMediaArtifactStore, 'touchExecution' | 'withOwnedFile'>>;
  mediaArtifactUploadManager?: AgentMediaArtifactUploadManager;
  resolveCapabilitySnapshot?: (
    input: AgentCapabilitySnapshotRequest,
  ) => Promise<AgentCapabilitySnapshot>;
  resolveContextBudget?: (input: {
    baseUrl: string;
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

function resolveAgentProviderOutputTokens(contextBudget: AgentContextBudget): number {
  return Math.min(contextBudget.outputReserveTokens, MAX_AGENT_PROVIDER_OUTPUT_TOKENS);
}

function claimUniqueAgentToolCallId(
  preferredId: string,
  seenIds: Set<string>,
  roundOrdinal: number,
  callOrdinal: number,
): string {
  const base = String(preferredId || `tool-call-${roundOrdinal}-${callOrdinal}`)
    .slice(0, AGENT_PROVIDER_TOOL_CALL_ID_MAX_LENGTH);
  if (!seenIds.has(base)) {
    seenIds.add(base);
    return base;
  }

  for (let attempt = 1; attempt <= seenIds.size + 1; attempt += 1) {
    const suffix = `-${roundOrdinal}-${callOrdinal}-${attempt}`
      .slice(-AGENT_PROVIDER_TOOL_CALL_ID_MAX_LENGTH);
    const candidate = `${base.slice(
      0,
      AGENT_PROVIDER_TOOL_CALL_ID_MAX_LENGTH - suffix.length,
    )}${suffix}`;
    if (seenIds.has(candidate)) continue;
    seenIds.add(candidate);
    return candidate;
  }

  throw new Error('Agent 无法分配唯一的 Tool 调用 ID');
}

function resolveOwnerUserId(ownerScope: AgentOwnerScope): number {
  const match = /^user:([1-9]\d*)$/u.exec(ownerScope.accountScope);
  const userId = Number(match?.[1]);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('Agent 缺少有效的账号环境');
  }
  return userId;
}

function normalizeCommittedMediaNode(
  value: unknown,
): Extract<AgentMediaArtifactUploadResult, { commitState: 'committed' }>['node'] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = Number(source.id);
  const rawName = String(source.name || '').trim().slice(0, 512);
  const rawExt = String(source.ext || '').trim().replace(/^\./u, '').slice(0, 32);
  const ext = /^[a-z0-9][a-z0-9_-]{0,31}$/iu.test(rawExt) ? rawExt : '';
  if (!Number.isSafeInteger(id) || id <= 0 || !rawName) {
    throw new Error('Agent 媒体产物上传提交回执无效');
  }
  const fullName = ext && !rawName.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
    ? `${rawName}.${ext}`
    : rawName;
  return {
    ...(ext ? { ext } : {}),
    id,
    name: fullName,
  };
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
  modelAdapter?: AgentModelAdapter;
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
      input.modelAdapter,
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
    const storage = source.storage && typeof source.storage === 'object' && !Array.isArray(source.storage)
      ? source.storage as Record<string, unknown> : undefined;
    const providerAlias = sanitizeAgentSensitiveText(String(storage?.providerAlias || '')).trim().slice(0, 160);
    const providerLabel = sanitizeAgentSensitiveText(String(storage?.providerLabel || '')).trim().slice(0, 160);
    const availability: 'available' | 'unavailable' | 'unknown' = storage?.availability === 'available'
      || storage?.availability === 'unavailable' ? storage.availability : 'unknown';
    return {
      ...normalizeAgentNodeConfigFields(source),
      ...(providerAlias ? { storage: {
        providerAlias,
        ...(providerLabel ? { providerLabel } : {}),
        availability,
        ...(typeof storage?.observedAt === 'string' ? { observedAt: storage.observedAt.slice(0, 80) } : {}),
      } } : {}),
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
  const suppliedCount = input.currentDirectory?.entryCount;
  const entryCount = Math.max(
    entries.length,
    typeof suppliedCount === 'number' && Number.isSafeInteger(suppliedCount) && suppliedCount >= 0
      ? suppliedCount : 0,
    Array.isArray(input.currentDirectory?.entries) ? input.currentDirectory.entries.length : 0,
  );
  return {
    ...(Number.isFinite(directoryId) && directoryId > 0 && directoryName
      ? {
          currentDirectory: {
            ...normalizeAgentNodeConfigFields(input.currentDirectory),
            entryCount,
            truncated: input.currentDirectory?.truncated === true || entryCount > entries.length,
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
  role: AgentNonAssistantMessage['role'],
  content: string,
  tool?: { callId: string; name: string },
): AgentNonAssistantMessage {
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

interface AgentAssistantTurnWriterSnapshot {
  content: string;
  expectedRevision: number;
  id: string;
}

interface AgentAssistantTurnWriter {
  append: (delta: string) => number;
  close: () => AgentAssistantTurnWriterSnapshot;
  discard: () => AgentAssistantTurnWriterSnapshot;
  getSnapshot: () => AgentAssistantItemSnapshot;
}

async function createAgentAssistantTurnWriter(
  store: AgentSessionStore,
  runId: string,
): Promise<AgentAssistantTurnWriter> {
  const item = await store.startAssistantItem({
    id: crypto.randomUUID(),
    now: now(),
    runId,
  });
  let liveContent = '';
  let closed = false;
  const getSnapshot = (): AgentAssistantItemSnapshot => ({
    ...item,
    content: liveContent,
  });
  const snapshot = (content: string): AgentAssistantTurnWriterSnapshot => ({
    content,
    expectedRevision: item.assistantItem.revision,
    id: item.id,
  });

  return {
    append(delta) {
      if (closed) throw new Error('Agent assistant turn 已关闭');
      const offset = liveContent.length;
      liveContent = appendBoundedAIServiceStreamText(
        liveContent,
        delta,
        MAX_ASSISTANT_TURN_CHARACTERS,
        'Agent 单轮回答',
      );
      return offset;
    },
    close() {
      closed = true;
      return snapshot(liveContent);
    },
    discard() {
      closed = true;
      return snapshot('');
    },
    getSnapshot,
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

const AGENT_SHELL_PROGRESS_VOLATILE_DATA_FIELDS = new Set([
  'durationMs',
  'executionId',
  'logRef',
]);

interface AgentToolTurnProgressEntry {
  input: unknown;
  name: string;
  result: unknown;
}

function projectAgentToolTurnProgressEntry(
  entry: AgentToolTurnProgressEntry,
): AgentToolTurnProgressEntry {
  if (entry.name !== AGENT_SHELL_RUN_TOOL_NAME) return entry;
  const result = entry.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return entry;
  const resultData = (result as Record<string, unknown>).data;
  if (!resultData || typeof resultData !== 'object' || Array.isArray(resultData)) return entry;
  return {
    ...entry,
    result: {
      ...(result as Record<string, unknown>),
      data: Object.fromEntries(
        Object.entries(resultData as Record<string, unknown>)
          .filter(([key]) => !AGENT_SHELL_PROGRESS_VOLATILE_DATA_FIELDS.has(key)),
      ),
    },
  };
}

function hashToolInput(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function hashAgentToolTurnProgress(entries: AgentToolTurnProgressEntry[]): string {
  return hashToolInput(entries.map(projectAgentToolTurnProgressEntry));
}

function hasRepeatedAgentToolProgressCycle(history: readonly string[]): boolean {
  for (
    let cycleLength = 1;
    cycleLength <= AGENT_TOOL_PROGRESS_MAX_CYCLE_LENGTH;
    cycleLength += 1
  ) {
    const repeatedLength = cycleLength * AGENT_TOOL_PROGRESS_REQUIRED_CYCLE_REPETITIONS;
    if (history.length < repeatedLength) continue;
    const cycleStart = history.length - cycleLength;
    let matches = true;
    for (
      let repetition = 2;
      repetition <= AGENT_TOOL_PROGRESS_REQUIRED_CYCLE_REPETITIONS && matches;
      repetition += 1
    ) {
      const repeatedStart = history.length - (cycleLength * repetition);
      for (let offset = 0; offset < cycleLength; offset += 1) {
        if (history[repeatedStart + offset] !== history[cycleStart + offset]) {
          matches = false;
          break;
        }
      }
    }
    if (matches) return true;
  }
  return false;
}

interface AgentProviderToolResultPolicy {
  maxTokens: number;
  projectionOptions?: AgentProviderToolResultProjectionOptions;
}

function resolveAgentProviderToolResultPolicy(
  canonicalToolName: string,
): AgentProviderToolResultPolicy {
  if (canonicalToolName === 'computer.observe' || canonicalToolName === 'computer.windows') {
    return { maxTokens: AGENT_COMPUTER_PROVIDER_RESULT_TOKENS,
      projectionOptions: { mode: canonicalToolName === 'computer.observe' ? 'computer-observe' : 'computer-windows' } };
  }
  if (canonicalToolName === AGENT_SHELL_RUN_TOOL_NAME) {
    return {
      maxTokens: SHELL_PROVIDER_TOOL_RESULT_TOKENS,
      projectionOptions: { mode: 'shell' },
    };
  }
  if (canonicalToolName === AGENT_SKILL_ACTIVATE_TOOL_NAME) {
    return { maxTokens: SKILL_PROVIDER_TOOL_RESULT_TOKENS };
  }
  if (['file.read', 'file.grep', 'attachment.read', 'attachment.query', 'recycle.list', 'tag.list'].includes(canonicalToolName)) return { maxTokens: 10_000 };
  if (canonicalToolName === 'operation.verify') return { maxTokens: 10_000 };
  if (['file.list', 'file.search', 'file.resolve', 'file.stat'].includes(canonicalToolName)) return { maxTokens: 10_000 };
  return { maxTokens: DEFAULT_PROVIDER_TOOL_RESULT_TOKENS };
}

interface CreatePreparedRuntimeOptions {
  computerText?: boolean;
  pluginOperation?: 'rename' | 'file-output';
  permissionMode?: AgentRunCapabilitySnapshot['shellPermissionMode'];
  identity?: AgentToolMainPreparationIdentity;
  preparedActionId?: string;
  sealMain?: (input: {
    approvalSemantics: unknown;
    binding: AgentToolMainPreparationResult['binding'];
    identity: AgentToolMainPreparationIdentity;
    publicAction: AgentPreparedActionPublic;
    snapshotMaterial?: unknown;
  }) => {
    capability: AgentToolMainPreparedCapability;
    identity: AgentToolMainPreparationIdentity;
    publicAction: AgentPreparedActionPublic;
    snapshotHash: string;
    stabilityHash: string;
  };
}

function createPreparedRuntime(
  result: AgentToolMainPreparationResult | AgentToolPreparationResult,
  expectedToolName: string,
  expectedRisk: AgentToolRisk,
  preparedRisk: 'dynamic' | undefined,
  preparationMode: AgentPreparedRuntime['preparationMode'],
  options: CreatePreparedRuntimeOptions = {},
): AgentPreparedRuntime {
  if (result.decision.behavior !== 'ask' && result.decision.behavior !== 'allow') {
    throw new Error(result.decision.message || 'Agent Tool prepare 已拒绝执行动作');
  }
  const effectiveRisk = result.decision.risk;
  if (
    !['read', 'write', 'destructive', 'external'].includes(effectiveRisk)
    || (preparedRisk !== 'dynamic' && effectiveRisk !== expectedRisk)
    || (result.decision.behavior === 'ask' && result.decision.preview.risk !== effectiveRisk)
  ) {
    throw new Error('Agent Tool prepare 风险等级与注册定义不匹配');
  }
  let action = Object.freeze(normalizeAgentPreparedActionPublic(result.publicAction));
  if (action.kind !== expectedToolName && !(options.pluginOperation === 'rename' && action.kind === 'plugin.rename')
    && !(options.pluginOperation === 'file-output' && action.kind === 'plugin.file-output')) {
    throw new Error('Agent prepared action 与 Tool 不匹配');
  }
  if (
    preparedRisk === 'dynamic'
    && (!('assessment' in action) || action.assessment.risk !== effectiveRisk)
  ) {
    throw new Error('Agent Tool dynamic prepared risk 与公开动作不匹配');
  }
  const preview = Object.freeze(normalizeActionPreview(
    options.computerText && action.kind === 'computer.setText'
      ? projectAgentComputerTextPreview(action)
    : result.decision.behavior === 'ask'
      ? result.decision.preview
      : {
          description: '执行已经准备完成',
          risk: result.decision.risk,
          title: '执行操作',
        },
  ));
  const approvalSemantics = Object.freeze({
    action,
    behavior: resolveAgentRunPermissionDecision(expectedToolName, result.decision, options.permissionMode, action).behavior,
    preview,
    risk: result.decision.risk,
  });
  const approvalSemanticsHash = hashToolInput(approvalSemantics);
  let preparedActionId: string;
  let snapshotHash: string;
  let stabilityHash: string;
  let mainPreparationCapability: AgentToolMainPreparedCapability | undefined;
  let mainPreparationIdentity: AgentToolMainPreparationIdentity | undefined;
  let preparedValue: unknown;
  if (preparationMode === 'main') {
    if (!options.identity || !options.sealMain) {
      throw new Error('Agent main Tool 缺少 preparation issuer');
    }
    const sealed = options.sealMain({
      approvalSemantics,
      binding: (result as AgentToolMainPreparationResult).binding,
      identity: options.identity,
      publicAction: action,
      snapshotMaterial: result.snapshotMaterial,
    });
    action = sealed.publicAction;
    preparedActionId = sealed.identity.preparedActionId;
    snapshotHash = sealed.snapshotHash;
    stabilityHash = sealed.stabilityHash;
    mainPreparationCapability = sealed.capability;
    mainPreparationIdentity = sealed.identity;
  } else {
    preparedValue = (result as AgentToolPreparationResult).executionInput;
    preparedActionId = String(options.preparedActionId || '').trim() || crypto.randomUUID();
    snapshotHash = hashToolInput({
      action,
      snapshotMaterial: result.snapshotMaterial ?? null,
    });
    stabilityHash = snapshotHash;
  }
  const executionInput = preparationMode === 'renderer'
    && preparedValue
    && typeof preparedValue === 'object'
    && !Array.isArray(preparedValue)
    ? { ...(preparedValue as Record<string, unknown>), preparedActionId, snapshotHash }
    : preparedValue;
  return {
    action,
    approvalSemanticsHash,
    executionInput,
    ...(mainPreparationCapability ? { mainPreparationCapability } : {}),
    ...(mainPreparationIdentity ? { mainPreparationIdentity } : {}),
    permissionBehavior: approvalSemantics.behavior as 'allow' | 'ask',
    preparationMode,
    preparedActionId,
    preview,
    snapshotHash,
    stabilityHash,
  };
}

function withMainPreparedExecution(
  context: AgentToolExecutionContext,
  prepared: AgentPreparedRuntime | undefined,
): AgentToolDispatchContext {
  if (
    !prepared
    || prepared.preparationMode !== 'main'
    || !prepared.mainPreparationCapability
    || !prepared.mainPreparationIdentity
  ) {
    throw new Error('Agent main Tool 缺少已冻结的 prepare 结果');
  }
  return {
    ...context,
    mainPreparationCapability: prepared.mainPreparationCapability,
    mainPreparationIdentity: prepared.mainPreparationIdentity,
  };
}

function getActivatedSkillId(result: AgentToolResult): string | undefined {
  if (!result.ok || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return undefined;
  }
  const skillId = String((result.data as Record<string, unknown>).skillId || '').trim();
  return skillId || undefined;
}

function getSkillActivationContextResult(
  result: AgentToolResult,
  loadedSkillIds: ReadonlySet<string>,
): AgentToolResult {
  const skillId = getActivatedSkillId(result);
  if (!skillId || !loadedSkillIds.has(skillId)) return result;
  const data = result.data as Record<string, unknown>;
  return {
    data: {
      alreadyLoaded: true,
      instructionsHash: data.instructionsHash,
      skillId,
      version: data.version,
    },
    message: `Skill ${skillId}（${data.version}）已加载；继续使用上下文中的完整说明，无需重复加载`,
    ok: true,
  };
}

function sameOwnerScope(left: AgentOwnerScope, right: AgentOwnerScope): boolean {
  return left.accountScope === right.accountScope && left.backendScope === right.backendScope;
}

export function updatePerceptionAfterLibraryMutation(
  perception: AgentPerceptionSnapshot,
  toolName: string,
  nodeId?: number,
): AgentPerceptionSnapshot {
  if (toolName === 'file.delete' || toolName === 'node.configure') {
    // 配置提交后旧版本不能继续成为下一次配置的 observedSource；下一动作重新读取。
    return {
      ...perception,
      knownNodes: perception.knownNodes?.filter(node => node.id !== nodeId) || [],
      selectedNodes: [],
      currentDirectory: undefined,
    };
  }
  return {
    ...perception,
    knownNodes: perception.knownNodes?.filter(node => node.id === nodeId) || [],
    selectedNodes: [],
    currentDirectory: undefined,
  };
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
  const mediaArtifactUploadManager = options.mediaArtifactUploadManager || (
    mediaArtifactStore.withOwnedFile
      ? createAgentMediaArtifactUploadManager({
          artifactStore: { withOwnedFile: mediaArtifactStore.withOwnedFile },
          controlPlane: createAgentMediaUploadControlPlane(),
        })
      : null
  );
  const saveMediaArtifactAs = options.saveMediaArtifactAs || saveAgentMediaArtifactAs;
  const resolveCapabilitySnapshot = options.resolveCapabilitySnapshot
    || createBuiltInAgentCapabilitySnapshot;
  const resolveContextBudget = options.resolveContextBudget || resolveAgentModelContextBudget;
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
  const readShellLogPageFromStore = options.readShellLogPage || (async (
    request: AgentShellLogReadRequest,
  ) => (await getAgentShellStorageRuntime()).logStore.readPage(request));
  const activeRuns = new Map<string, ActiveAgentRun>();
  const activeTitleTasks = new Map<string, { controller: AbortController; ownerWebContentsId: number }>();
  const startingRuns = new Map<string, StartingAgentRun>();
  const startingSessions = new Set<string>();
  const startingGroupKeys = new Map<string, string>();
  const pendingApprovals = new Map<string, PendingAgentApproval>();
  const pendingInteractions = new Map<string, PendingAgentInteraction>();
  const activeMediaArtifactSaves = new Set<ActiveMediaArtifactSave>();
  const mediaArtifactFallbackGrants = new Map<string, AgentMediaArtifactFallbackGrant>();
  let shuttingDown = false;

  function releaseRunRendering(runtime: ActiveAgentRun): void {
    const release = runtime.releaseRendering;
    runtime.releaseRendering = undefined;
    try { release?.(); }
    catch { /* Rendering cleanup must not replace the authoritative Run result. */ }
  }

  function keepRunRendering(runtime: ActiveAgentRun): void {
    if (!options.keepOwnerRendering) return;
    const release = options.keepOwnerRendering(runtime.ownerWebContentsId);
    let released = false;
    const cancel = () => releaseRunRendering(runtime);
    runtime.releaseRendering = () => {
      if (released) return;
      released = true;
      runtime.controller.signal.removeEventListener('abort', cancel);
      release();
    };
    runtime.controller.signal.addEventListener('abort', cancel, { once: true });
    if (runtime.controller.signal.aborted) cancel();
    throwIfAborted(runtime.controller.signal);
  }

  function groupKey(owner: AgentOwnerScope, libraryId: number, groupId: string): string {
    const scope = normalizeAgentOwnerScope(owner);
    return JSON.stringify([scope.backendScope, scope.accountScope, Number(libraryId), groupId]);
  }
  function assertGroupIdle(key: string) {
    if ([...startingGroupKeys.values()].includes(key) || [...activeRuns.values()].some(run => run.groupKey === key)) {
      throw new Error('组内任务正在运行或停止收尾，请稍后修改');
    }
  }
  function assertSessionIdle(id: string) {
    if (activeRuns.has(id) || startingSessions.has(id)) throw new Error('会话正在运行或停止收尾，请稍后操作');
  }

  function scheduleSessionTitle(
    sender: WebContents,
    store: AgentSessionStore,
    session: AgentSessionSnapshot,
    runId: string,
    input: AgentChatRequest,
    connection: AIServiceRuntimeConnection,
    answer: string,
  ) {
    if (shuttingDown || activeTitleTasks.has(session.id) || session.runs.length !== 1
      || session.runs[0].id !== runId || session.title !== sessionTitleFromPrompt(input.userPrompt)) return;
    const controller = new AbortController();
    const task = { controller, ownerWebContentsId: sender.id };
    activeTitleTasks.set(session.id, task);
    const timer = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      const current = await store.getSession(session.id, input.ownerScope, Number(input.appContext.libraryId));
      if (controller.signal.aborted || !current || current.title !== session.title || current.runs.length !== 1) return;
      const title = await (options.generateSessionTitle || generateAgentSessionTitle)({
        prompt: input.userPrompt, answer, model: input.model, profileId: input.profileId,
        connection, signal: controller.signal,
      });
      if (!title || controller.signal.aborted) return;
      const updated = await store.setGeneratedSessionTitle({
        sessionId: session.id, runId, ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId),
        expectedTitle: current.title, expectedUpdatedAt: current.updatedAt, title,
      });
      if (updated && !controller.signal.aborted) emit(sender, {
        sessionId: session.id, runId, type: 'session-title-updated',
        ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId),
      });
    })().catch(() => undefined).finally(() => {
      clearTimeout(timer);
      if (activeTitleTasks.get(session.id) === task) activeTitleTasks.delete(session.id);
    });
  }

  function clearMediaArtifactFallbackGrants(
    predicate: (grant: AgentMediaArtifactFallbackGrant) => boolean,
  ): void {
    mediaArtifactFallbackGrants.forEach((grant, executionId) => {
      if (predicate(grant)) mediaArtifactFallbackGrants.delete(executionId);
    });
  }

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

  async function updateRunAndEmitAfterApprovalCommit(
    sender: WebContents,
    store: AgentSessionStore,
    sessionId: string,
    runId: string,
    update: AgentRunUpdate,
  ): Promise<void> {
    try {
      await updateRunAndEmit(sender, store, sessionId, runId, update);
    } catch {
      // The approval CAS is authoritative; a projection failure cannot revive its stale card.
    }
  }

  function waitForApproval(input: {
    verifyAccess?: () => Promise<void>;
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      let deadlineAt = 0;
      let remainingMs = approvalTimeoutMs;
      const clearApprovalTimer = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = undefined;
      };
      const removeCurrentRegistration = () => {
        const currentApprovalId = pending.approval.approvalId;
        if (pendingApprovals.get(currentApprovalId) === pending) {
          pendingApprovals.delete(currentApprovalId);
        }
      };
      const cleanup = () => {
        clearApprovalTimer();
        input.signal.removeEventListener('abort', handleAbort);
        removeCurrentRegistration();
      };
      const takeSettlement = () => {
        if (settled) return false;
        settled = true;
        cleanup();
        return true;
      };
      const handleAbort = () => {
        const currentApprovalId = pending.approval.approvalId;
        if (!takeSettlement()) return;
        void input.store.resolveToolApproval(
          currentApprovalId,
          'cancelled',
          now(),
        ).catch(() => undefined).finally(() => reject(abortError()));
      };
      const handleTimeout = () => {
        timer = undefined;
        const currentApprovalId = pending.approval.approvalId;
        if (!takeSettlement()) return;
        void input.store.resolveToolApproval(
          currentApprovalId,
          'expired',
          now(),
        ).catch(() => undefined).finally(() => reject(new Error('用户确认已超时')));
      };
      const armTimeout = (durationMs: number) => {
        clearApprovalTimer();
        remainingMs = Math.max(0, durationMs);
        deadlineAt = Date.now() + remainingMs;
        timer = setTimeout(handleTimeout, remainingMs);
        timer.unref?.();
      };
      const pending: PendingAgentApproval = {
        ...input,
        pauseTimeout: () => {
          if (!timer || settled) return;
          remainingMs = Math.max(0, deadlineAt - Date.now());
          clearApprovalTimer();
        },
        reject: (error) => {
          if (takeSettlement()) reject(error);
        },
        replaceRound: (approval) => {
          if (settled) throw new Error('Agent 确认请求已经失效');
          const previousApprovalId = pending.approval.approvalId;
          if (pendingApprovals.get(previousApprovalId) !== pending) {
            throw new Error('Agent 确认请求已经变化');
          }
          clearApprovalTimer();
          pendingApprovals.delete(previousApprovalId);
          pending.approval = approval;
          pendingApprovals.set(approval.approvalId, pending);
          armTimeout(approvalTimeoutMs);
        },
        resolving: false,
        resumeTimeout: () => {
          if (timer || settled) return;
          armTimeout(remainingMs);
        },
        resolve: (outcome) => {
          if (takeSettlement()) resolve(outcome);
        },
      };
      pendingApprovals.set(input.approval.approvalId, pending);
      armTimeout(approvalTimeoutMs);
      if (input.signal.aborted) handleAbort();
      else input.signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  async function requestDirectoryApproval(sender: WebContents, store: AgentSessionStore, sessionId: string,
    runId: string, appContext: AgentAppContext, ownerScope: AgentOwnerScope, signal: AbortSignal, request: AgentAccessApproval): Promise<boolean> {
    signal.throwIfAborted();
    const call = { id: crypto.randomUUID(), name: 'agent.access.request', input: request };
    const approvalId = crypto.randomUUID();
    const preview: AgentActionPreview = { title: request.title, description: request.description,
      risk: request.write ? 'write' : 'read', details: request.targets.map(target => ({
        label: target.write ? '修改' : target.descendants ? '读取目录及子目录' : '读取文件', value: target.name,
      })) };
    let activity = await store.createToolRun({ id: crypto.randomUUID(), runId, callId: call.id, toolName: call.name,
      toolKind: 'control', input: request, now: now(), status: 'awaiting_approval', permissionBehavior: 'ask',
      approvalId, approvalPreview: preview, approvalInputHash: hashToolInput(request) });
    const approval: AgentToolApprovalSnapshot = { approvalId, call, preview, runId, sessionId };
    await updateRunAndEmit(sender, store, sessionId, runId, { status: 'awaiting_approval', currentStep: request.title, updatedAt: now() });
    const waiting = waitForApproval({ approval, appContext, ownerScope, ownerWebContentsId: sender.id, sender,
      executor: 'main', executionInput: undefined, onProgress: () => undefined, onCancel: () => undefined,
      signal, store, timeoutMs: approvalTimeoutMs });
    emit(sender, { activity, approval, runId, sessionId, type: 'tool-approval-required' });
    try {
      const outcome = await waiting;
      const result = { ok: outcome.approved, message: outcome.approved ? '已批准本次执行的访问范围' : '用户未批准访问' };
      activity = await store.completeToolRun(activity.id, result, now(), outcome.approved ? 'completed' : 'failed');
      emit(sender, { activity, approvalId, approved: outcome.approved, runId, sessionId, type: 'tool-approval-resolved' });
      emit(sender, { activity, call, result, runId, sessionId, type: 'tool-completed' });
      return outcome.approved;
    } catch (error) {
      await store.completeToolRun(activity.id, { ok: false, message: '访问确认已结束' }, now(), signal.aborted ? 'cancelled' : 'failed').catch(() => undefined);
      throw error;
    }
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
    let approvalCommitted = false;

    try {
      const approved = input.approved === true;
      let preparedResolution: Parameters<AgentSessionStore['resolveToolApproval']>[3];
      let finalizedPrepared: AgentPreparedRuntime | undefined;
      pending.pauseTimeout();
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
        if (requestedAction.kind !== pending.approval.call.name && !(['plugin.rename', 'plugin.file-output'].includes(requestedAction.kind)
          && pending.prepared.current.action.kind === requestedAction.kind
          && hashToolInput(requestedAction) === hashToolInput(pending.prepared.current.action))) {
          throw new Error('Agent prepared action 与 Tool 不匹配');
        }
        const currentPrepared = pending.prepared.current;
        let finalized: AgentPreparedRuntime;
        try {
          finalized = await pending.prepared.finalize(requestedAction);
        } catch (error) {
          if (isAbortError(error, pending.signal)) throw error;
          throw new Error(`工具 ${pending.approval.call.name} 重新准备失败，请重试`);
        }
        throwIfAborted(pending.signal);
        if (
          pendingApprovals.get(approvalId) !== pending
          || pending.approval.approvalId !== approvalId
        ) {
          throw new Error('Agent 确认请求已经变化');
        }
        const preparationStable = (
          equalAgentPreparedActionPublic(requestedAction, currentPrepared.action)
          && equalAgentPreparedActionPublic(finalized.action, currentPrepared.action)
          && finalized.approvalSemanticsHash === currentPrepared.approvalSemanticsHash
          && finalized.preparationMode === currentPrepared.preparationMode
          && finalized.stabilityHash === currentPrepared.stabilityHash
        );
        if (!preparationStable) {
          const nextApprovalId = crypto.randomUUID();
          const nextApproval: AgentToolApprovalSnapshot = {
            ...pending.approval,
            approvalId: nextApprovalId,
            preparation: {
              action: finalized.action,
              preparedActionId: finalized.preparedActionId,
              snapshotHash: finalized.snapshotHash,
            },
            preview: finalized.preview,
          };
          const activity = await pending.store.replacePendingToolApproval({
            action: finalized.action,
            approvalInputHash: finalized.snapshotHash,
            approvalPreview: finalized.preview,
            currentApprovalId: approvalId,
            expectedPreparedActionId,
            expectedSnapshotHash: currentPrepared.snapshotHash,
            nextApprovalId,
            preparedActionId: finalized.preparedActionId,
            snapshotHash: finalized.snapshotHash,
          });
          throwIfAborted(pending.signal);
          if (
            activity.status !== 'awaiting_approval'
            || activity.approval?.approvalId !== nextApprovalId
            || activity.approval.status !== 'pending'
            || activity.preparation?.preparedActionId !== finalized.preparedActionId
            || activity.preparation.snapshotHash !== finalized.snapshotHash
            || pendingApprovals.get(approvalId) !== pending
          ) {
            throw new Error('Agent 新确认轮次未能建立');
          }
          pending.executionInput = finalized.executionInput;
          pending.prepared.current = finalized;
          pending.replaceRound(nextApproval);
          await updateRunAndEmitAfterApprovalCommit(
            pending.sender,
            pending.store,
            nextApproval.sessionId,
            nextApproval.runId,
            {
              currentStep: `等待确认 ${nextApproval.call.name}`,
              status: 'awaiting_approval',
              updatedAt: now(),
            },
          );
          throwIfAborted(pending.signal);
          if (pendingApprovals.get(nextApprovalId) !== pending) throw abortError();
          emit(pending.sender, {
            activity,
            approval: nextApproval,
            runId: nextApproval.runId,
            sessionId: nextApproval.sessionId,
            type: 'tool-approval-required',
          });
          return { approved: false, reapprovalRequired: true };
        }
        finalizedPrepared = finalized;
        preparedResolution = {
          action: finalized.action,
          approvalInputHash: finalized.snapshotHash,
          approvalPreview: finalized.preview,
          expectedPreparedActionId: currentPrepared.preparedActionId,
          expectedSnapshotHash: currentPrepared.snapshotHash,
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
      approvalCommitted = true;
      if (approved && pending.approval.call.name !== 'agent.access.request') {
        activeRuns.get(pending.approval.sessionId)?.accessGuard?.grantApprovedTool(activity.id);
      }
      throwIfAborted(pending.signal);
      if (approved && finalizedPrepared && pending.prepared) {
        pending.executionInput = finalizedPrepared.executionInput;
        pending.prepared.current = finalizedPrepared;
      }
      await updateRunAndEmitAfterApprovalCommit(
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
        pending.resolve({ activity, approvalId, approved: false });
        return { approved: false };
      }

      if (pending.executor !== 'renderer') {
        pending.resolve({
          activity,
          approvalId,
          approved: true,
          ...(pending.prepared ? { prepared: pending.prepared.current } : {}),
        });
        return { approved: true };
      }

      const execution = toolBroker.prepareRendererExecution({
        verifyAccess: pending.verifyAccess,
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
      pending.resolve({
        activity,
        approvalId,
        approved: true,
        execution: execution.outcome,
      });
      return { approved: true, execution: execution.request };
    } catch (error) {
      if (approvalCommitted) {
        pending.reject(error);
      } else if (
        !pending.signal.aborted
        && pendingApprovals.get(pending.approval.approvalId) === pending
      ) {
        pending.resumeTimeout();
      }
      throw error;
    } finally {
      pending.resolving = false;
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

  async function verifyMediaAccess(ownerWebContentsId: number, input: Omit<AgentToolExecutionCommit, 'result'>) {
    if (activeRuns.get(input.sessionId)?.accessGuard) await toolBroker.verifyRendererAccess(ownerWebContentsId, input);
  }

  async function inspectMedia(
    ownerWebContentsId: number,
    input: AgentMediaInspectionRequest,
  ): Promise<AgentToolResult> {
    await verifyMediaAccess(ownerWebContentsId, input);
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
    await verifyMediaAccess(ownerWebContentsId, input);
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
      nodeId,
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
    mediaArtifactFallbackGrants.delete(String(input?.executionId || ''));
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
    await verifyMediaAccess(sender.id, input);
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
    if (purpose === 'upload_fallback') {
      const grant = mediaArtifactFallbackGrants.get(String(input.executionId || ''));
      if (
        !grant
        || grant.artifactId !== String(input.artifactId || '')
        || grant.ownerWebContentsId !== sender.id
        || grant.runId !== String(input.runId || '')
        || grant.sessionId !== String(input.sessionId || '')
      ) {
        throw new Error('资料库上传尚未明确进入可本机兜底状态');
      }
      mediaArtifactFallbackGrants.delete(String(input.executionId || ''));
    }
    const owner = {
      executionId: String(input.executionId || ''),
      ownerScope: normalizeAgentOwnerScope(input.ownerScope),
      ownerWebContentsId: sender.id,
      runId: String(input.runId || ''),
      sessionId: String(input.sessionId || ''),
    };
    if (!mediaArtifactStore.withOwnedFile) {
      throw new Error('当前运行时不支持 Agent 本机保存');
    }
    const task = mediaArtifactStore.withOwnedFile(
      String(input.artifactId || ''),
      owner,
      async ownedFile => saveMediaArtifactAs({
        artifact: ownedFile.artifact,
        copyArtifact: async (temporaryPath, signal) => {
          await pipeline(
            ownedFile.fileHandle.createReadStream({
              autoClose: false,
              end: ownedFile.artifact.sizeBytes - 1,
              start: 0,
            }),
            createWriteStream(temporaryPath, { flags: 'wx' }),
            { signal },
          );
          await ownedFile.verifyUnchanged();
        },
        defaultFileName: outputFileName,
        sender,
        signal: capability.signal,
      }),
    );
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

  async function uploadMediaArtifact(
    sender: WebContents,
    input: AgentMediaArtifactUploadRequest,
  ): Promise<AgentMediaArtifactUploadResult> {
    await verifyMediaAccess(sender.id, input);
    if (!mediaArtifactUploadManager) {
      throw new Error('当前运行时不支持 Agent 媒体产物上传');
    }
    const ownerScope = normalizeAgentOwnerScope(input?.ownerScope);
    const capability = toolBroker.claimRendererCapability(sender.id, {
      capability: 'media.extractAudio.upload',
      executionId: input?.executionId,
      libraryId: Number(input?.libraryId),
      ownerScope,
      runId: input?.runId,
      sessionId: input?.sessionId,
    }, 'media.extractAudio');
    if (!capability.executionInput || typeof capability.executionInput !== 'object') {
      throw new Error('音频上传执行参数无效');
    }
    const executionInput = capability.executionInput as Record<string, unknown>;
    const destination = String(executionInput.destination || '');
    const outputFileName = String(executionInput.outputFileName || '').trim();
    const outputFormat = String(executionInput.outputFormat || '').trim().toLowerCase();
    const parentId = Number(executionInput.parentId);
    const storageProvider = String(executionInput.storageProvider || '').trim();
    const conflictPolicy = String(executionInput.conflictPolicy || '');
    if (
      destination !== 'library'
      || Number(executionInput.libraryId) !== Number(input.libraryId)
      || !outputFileName
      || !Number.isSafeInteger(parentId)
      || parentId <= 0
      || !storageProvider
      || conflictPolicy !== 'auto_rename'
      || (outputFormat !== 'm4a' && outputFormat !== 'mp3' && outputFormat !== 'wav')
    ) {
      throw new Error('音频上传目标与冻结后的 Agent 动作不匹配');
    }
    const contentType = outputFormat === 'mp3'
      ? 'audio/mpeg'
      : outputFormat === 'wav'
        ? 'audio/wav'
        : 'audio/mp4';
    mediaArtifactFallbackGrants.delete(String(input.executionId || ''));
    const uploadResult = await mediaArtifactUploadManager.upload({
      artifactId: input.artifactId,
      credentials: input.credentials,
      expectedUserId: resolveOwnerUserId(ownerScope),
      beforeCommit: () => verifyMediaAccess(sender.id, input),
      onProgress: (uploadedBytes, totalBytes) => {
        if (capability.signal.aborted || totalBytes <= 0) return;
        const percent = Math.floor(65 + Math.max(0, Math.min(1, uploadedBytes / totalBytes)) * 33);
        capability.onProgress({
          message: `正在上传提取后的音频（${percent}%）`,
          percent,
        });
      },
      onSettlementStarted: capability.beginCriticalSettlement,
      owner: {
        executionId: input.executionId,
        ownerScope,
        ownerWebContentsId: sender.id,
        runId: input.runId,
        sessionId: input.sessionId,
      },
      signal: capability.signal,
      target: {
        conflictPolicy: 'auto_rename',
        contentType,
        fileName: outputFileName,
        libraryId: Number(input.libraryId),
        parentId,
        storageProvider,
      },
    });
    if (uploadResult.commitState === 'uncommitted') {
      mediaArtifactFallbackGrants.set(input.executionId, {
        artifactId: input.artifactId,
        ownerWebContentsId: sender.id,
        runId: input.runId,
        sessionId: input.sessionId,
      });
      return uploadResult;
    }
    if (uploadResult.commitState === 'commit_unknown') return uploadResult;
    const node = normalizeCommittedMediaNode(uploadResult.node);
    toolBroker.markRendererExecutionCommitted(sender.id, {
      executionId: input.executionId,
      libraryId: Number(input.libraryId),
      ownerScope,
      result: {
        data: {
          ...(node.id ? { createdNodeId: node.id } : {}),
          destination: 'library',
          format: outputFormat,
          name: node.name,
          parentId,
          uploadCommitState: 'committed',
          verified: false,
        },
        message: `已提取并上传“${node.name}”，正在刷新目录`,
        ok: true,
      },
      runId: input.runId,
      sessionId: input.sessionId,
    });
    return { commitState: 'committed', node };
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
    aiDestination: AgentToolMainAiDestinationSnapshot,
    onPerception: (next: AgentChatRequest['perception']) => void,
    resolveComputerTextAuditSource: AgentComputerTextAuditSourceResolver,
    readOutputTokenBudget?: number,
  ): Promise<AgentToolResult> {
    const tool = capabilitySnapshot.getTool(call.name, activeSkillId);
    let pluginInputError: string | undefined;
    const registeredTool = capabilitySnapshot.toolSnapshot.get(call.name);
    const computerTextAuditSource = resolveComputerTextAuditSource(call.name);
    const privateComputerText = isBuiltinComputerSetTextTool(computerTextAuditSource);
    const preparationMode: AgentPreparedRuntime['preparationMode'] | 'none' = tool?.prepareMain
      ? 'main'
      : tool?.createRendererPrepareRequest && tool.finalizeRendererPreparation
        ? 'renderer'
        : 'none';
    if (tool && !call.inputError) {
      const schemaValidation = capabilitySnapshot.validateInput(
        tool.name,
        call.input,
        activeSkillId,
        tool.registrationId,
      );
      if (!schemaValidation.ok) {
        call.input = { _omniflowAudit: 'invalid Tool input omitted' };
        if (!tool.pluginSource) return { message: privateComputerText ? '文字输入参数无效' : schemaValidation.message, ok: false };
        pluginInputError = schemaValidation.message;
      }
    }
    const toolRunId = crypto.randomUUID();
    const accessGuard = activeRuns.get(sessionId)?.accessGuard;
    const acceptRendererPerception = async (next: AgentPerceptionSnapshot) => {
      if (!accessGuard) { onPerception(next); return; }
      try {
        const filtered = await accessGuard.initialPerception(next);
        if (filtered) onPerception(filtered);
      } catch { /* A refresh failure cannot erase an already committed result. */ }
    };
    let activity: AgentToolActivitySnapshot | undefined;
    let progressWrites = Promise.resolve();
    const persistAndEmitProgress = (rawProgress: AgentToolProgress) => {
      const progress = normalizeToolProgress(privateComputerText ? { message: '正在输入文字' } : rawProgress);
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
    const renameRequest = (source: import('@/shared/agent/agent.types').AgentPluginToolSource, pluginInput: unknown, operationSignal: AbortSignal): AgentPluginRenameRequest => {
      if (tool?.pluginOperation !== 'rename' || !tool.pluginSource || !accessGuard
        || source.registrationId !== tool.registrationId || JSON.stringify(source) !== JSON.stringify(tool.pluginSource)
        || hashToolInput(pluginInput) !== hashToolInput(call.input)) throw new Error('重命名插件调用身份不匹配');
      const nodeIds = [...(pluginInput as { resources: number[] }).resources];
      const assertIdentity = (requestSignal: AbortSignal) => {
        signal.throwIfAborted(); requestSignal.throwIfAborted();
        const activeRun = activeRuns.get(sessionId);
        if (!activeRun || activeRun.runId !== runId || activeRun.ownerWebContentsId !== sender.id || sender.isDestroyed()) throw new Error('重命名运行已结束');
        const current = createAgentAiDestinationSnapshot({ model: input.model, profileId: input.profileId, runtimeConnection: resolveRuntimeProfile(input.profileId) });
        if (current.identity !== aiDestination.identity) throw new Error('AI 目的地已变化，未继续改名');
      };
      const assertCurrent = async (requestSignal: AbortSignal) => {
        assertIdentity(requestSignal); await accessGuard.authorizeRename(nodeIds, toolRunId, false); assertIdentity(requestSignal);
      };
      return { source: tool.pluginSource, input: pluginInput, aiDestinationId: aiDestination.identity, assertCurrent,
        authority: { sender, ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId), sessionId, runId, toolRunId,
          signal: AbortSignal.any([signal, operationSignal]), operation: { operation: 'rename-library-files', nodeIds, includeCredentials: false } } };
    };
    const outputRequest = (source: AgentPluginToolSource, pluginInput: unknown, operationSignal: AbortSignal): AgentPluginFileOutputRequest => {
      if (tool?.pluginOperation !== 'file-output' || !tool.pluginSource || !accessGuard
        || source.registrationId !== tool.registrationId || hashToolInput(source) !== hashToolInput(tool.pluginSource)
        || hashToolInput(pluginInput) !== hashToolInput(call.input)) throw new Error('插件产物调用身份不匹配');
      const outputInput = pluginInput as { resource: { nodeId: number }; destination: { parentId: number } };
      const nodeId = outputInput.resource.nodeId;
      const parentId = outputInput.destination.parentId;
      const assertIdentity = (requestSignal: AbortSignal) => {
        signal.throwIfAborted(); requestSignal.throwIfAborted();
        const activeRun = activeRuns.get(sessionId);
        if (!activeRun || activeRun.runId !== runId || activeRun.ownerWebContentsId !== sender.id || sender.isDestroyed()) throw new Error('插件产物运行已结束');
        const current = createAgentAiDestinationSnapshot({ model: input.model, profileId: input.profileId, runtimeConnection: resolveRuntimeProfile(input.profileId) });
        if (current.identity !== aiDestination.identity) throw new Error('AI 目的地已变化');
      };
      const assertCurrent = async (requestSignal: AbortSignal) => {
        assertIdentity(requestSignal); await accessGuard.authorizeOutput(nodeId, parentId, toolRunId, false); assertIdentity(requestSignal);
      };
      return { source: tool.pluginSource, input: pluginInput, aiDestinationId: aiDestination.identity,
        lifetimeSignal: signal, assertCurrent, onProgress: persistAndEmitProgress,
        authority: { sender, ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId), sessionId, runId, toolRunId,
          signal: AbortSignal.any([signal, operationSignal]), operation: { operation: 'stage-library-node', nodeId, includeDownloadUrl: true } } };
    };
    const executionContext: AgentToolExecutionContext = {
      executePluginFileOutput: async (source, pluginInput, preparation, commit, operationSignal) => {
        if (!options.executePluginFileOutput) throw new Error('插件文件产物执行能力未配置');
        return options.executePluginFileOutput(outputRequest(source, pluginInput, operationSignal), preparation, commit);
      },
      executePluginRename: async (source, pluginInput, preparation, commit, operationSignal) => {
        if (!options.executePluginRename) throw new Error('插件重命名提交能力未配置');
        const request = renameRequest(source, pluginInput, operationSignal);
        return options.executePluginRename(request, preparation, commit);
      },
      executePluginTool: async (source, pluginInput, operationSignal) => {
        if (!options.executePluginTool || !tool?.pluginSource || !accessGuard
          || source.registrationId !== tool.registrationId || JSON.stringify(source) !== JSON.stringify(tool.pluginSource)
          || hashToolInput(pluginInput) !== hashToolInput(call.input)) throw new Error('插件工具调用身份不匹配');
        const nodeId = Number((pluginInput as { resource?: { nodeId?: number } }).resource?.nodeId);
        const assertIdentity = (requestSignal: AbortSignal) => {
          signal.throwIfAborted(); requestSignal.throwIfAborted();
          const activeRun = activeRuns.get(sessionId);
          if (!activeRun || activeRun.runId !== runId || activeRun.ownerWebContentsId !== sender.id || sender.isDestroyed()) throw new Error('插件工具运行已结束');
          const destination = createAgentAiDestinationSnapshot({ model: input.model, profileId: input.profileId, runtimeConnection: resolveRuntimeProfile(input.profileId) });
          if (destination.identity !== aiDestination.identity) throw new Error('AI 目的地已变化，请重新开始任务');
        };
        const assertCurrent = async (requestSignal: AbortSignal) => {
          assertIdentity(requestSignal);
          await accessGuard.authorizeResource(nodeId, false, toolRunId, false);
          assertIdentity(requestSignal);
        };
        await assertCurrent(operationSignal);
        const result = await options.executePluginTool({ source: tool.pluginSource, input: pluginInput,
          authority: { sender, ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId), sessionId, runId, toolRunId,
            signal: AbortSignal.any([signal, operationSignal]), operation: { operation: 'stage-library-node', nodeId, includeDownloadUrl: true } },
          aiDestinationId: aiDestination.identity, assertCurrent });
        await assertCurrent(operationSignal);
        return result;
      },
      operateAttachment: (operation, query) => operateAgentAttachment(getAgentAttachmentStore(),
        { ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId) }, sessionId,
        operation, query, signal, readOutputTokenBudget ?? 10000),
      readAttachment: async query => {
        signal.throwIfAborted();
        const result = await operateAgentAttachment(getAgentAttachmentStore(), { ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId) }, sessionId,
          'read', query, signal, readOutputTokenBudget ?? 10000);
        signal.throwIfAborted(); return result;
      },
      readOutputTokenBudget,
      readLibraryDocumentImage: async ({ nodeId, format, page }, requestSignal) => {
        await accessGuard?.authorizeResource(nodeId, false, toolRunId, false);
        const bytes = await (options.readLibraryText || readAgentLibraryText)({ sender, libraryId: Number(input.appContext.libraryId), ownerScope: input.ownerScope,
          sessionId, runId, toolRunId, signal: requestSignal, operation: { operation: 'stage-library-node', nodeId, includeDownloadUrl: true } });
        const rendered = await runAgentDocument({ format, operation: 'render', bytes, page }, requestSignal);
        if (!rendered.png) throw new Error('文档工具没有生成页面图片');
        const store = getAgentAttachmentStore();
        const scope = { ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId) };
        const image = await store.import({ ...scope, name: `library-node-${nodeId}-page-${rendered.page}.png`, base64: Buffer.from(rendered.png).toString('base64') });
        try { await store.bind(scope, [image.id], sessionId); } catch (error) { await store.discard(scope, image.id).catch(() => undefined); throw error; }
        return { imageId: image.id, fileName: image.name, page: rendered.page, pageCount: rendered.pageCount, warnings: rendered.warnings };
      },
      ...(options.readLibraryText ? { readLibraryText: async (nodeId: number, requestSignal: AbortSignal) => {
        await accessGuard?.authorizeResource(nodeId, false, toolRunId, false);
        return options.readLibraryText!({ sender, libraryId: Number(input.appContext.libraryId),
          ownerScope: input.ownerScope, sessionId, runId, toolRunId, signal: requestSignal,
          operation: { operation: 'stage-library-node', nodeId, includeDownloadUrl: true } }); } } : {}),
      ...(options.readLibraryText ? { readLibraryDocument: async (nodeId: number, requestSignal: AbortSignal) => {
        await accessGuard?.authorizeResource(nodeId, false, toolRunId, false);
        return options.readLibraryText!({ sender, libraryId: Number(input.appContext.libraryId), ownerScope: input.ownerScope,
          sessionId, runId, toolRunId, signal: requestSignal,
          operation: { operation: 'stage-library-node', nodeId, includeDownloadUrl: true } }); } } : {}),
      sessionId,
      readOperationJournal: async (operationId: string, operationSignal: AbortSignal) => {
        throwIfAborted(operationSignal);
        const journalSession = await resolveSessionStore().then(store => store.getSession(
          sessionId,
          input.ownerScope,
          Number(input.appContext.libraryId),
        ));
        throwIfAborted(operationSignal);
        const activity = journalSession?.toolActivities.find(candidate => {
          const data = candidate.result?.data;
          return candidate.id === operationId
            || (data && typeof data === 'object' && !Array.isArray(data)
              && (data as Record<string, unknown>).operationId === operationId);
        });
        if (!activity) return undefined;
        const data = activity.result?.data;
        const commitState = data && typeof data === 'object' && !Array.isArray(data)
          ? String((data as Record<string, unknown>).mutationCommitState
            || (data as Record<string, unknown>).writeCommitState
            || (data as Record<string, unknown>).deleteCommitState
            || (data as Record<string, unknown>).uploadCommitState
            || '')
          : '';
        const status = commitState === 'committed' || activity.result?.ok === true
          ? 'committed'
          : commitState === 'uncommitted' ? 'uncommitted'
            : commitState === 'commit_unknown' ? 'commit_unknown' : 'unknown';
        return { operationId, toolName: activity.call.name, status, ...(activity.result ? { result: activity.result } : {}) };
      },
      ...(options.readLibraryMetadata ? { readLibraryMetadata: async (query, requestSignal) => {
        await accessGuard?.authorizeQuery(query, false, toolRunId);
        const libraryId = Number(input.appContext.libraryId);
        const data = normalizeAgentLibraryReadResult(await options.readLibraryMetadata!({
          sender, libraryId, ownerScope: input.ownerScope, sessionId, runId, toolRunId,
          signal: requestSignal, operation: { operation: 'query-library-metadata', query },
        }), libraryId);
        await accessGuard?.checkMetadata(data, toolRunId);
        const known = new Map((executionContext.perception?.knownNodes || []).map(node => [node.id, node]));
        for (const node of [...(data.entries || []), ...(data.node ? [data.node] : []), ...(data.directory ? [data.directory] : [])]) {
          known.delete(node.id); known.set(node.id, node);
        }
        const next = { selectedNodes: [], collectedAt: now(), ...perception, knownNodes: Array.from(known.values()).slice(-500) };
        executionContext.perception = next;
        onPerception(next);
        return data;
      } } satisfies Pick<AgentToolExecutionContext, 'readLibraryMetadata'> : {}),
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
        toolContext: AgentToolDispatchContext,
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
    let preflightDecision: AgentToolPermissionDecision | undefined = pluginInputError ? { behavior: 'deny', risk: 'read', message: pluginInputError } : undefined;
    let scopeMayAutoApprove = false;
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
    const auditProjection = projectAgentToolAuditInput(call.input, computerTextAuditSource || tool);
    let safeCallInput = privateComputerText ? auditProjection.input : call.input;
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
    // 插件来源在资源审批之前落盘；停止等待审批时也保留真实调用身份。
    if (!preflightDecision && !call.inputError && tool?.pluginSource && accessGuard) {
      activity = await store.createToolRun({ callId: call.id, id: toolRunId, input: auditProjection.input,
        now: now(), permissionBehavior: tool.pluginOperation ? 'ask' : 'allow', runId, status: preparationMode === 'none' ? 'running' : 'preparing', toolKind: tool.kind,
        toolName: call.name, pluginSource: tool.pluginSource });
      emit(sender, { activity, call: { id: call.id, input: safeCallInput, name: call.name }, runId, sessionId, type: 'tool-started' });
      persistAndEmitProgress({ message: '检查插件读取范围' });
    }
    if (!preflightDecision && !call.inputError && tool && accessGuard) {
      try {
        scopeMayAutoApprove = await accessGuard.authorizeTool(call, toolRunId);
        const known = new Map((executionContext.perception?.knownNodes || []).map(node => [node.id, node]));
        for (const node of accessGuard.observedNodes()) known.set(node.id, node);
        perception = { ...executionContext.perception, selectedNodes: executionContext.perception?.selectedNodes || [],
          collectedAt: now(), knownNodes: [...known.values()].slice(-500) };
        executionContext.perception = perception;
        onPerception(perception);
      } catch (error) {
        if (signal.aborted) throw error;
        preflightDecision = { behavior: 'deny', risk: tool.risk, message: error instanceof Error ? error.message : '文件访问未获授权' };
      }
    }

    let decision: AgentToolPermissionDecision;
    let rendererExecutionInput: unknown;
    let preparedApproval: PendingAgentApproval['prepared'];
    let approvalId: string | undefined;

    if (!preflightDecision && !call.inputError && tool && preparationMode !== 'none') {
      const validation = await tool.validate?.(call.input, executionContext);
      if (validation && !validation.ok) {
        decision = {
          behavior: 'deny',
          message: privateComputerText ? '文字输入参数无效' : validation.message,
          risk: tool.risk,
        };
      } else {
        if (!activity) activity = await store.createToolRun({
          callId: call.id,
          id: toolRunId,
          input: safeCallInput,
          now: now(),
          permissionBehavior: tool.risk === 'read' ? 'allow' : 'ask',
          runId,
          status: 'preparing',
          toolKind: tool.kind,
          toolName: call.name,
          ...(registeredTool?.pluginSource ? { pluginSource: registeredTool.pluginSource } : {}),
        });
        emit(sender, {
          activity,
          call: { id: call.id, input: safeCallInput, name: call.name },
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
          let finalizePrepared: (
            requestedAction?: AgentPreparedActionPublic,
            preparedActionId?: string,
          ) => Promise<AgentPreparedRuntime>;
          if (preparationMode === 'renderer') {
            finalizePrepared = async (requestedAction, preparedActionId = crypto.randomUUID()) => {
              const prepareInput = tool.createRendererPrepareRequest!(call.input, executionContext, requestedAction);
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
              throwIfAborted(signal);
              return toolPrepareBroker.prepareMain({
                prepare: async (preparationSignal) => {
                  const preparationContext: AgentToolExecutionContext = {
                    activeSkillId,
                    appContext: input.appContext,
                    onProgress: () => undefined,
                    perception,
                    runCapabilitySnapshot: capabilitySnapshot,
                    signal: preparationSignal,
                  };
                  const result = await tool.finalizeRendererPreparation!(
                    call.input,
                    rendererPreparation,
                    requestedAction,
                    preparationContext,
                  );
                  throwIfAborted(preparationSignal);
                  return createPreparedRuntime(result, call.name, tool.risk, tool.preparedRisk, 'renderer', {
                    permissionMode: await accessGuard?.canAutoApproveTool(call, toolRunId, result.publicAction) ? 'full-access' : capabilitySnapshot.shellPermissionMode,
                    preparedActionId,
                  });
                },
                signal,
                toolName: call.name,
              });
            };
          } else {
            const ownerScope = Object.freeze(normalizeAgentOwnerScope(input.ownerScope));
            const libraryId = Number(input.appContext.libraryId);
            if (!Number.isSafeInteger(libraryId) || libraryId <= 0) {
              throw new Error('Agent main Tool 缺少有效的资料库身份');
            }
            const toolInputHash = hashAgentToolInputForPreparation(call.input);
            finalizePrepared = async (requestedAction, preparedActionId = crypto.randomUUID()) => {
              const preparationIdentity: AgentToolMainPreparationIdentity = Object.freeze({
                aiDestinationIdentity: aiDestination.identity,
                callId: call.id,
                libraryId,
                ownerScope,
                ownerWebContentsId: sender.id,
                preparedActionId,
                runCapabilityIdentity: capabilitySnapshot.identity,
                runId,
                sessionId,
                toolInputHash,
                toolName: call.name,
                toolRegistrationId: tool.registrationId,
                toolRunId,
              });
              return toolPrepareBroker.prepareMain({
                prepare: async (preparationSignal) => {
                  const preparationContext: AgentToolMainPreparationContext = {
                    ...(tool.pluginOperation === 'file-output' ? {
                      preparePluginFileOutput: async (source: AgentPluginToolSource, pluginInput: unknown, operationSignal: AbortSignal) => {
                        if (!options.preparePluginFileOutput) throw new Error('插件文件产物准备能力未配置');
                        return options.preparePluginFileOutput(outputRequest(source, pluginInput, operationSignal));
                      },
                    } : {}),
                    ...(tool.pluginOperation === 'rename' ? {
                      preparePluginRename: async (source: AgentPluginToolSource, pluginInput: unknown, operationSignal: AbortSignal) => {
                        if (!options.preparePluginRename) throw new Error('插件重命名提案能力未配置');
                        return options.preparePluginRename(renameRequest(source, pluginInput, operationSignal));
                      },
                    } : {}),
                    activeSkillId,
                    aiDestination,
                    appContext: input.appContext,
                    ownerScope,
                    ownerWebContentsId: sender.id,
                    perception,
                    preparationIdentity,
                    runCapabilitySnapshot: capabilitySnapshot,
                    signal: preparationSignal,
                  };
                  const result = await tool.prepareMain!(
                    call.input,
                    requestedAction,
                    preparationContext,
                  );
                  throwIfAborted(preparationSignal);
                  return createPreparedRuntime(result, call.name, tool.risk, tool.preparedRisk, 'main', {
                    computerText: privateComputerText,
                    pluginOperation: tool.pluginOperation,
                    permissionMode: tool.pluginOperation ? 'ask' : await accessGuard?.canAutoApproveTool(call, toolRunId, result.publicAction) ? 'full-access' : capabilitySnapshot.shellPermissionMode,
                    identity: preparationIdentity,
                    sealMain: sealInput => capabilitySnapshot.sealMainPreparedExecution(
                      call.name,
                      sealInput,
                      activeSkillId,
                      tool.registrationId,
                    ),
                  });
                },
                signal,
                toolName: call.name,
              });
            };
          }
          const prepared = await finalizePrepared();
          throwIfAborted(signal);
          decision = prepared.permissionBehavior === 'ask'
            ? { behavior: 'ask', preview: prepared.preview, risk: prepared.preview.risk }
            : { behavior: 'allow', risk: prepared.preview.risk };
          if (preparationMode === 'renderer') {
            rendererExecutionInput = prepared.executionInput;
          }
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
            call: { id: call.id, input: safeCallInput, name: call.name },
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
            message: privateComputerText ? '文字输入准备失败，请重新查看窗口' : normalizeAgentErrorMessage(error, `${call.name} 准备失败`),
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
            message: privateComputerText ? '文字输入参数无效' : call.inputError,
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
    if (preparationMode === 'none') {
      decision = resolveAgentRunPermissionDecision(call.name, decision, capabilitySnapshot.shellPermissionMode);
      if (scopeMayAutoApprove && decision.behavior === 'ask' && decision.risk === 'write') decision = { behavior: 'allow', risk: 'write' };
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
      if (!privateComputerText) call.input = omitDeniedAudit
        ? { _omniflowAudit: 'sensitive interaction request omitted' }
        : auditProjection.input;
      if (!privateComputerText) safeCallInput = call.input;
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
        input: safeCallInput,
        now: now(),
        permissionBehavior: decision.behavior,
        runId,
        status: decision.behavior === 'ask' ? 'awaiting_approval' : 'running',
        toolKind: tool?.kind || registeredTool?.kind || 'business',
        toolName: call.name,
        ...(registeredTool?.pluginSource ? { pluginSource: registeredTool.pluginSource } : {}),
      });
      emit(sender, {
        activity,
        call: { id: call.id, input: safeCallInput, name: call.name },
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
      if (decision.behavior !== 'deny') await accessGuard?.authorizeTool(call, toolRunId, preparedApproval?.current.action, false);
      if (decision.behavior === 'deny') {
        result = { message: decision.message, ok: false };
      } else if (!tool) {
        result = { message: `Agent Tool 不存在：${call.name}`, ok: false };
      } else if (decision.behavior === 'ask' && approvalId) {
        const approval: AgentToolApprovalSnapshot = {
          approvalId,
          call: { id: call.id, input: safeCallInput, name: call.name },
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
          verifyAccess: accessGuard ? async () => { await accessGuard.authorizeTool(call, toolRunId, preparedApproval?.current.action, false); } : undefined,
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
          approvalId: approved.approvalId,
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
          if (outcome.perception) await acceptRendererPerception(outcome.perception);
          result = outcome.result;
        } else {
          const mainExecutionContext = tool.prepareMain
            ? withMainPreparedExecution({
                ...executionContext,
                perception,
              }, approved.prepared)
            : {
                ...executionContext,
                perception,
              };
          result = await toolBroker.executeMain(call.name, call.input, {
            ...mainExecutionContext,
          }, tool.timeoutMs, runToolRegistry, tool.cancellationSettleTimeoutMs);
        }
      } else if ((tool.executor || 'main') === 'renderer') {
        const execution = toolBroker.prepareRendererExecution({
          verifyAccess: accessGuard ? async () => { await accessGuard.authorizeTool(call, toolRunId, preparedApproval?.current.action, false); } : undefined,
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
        if (outcome.perception) await acceptRendererPerception(outcome.perception);
        result = outcome.result;
      } else {
        const mainExecutionContext = tool.prepareMain
          ? withMainPreparedExecution(executionContext, preparedApproval?.current)
          : executionContext;
        result = await toolBroker.executeMain(
          call.name,
          call.input,
          mainExecutionContext,
          tool.timeoutMs,
          runToolRegistry,
          tool.cancellationSettleTimeoutMs,
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
        message: privateComputerText ? '文字输入未发送，请重新查看窗口' : normalizeAgentErrorMessage(error, `${call.name} 执行失败`),
        ok: false,
      };
    } finally {
      if (tool?.pluginOperation === 'file-output') await (options.releasePluginOutputs ?? releaseAgentPluginOutputs)(runId, toolRunId).catch(() => undefined);
    }

    const textAction = preparedApproval?.current.action;
    result = normalizeAgentToolResult(privateComputerText ? projectAgentComputerTextResult(result,
      textAction?.kind === 'computer.setText' ? textAction : undefined) : result);
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
      call: { id: call.id, input: safeCallInput, name: call.name },
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
    modelAdapter: AgentModelAdapter,
    windowSource: AgentContextUsageSnapshot['windowSource'],
    resolveComputerTextAuditSource: AgentComputerTextAuditSourceResolver,
    continuationInstruction = '',
  ): Promise<void> {
    const sessionId = session.id;
    const providerMaxOutputTokens = resolveAgentProviderOutputTokens(contextBudget);
    let assistantRunCharacterCount = 0;
    let activeAssistantWriter: AgentAssistantTurnWriter | null = null;
    const exposeActiveAssistantWriter = (writer: AgentAssistantTurnWriter | null) => {
      const active = activeRuns.get(sessionId);
      if (!active || active.runId !== runId) return;
      if (writer) active.assistantWriter = writer;
      else delete active.assistantWriter;
    };
    const appendAndEmitAssistantDelta = (delta: string) => {
      if (!activeAssistantWriter) {
        throw new Error('Agent assistant turn 尚未开始');
      }
      if (delta.length > MAX_ASSISTANT_RUN_CHARACTERS - assistantRunCharacterCount) {
        throw new AIServiceStreamLimitError('Agent 单次运行回答', MAX_ASSISTANT_RUN_CHARACTERS);
      }
      const offset = activeAssistantWriter.append(delta);
      assistantRunCharacterCount += delta.length;
      emit(sender, {
        delta,
        itemId: activeAssistantWriter.getSnapshot().id,
        offset,
        runId,
        sessionId,
        type: 'assistant-item-delta',
      });
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
    // Tool signals end with each broker execution. Window sharing must also
    // release synchronously when the actual Run is stopped between tools.
    const releaseComputerOnAbort = () => releaseAgentComputerRun(runId);
    controller.signal.addEventListener('abort', releaseComputerOnAbort, { once: true });
    if (controller.signal.aborted) releaseComputerOnAbort();
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
          providerTools: modelAdapter.toolCalling ? [createAgentPlanControlTool(visibleTools.filter(tool => tool.kind === 'business').map(tool => tool.name)), ...visibleTools] : [],
        };
      };
      const initialCapabilityView = getProviderCapabilityView();
      const initialSystemPrompt = buildAgentSystemPrompt(
        input.appContext,
        input.perception,
        initialCapabilityView.capabilities,
        skillSummaries,
        omittedSkillCount,
        modelAdapter,
      );
      const initialFallbackSystemPrompt = buildAgentFallbackSystemPrompt(
        input.appContext,
        input.perception,
        modelAdapter,
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
        fixedInputTokens: fixedInputTokens + (continuationInstruction
          ? estimateAgentProviderMessagesTokens([{ role: 'user', content: continuationInstruction }]) : 0),
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
        ...(continuationInstruction ? [{ role: 'user' as const, content: continuationInstruction }] : []),
      ];
      const activeToolResults: AgentActiveToolResultRecord[] = [];
      const usageLedger = createAgentContextUsageLedger(contextBudget, windowSource);
      if (contextProjection.droppedMessageCount > 0) usageLedger.compacted();
      const getProviderRequestLimit = usageLedger.requestLimit;
      let completionReviewPending = false;
      const reportRetry = async (attempt: number, maximum: number) => {
        controller.signal.throwIfAborted();
        await updateRunAndEmit(sender, store, sessionId, runId, {
          currentStep: `正在重新连接 ${attempt}/${maximum}`, status: 'running', updatedAt: now(),
        });
      };
      const publishContextUsage = async (request: AgentContextRequest, phase: AgentContextUsageSnapshot['phase']) => {
        if (controller.signal.aborted) return;
        const updatedAt = now();
        await updateRunAndEmit(sender, store, sessionId, runId, {
          contextUsage: usageLedger.snapshot(request, phase, updatedAt),
          currentStep: completionReviewPending ? '正在核对结果'
            : phase === 'before-request' ? '请求 AI 服务' : phase === 'after-response' ? '处理模型响应' : '准备工具续接',
          status: 'running', updatedAt,
        });
      };
      const assertProviderTurnFitsObservedContext = (
        providerInput: {
          messages: readonly AgentProviderMessage[];
          systemPrompt: string;
          tools: readonly unknown[];
        },
        phase: string,
      ) => {
        const estimatedTokens = estimateAgentProviderTurnTokens(providerInput);
        const requestTokenLimit = getProviderRequestLimit();
        if (estimatedTokens > requestTokenLimit) {
          throw new Error(
            `${phase}超过模型上下文窗口：请求预计 ${estimatedTokens} token，`
            + `当前最多可使用 ${requestTokenLimit} token；已停止调用，未静默省略当前任务内容`,
          );
        }
        return estimatedTokens;
      };
      const plainMessages = messages.map(message => ({
        content: message.content,
        ...(message.role === 'user' && message.attachments?.length ? { attachments: message.attachments } : {}),
        role: message.role as 'user' | 'assistant',
      }));
      let currentPerception = input.perception;
      // The Run snapshot freezes each Skill version. Successful activation
      // bodies remain protected from compaction, so later loads need only an
      // identity receipt. activeSkillId stays the most recent ID for existing
      // Tool dispatch interfaces; it does not limit available Skills or Tools.
      const loadedSkillIds = new Set<string>();
      let activeSkillId: string | undefined;
      const seenToolCallIds = new Set<string>();
      const compactActiveContext = async (fitInput: {
        estimateTokens: (candidateMessages: readonly AgentProviderMessage[]) => number;
        preserveLatestToolResult?: boolean;
        requestTokenLimit: number;
      }) => compactAgentActiveContextToFit({
        ...fitInput,
        canSummarizeCandidate: candidate => {
          try {
            const payload = buildAgentActiveContextSummaryPayload({ candidate, userPrompt: input.userPrompt });
            return estimateAgentProviderTurnTokens({
              messages: [{ content: payload, role: 'user' }],
              systemPrompt: AGENT_ACTIVE_CONTEXT_SUMMARY_SYSTEM_PROMPT,
              tools: [],
            }) + AGENT_ACTIVE_CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS <= contextBudget.contextWindowTokens;
          } catch { return false; }
        },
        onCompacted: () => usageLedger.compacted(),
        messages,
        summarize: async (candidate) => {
          const payload = buildAgentActiveContextSummaryPayload({
            candidate,
            userPrompt: input.userPrompt,
          });
          const summaryRequestTokens = estimateAgentProviderTurnTokens({
            messages: [{ content: payload, role: 'user' }],
            systemPrompt: AGENT_ACTIVE_CONTEXT_SUMMARY_SYSTEM_PROMPT,
            tools: [],
          });
          if (
            summaryRequestTokens + AGENT_ACTIVE_CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS
            > contextBudget.contextWindowTokens
          ) {
            throw new Error('Agent 当前 Run 语义压缩超过模型上下文，无法安全继续');
          }
          await updateRunAndEmit(sender, store, sessionId, runId, {
            currentStep: '整理当前任务上下文',
            status: 'running',
            updatedAt: now(),
          });
          const output = await retryBufferedAgentTransport(() => streamAIServiceProfile({
            maxOutputTokens: AGENT_ACTIVE_CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS,
            messages: [{ content: payload, role: 'user' }],
            model: input.model,
            profileId: input.profileId,
            reasoningEffort: 'auto',
            systemPrompt: AGENT_ACTIVE_CONTEXT_SUMMARY_SYSTEM_PROMPT,
            temperature: 0,
          }, () => undefined, runtimeConnection, controller.signal, {
            maxContentCharacters: AGENT_ACTIVE_CONTEXT_SUMMARY_MAX_CHARACTERS,
          }), controller.signal, undefined, reportRetry);
          return normalizeAgentActiveContextSummary(output);
        },
        toolResults: activeToolResults,
      });
      const recentToolTurnProgressHashes: string[] = [];
      let completedToolCalls = 0;
      let completionChecked = false;
      let interruptedReadContinuations = 0;
      let nonReadToolAttempted = false;
      const assertToolTurnMadeProgress = (entries: AgentToolTurnProgressEntry[]) => {
        recentToolTurnProgressHashes.push(hashAgentToolTurnProgress(entries));
        if (recentToolTurnProgressHashes.length > AGENT_TOOL_PROGRESS_HISTORY_LIMIT) {
          recentToolTurnProgressHashes.shift();
        }
        if (hasRepeatedAgentToolProgressCycle(recentToolTurnProgressHashes)) {
          throw new Error(
            'Agent 工具调用与结果形成重复且无进展的调用周期；已停止当前 Run 以避免无进展循环',
          );
        }
      };

      for (let round = 0; ; round += 1) {
        const bufferTurn = completionReviewPending || shouldCheckAgentCompletion({
          checked: completionChecked, completedToolCalls, pendingToolCalls: 0, nonReadToolAttempted,
        });
        const roundCapabilityView = getProviderCapabilityView(activeSkillId);
        await updateRunAndEmit(sender, store, sessionId, runId, {
          currentStep: completionReviewPending ? '正在核对结果' : round === 0 ? '请求 AI 服务' : '根据工具结果继续思考',
          status: 'running',
          updatedAt: now(),
        });
        activeAssistantWriter = await createAgentAssistantTurnWriter(
          store,
          runId,
        );
        exposeActiveAssistantWriter(activeAssistantWriter);
        emit(sender, {
          item: activeAssistantWriter.getSnapshot(),
          runId,
          sessionId,
          type: 'assistant-item-started',
        });
        const characterCountBeforeTurn = assistantRunCharacterCount;
        let turn;
        try {
          const systemPrompt = buildAgentSystemPrompt(
            input.appContext,
            currentPerception,
            roundCapabilityView.capabilities,
            skillSummaries,
            omittedSkillCount,
            modelAdapter,
          );
          const providerTurnInput = {
            modelAdapter,
            maxOutputTokens: providerMaxOutputTokens,
            messages,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            systemPrompt,
            tools: roundCapabilityView.providerTools,
          };
          await compactActiveContext({
            estimateTokens: candidateMessages => estimateAgentProviderTurnTokens({
              ...providerTurnInput,
              messages: [...candidateMessages],
            }),
            requestTokenLimit: getProviderRequestLimit(),
          });
          assertProviderTurnFitsObservedContext(
            providerTurnInput,
            round === 0 ? '当前 Agent 请求' : `Agent 第 ${round + 1} 轮工具续接请求`,
          );
          await publishContextUsage(providerTurnInput, 'before-request');
          const multimodalMessages = await hydrateAgentAttachmentImages(providerTurnInput.messages, { ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId) }, sessionId);
          controller.signal.throwIfAborted();
          turn = await streamAgentProviderTurn(runtimeConnection, { ...providerTurnInput, messages: multimodalMessages }, (delta) => {
            if (!bufferTurn) appendAndEmitAssistantDelta(delta);
          }, controller.signal, {
            maxAssistantContentCharacters: Math.min(
              MAX_ASSISTANT_TURN_CHARACTERS,
              providerMaxOutputTokens * 4,
            ),
          }, {
            bufferOutput: bufferTurn,
            onRetry: reportRetry,
          });
          usageLedger.observe(providerTurnInput, turn.usage);
        } catch (error) {
          if (canResumeInterruptedReadTurn({ error, aborted: controller.signal.aborted, nonReadToolAttempted,
            recoveries: interruptedReadContinuations, hasPartialContent: assistantRunCharacterCount > characterCountBeforeTurn })) {
            interruptedReadContinuations += 1;
            const partial = activeAssistantWriter.close();
            const notice = '\n\n[本段模型响应因连接中断而未完成，运行时正在续接；本段未执行任何新工具。]';
            const item = await store.finishAssistantCommentary({
              id: partial.id, expectedRevision: partial.expectedRevision,
              content: partial.content + notice, now: now(),
            });
            activeAssistantWriter = null;
            exposeActiveAssistantWriter(null);
            emit(sender, { type: 'assistant-item-finished', item, runId, sessionId });
            messages.push({ role: 'assistant', content: partial.content + notice }, { role: 'user', content:
              '[OmniFlow runtime recovery] 上一轮模型输出连接中断，未完成的工具参数已丢弃且没有执行。已有成功工具结果仍有效。请继续原任务，不重复此前成功操作，不把中断片段当作已验证事实；当前权限不变。' });
            await waitForAgentRetry(interruptedReadContinuations, controller.signal, { maximum: 2, onRetry: reportRetry });
            continue;
          }
          if (
            round !== 0
            || assistantRunCharacterCount !== characterCountBeforeTurn
            || !isToolProtocolUnsupported(error)
          ) {
            throw error;
          }
          const fallbackInput = {
            modelAdapter,
            maxOutputTokens: providerMaxOutputTokens,
            messages: [...fallbackContextMessages, ...plainMessages],
            model: input.model,
            profileId: input.profileId,
            reasoningEffort: input.reasoningEffort,
            systemPrompt: buildAgentFallbackSystemPrompt(input.appContext, currentPerception, modelAdapter),
          };
          assertProviderTurnFitsObservedContext(
            { ...fallbackInput, tools: [] },
            '当前 Agent 兼容模式请求',
          );
          const fallbackRequest = { ...fallbackInput, tools: [] };
          await publishContextUsage(fallbackRequest, 'before-request');
          const fallbackMessages = await hydrateAgentAttachmentImages(fallbackRequest.messages, { ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId) }, sessionId);
          controller.signal.throwIfAborted();
          const fallbackResponse = await streamAgentProviderTurn(runtimeConnection, { ...fallbackRequest, messages: fallbackMessages }, (delta) => {
            appendAndEmitAssistantDelta(delta);
          }, controller.signal, {
            maxAssistantContentCharacters: Math.min(
              MAX_ASSISTANT_TURN_CHARACTERS,
              providerMaxOutputTokens * 4,
            ),
          });
          usageLedger.observe(fallbackRequest, fallbackResponse.usage);
          await publishContextUsage({ ...fallbackRequest, messages: [...fallbackRequest.messages,
            { role: 'assistant', content: fallbackResponse.content }] }, 'after-response');
          break;
        }

        markAgentActiveToolResultsConsumed(activeToolResults);
        if (!modelAdapter.toolCalling && turn.toolCalls.length) throw new Error('当前模型适配未开放 Tool Calling；未执行任何工具');
        const toolCalls = turn.toolCalls.map((call, callIndex) => ({
          ...call,
          id: claimUniqueAgentToolCallId(
            call.id,
            seenToolCallIds,
            round + 1,
            callIndex + 1,
          ),
        }));
        messages.push({
          content: turn.content,
          role: 'assistant',
          ...(toolCalls.length > 0 ? { toolCalls: toolCalls.map(call =>
            isBuiltinComputerSetTextTool(resolveComputerTextAuditSource(call.name))
              ? { ...call, input: projectAgentComputerTextInput(call.input), inputError: call.inputError ? '文字输入参数无效' : undefined }
              : call) } : {}),
        });
        await publishContextUsage({ messages, systemPrompt: buildAgentSystemPrompt(input.appContext, currentPerception,
          roundCapabilityView.capabilities, skillSummaries, omittedSkillCount, modelAdapter),
          tools: roundCapabilityView.providerTools }, 'after-response');
        controller.signal.throwIfAborted();
        const checkCompletion = shouldCheckAgentCompletion({
          checked: completionChecked, completedToolCalls, pendingToolCalls: toolCalls.length, nonReadToolAttempted,
        });
        if (bufferTurn) {
          if (checkCompletion) {
            // Keep the candidate in model context only; its empty display item closes below.
            if (turn.content.length > MAX_ASSISTANT_RUN_CHARACTERS - assistantRunCharacterCount) {
              throw new AIServiceStreamLimitError('Agent 单次运行回答', MAX_ASSISTANT_RUN_CHARACTERS);
            }
            assistantRunCharacterCount += turn.content.length;
          } else {
            appendAndEmitAssistantDelta(turn.content);
          }
        }
        completionReviewPending = false;
        if (toolCalls.length === 0 && !checkCompletion) {
          break;
        }
        const commentary = activeAssistantWriter.close();
        const finishedCommentary = await store.finishAssistantCommentary({
          content: commentary.content,
          expectedRevision: commentary.expectedRevision,
          id: commentary.id,
          now: now(),
        });
        activeAssistantWriter = null;
        exposeActiveAssistantWriter(null);
        emit(sender, {
          item: finishedCommentary,
          runId,
          sessionId,
          type: 'assistant-item-finished',
        });
        if (checkCompletion) {
          completionChecked = true;
          completionReviewPending = true;
          messages.push({ role: 'user', content: AGENT_COMPLETION_CHECK_PROMPT });
          continue;
        }
        const activationCalls = toolCalls.filter(
          call => call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME,
        );
        if (activationCalls.length > 0 && toolCalls.length !== 1) {
          const rejectionResult: AgentToolResult = {
            message: 'skill.activate 必须独占一次 Tool 调用；本轮所有 Tool 均未执行，请下一轮只调用 skill.activate',
            ok: false,
          };
          const rejection = projectAgentToolResultForProvider(
            rejectionResult,
            DEFAULT_PROVIDER_TOOL_RESULT_TOKENS,
          );
          const rejectedToolMessages: AgentProviderMessage[] = toolCalls.map(call => ({
            content: rejection.content,
            name: call.name,
            role: 'tool',
            toolCallId: call.id,
          }));
          await compactActiveContext({
            estimateTokens: candidateMessages => estimateAgentProviderTurnTokens({
              messages: [...candidateMessages, ...rejectedToolMessages],
              systemPrompt: buildAgentSystemPrompt(
                input.appContext,
                currentPerception,
                roundCapabilityView.capabilities,
                skillSummaries,
                omittedSkillCount,
                modelAdapter,
              ),
              tools: roundCapabilityView.providerTools,
            }),
            preserveLatestToolResult: false,
            requestTokenLimit: getProviderRequestLimit(),
          });
          assertProviderTurnFitsObservedContext({
            messages: [...messages, ...rejectedToolMessages],
            systemPrompt: buildAgentSystemPrompt(
              input.appContext,
              currentPerception,
              roundCapabilityView.capabilities,
              skillSummaries,
              omittedSkillCount,
              modelAdapter,
            ),
            tools: roundCapabilityView.providerTools,
          }, 'Agent Skill 激活协议拒绝续接请求');
          toolCalls.forEach((call) => {
            appendAgentActiveToolResult({
              allowCompaction: true,
              messages,
              projectedResult: rejection,
              toolCallId: call.id,
              toolName: call.name,
              toolResults: activeToolResults,
            });
          });
          assertToolTurnMadeProgress(toolCalls.map(call => ({
            input: call.input,
            name: call.name,
            result: rejection.content,
          })));
          continue;
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
        await compactActiveContext({
          estimateTokens: candidateMessages => estimateContinuationTokensBeforeSideEffects({
            modelAdapter,
            appContext: input.appContext,
            capabilities: minimumContinuationCapabilityView.capabilities,
            currentPerception,
            messages: [...candidateMessages, ...minimumToolResultMessages],
            omittedSkillCount,
            skillSummaries,
            tools: minimumContinuationCapabilityView.providerTools,
          }),
          preserveLatestToolResult: false,
          requestTokenLimit: getProviderRequestLimit(),
        });
        const minimumContinuationTokens = estimateContinuationTokensBeforeSideEffects({
          modelAdapter,
          appContext: input.appContext,
          capabilities: minimumContinuationCapabilityView.capabilities,
          currentPerception,
          messages: [...messages, ...minimumToolResultMessages],
          omittedSkillCount,
          skillSummaries,
          tools: minimumContinuationCapabilityView.providerTools,
        });
        if (minimumContinuationTokens > getProviderRequestLimit()) {
          throw new Error(
            `Agent 工具调用已占满模型上下文：完整续接协议预计至少 ${minimumContinuationTokens} token，`
            + `当前最多可使用 ${getProviderRequestLimit()} token；本轮未执行工具`,
          );
        }

        const toolTurnProgress: Array<{
          input: unknown;
          name: string;
          result: AgentToolResult;
        }> = [];
        for (const [callIndex, call] of toolCalls.entries()) {
          const futureMinimumResultMessages = minimumToolResultMessages.slice(callIndex + 1);
          const currentMinimumResultMessage = minimumToolResultMessages[callIndex];
          await compactActiveContext({
            estimateTokens: candidateMessages => estimateContinuationTokensBeforeSideEffects({
              modelAdapter,
              appContext: input.appContext,
              capabilities: minimumContinuationCapabilityView.capabilities,
              currentPerception,
              messages: [
                ...candidateMessages,
                currentMinimumResultMessage,
                ...futureMinimumResultMessages,
              ],
              omittedSkillCount,
              skillSummaries,
              tools: minimumContinuationCapabilityView.providerTools,
            }),
            preserveLatestToolResult: false,
            requestTokenLimit: getProviderRequestLimit(),
          });
          const preExecutionMinimumTokens = estimateContinuationTokensBeforeSideEffects({
            modelAdapter,
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
          if (preExecutionMinimumTokens > getProviderRequestLimit()) {
            throw new Error(
              `Agent Tool 结果没有足够的模型上下文预算：完整续接协议至少需要 `
              + `${preExecutionMinimumTokens} token，当前最多可使用 `
              + `${getProviderRequestLimit()} token；当前工具未执行`,
            );
          }
          const expectedActivationResult = call === exclusiveActivationCall
            ? expectedExclusiveActivationResult
            : undefined;
          let expectedActivationProjection: ReturnType<
            typeof projectAgentToolResultForProvider
          > | undefined;
          if (expectedActivationResult) {
            const expectedCapabilityView = minimumContinuationCapabilityView;
            const activationResultPolicy = resolveAgentProviderToolResultPolicy(call.name);
            expectedActivationProjection = projectAgentToolResultForProvider(
              getSkillActivationContextResult(expectedActivationResult, loadedSkillIds),
              activationResultPolicy.maxTokens,
              activationResultPolicy.projectionOptions,
            );
            if (expectedActivationProjection.truncated) {
              throw new Error(
                `Agent Skill 完整说明无法放入当前模型上下文；当前 Skill 未激活`,
              );
            }
            const expectedActivationMessage: AgentProviderMessage = {
              content: expectedActivationProjection.content,
              name: call.name,
              role: 'tool',
              toolCallId: call.id,
            };
            const activationFit = await compactActiveContext({
              estimateTokens: candidateMessages => estimateContinuationTokensBeforeSideEffects({
                modelAdapter,
                appContext: input.appContext,
                capabilities: expectedCapabilityView.capabilities,
                currentPerception,
                messages: [
                  ...candidateMessages,
                  expectedActivationMessage,
                  ...futureMinimumResultMessages,
                ],
                omittedSkillCount,
                skillSummaries,
                tools: expectedCapabilityView.providerTools,
              }),
              preserveLatestToolResult: false,
              requestTokenLimit: getProviderRequestLimit(),
            });
            if (!activationFit.fits) {
              throw new Error(
                `Agent Skill 完整说明无法放入当前模型上下文；当前 Skill 未激活`,
              );
            }
          }

          if (call.name !== AGENT_PLAN_CONTROL_TOOL_NAME
            && capabilitySnapshot.getTool(call.name, activeSkillId)?.risk !== 'read') nonReadToolAttempted = true;
          const result = call.name === AGENT_PLAN_CONTROL_TOOL_NAME
            ? await executePlanControlCall(
                sender,
                store,
                sessionId,
                runId,
                call,
                roundCapabilityView.availableBusinessToolNames,
              )
            : await executeToolCall(
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
                createAgentAiDestinationSnapshot({
                  model: input.model,
                  profileId: input.profileId,
                  runtimeConnection,
                }),
                (nextPerception) => {
                  currentPerception = nextPerception ? {
                    ...nextPerception,
                    knownNodes: Array.from(new Map([
                      ...(currentPerception?.knownNodes || []),
                      ...(nextPerception.knownNodes || []),
                    ].filter(node => node.libraryId === input.appContext.libraryId)
                      .map(node => [node.id, node])).values()).slice(-500),
                  } : currentPerception;
                },
                resolveComputerTextAuditSource,
                Math.min(10_000, Math.max(1, getProviderRequestLimit() - preExecutionMinimumTokens)),
              );
          if (isAgentRendererMutationTool(call.name) && !['directory.create', 'file.copy', 'file.write'].includes(call.name) && result.ok && currentPerception) {
            const nodeId = (result.data as { nodeId?: number } | undefined)?.nodeId;
            currentPerception = updatePerceptionAfterLibraryMutation(currentPerception, call.name, nodeId);
          }
          toolTurnProgress.push({
            input: call.input,
            name: call.name,
            result,
          });
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
            modelAdapter,
          );
          const isComputerObservation = call.name === 'computer.observe'
            && capabilitySnapshot.toolSnapshot.get(call.name)?.registrationId === 'builtin:computer.observe@1'
            && !capabilitySnapshot.toolSnapshot.get(call.name)?.pluginSource;
          const imageId = (call.name === 'attachment.view' || isComputerObservation) && result.ok
            ? (result.data as { imageId?: string } | undefined)?.imageId : undefined;
          const visualAttachments = imageId ? await getAgentAttachmentStore().resolve(
            { ownerScope: input.ownerScope, libraryId: Number(input.appContext.libraryId) }, [imageId], sessionId) : [];
          const emptyCurrentResultMessage: AgentProviderMessage = {
            ...(visualAttachments.length ? { attachments: visualAttachments } : {}),
            content: '',
            name: call.name,
            role: 'tool',
            toolCallId: call.id,
          };
          const resultPolicy = resolveAgentProviderToolResultPolicy(call.name);
          const contextResult = call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME
            ? getSkillActivationContextResult(result, loadedSkillIds)
            : result;
          let projectedResult = expectedActivationProjection
            || projectAgentToolResultForProvider(
              contextResult,
              resultPolicy.maxTokens,
              resultPolicy.projectionOptions,
            );
          if (call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME && projectedResult.truncated) {
            throw new Error('Agent Skill 完整说明在 Provider 投影中被截断；已停止当前 Run');
          }
          if (call.name === 'file.grep' && result.ok && projectedResult.truncated) {
            throw new Error('上下文不足以完整交付正文搜索页，不能使用未交付页面的续搜游标');
          }
          if (['file.read', 'attachment.read', 'attachment.query'].includes(call.name) && result.ok && projectedResult.truncated) {
            throw new Error('当前上下文不足以完整交付正文页；不能使用未完整交付页面的续读位置');
          }
          const preferredCurrentResultMessage: AgentProviderMessage = {
            ...emptyCurrentResultMessage,
            content: projectedResult.content,
          };
          const preferredResultFit = await compactActiveContext({
            estimateTokens: candidateMessages => estimateAgentProviderTurnTokens({
              messages: [
                ...candidateMessages,
                preferredCurrentResultMessage,
                ...futureMinimumResultMessages,
              ],
              systemPrompt: currentSystemPrompt,
              tools: continuationCapabilityView.providerTools,
            }),
            preserveLatestToolResult: false,
            requestTokenLimit: getProviderRequestLimit(),
          });
          if (!preferredResultFit.fits) {
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
              resultPolicy.maxTokens,
              getProviderRequestLimit()
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
            projectedResult = projectAgentToolResultForProvider(
              contextResult,
              resultTokenBudget,
              resultPolicy.projectionOptions,
            );
          }
          if (call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME && projectedResult.truncated) {
            throw new Error('Agent Skill 完整说明在 Provider 投影中被截断；已停止当前 Run');
          }
          if (options.readLibraryMetadata && result.ok && projectedResult.truncated
            && ['file.list', 'file.search', 'file.resolve', 'file.stat'].includes(call.name)) {
            if (call.name === 'file.resolve' || call.name === 'file.stat') {
              throw new Error('当前上下文不足以完整交付节点元数据，未把截断的路径作为可用结果');
            }
            const query = call.input as { cursor?: string; limit?: number };
            projectedResult = projectAgentToolResultForProvider({
              ok: false, message: '元数据页未完整交付；减小 limit 并重试原 cursor，不能跳到下一页',
              data: { retryCursor: query.cursor || null, retryLimit: Math.max(1, Math.floor((query.limit || 50) / 2)) },
            }, projectedResult.estimatedTokens);
          }
          if (['file.read', 'attachment.read', 'attachment.query'].includes(call.name) && result.ok && projectedResult.truncated) {
            throw new Error('当前上下文不足以完整交付正文页；不能使用未完整交付页面的续读位置');
          }
          appendAgentActiveToolResult({
            ...(visualAttachments.length ? { attachments: visualAttachments } : {}),
            allowCompaction: call.name !== AGENT_SKILL_ACTIVATE_TOOL_NAME,
            messages,
            projectedResult,
            toolCallId: call.id,
            toolName: call.name,
            toolResults: activeToolResults,
          });
          if (call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME) {
            const loadedSkillId = getActivatedSkillId(result);
            if (loadedSkillId) loadedSkillIds.add(loadedSkillId);
          }
          if (result.ok) completedToolCalls += 1;
          await publishContextUsage({ messages, systemPrompt: currentSystemPrompt,
            tools: continuationCapabilityView.providerTools }, 'after-tool');
        }
        assertToolTurnMadeProgress(toolTurnProgress);
      }

      if (!activeAssistantWriter) {
        throw new Error('Agent 最终回答缺少 assistant item');
      }
      controller.signal.throwIfAborted();
      const finalItem = activeAssistantWriter.close();
      const finishedAt = now();
      const completedResult = await store.finishRunWithAssistantFinal({
        content: finalItem.content,
        currentStep: '已完成',
        expectedRevision: finalItem.expectedRevision,
        id: finalItem.id,
        now: finishedAt,
        runId,
      });
      activeAssistantWriter = null;
      exposeActiveAssistantWriter(null);
      if (!completedResult.assistantItem) {
        throw new Error('Agent final assistant item 终态缺失');
      }
      emit(sender, {
        item: completedResult.assistantItem,
        runId,
        sessionId,
        type: 'assistant-item-finished',
      });
      emit(sender, {
        run: completedResult.run,
        runId,
        sessionId,
        type: 'run-updated',
      });
      emit(sender, {
        ...await readCanonicalRunProjection(),
        runId,
        sessionId,
        type: 'completed',
      });
      scheduleSessionTitle(sender, store, session, runId, input, runtimeConnection, completedResult.assistantItem.content);
    } catch (error) {
      const finishedAt = now();
      const effectiveError = error;
      const cancelled = isAbortError(error, controller.signal);
      let failedAssistantItem: AgentAssistantTurnWriterSnapshot | undefined;
      if (activeAssistantWriter) {
        failedAssistantItem = activeAssistantWriter.discard();
      }
      const terminalResult = await store.finishRunWithAssistantFailure({
        ...(failedAssistantItem ? { assistantItem: failedAssistantItem } : {}),
        currentStep: cancelled ? '已取消' : '执行失败',
        ...(!cancelled
          ? { error: normalizeAgentErrorMessage(effectiveError, 'Agent 请求失败') }
          : {}),
        now: finishedAt,
        runId,
        status: cancelled ? 'cancelled' : 'failed',
      });
      activeAssistantWriter = null;
      exposeActiveAssistantWriter(null);
      if (terminalResult.assistantItem) {
        emit(sender, {
          item: terminalResult.assistantItem,
          runId,
          sessionId,
          type: 'assistant-item-finished',
        });
      }
      emit(sender, {
        run: terminalResult.run,
        runId,
        sessionId,
        type: 'run-updated',
      });
      if (cancelled) {
        emit(sender, {
          ...await readCanonicalRunProjection(),
          runId,
          sessionId,
          type: 'cancelled',
        });
      } else {
        const message = normalizeAgentErrorMessage(effectiveError, 'Agent 请求失败');
        emit(sender, {
          message,
          ...await readCanonicalRunProjection(),
          runId,
          sessionId,
          type: 'error',
        });
      }
    } finally {
      controller.signal.removeEventListener('abort', releaseComputerOnAbort);
      releaseAgentComputerRun(runId);
      const renderingOwner = activeRuns.get(sessionId);
      if (renderingOwner?.runId === runId) releaseRunRendering(renderingOwner);
      await waitForMediaArtifactSaves(save => save.runId === runId);
      await (options.releasePluginOutputs ?? releaseAgentPluginOutputs)(runId).catch(() => undefined);
      agentLibraryTextReader.releaseRun(runId);
      clearMediaArtifactFallbackGrants(grant => grant.runId === runId);
      await mediaArtifactStore.releaseRun(runId).catch(() => undefined);
      await releaseAgentShellRun(runId).catch(() => undefined);
      const active = activeRuns.get(sessionId);
      if (active?.runId === runId) active.releaseAccess?.();
      if (active?.runId === runId) activeRuns.delete(sessionId);
      runSessionRegistry.end(runId, sender.id);
    }
  }

  async function start(sender: WebContents, input: AgentChatRequest): Promise<AgentChatStartResult> {
    if (shuttingDown) throw new Error('Agent 正在退出，暂时不能开始新任务');
    let userPrompt = String(input?.userPrompt || '').trim();
    const resumeRunId = String(input?.resumeRunId || '').trim();
    if (input?.resumeRunId !== undefined && (typeof input.resumeRunId !== 'string' || !resumeRunId || resumeRunId.length > 200)) {
      throw new Error('要继续的任务标识无效');
    }
    if (resumeRunId && (!input.sessionId || userPrompt || input.attachmentIds?.length)) {
      throw new Error('继续任务不能同时提交新的消息或附件');
    }
    const profileId = String(input?.profileId || '').trim();
    const model = String(input?.model || '').trim();
    let reasoningEffort = normalizeReasoningEffort(input?.reasoningEffort);
    if (!userPrompt && !input.attachmentIds?.length && !resumeRunId) throw new Error('请求内容不能为空');
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
    let perception = normalizePerception(input.perception);
    const attachmentBindings = input.attachmentIds?.length ? options.attachmentBindings || getAgentAttachmentStore() : undefined;
    let attachments = attachmentBindings
      ? await attachmentBindings.resolve({ ownerScope, libraryId }, input.attachmentIds!) : [];
    const requestedSessionId = String(input?.sessionId || '').trim();
    if (requestedSessionId.length > MAX_AGENT_SESSION_ID_CHARACTERS) {
      throw new Error('Agent 会话 ID 过长');
    }
    const stoppingRun = activeRuns.get(requestedSessionId);
    const canWaitForStop = Boolean(stoppingRun?.stoppedByUser && (!resumeRunId || stoppingRun.runId === resumeRunId)
      && stoppingRun.ownerWebContentsId === sender.id && stoppingRun.controller.signal.aborted && stoppingRun.task);
    if (requestedSessionId && (
      (activeRuns.has(requestedSessionId) && !canWaitForStop)
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
    let runCreationAttempted = false;
    let addedAttachmentBindings: string[] = [];
    let store: AgentSessionStore | null = null;
    let session: AgentSessionSnapshot | null = null;
    try {
      if (canWaitForStop) await stoppingRun!.task;
      throwIfAborted(controller.signal);
      store = await resolveSessionStore();
      session = requestedSessionId ? await store.getSession(requestedSessionId, ownerScope, libraryId) : null;
      throwIfAborted(controller.signal);
      if (requestedSessionId && !session) throw new Error('Agent 会话不存在或不属于当前资料库');
      let continuationInstruction = '';
      if (resumeRunId) {
        const previous = session?.runs.at(-1);
        if (!session || previous?.id !== resumeRunId || previous.status !== 'cancelled') {
          throw new Error('只能继续当前会话最后一次主动停止的任务');
        }
        userPrompt = previous.userPrompt;
        if (userPrompt.length > 100_000 || containsAgentSensitiveData(userPrompt)) {
          throw new Error('原任务内容不符合当前请求限制，请重新提交不含凭据的请求');
        }
        attachments = session.messages.find(message => message.role === 'user' && message.runId === previous.id)?.attachments || [];
        continuationInstruction = buildAgentResumeInstruction(session, resumeRunId);
      }
      const selectedGroupId = session ? session.groupId || null : input.groupId || null;
      if (selectedGroupId !== null && (typeof selectedGroupId !== 'string' || selectedGroupId.length > 200)) throw new Error('会话组标识无效');
      if (session && input.groupId !== undefined && input.groupId !== selectedGroupId) throw new Error('请先在会话管理中移动分组');
      const permissionMode = normalizeAgentSessionPermissionMode(session?.permissionMode || input.permissionMode || (selectedGroupId ? 'group' : 'ask'));
      if (permissionMode === 'group' && !selectedGroupId) throw new Error('组内访问需要选择一个会话组');
      if (selectedGroupId) startingGroupKeys.set(runId, groupKey(ownerScope, libraryId, selectedGroupId));
      const selectedGroup = selectedGroupId ? await store.getGroup(ownerScope, libraryId, selectedGroupId) : null;
      if (selectedGroupId && !selectedGroup) throw new Error('会话组不存在或不属于当前资料库');
      const libraryAccess: AgentLibraryAccessSnapshot = { version: 1, mode: permissionMode,
        groupId: selectedGroupId, policyRevision: selectedGroup?.policyRevision || 0,
        directories: selectedGroup?.directories || [], access: selectedGroup?.access || 'read' };
      const baseToolSnapshot = agentToolRegistry.createSnapshot();
      const pluginRegistrations = options.getPluginTools?.(baseToolSnapshot.tools.map(item => item.name)) ?? [];
      const combinedToolSnapshot = createAgentPluginToolSnapshot(baseToolSnapshot, pluginRegistrations);
      const resolveComputerTextAuditSource = createAgentComputerTextAuditSourceResolver(combinedToolSnapshot);
      const pluginTools = new Map(combinedToolSnapshot.tools.flatMap(item => item.pluginSource && !item.pluginOperation ? [[item.name, item.pluginSource] as const] : []));
      const pluginRenameTools = new Map(combinedToolSnapshot.tools.flatMap(item => item.pluginSource && item.pluginOperation === 'rename' ? [[item.name, item.pluginSource] as const] : []));
      const pluginOutputTools = new Map(combinedToolSnapshot.tools.flatMap(item => item.pluginSource && item.pluginOperation === 'file-output' ? [[item.name, item.pluginSource] as const] : []));
      const accessGuard = createAgentLibraryAccessGuard({ pluginTools, pluginRenameTools, pluginOutputTools, policy: libraryAccess, context, signal: controller.signal,
        read: async (query, signal) => {
          if (!options.readLibraryMetadata) throw new Error('当前运行时无法验证资料库目录授权');
          return normalizeAgentLibraryReadResult(await options.readLibraryMetadata({ sender, libraryId, ownerScope,
            sessionId: session?.id || `preflight:${runId}`, runId, toolRunId: `scope-check:${runId}`, signal,
            internalScopeLookup: true, operation: { operation: 'query-library-metadata', query } }), libraryId);
        },
        approve: request => {
          if (!session || !runCreated) throw new Error('运行尚未开始，不能申请临时访问');
          return requestDirectoryApproval(sender, store!, session.id, runId, context, ownerScope, controller.signal, request);
        },
        assertCurrent: async () => {
          controller.signal.throwIfAborted();
          if (libraryAccess.mode !== 'group' || !selectedGroupId) return;
          const current = await store!.getGroup(ownerScope, libraryId, selectedGroupId);
          if (!current || current.policyRevision !== libraryAccess.policyRevision) throw new Error('会话组授权已变化，请重新开始任务');
        },
      });
      if (accessGuard && permissionMode !== 'full-access') {
        perception = await accessGuard.initialPerception(perception);
        context.currentDirectory = perception?.currentDirectory
          ? { id: perception.currentDirectory.id, name: perception.currentDirectory.name }
          : context.currentDirectory ? { id: context.currentDirectory.id, name: '当前目录' } : undefined;
      }
      const runtimeConnection = { ...resolveRuntimeProfile(profileId) };
      const metadata = options.getModelMetadata ? await options.getModelMetadata(runtimeConnection, model)
        : options.resolveContextBudget ? undefined : await agentModelCatalog.get(runtimeConnection, model);
      const modelAdapter = resolveAgentModelAdapter(runtimeConnection, model, metadata);
      if (modelAdapter.supportsImages === false && attachments.some(item => item.kind === 'image')) {
        throw new Error('当前模型不支持图片输入，请选择支持视觉的模型');
      }
      reasoningEffort = resolveAgentAdapterEffort(modelAdapter, reasoningEffort) || 'auto';
      const modelBudget = (options.resolveContextBudget ? resolveContextBudget({
          baseUrl: runtimeConnection.baseUrl,
          model,
          providerType: runtimeConnection.providerType,
        }) : resolveAgentModelContextBudget({
          baseUrl: runtimeConnection.baseUrl,
          model,
          providerType: runtimeConnection.providerType,
          metadata,
        })) || {};
      const windowSource: AgentContextUsageSnapshot['windowSource'] = options.contextBudget || options.resolveContextBudget
        ? 'internal' : 'source' in modelBudget && (modelBudget.source === 'provider' || modelBudget.source === 'catalog') ? modelBudget.source : 'fallback';
      const contextBudget = resolveAgentContextBudget({
        ...modelBudget,
        ...(options.contextBudget ? resolveAgentContextBudget(options.contextBudget) : {}),
      });
      resolveAIServiceOutputTokenLimit(contextBudget.outputReserveTokens);
      const toolSnapshot = restrictAgentToolsForModel(combinedToolSnapshot, modelAdapter);
      const skillSnapshot = restrictAgentSkillsForModel(builtInAgentSkillRegistry.createRunSnapshot(), toolSnapshot);
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
      const shellProviderSnapshot = getAgentShellProviderSnapshotForRun();
      const capabilitySnapshot = createAgentRunCapabilitySnapshot({
        libraryAccess,
        modelAdapterIdentity: modelAdapter.identity,
        capabilitySnapshot: environmentCapabilitySnapshot,
        shellPermissionMode: options.getPermissionMode ? options.getPermissionMode() : permissionMode === 'full-access' ? 'full-access' : 'ask',
        ...(shellProviderSnapshot ? { shellProviderSnapshot } : {}),
        skillSnapshot,
        toolSnapshot,
      });
      const recalledMemories = await retrieveMemories({
        libraryId,
        ownerScope,
        query: userPrompt,
      }).catch(() => []);
      const preflightVisibleTools = capabilitySnapshot.listTools();
      const preflightTools = modelAdapter.toolCalling ? [createAgentPlanControlTool(preflightVisibleTools.filter(tool => tool.kind === 'business').map(tool => tool.name)), ...preflightVisibleTools] : [];
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
            modelAdapter,
          ),
        ], preflightTools),
        estimateAgentFixedInputTokens([
          buildAgentFallbackSystemPrompt(context, perception, modelAdapter),
        ], []) + estimateAgentProviderMessagesTokens(preflightFallbackContextMessages),
      );
      assertAgentCurrentRunFitsContext(
        [{ content: userPrompt + attachmentManifest(attachments), role: 'user', ...(attachments.length ? { attachments } : {}) }],
        preflightFixedInputTokens + (continuationInstruction
          ? estimateAgentProviderMessagesTokens([{ role: 'user', content: continuationInstruction }]) : 0),
        contextBudget,
      );
      runSessionRegistry.begin({
        connection: runtimeConnection,
        ownerWebContentsId: sender.id,
        profileId,
      }, runId);
      runSessionStarted = true;
      const startedAt = now();
      if (!session) {
        session = await store.createSession({
          groupId: selectedGroupId,
          permissionMode,
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

      if (attachments.length && !resumeRunId) addedAttachmentBindings = await attachmentBindings!.bind({ ownerScope, libraryId }, attachments.map(item => item.id), session.id);
      throwIfAborted(controller.signal);
      runCreationAttempted = true;
      const createdRun = await store.createRun({
        libraryAccess,
        ...(resumeRunId ? { resumesRunId: resumeRunId } : {}),
        ...(attachments.length ? { attachments } : {}),
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
      const runtime: ActiveAgentRun = {
        accessGuard,
        ...(selectedGroupId ? { groupKey: groupKey(ownerScope, libraryId, selectedGroupId) } : {}),
        controller,
        ownerWebContentsId: sender.id,
        runId,
      };
      activeRuns.set(session.id, runtime);
      keepRunRendering(runtime);
      if (accessGuard) runtime.releaseAccess = agentFileAuthorityBroker.registerRunAccess(runId, {
        before: async request => {
          if (request.sessionId !== session!.id || request.libraryId !== libraryId || request.sender.id !== sender.id
            || !sameOwnerScope(normalizeAgentOwnerScope(request.ownerScope), ownerScope)) throw new Error('访问请求与运行范围不一致');
          const operation = request.operation;
          if (operation.operation === 'query-library-metadata') await accessGuard.authorizeQuery(operation.query, false, request.toolRunId);
          else if (operation.operation === 'stage-library-node') await accessGuard.authorizeResource(operation.nodeId, false, request.toolRunId, false);
          else if (operation.operation === 'resolve-library-directory') await accessGuard.authorizeDirectory(operation.directoryPath, true, request.toolRunId, false);
          else if (operation.operation === 'rename-library-files') await accessGuard.authorizeRename(operation.nodeIds, request.toolRunId, false);
          else if (operation.operation === 'publish-library-file') await accessGuard.authorizeResource(operation.parentId, true, request.toolRunId, false);
        },
        after: async (request, result) => {
          if (result.operation === 'query-library-metadata') await accessGuard.checkMetadata(result.data, request.toolRunId);
          if (result.operation === 'rename-library-files') await accessGuard.authorizeRename(result.nodes.map(node => node.id), request.toolRunId, false);
        },
      });
      emit(sender, {
        run: createdRun,
        runId,
        sessionId: session.id,
        type: 'started',
      });
      runtime.task = run(sender, store, session, runId, {
        appContext: context,
        model,
        ownerScope,
        perception,
        profileId,
        reasoningEffort,
        sessionId: session.id,
        userPrompt,
      }, runtimeConnection, controller, contextBudget, recalledMemories, capabilitySnapshot, modelAdapter, windowSource,
      resolveComputerTextAuditSource, continuationInstruction);
      return { runId, sessionId: session.id, session: pickAgentSessionSummary(session) };
    } catch (error) {
      let confirmedUncreated = !runCreated && !runCreationAttempted;
      if (session && store && !runCreated && runCreationAttempted) {
        try {
          const persisted = await store.getSession(session.id, ownerScope, libraryId);
          runCreated = Boolean(persisted?.runs.some(item => item.id === runId));
          confirmedUncreated = !runCreated;
        } catch { /* Keep bindings when the database cannot confirm the commit outcome. */ }
      }
      try {
        if (session && store) {
          if (confirmedUncreated) {
            if (addedAttachmentBindings.length) await attachmentBindings!.rollbackBinding({ ownerScope, libraryId }, addedAttachmentBindings, session.id);
            if (createdSession) await store.deleteSession(session.id, ownerScope, libraryId).catch(() => undefined);
          } else if (runCreated) {
            const cancelled = isAbortError(error, controller.signal);
            const finishedAt = now();
            await store.updateRun(runId, {
              currentStep: cancelled ? '已取消' : '启动失败',
              finishedAt,
              status: cancelled ? 'cancelled' : 'failed',
              ...(cancelled ? {} : { error: normalizeAgentErrorMessage(error, 'Agent 启动失败') }),
              updatedAt: finishedAt,
            }).catch(() => undefined);
          }
        }
      } finally {
        const active = session && activeRuns.get(session.id);
        if (session && active?.runId === runId) {
          releaseRunRendering(active);
          try { active.releaseAccess?.(); }
          catch { /* Failed startup must preserve its original error. */ }
          activeRuns.delete(session.id);
        }
        releaseAgentComputerRun(runId);
        if (runSessionStarted) runSessionRegistry.end(runId, sender.id);
      }
      throw error;
    } finally {
      startingRuns.delete(runId);
      startingGroupKeys.delete(runId);
      if (requestedSessionId) startingSessions.delete(requestedSessionId);
    }
  }

  function stop(sessionId: string, ownerWebContentsId: number): boolean {
    const runtime = activeRuns.get(String(sessionId || ''));
    if (!runtime) return false;
    if (runtime.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('当前窗口无权停止该 Agent 会话');
    }
    if (!runtime.controller.signal.aborted) runtime.stoppedByUser = true;
    runtime.controller.abort();
    return true;
  }

  function releaseOwner(ownerWebContentsId: number): void {
    activeTitleTasks.forEach(task => {
      if (task.ownerWebContentsId === ownerWebContentsId) task.controller.abort();
    });
    startingRuns.forEach((runtime) => {
      if (runtime.ownerWebContentsId === ownerWebContentsId) {
        runtime.controller.abort();
      }
    });
    activeRuns.forEach((runtime) => {
      if (runtime.ownerWebContentsId === ownerWebContentsId) {
        runtime.stoppedByUser = false;
        runtime.controller.abort();
      }
    });
    toolBroker.releaseOwner(ownerWebContentsId);
    toolPrepareBroker.releaseOwner(ownerWebContentsId);
    clearMediaArtifactFallbackGrants(
      grant => grant.ownerWebContentsId === ownerWebContentsId,
    );
    void waitForMediaArtifactSaves(save => save.ownerWebContentsId === ownerWebContentsId)
      .then(() => mediaArtifactStore.releaseOwner(ownerWebContentsId))
      .catch(() => undefined);
  }

  async function shutdown(timeoutMs = 6_000): Promise<boolean> {
    shuttingDown = true;
    const owners = new Set<number>();
    startingRuns.forEach(runtime => owners.add(runtime.ownerWebContentsId));
    activeRuns.forEach(runtime => owners.add(runtime.ownerWebContentsId));
    activeTitleTasks.forEach(task => owners.add(task.ownerWebContentsId));
    activeMediaArtifactSaves.forEach(save => owners.add(save.ownerWebContentsId));
    owners.forEach(releaseOwner);

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (
      startingRuns.size > 0
      || activeRuns.size > 0
      || activeMediaArtifactSaves.size > 0
      || activeTitleTasks.size > 0
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
    filter?: AgentSessionListFilter,
  ): Promise<AgentSessionPage> {
    return (await resolveSessionStore()).listSessions(
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      query,
      cursor,
      filter,
    );
  }

  async function getSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
    includeArchived = false,
  ): Promise<AgentSessionSnapshot> {
    const session = await (await resolveSessionStore()).getSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      includeArchived,
    );
    if (!session) throw new Error('Agent 会话不存在或不属于当前资料库');
    const activeWriter = activeRuns.get(session.id)?.assistantWriter;
    if (!activeWriter) return projectAgentSessionForRenderer(session);
    const activeItem = activeWriter.getSnapshot();
    const itemIndex = session.messages.findIndex(message => message.id === activeItem.id);
    const messages = itemIndex >= 0
      ? session.messages.map(message => message.id === activeItem.id ? activeItem : message)
      : [...session.messages, activeItem];
    return projectAgentSessionForRenderer({ ...session, messages });
  }

  async function renameSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
    title: string,
  ): Promise<AgentSessionSummary> {
    const renamed = await (await resolveSessionStore()).renameSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      title,
      now(),
    );
    activeTitleTasks.get(sessionId)?.controller.abort();
    return renamed;
  }

  async function deleteSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<boolean> {
    if (activeRuns.has(sessionId) || startingSessions.has(sessionId)) {
      throw new Error('Agent 正在处理消息，暂时不能删除该会话');
    }
    const sessionStore = await resolveSessionStore();
    const deletingSession = await sessionStore.getSession(sessionId, normalizeAgentOwnerScope(ownerScope), libraryId, true);
    if (!deletingSession?.archivedAt) throw new Error('请先归档会话，再从归档页面永久删除');
    const deleted = await sessionStore.deleteSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      true,
    );
    if (!deleted) throw new Error('Agent 会话不存在或不属于当前资料库');
    activeTitleTasks.get(sessionId)?.controller.abort();
    if (deletingSession.messages.some(message => message.attachments?.length)
      || deletingSession.toolActivities.some(activity => activity.call.name === 'computer.observe')) {
      await getAgentAttachmentStore().releaseSession({ ownerScope, libraryId }, sessionId).catch(() => undefined);
    }
    return true;
  }

  async function listGroups(owner: AgentOwnerScope, libraryId: number) {
    return (await resolveSessionStore()).listGroups(normalizeAgentOwnerScope(owner), libraryId);
  }
  async function saveGroup(owner: AgentOwnerScope, libraryId: number, value: AgentSessionGroupInput) {
    const input = normalizeAgentSessionGroupInput(value);
    const store = await resolveSessionStore();
    if (input.id) {
      const previous = await store.getGroup(owner, libraryId, input.id);
      if (!previous) throw new Error('会话组不存在');
      if (previous.access !== input.access || JSON.stringify(previous.directories) !== JSON.stringify(input.directories)) {
        assertGroupIdle(groupKey(owner, libraryId, input.id));
      }
    }
    return store.saveGroup(owner, libraryId, input, now());
  }
  async function deleteGroup(owner: AgentOwnerScope, libraryId: number, id: string, revision: number) {
    const store = await resolveSessionStore();
    assertGroupIdle(groupKey(owner, libraryId, id));
    return store.deleteGroup(owner, libraryId, id, revision);
  }
  async function organizeSession(id: string, owner: AgentOwnerScope, libraryId: number, value: AgentSessionOrganizationInput) {
    const store = await resolveSessionStore();
    assertSessionIdle(id);
    const result = await store.organizeSession(id, owner, libraryId, value, now());
    activeTitleTasks.get(id)?.controller.abort();
    return result;
  }
  async function archiveSession(id: string, owner: AgentOwnerScope, libraryId: number, archived: boolean, revision: number) {
    const store = await resolveSessionStore();
    assertSessionIdle(id);
    const result = await store.archiveSession(id, owner, libraryId, archived, revision, now());
    activeTitleTasks.get(id)?.controller.abort();
    return result;
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

  async function readShellLogPage(input: AgentShellLogPageRequestV1): Promise<AgentShellLogPageV1> {
    if (!input || typeof input !== 'object' || input.version !== 1) {
      throw new Error('Agent Shell 日志请求无效');
    }
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    const libraryId = Number(input.libraryId);
    const sessionId = String(input.sessionId || '').trim();
    const runId = String(input.runId || '').trim();
    const toolRunId = String(input.toolRunId || '').trim();
    if (
      !Number.isSafeInteger(libraryId)
      || libraryId <= 0
      || !sessionId
      || sessionId.length > MAX_AGENT_SESSION_ID_CHARACTERS
      || !runId
      || runId.length > 200
      || !toolRunId
      || toolRunId.length > 200
    ) {
      throw new Error('Agent Shell 日志请求无效');
    }
    const session = await (await resolveSessionStore()).getSession(
      sessionId,
      ownerScope,
      libraryId,
    );
    const activity = session?.toolActivities.find(candidate => candidate.id === toolRunId);
    if (
      !activity
      || activity.sessionId !== sessionId
      || activity.runId !== runId
      || activity.call.name !== 'shell.run'
      || !activity.result?.data
      || typeof activity.result.data !== 'object'
      || Array.isArray(activity.result.data)
    ) {
      throw new Error('Agent Shell 日志不属于当前 Tool Run');
    }
    const resultData = activity.result.data as Record<string, unknown>;
    const executionId = String(resultData.executionId || '');
    const logRef = String(resultData.logRef || '');
    if (
      !executionId
      || executionId.length > 200
      || !/^log:v1:[a-f0-9]{64}$/u.test(logRef)
    ) {
      throw new Error('Agent Shell Tool Run 没有可读取的详细日志');
    }
    const identity: AgentShellLogIdentity = {
      executionId,
      owner: { ...ownerScope, sessionId },
      runId,
      sessionId,
      toolRunId,
    };
    return readShellLogPageFromStore({
      ...identity,
      logRef,
      ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
      ...(input.maxFrames === undefined ? {} : { maxFrames: input.maxFrames }),
    });
  }

  return {
    completeToolPreparation,
    reconcilePluginOperation: async (sender: WebContents, request: AgentPluginOperationReconcileRequest) =>
      reconcileAgentPluginOperation(await resolveSessionStore(), sender, request),
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
    readShellLogPage,
    renameSession,
    verifyToolAccess: (ownerWebContentsId: number, input: Omit<AgentToolExecutionCommit, 'result'>) => toolBroker.verifyRendererAccess(ownerWebContentsId, input),
    listGroups,
    saveGroup,
    deleteGroup,
    organizeSession,
    archiveSession,
    reportToolExecutionProgress,
    resolveToolApproval,
    saveMediaArtifact,
    shutdown,
    submitInteraction,
    uploadMediaArtifact,
    start,
    stop,
    updateMemory,
  };
}

export const agentOrchestrator = createAgentOrchestrator({
  keepOwnerRendering: keepAgentOwnerRendering,
  preparePluginFileOutput: prepareAgentPluginFileOutput,
  executePluginFileOutput: executeAgentPluginFileOutput,
  getPluginTools: getAgentPluginToolRegistrations,
  preparePluginRename: prepareAgentPluginRename,
  executePluginRename: executeAgentPluginRename,
  executePluginTool: executeAgentPluginTool,
  readLibraryText: readAgentLibraryText,
  readLibraryMetadata: async input => {
    const result = await agentFileAuthorityBroker.request(input);
    if (result.operation !== 'query-library-metadata') throw new Error('资料库查询响应类型不匹配');
    return result.data;
  },
});
