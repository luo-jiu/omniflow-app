import type {
  AgentShellExecutionLease,
  AgentShellExecutionLeaseGrant,
  AgentShellExecutionLeaseManager,
} from './agent-shell-execution-lease';
import type {
  AgentShellLogAppendResult,
  AgentShellLogHandle,
  AgentShellLogIdentity,
  AgentShellLogStore,
  AgentShellOutputFrameV1,
  AgentShellOutputTailV1,
} from './agent-shell-log-store';
import type {
  AgentShellProcessEvent,
  AgentShellProcessResult,
  AgentShellProcessState,
  AgentShellProcessStateEvent,
  AgentShellProcessSupervisor,
} from './agent-shell-process-supervisor';
import type { AgentShellWorkspaceOwner } from './agent-shell-workspace-store';
import type { AgentToolMainPreparedExecution } from '../agent-tool-registry';
import type { AgentShellSpawnPreflight } from './agent-shell-spawn-preflight';
import {
  createAgentShellOutputProjectionCollector,
  type AgentShellProviderOutputV1,
} from './agent-shell-output-projection';

export type AgentShellRuntimeStatus =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentShellRuntimeFailureReason =
  | 'cancelled'
  | 'exit_code'
  | 'interrupted'
  | 'log_failure'
  | 'process_error'
  | 'quota_exceeded'
  | 'termination_incomplete'
  | 'timed_out';

export interface AgentShellRuntimeStateEvent {
  readonly executionId: string;
  readonly kind: 'state';
  readonly logRef: string;
  readonly state: AgentShellProcessState;
  readonly timestamp: number;
}

export interface AgentShellRuntimeOutputEvent {
  readonly droppedDetailedBytes: number;
  readonly executionId: string;
  readonly frames: readonly AgentShellOutputFrameV1[];
  readonly kind: 'output';
  readonly logRef: string;
}

export type AgentShellRuntimeEvent =
  | AgentShellRuntimeOutputEvent
  | AgentShellRuntimeStateEvent;

export interface AgentShellRuntimeRunInput {
  readonly onEvent?: (event: AgentShellRuntimeEvent) => void;
  readonly owner: AgentShellWorkspaceOwner;
  readonly preparation: AgentToolMainPreparedExecution;
  readonly runCapabilityIdentity: string;
  readonly signal: AbortSignal;
  readonly toolRunId: string;
  readonly workspaceId?: string;
}

export interface AgentShellRuntimeResult {
  readonly droppedDetailedBytes: number;
  readonly droppedOutputBytes: number;
  readonly durationMs: number;
  readonly errorMessage?: string;
  readonly executionId: string;
  readonly exitCode: number | null;
  readonly logRef: string;
  readonly outputBytes: number;
  readonly outputProjection: AgentShellProviderOutputV1;
  readonly outputTail: AgentShellOutputTailV1;
  readonly processStatus: AgentShellProcessResult['status'];
  readonly status: AgentShellRuntimeStatus;
  readonly terminationConfirmed: boolean;
  readonly terminationReason?: AgentShellRuntimeFailureReason;
  readonly terminationSignal: NodeJS.Signals | null;
  readonly ok: boolean;
}

export interface AgentShellRuntimeOptions {
  readonly executionLeaseManager: Pick<AgentShellExecutionLeaseManager, 'acquire' | 'consume'>;
  readonly logStore: Pick<AgentShellLogStore, 'create'>;
  readonly processSupervisor: Pick<AgentShellProcessSupervisor, 'cancel' | 'start'>;
  readonly spawnPreflight: Pick<AgentShellSpawnPreflight, 'assertReady'>;
}

const EMPTY_TAIL = (executionId: string): AgentShellOutputTailV1 => Object.freeze({
  executionId,
  firstSequence: null,
  frames: Object.freeze([]),
  lastSequence: null,
  truncatedBefore: null,
});

function isTerminalState(state: AgentShellProcessState): boolean {
  return state === 'completed'
    || state === 'failed'
    || state === 'cancelled'
    || state === 'timed-out'
    || state === 'interrupted';
}

function stableErrorMessage(reason: AgentShellRuntimeFailureReason | undefined): string | undefined {
  switch (reason) {
    case 'cancelled':
      return 'Agent Shell 执行已取消';
    case 'exit_code':
      return 'Agent Shell 进程返回非零状态';
    case 'interrupted':
      return 'Agent Shell 进程被宿主中断';
    case 'log_failure':
      return 'Agent Shell 日志写入失败';
    case 'process_error':
      return 'Agent Shell 进程执行失败';
    case 'quota_exceeded':
      return 'Agent Shell workspace 超过执行配额或无法可信计量';
    case 'termination_incomplete':
      return 'Agent Shell 进程终止未确认';
    case 'timed_out':
      return 'Agent Shell 进程执行超时';
    default:
      return undefined;
  }
}

function emitSafely(listener: AgentShellRuntimeRunInput['onEvent'], event: AgentShellRuntimeEvent): void {
  try {
    listener?.(event);
  } catch {
    // Runtime observers cannot change execution or settlement semantics.
  }
}

function mapProcessResult(result: AgentShellProcessResult): {
  readonly reason?: AgentShellRuntimeFailureReason;
  readonly status: AgentShellRuntimeStatus;
} {
  switch (result.status) {
    case 'completed':
      return result.exitCode === 0
        ? { status: 'completed' }
        : { reason: 'exit_code', status: 'failed' };
    case 'cancelled':
      return { reason: 'cancelled', status: 'cancelled' };
    case 'timed-out':
      return { reason: 'timed_out', status: 'failed' };
    case 'interrupted':
      return result.terminationConfirmed
        ? { reason: 'interrupted', status: 'interrupted' }
        : { reason: 'termination_incomplete', status: 'failed' };
    case 'failed':
      return { reason: 'process_error', status: 'failed' };
    default:
      return { reason: 'process_error', status: 'failed' };
  }
}

function createLogIdentity(
  input: AgentShellRuntimeRunInput,
  grant: AgentShellExecutionLeaseGrant,
  executionId: string,
): AgentShellLogIdentity {
  const owner = grant.owner || grant.workspace?.owner;
  const runId = grant.runId || grant.workspace?.runId;
  const sessionId = grant.sessionId || owner?.sessionId || grant.workspace?.owner.sessionId;
  if (!owner || !runId || !sessionId) {
    throw new Error('Agent Shell execution grant identity 缺失');
  }
  return Object.freeze({
    executionId,
    owner,
    runId,
    sessionId,
    toolRunId: input.preparation.identity.toolRunId,
  });
}

export function createAgentShellRuntime(options: AgentShellRuntimeOptions) {
  if (!options?.executionLeaseManager) throw new Error('Agent Shell Runtime 缺少 execution lease manager');
  if (!options?.logStore) throw new Error('Agent Shell Runtime 缺少 log store');
  if (!options?.processSupervisor) throw new Error('Agent Shell Runtime 缺少 process supervisor');
  if (!options?.spawnPreflight) throw new Error('Agent Shell Runtime 缺少 spawn preflight');

  async function run(input: AgentShellRuntimeRunInput): Promise<AgentShellRuntimeResult> {
    const lease: AgentShellExecutionLease = await options.executionLeaseManager.acquire({
      owner: input.owner,
      preparation: input.preparation,
      runCapabilityIdentity: input.runCapabilityIdentity,
      signal: input.signal,
      toolRunId: input.toolRunId,
      workspaceId: input.workspaceId,
    });
    const grant = await options.executionLeaseManager.consume(lease, input.owner, input.signal);
    const spawnGrant = await options.spawnPreflight.assertReady({
      grant,
      owner: input.owner,
      preparation: input.preparation,
      runCapabilityIdentity: input.runCapabilityIdentity,
      signal: input.signal,
      toolRunId: input.toolRunId,
      workspaceId: input.workspaceId,
    });

    let log: AgentShellLogHandle | null = null;
    let processHandle: ReturnType<AgentShellProcessSupervisor['start']> | null = null;
    let logFailure: unknown;
    let droppedDetailedBytes = 0;
    let logReady = false;
    const outputProjectionCollector = createAgentShellOutputProjectionCollector();
    let terminalStateEvent: AgentShellProcessStateEvent | undefined;
    const pendingEvents: AgentShellProcessEvent[] = [];
    const requestProcessCancellation = (): void => {
      if (!processHandle) return;
      try {
        options.processSupervisor.cancel(processHandle.executionId);
      } catch (error) {
        logFailure ||= error;
      }
    };

    const processEvent = (event: AgentShellProcessEvent): void => {
      if (!logReady) {
        pendingEvents.push(event);
        return;
      }
      if (event.kind === 'state') {
        const currentLog = log;
        if (!currentLog) return;
        if (isTerminalState(event.state)) {
          terminalStateEvent = event;
          return;
        }
        emitSafely(input.onEvent, Object.freeze({
          executionId: event.executionId,
          kind: 'state' as const,
          logRef: currentLog.logRef,
          state: event.state,
          timestamp: event.timestamp,
        }));
        return;
      }
      const currentLog = log;
      if (!currentLog) return;
      let appended: AgentShellLogAppendResult;
      try {
        appended = currentLog.appendSupervisorOutput(event);
      } catch (error) {
        logFailure ||= error;
        requestProcessCancellation();
        return;
      }
      droppedDetailedBytes += appended.droppedDetailedBytes;
      outputProjectionCollector.append(appended.frames);
      if (appended.frames.length === 0 && appended.droppedDetailedBytes === 0) return;
      emitSafely(input.onEvent, Object.freeze({
        droppedDetailedBytes: appended.droppedDetailedBytes,
        executionId: event.executionId,
        frames: Object.freeze([...appended.frames]),
        kind: 'output' as const,
        logRef: currentLog.logRef,
      }));
    };

    // The lease has already been consumed. A rejected start is an execution
    // boundary failure and must reach ToolRun settlement as an exception.
    processHandle = options.processSupervisor.start({
      grant: spawnGrant,
      onEvent: processEvent,
      signal: input.signal,
    });

    try {
      log = options.logStore.create({
        ...createLogIdentity(input, grant, processHandle.executionId),
      });
    } catch (error) {
      requestProcessCancellation();
      await processHandle.promise;
      throw error;
    }
    if (!log || !processHandle) throw new Error('Agent Shell Runtime 初始化失败');
    logReady = true;
    pendingEvents.splice(0).forEach(processEvent);

    const processResult = await processHandle.promise;
    try {
      const finished = log.finish();
      droppedDetailedBytes += finished.droppedDetailedBytes;
      outputProjectionCollector.append(finished.frames);
      if (finished.frames.length > 0) {
        emitSafely(input.onEvent, Object.freeze({
          droppedDetailedBytes: finished.droppedDetailedBytes,
          executionId: processResult.executionId,
          frames: Object.freeze([...finished.frames]),
          kind: 'output' as const,
          logRef: log.logRef,
        }));
      }
    } catch (error) {
      logFailure ||= error;
    }
    try {
      await log.flush();
    } catch (error) {
      logFailure ||= error;
    }

    let outputTail: AgentShellOutputTailV1;
    try {
      outputTail = log.getTail();
    } catch (error) {
      logFailure ||= error;
      outputTail = EMPTY_TAIL(processResult.executionId);
    }

    if (terminalStateEvent) {
      emitSafely(input.onEvent, Object.freeze({
        executionId: terminalStateEvent.executionId,
        kind: 'state' as const,
        logRef: log.logRef,
        state: terminalStateEvent.state,
        timestamp: terminalStateEvent.timestamp,
      }));
    }

    const mapped = mapProcessResult(processResult);
    const status = logFailure === undefined
      ? mapped.status
      : 'failed';
    const terminationReason = logFailure === undefined
      ? mapped.reason
      : mapped.reason === 'termination_incomplete'
        ? mapped.reason
        : 'log_failure';
    const errorMessage = stableErrorMessage(terminationReason);
    return Object.freeze({
      ...(errorMessage ? { errorMessage } : {}),
      droppedDetailedBytes,
      droppedOutputBytes: processResult.droppedOutputBytes,
      durationMs: processResult.durationMs,
      executionId: processResult.executionId,
      exitCode: processResult.exitCode,
      logRef: log.logRef,
      ok: status === 'completed',
      outputBytes: processResult.outputBytes,
      outputProjection: outputProjectionCollector.snapshot(),
      outputTail,
      processStatus: processResult.status,
      status,
      terminationConfirmed: processResult.terminationConfirmed,
      ...(terminationReason ? { terminationReason } : {}),
      terminationSignal: processResult.terminationSignal,
    });
  }

  return Object.freeze({ run });
}

export type AgentShellRuntime = ReturnType<typeof createAgentShellRuntime>;
