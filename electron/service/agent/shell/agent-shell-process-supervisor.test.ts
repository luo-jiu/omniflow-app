import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import type { AgentToolMainPreparedExecution } from '../agent-tool-registry';
import { createAgentShellExecutionLeaseManager } from './agent-shell-execution-lease';
import { createAgentShellCommandHash } from './agent-shell-prepared-action';
import { createAgentShellProcessSupervisor } from './agent-shell-process-supervisor';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
} from './agent-shell-workspace-store';

const OWNER: AgentShellWorkspaceOwner = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});

function workspace(): AgentShellWorkspacePreparationContext {
  return Object.freeze({
    generation: 3,
    logicalCwd: 'work',
    owner: OWNER,
    physicalCwdPath: '/private/agent/workspace/work',
    physicalHomePath: '/private/agent/workspace/home',
    physicalTempPath: '/private/agent/workspace/tmp',
    runId: 'run-1',
    workspaceContentIdentity: `v3:${'1'.repeat(64)}`,
    workspaceContentScannerRevision: 'workspace-content-scanner-v3',
    workspaceEntryCount: 5,
    workspaceId: 'workspace-1',
    workspaceMetadataIdentity: `v2:${'2'.repeat(64)}`,
    workspaceTotalBytes: 0,
  });
}

function prepared(timeoutMs = 10_000): AgentToolMainPreparedExecution {
  const command = 'printf hello';
  const commandHash = createAgentShellCommandHash(command);
  return {
    binding: {
      aiDestination: { identity: `v1:${'3'.repeat(64)}` },
      analysis: {
        analysisIdentity: `v1:${'4'.repeat(64)}`,
        authorizationIdentity: `v1:${'5'.repeat(64)}`,
        workspaceBoundaryVerified: true,
      },
      commandHash,
      effectiveEnvironment: {
        entries: [{ name: 'PATH', value: '/usr/bin' }],
      },
      invocation: { argv: ['-c', command], executable: '/bin/sh', shell: false },
      provider: {
        executable: 'sh',
        executableContentIdentity: { sha256: 'b'.repeat(64), sizeBytes: 100 },
        fixedArgs: ['-c'],
        registrationIdentity: `v1:${'6'.repeat(64)}`,
        resolvedExecutable: '/bin/sh',
      },
      workspace: workspace(),
    },
    identity: {
      aiDestinationIdentity: `v1:${'3'.repeat(64)}`,
      callId: 'call-1',
      libraryId: 3,
      ownerScope: OWNER,
      ownerWebContentsId: 1,
      preparedActionId: 'prepared-1',
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      runId: 'run-1',
      sessionId: 'session-1',
      toolInputHash: `sha256:${'8'.repeat(64)}`,
      toolName: 'shell.run',
      toolRegistrationId: 'omniflow.shell.run.v1',
      toolRunId: 'tool-run-1',
    },
    preparedActionId: 'prepared-1',
    publicAction: {
      aiDestination: {
        identityHash: `v1:${'3'.repeat(64)}`,
        profileLabel: 'Local',
        providerType: 'openai-compatible',
      },
      assessment: {
        facets: ['process_launch'],
        operations: [{ argvPrefix: ['hello'], effects: ['process_launch'], executable: 'printf' }],
        persistentRuleEligible: false,
        risk: 'write',
        unresolved: [],
      },
      command,
      commandHash,
      cwd: { kind: 'run-workspace', path: 'work' },
      dataScope: { stagedInputs: [], unresolvedWorkspaceRead: false },
      environment: [],
      kind: 'shell.run',
      provider: { dialect: 'bash', id: 'system-shell', version: '1' },
      timeoutMs,
      version: 1,
    },
    snapshotHash: `sha256:${'9'.repeat(64)}`,
  };
}

async function grant(timeoutMs = 10_000) {
  const manager = createAgentShellExecutionLeaseManager({
    createId: () => `lease-${timeoutMs}-${Math.random()}`,
    ttlMs: 60_000,
    workspaceStore: {
      resolvePreparationContext: vi.fn(async () => workspace()),
    },
  });
  const lease = await manager.acquire({
    owner: OWNER,
    preparation: prepared(timeoutMs),
    runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
    toolRunId: 'tool-run-1',
    workspaceId: 'workspace-1',
  });
  return manager.consume(lease, OWNER);
}

async function windowsGrant() {
  const source = await grant();
  const windowsWorkspace = Object.freeze({
    ...source.workspace,
    physicalCwdPath: 'C:\\OmniFlow\\agent\\workspace\\work',
  });
  return Object.freeze({
    ...source,
    cwdPath: windowsWorkspace.physicalCwdPath,
    invocation: Object.freeze({
      ...source.invocation,
      argv: Object.freeze(['-NoProfile', '-Command', source.command]),
      executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    }),
    provider: Object.freeze({
      ...source.provider,
      executable: 'powershell.exe',
      fixedArgs: Object.freeze(['-NoProfile', '-Command']),
      resolvedExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    }),
    workspace: windowsWorkspace,
  });
}

interface TestChild extends ChildProcess {
  readonly stderr: PassThrough;
  readonly stdout: PassThrough;
}

function childFixture(): TestChild {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    pid: 1234,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  }) as unknown as TestChild;
  return child;
}

function supervisorFixture(child: TestChild, options: {
  readonly maxConcurrentProcesses?: number;
  readonly maxOutputBytes?: number;
  readonly terminationGraceMs?: number;
  readonly terminationSettleMs?: number;
} = {}) {
  const spawnProcess = vi.fn(() => child);
  const terminateProcessTree = vi.fn((target: ChildProcess, request: { force: boolean }) => {
    if (!request.force) queueMicrotask(() => target.emit('close', null, 'SIGTERM'));
  });
  return {
    spawnProcess,
    terminateProcessTree,
    supervisor: createAgentShellProcessSupervisor({
      ...options,
      createId: () => 'execution-1',
      platform: 'darwin',
      spawnProcess,
      terminateProcessTree,
    }),
  };
}

describe('Agent Shell process supervisor', () => {
  it('runs a consumed grant with a fixed process boundary and preserves output order', async () => {
    const child = childFixture();
    const fixture = supervisorFixture(child);
    const events: string[] = [];
    const handle = fixture.supervisor.start({
      grant: await grant(),
      onEvent: event => events.push(event.kind === 'state' ? event.state : `${event.stream}:${event.text}`),
    });
    await Promise.resolve();
    child.stdout.write(Buffer.from([0xe4]));
    child.stderr.write('warning');
    child.stdout.write(Buffer.from([0xbd, 0xa0]));
    child.emit('close', 0, null);

    const result = await handle.promise;
    expect(fixture.spawnProcess).toHaveBeenCalledWith('/bin/sh', ['-c', 'printf hello'], expect.objectContaining({
      cwd: '/private/agent/workspace/work',
      detached: true,
      shell: false,
      windowsHide: false,
    }));
    expect(result).toMatchObject({
      status: 'completed',
      stderr: 'warning',
      stdout: '你',
      terminationConfirmed: true,
    });
    expect(result.output.map(event => event.stream)).toEqual(['stdout', 'stderr', 'stdout']);
    expect(events.slice(0, 2)).toEqual(['starting', 'running']);
    expect(events.at(-1)).toBe('completed');
  });

  it('reports a non-zero exit as failed', async () => {
    const child = childFixture();
    const fixture = supervisorFixture(child);
    const handle = fixture.supervisor.start({ grant: await grant() });
    await Promise.resolve();
    child.emit('close', 2, null);
    await expect(handle.promise).resolves.toMatchObject({ status: 'failed', exitCode: 2 });
  });

  it('uses the Windows Provider process boundary without POSIX detachment', async () => {
    const child = childFixture();
    const spawnProcess = vi.fn(() => child);
    const terminateProcessTree = vi.fn((target: ChildProcess) => {
      queueMicrotask(() => target.emit('close', null, 'SIGTERM'));
    });
    const supervisor = createAgentShellProcessSupervisor({
      createId: () => 'execution-win',
      platform: 'win32',
      spawnProcess,
      terminateProcessTree,
    });
    const handle = supervisor.start({ grant: await windowsGrant() });
    await Promise.resolve();
    child.emit('close', 0, null);
    await expect(handle.promise).resolves.toMatchObject({ status: 'completed' });
    expect(spawnProcess).toHaveBeenCalledWith(expect.stringContaining('WindowsPowerShell'), expect.any(Array), expect.objectContaining({
      detached: false,
      shell: false,
      windowsHide: true,
    }));
  });

  it('cancels through the process tree and waits for close', async () => {
    const child = childFixture();
    const fixture = supervisorFixture(child);
    const controller = new AbortController();
    const handle = fixture.supervisor.start({ grant: await grant(), signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    await expect(handle.promise).resolves.toMatchObject({
      status: 'cancelled',
      terminationConfirmed: true,
      terminationSignal: 'SIGTERM',
    });
    expect(fixture.terminateProcessTree).toHaveBeenCalledWith(child, expect.objectContaining({
      force: false,
      platform: 'darwin',
    }));
  });

  it('settles a timed-out process with a timed-out terminal state', async () => {
    vi.useFakeTimers();
    try {
      const child = childFixture();
      const fixture = supervisorFixture(child);
      const handle = fixture.supervisor.start({ grant: await grant(10) });
      await Promise.resolve();
      vi.advanceTimersByTime(11);
      await Promise.resolve();
      await expect(handle.promise).resolves.toMatchObject({
        status: 'timed-out',
        terminationConfirmed: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('escalates termination after the grace period before settling', async () => {
    vi.useFakeTimers();
    try {
      const child = childFixture();
      const terminateProcessTree = vi.fn((target: ChildProcess, request: { force: boolean }) => {
        if (request.force) target.emit('close', null, 'SIGKILL');
      });
      const supervisor = createAgentShellProcessSupervisor({
        createId: () => 'execution-force',
        platform: 'darwin',
        spawnProcess: () => child,
        terminateProcessTree,
        terminationGraceMs: 5,
        terminationSettleMs: 20,
      });
      const handle = supervisor.start({ grant: await grant(10) });
      await Promise.resolve();
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      expect(terminateProcessTree).toHaveBeenCalledWith(child, expect.objectContaining({ force: false }));
      expect(supervisor.getActiveCount()).toBe(1);
      vi.advanceTimersByTime(5);
      await expect(handle.promise).resolves.toMatchObject({
        status: 'timed-out',
        terminationConfirmed: true,
        terminationSignal: 'SIGKILL',
      });
      expect(terminateProcessTree).toHaveBeenCalledWith(child, expect.objectContaining({ force: true }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses interrupted when process teardown cannot be confirmed within the budget', async () => {
    vi.useFakeTimers();
    try {
      const child = childFixture();
      const supervisor = createAgentShellProcessSupervisor({
        createId: () => 'execution-unconfirmed',
        platform: 'darwin',
        spawnProcess: () => child,
        terminateProcessTree: vi.fn(),
        terminationGraceMs: 5,
        terminationSettleMs: 10,
      });
      const handle = supervisor.start({ grant: await grant() });
      await Promise.resolve();
      expect(supervisor.interrupt(handle.executionId)).toBe(true);
      vi.advanceTimersByTime(15);
      await expect(handle.promise).resolves.toMatchObject({
        status: 'interrupted',
        terminationConfirmed: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains output after the bound, records dropped bytes, and fails the run', async () => {
    const child = childFixture();
    const fixture = supervisorFixture(child, { maxOutputBytes: 4 });
    const handle = fixture.supervisor.start({ grant: await grant() });
    await Promise.resolve();
    child.stdout.write('abcdef');
    const result = await handle.promise;

    expect(result).toMatchObject({
      droppedOutputBytes: 2,
      outputBytes: 6,
      status: 'failed',
      stdout: 'abcd',
    });
    expect(fixture.terminateProcessTree).toHaveBeenCalled();
  });

  it('enforces concurrency and prevents reusing one consumed grant', async () => {
    const firstChild = childFixture();
    const secondChild = childFixture();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const terminateProcessTree = vi.fn((target: ChildProcess) => {
      queueMicrotask(() => target.emit('close', 0, null));
    });
    const supervisor = createAgentShellProcessSupervisor({
      createId: () => 'execution-1',
      maxConcurrentProcesses: 1,
      platform: 'darwin',
      spawnProcess,
      terminateProcessTree,
    });
    const firstGrant = await grant();
    const secondGrant = await grant();
    const first = supervisor.start({ grant: firstGrant });
    await Promise.resolve();
    expect(() => supervisor.start({ grant: secondGrant })).toThrow('并发数已达到上限');
    supervisor.interrupt(first.executionId);
    await first.promise;
    expect(() => supervisor.start({ grant: firstGrant })).toThrow('不能重复 spawn');
  });

  it('rejects a plain object before spawn', () => {
    const child = childFixture();
    const fixture = supervisorFixture(child);
    expect(() => fixture.supervisor.start({
      grant: {} as never,
    })).toThrow('只接受已消费');
    expect(fixture.spawnProcess).not.toHaveBeenCalled();
  });
});
