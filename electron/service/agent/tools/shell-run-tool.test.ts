import { describe, expect, it, vi } from 'vitest';

import { normalizeAgentToolResult } from '../agent-tool-broker';
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
    outputProjection: {
      stderr: {
        head: '',
        omittedBytes: 0,
        tail: '',
        totalBytes: 0,
        truncated: false,
      },
      stdout: {
        head: 'done',
        omittedBytes: 0,
        tail: '',
        totalBytes: 4,
        truncated: false,
      },
      version: 1 as const,
    },
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
        providerOutput: {
          stderr: {
            head: '',
            omittedBytes: 0,
            tail: '',
            totalBytes: 0,
            truncated: false,
          },
          stdout: {
            head: 'done',
            omittedBytes: 0,
            tail: '',
            totalBytes: 4,
            truncated: false,
          },
          version: 1,
        },
        status: 'completed',
        stderrTail: '',
        stdoutTail: 'done',
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

  it('uses a bounded head-tail summary for renderer output instead of a pure tail', async () => {
    const output = `renderer-start\n${'x'.repeat(8_000)}\nrenderer-end`;
    const tool = createAgentShellRunTool({
      execute: vi.fn(async () => runtimeResult({
        outputProjection: {
          stderr: {
            head: '',
            omittedBytes: 0,
            tail: '',
            totalBytes: 0,
            truncated: false,
          },
          stdout: {
            head: output,
            omittedBytes: 0,
            tail: '',
            totalBytes: Buffer.byteLength(output, 'utf8'),
            truncated: false,
          },
          version: 1,
        },
      })),
      prepare: vi.fn(),
    });
    const result = await tool.execute?.({ command: 'cat document.md' }, executionContext());
    const data = result?.data as Record<string, unknown>;
    const stdout = String(data.stdoutTail);

    expect(Buffer.byteLength(stdout, 'utf8')).toBeLessThanOrEqual(4 * 1_024);
    expect(stdout).toMatch(/^renderer-start/u);
    expect(stdout).toMatch(/renderer-end$/u);
    expect(stdout).toMatch(/\[\.\.\. \d+ bytes omitted \.\.\.\]/u);
    expect(data).not.toHaveProperty('tailTruncated');
  });

  it('keeps the exact upstream omitted-byte fact in the real renderer projection', async () => {
    const tool = createAgentShellRunTool({
      execute: vi.fn(async () => runtimeResult({
        outputProjection: {
          stderr: {
            head: '',
            omittedBytes: 0,
            tail: '',
            totalBytes: 0,
            truncated: false,
          },
          stdout: {
            head: `provider-start\n${'h'.repeat(45_000)}`,
            omittedBytes: 89_990,
            tail: `${'t'.repeat(45_000)}\nprovider-end`,
            totalBytes: 180_018,
            truncated: true,
          },
          version: 1,
        },
      })),
      prepare: vi.fn(),
    });

    const result = await tool.execute?.({ command: 'cat huge.md' }, executionContext());
    const stdout = String((result?.data as Record<string, unknown>).stdoutTail);
    const omittedMatch = /\n\[\.\.\. (\d+) bytes omitted \.\.\.\]\n/u.exec(stdout);
    const retainedOutput = omittedMatch
      ? stdout.slice(0, omittedMatch.index) + stdout.slice(omittedMatch.index + omittedMatch[0].length)
      : stdout;

    expect(Buffer.byteLength(stdout, 'utf8')).toBeLessThanOrEqual(4 * 1_024);
    expect(stdout).toMatch(/^provider-start/u);
    expect(stdout).toMatch(/provider-end$/u);
    expect(Number(omittedMatch?.[1])).toBe(
      180_018 - Buffer.byteLength(retainedOutput, 'utf8'),
    );
  });

  it('keeps model output above 32 KiB while bounding the renderer projection', async () => {
    const output = `provider-start\n${'x'.repeat(60_000)}\nprovider-end`;
    const tool = createAgentShellRunTool({
      execute: vi.fn(async () => runtimeResult({
        outputProjection: {
          stderr: {
            head: '',
            omittedBytes: 0,
            tail: '',
            totalBytes: 0,
            truncated: false,
          },
          stdout: {
            head: output,
            omittedBytes: 0,
            tail: '',
            totalBytes: Buffer.byteLength(output, 'utf8'),
            truncated: false,
          },
          version: 1,
        },
      })),
      prepare: vi.fn(),
    });
    const result = await tool.execute?.({ command: 'cat document.md' }, executionContext());
    const data = result?.data as Record<string, unknown>;
    const providerOutput = data.providerOutput as {
      stdout: { head: string; truncated: boolean };
    };

    expect(Buffer.byteLength(providerOutput.stdout.head, 'utf8')).toBeGreaterThan(32 * 1024);
    expect(providerOutput.stdout.head).toBe(output);
    expect(providerOutput.stdout.truncated).toBe(false);
    expect(Buffer.byteLength(String(data.stdoutTail), 'utf8')).toBeLessThanOrEqual(4 * 1_024);
  });

  it('fits very large provider output below the canonical Tool result hard limit', async () => {
    const output = `provider-start\n${'x'.repeat(180_000)}\nprovider-end`;
    const tool = createAgentShellRunTool({
      execute: vi.fn(async () => runtimeResult({
        outputProjection: {
          stderr: {
            head: '',
            omittedBytes: 0,
            tail: '',
            totalBytes: 0,
            truncated: false,
          },
          stdout: {
            head: output,
            omittedBytes: 0,
            tail: '',
            totalBytes: Buffer.byteLength(output, 'utf8'),
            truncated: false,
          },
          version: 1,
        },
      })),
      prepare: vi.fn(),
    });
    const result = await tool.execute?.({ command: 'cat large.md' }, executionContext());
    const data = result?.data as Record<string, unknown>;
    const providerOutput = data.providerOutput as {
      stdout: {
        head: string;
        omittedBytes: number;
        tail: string;
        totalBytes: number;
        truncated: boolean;
      };
    };

    expect(JSON.stringify(data).length).toBeLessThanOrEqual(90_000);
    expect(providerOutput.stdout.head).toMatch(/^provider-start/u);
    expect(providerOutput.stdout.tail).toMatch(/provider-end$/u);
    expect(providerOutput.stdout.totalBytes).toBe(Buffer.byteLength(output, 'utf8'));
    expect(providerOutput.stdout.omittedBytes).toBeGreaterThan(0);
    expect(providerOutput.stdout.truncated).toBe(true);
    expect(normalizeAgentToolResult(result!).data).toHaveProperty('providerOutput');
  });

  it('keeps strict Shell normalization behind the JSON schema boundary', async () => {
    const tool = createAgentShellRunTool({ execute: vi.fn(), prepare: vi.fn() });
    expect(await tool.validate?.({ command: 'pwd' }, executionContext())).toEqual({ ok: true });
    expect(await tool.validate?.({ command: 'pwd', env: { PATH: '/tmp' } }, executionContext()))
      .toMatchObject({ ok: false, message: 'Agent Shell 环境变量禁止覆盖' });
  });

  it('describes the explicit host execution context without weakening workspace defaults', () => {
    const tool = createAgentShellRunTool({ execute: vi.fn(), prepare: vi.fn() });

    expect(tool.description).toContain('executionContext=host');
    expect(tool.description).toContain('隔离工作区');
    expect(tool.description).toContain('不存在 _omniflowProjection.truncated=true');
    expect(tool.description).toContain('stdout/stderr 流均包含 content、truncated=false、omittedBytes=0');
    expect(tool.description).toContain('这仍不表示命令覆盖了完整源文件');
    expect(tool.description).toContain('只有命令读取完整来源且所需输出也完整时');
    expect(tool.inputSchema).toMatchObject({
      properties: {
        command: {
          description: expect.stringContaining('完整非交互式 Shell 命令'),
        },
        cwd: {
          description: expect.stringContaining('用户给出文件路径时使用其父目录'),
        },
        executionContext: {
          enum: ['run-workspace', 'host'],
        },
      },
    });
  });
});
