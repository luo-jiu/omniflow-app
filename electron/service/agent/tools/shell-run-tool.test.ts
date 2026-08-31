import { describe, expect, it, vi } from 'vitest';

import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { createAgentShellRunTool } from './shell-run-tool';

function executionContext(): AgentToolExecutionContext {
  return {
    appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
    onProgress: vi.fn(),
    preparation: {
      binding: {},
      identity: {
        aiDestinationIdentity: `v1:${'a'.repeat(64)}`,
        callId: 'call-1',
        libraryId: 3,
        ownerScope: { accountScope: 'user:7', backendScope: 'https://example.com/api' },
        ownerWebContentsId: 1,
        preparedActionId: 'prepared-1',
        runCapabilityIdentity: `v2:${'b'.repeat(64)}`,
        runId: 'run-1',
        sessionId: 'session-1',
        toolInputHash: 'c'.repeat(64),
        toolName: 'shell.run',
        toolRegistrationId: 'shell.run@1',
        toolRunId: 'tool-run-1',
      },
      preparedActionId: 'prepared-1',
      publicAction: { kind: 'shell.run', version: 1 } as never,
      snapshotHash: 'd'.repeat(64),
    },
    signal: new AbortController().signal,
  };
}

function runtimeResult(overrides: Record<string, unknown> = {}) {
  return {
    droppedDetailedBytes: 0,
    droppedOutputBytes: 0,
    durationMs: 12,
    executionId: 'execution-1',
    exitCode: 0,
    logRef: `log:v1:${'e'.repeat(64)}`,
    ok: true,
    outputBytes: 4,
    outputTail: {
      executionId: 'execution-1',
      firstSequence: 1,
      frames: [{
        executionId: 'execution-1',
        observedAt: new Date(0).toISOString(),
        sequence: 1,
        stream: 'stdout' as const,
        text: 'done',
      }],
      lastSequence: 1,
      truncatedBefore: null,
    },
    processStatus: 'completed' as const,
    status: 'completed' as const,
    terminationConfirmed: true,
    terminationSignal: null,
    ...overrides,
  };
}

describe('shell.run Tool', () => {
  it('projects only bounded sanitized tails and opaque log identity', async () => {
    const execute = vi.fn(async () => runtimeResult());
    const tool = createAgentShellRunTool({
      execute,
      prepare: vi.fn(),
    });
    const result = await tool.execute?.({ command: 'pwd' }, executionContext());

    expect(tool).toMatchObject({
      name: 'shell.run',
      preparedRisk: 'dynamic',
      registrationId: 'shell.run@1',
      risk: 'destructive',
    });
    expect(result).toEqual({
      data: {
        droppedOutputBytes: 0,
        durationMs: 12,
        executionId: 'execution-1',
        exitCode: 0,
        logRef: `log:v1:${'e'.repeat(64)}`,
        status: 'completed',
        stderrTail: '',
        stdoutTail: 'done',
        tailTruncated: false,
      },
      message: 'Shell 命令执行完成',
      ok: true,
    });
  });

  it('maps process cancellation to AbortError so ToolRun settles as cancelled', async () => {
    const tool = createAgentShellRunTool({
      execute: vi.fn(async () => runtimeResult({
        errorMessage: 'Agent Shell 执行已取消',
        ok: false,
        processStatus: 'cancelled',
        status: 'cancelled',
        terminationReason: 'cancelled',
      })),
      prepare: vi.fn(),
    });
    await expect(tool.execute?.({ command: 'pwd' }, executionContext()))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps strict Shell normalization behind the JSON schema boundary', async () => {
    const tool = createAgentShellRunTool({ execute: vi.fn(), prepare: vi.fn() });
    expect(await tool.validate?.({ command: 'pwd' }, executionContext())).toEqual({ ok: true });
    expect(await tool.validate?.({ command: 'pwd', env: { PATH: '/tmp' } }, executionContext()))
      .toMatchObject({ ok: false, message: 'Agent Shell 环境变量禁止覆盖' });
  });
});
