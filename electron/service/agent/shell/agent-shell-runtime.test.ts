import { describe, expect, it, vi } from 'vitest';

import type { AgentToolMainPreparedExecution } from '../agent-tool-registry';
import type {
  AgentShellExecutionLease,
  AgentShellExecutionLeaseGrant,
} from './agent-shell-execution-lease';
import type {
  AgentShellLogHandle,
  AgentShellOutputTailV1,
} from './agent-shell-log-store';
import type {
  AgentShellProcessEvent,
  AgentShellProcessResult,
} from './agent-shell-process-supervisor';
import {
  createAgentShellRuntime,
  type AgentShellRuntimeEvent,
} from './agent-shell-runtime';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
} from './agent-shell-workspace-store';

const OWNER: AgentShellWorkspaceOwner = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});

const PREPARATION = {
  identity: {
    toolRunId: 'tool-run-1',
  },
} as unknown as AgentToolMainPreparedExecution;

const LEASE = {
  commandHash: 'hash',
  expiresAt: Date.now() + 10_000,
  generation: 1,
  leaseId: 'lease-1',
  preparedActionId: 'prepared-1',
  token: {},
  workspaceContentIdentity: 'content',
  workspaceId: 'workspace-1',
} as unknown as AgentShellExecutionLease;

const GRANT = {
  command: 'printf hello',
  commandHash: 'hash',
  cwdPath: '/tmp/work',
  environment: [],
  expiresAt: Date.now() + 10_000,
  invocation: {
    argv: ['-c', 'printf hello'],
    executable: '/bin/sh',
    shell: false,
  },
  leaseId: 'lease-1',
  provider: {
    executable: 'sh',
    executableContentIdentity: { sha256: 'a'.repeat(64), sizeBytes: 10 },
    fixedArgs: ['-c'],
    registrationIdentity: 'provider-1',
    resolvedExecutable: '/bin/sh',
  },
  token: {},
  workspace: {
    generation: 1,
    logicalCwd: 'work',
    owner: OWNER,
    physicalCwdPath: '/tmp/work',
    physicalHomePath: '/tmp/home',
    physicalTempPath: '/tmp/tmp',
    runId: 'run-1',
    workspaceContentIdentity: 'content',
    workspaceContentScannerRevision: 'workspace-content-scanner-v3',
    workspaceEntryCount: 1,
    workspaceId: 'workspace-1',
    workspaceMetadataIdentity: 'metadata',
    workspaceTotalBytes: 0,
  } satisfies AgentShellWorkspacePreparationContext,
} as unknown as AgentShellExecutionLeaseGrant;

function processResult(
  status: AgentShellProcessResult['status'],
  overrides: Partial<AgentShellProcessResult> = {},
): AgentShellProcessResult {
  return Object.freeze({
    durationMs: 12,
    executionId: 'execution-1',
    exitCode: status === 'completed' ? 0 : null,
    output: Object.freeze([]),
    outputBytes: 5,
    droppedOutputBytes: 0,
    status,
    stderr: '',
    stdout: '',
    terminationConfirmed: true,
    terminationSignal: null,
    ...overrides,
  });
}

function tail(): AgentShellOutputTailV1 {
  return Object.freeze({
    executionId: 'execution-1',
    firstSequence: 1,
    frames: Object.freeze([Object.freeze({
      executionId: 'execution-1',
      observedAt: new Date(0).toISOString(),
      sequence: 1,
      stream: 'stdout' as const,
      text: 'hello',
    })]),
    lastSequence: 1,
    truncatedBefore: null,
  });
}

function createFixture(result: AgentShellProcessResult, options: {
  readonly appendError?: Error;
  readonly finishFrames?: boolean;
  readonly flushError?: Error;
} = {}) {
  const events: AgentShellRuntimeEvent[] = [];
  const appendedTexts: string[] = [];
  const log = {
    appendSupervisorOutput: vi.fn((event) => {
      if (options.appendError) throw options.appendError;
      appendedTexts.push(event.text);
      return {
        droppedDetailedBytes: 0,
        frames: event.text === 'raw output'
          ? [tail().frames[0]]
          : [],
      };
    }),
    finish: vi.fn(() => ({
      droppedDetailedBytes: 0,
      frames: options.finishFrames ? [tail().frames[0]] : [],
    })),
    flush: vi.fn(async () => {
      if (options.flushError) throw options.flushError;
    }),
    getTail: vi.fn(() => tail()),
    logRef: 'log:v1:ref',
    dispose: vi.fn(async () => true),
  } satisfies AgentShellLogHandle;
  const acquire = vi.fn(async () => LEASE);
  const consume = vi.fn(async () => GRANT);
  const start = vi.fn((input: {
    onEvent?: (event: AgentShellProcessEvent) => void;
    signal?: AbortSignal;
    grant: AgentShellExecutionLeaseGrant;
  }) => {
    input.onEvent?.({
      executionId: 'execution-1',
      kind: 'state',
      state: 'starting',
      timestamp: 1,
    });
    input.onEvent?.({
      executionId: 'execution-1',
      kind: 'state',
      state: 'running',
      timestamp: 2,
    });
    input.onEvent?.({
      byteLength: 11,
      executionId: 'execution-1',
      kind: 'output',
      sequence: 0,
      stream: 'stdout' as const,
      text: 'raw output',
      timestamp: 3,
    });
    input.onEvent?.({
      executionId: 'execution-1',
      kind: 'state',
      state: result.status,
      timestamp: 4,
    });
    return {
      executionId: 'execution-1',
      promise: Promise.resolve(result),
    };
  });
  const cancel = vi.fn(() => true);
  const assertReady = vi.fn(async ({ grant }: { grant: AgentShellExecutionLeaseGrant }) => grant);
  const createLog = vi.fn(() => log);
  const runtime = createAgentShellRuntime({
    executionLeaseManager: { acquire, consume },
    logStore: { create: createLog },
    processSupervisor: { cancel, start },
    spawnPreflight: { assertReady },
  });
  return {
    appendedTexts,
    cancel,
    consume,
    events,
    log,
    runtime,
    start,
    acquire,
    assertReady,
    createLog,
    run: () => runtime.run({
      onEvent: event => events.push(event),
      owner: OWNER,
      preparation: PREPARATION,
      runCapabilityIdentity: 'capability-1',
      signal: new AbortController().signal,
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    }),
  };
}

describe('Agent Shell Runtime', () => {
  it('acquires and consumes a lease, binds one log, and only emits sanitized log frames', async () => {
    const fixture = createFixture(processResult('completed'));
    const result = await fixture.run();

    expect(fixture.acquire).toHaveBeenCalledWith(expect.objectContaining({
      owner: OWNER,
      preparation: PREPARATION,
      runCapabilityIdentity: 'capability-1',
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    }));
    expect(fixture.consume).toHaveBeenCalledWith(LEASE, OWNER, expect.any(AbortSignal));
    expect(fixture.assertReady).toHaveBeenCalledWith(expect.objectContaining({
      grant: GRANT,
      owner: OWNER,
      preparation: PREPARATION,
      runCapabilityIdentity: 'capability-1',
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    }));
    expect(fixture.start).toHaveBeenCalledWith(expect.objectContaining({ grant: GRANT }));
    expect(fixture.appendedTexts).toEqual(['raw output']);
    expect(fixture.events.map(event => event.kind)).toEqual(['state', 'state', 'output', 'state']);
    expect(fixture.events.at(-1)).toMatchObject({ state: 'completed' });
    expect(fixture.events.find(event => event.kind === 'output')).toMatchObject({
      frames: [tail().frames[0]],
      logRef: 'log:v1:ref',
    });
    expect(fixture.log.finish).toHaveBeenCalledOnce();
    expect(fixture.log.flush).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      executionId: 'execution-1',
      logRef: 'log:v1:ref',
      ok: true,
      outputProjection: {
        stderr: { totalBytes: 0 },
        stdout: { head: 'hello', totalBytes: 5, truncated: false },
        version: 1,
      },
      processStatus: 'completed',
      status: 'completed',
    });
  });

  it('turns a logging failure into a failed settlement and asks the supervisor to cancel', async () => {
    const fixture = createFixture(processResult('cancelled'), {
      appendError: new Error('log append failed'),
    });
    const result = await fixture.run();

    expect(fixture.cancel).toHaveBeenCalledWith('execution-1');
    expect(result).toMatchObject({
      ok: false,
      processStatus: 'cancelled',
      status: 'failed',
      terminationReason: 'log_failure',
    });
  });

  it('publishes the process terminal event only after final log frames', async () => {
    const fixture = createFixture(processResult('completed'), { finishFrames: true });
    await fixture.run();

    expect(fixture.events.at(-2)?.kind).toBe('output');
    expect(fixture.events.at(-1)).toMatchObject({ kind: 'state', state: 'completed' });
  });

  it('maps timeout and unconfirmed termination to stable failure reasons', async () => {
    const timedOut = await createFixture(processResult('timed-out')).run();
    expect(timedOut).toMatchObject({ status: 'failed', terminationReason: 'timed_out' });

    const unconfirmed = await createFixture(processResult('interrupted', {
      terminationConfirmed: false,
    })).run();
    expect(unconfirmed).toMatchObject({
      processStatus: 'interrupted',
      status: 'failed',
      terminationReason: 'termination_incomplete',
    });
  });

  it('does not expose process-layer error text in the settlement result', async () => {
    const result = await createFixture(processResult('failed', {
      errorMessage: 'spawn /Users/private/agent/workspace failed',
    })).run();

    expect(result).toMatchObject({
      errorMessage: 'Agent Shell 进程执行失败',
      status: 'failed',
      terminationReason: 'process_error',
    });
    expect(result.errorMessage).not.toContain('/Users/private');
  });

  it('preserves a confirmed cancellation and reports a confirmed interruption separately', async () => {
    const cancelled = await createFixture(processResult('cancelled')).run();
    expect(cancelled).toMatchObject({ status: 'cancelled', terminationReason: 'cancelled' });

    const interrupted = await createFixture(processResult('interrupted')).run();
    expect(interrupted).toMatchObject({ status: 'interrupted', terminationReason: 'interrupted' });
  });

  it('fails closed when the per-log flush cannot complete', async () => {
    const fixture = createFixture(processResult('completed'), {
      flushError: new Error('physical log unavailable'),
    });
    const result = await fixture.run();

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      terminationReason: 'log_failure',
    });
  });

  it('does not start a process when spawn preflight rejects the consumed grant', async () => {
    const fixture = createFixture(processResult('completed'));
    fixture.assertReady.mockRejectedValueOnce(new Error('Agent Shell workspace 在 spawn 前已变化'));

    await expect(fixture.run()).rejects.toThrow('spawn 前已变化');
    expect(fixture.start).not.toHaveBeenCalled();
    expect(fixture.createLog).not.toHaveBeenCalled();
  });
});
