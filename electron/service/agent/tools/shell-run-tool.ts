import type { AgentToolResult } from '../../../../src/shared/agent/agent.types';
import {
  AGENT_SHELL_MAX_COMMAND_BYTES,
  AGENT_SHELL_MAX_CWD_BYTES,
  AGENT_SHELL_MAX_ENVIRONMENT_ENTRIES,
  AGENT_SHELL_MAX_TIMEOUT_MS,
  AGENT_SHELL_RUN_TOOL_NAME,
  normalizeAgentShellRunInputV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolMainPreparationContext,
  AgentToolMainPreparationResult,
} from '../agent-tool-registry';
import type { AgentShellRuntimeResult } from '../shell/agent-shell-runtime';

const AGENT_SHELL_TOOL_REGISTRATION_ID = 'shell.run@1';
const AGENT_SHELL_RESULT_TAIL_BYTES = 16 * 1024;

export interface AgentShellRunToolRuntime {
  readonly execute: (
    context: AgentToolExecutionContext,
  ) => Promise<AgentShellRuntimeResult>;
  readonly prepare: (
    input: unknown,
    requestedAction: Parameters<NonNullable<AgentTool['prepareMain']>>[1],
    context: AgentToolMainPreparationContext,
  ) => Promise<AgentToolMainPreparationResult>;
}

function boundedTail(input: string): { readonly text: string; readonly truncated: boolean } {
  const source = Buffer.from(input, 'utf8');
  if (source.byteLength <= AGENT_SHELL_RESULT_TAIL_BYTES) {
    return { text: input, truncated: false };
  }
  let start = source.byteLength - AGENT_SHELL_RESULT_TAIL_BYTES;
  while (start < source.byteLength && (source[start] & 0xc0) === 0x80) start += 1;
  return {
    text: source.subarray(start).toString('utf8'),
    truncated: true,
  };
}

function projectShellResult(result: AgentShellRuntimeResult): AgentToolResult {
  const stdout = boundedTail(result.outputTail.frames
    .filter(frame => frame.stream === 'stdout')
    .map(frame => frame.text)
    .join(''));
  const stderr = boundedTail(result.outputTail.frames
    .filter(frame => frame.stream === 'stderr')
    .map(frame => frame.text)
    .join(''));
  const tailTruncated = stdout.truncated
    || stderr.truncated
    || result.outputTail.truncatedBefore !== null
    || result.droppedDetailedBytes > 0
    || result.droppedOutputBytes > 0;
  return {
    data: {
      droppedOutputBytes: result.droppedOutputBytes,
      durationMs: result.durationMs,
      executionId: result.executionId,
      exitCode: result.exitCode,
      logRef: result.logRef,
      status: result.status,
      stderrTail: stderr.text,
      stdoutTail: stdout.text,
      tailTruncated,
    },
    message: result.ok
      ? 'Shell 命令执行完成'
      : result.errorMessage || 'Shell 命令执行失败',
    ok: result.ok,
  };
}

export function createAgentShellRunTool(runtime: AgentShellRunToolRuntime): AgentTool {
  if (!runtime?.prepare || !runtime?.execute) {
    throw new Error('Agent Shell Tool 缺少生产运行时');
  }
  const tool: AgentTool = {
    description: '在当前 Agent Run 的隔离工作区中运行一条非交互式 Shell 命令。工作目录只能位于 home、input、output、tmp 或 work；命令、Provider、环境和实际风险会在执行前由主进程分析并冻结。',
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('Agent Shell Tool 缺少 prepared execution');
      const result = await runtime.execute(context);
      if (result.status === 'cancelled') {
        const error = new Error('Agent Shell 执行已取消');
        error.name = 'AbortError';
        throw error;
      }
      return projectShellResult(result);
    },
    executor: 'main' as const,
    inputSchema: {
      additionalProperties: false,
      properties: {
        command: {
          description: '要执行的完整非交互式 Shell 命令。路径必须位于 Run 工作区内。',
          maxLength: AGENT_SHELL_MAX_COMMAND_BYTES,
          minLength: 1,
          type: 'string',
        },
        cwd: {
          default: 'work',
          description: '逻辑工作目录，例如 work、input 或 output/result。默认 work。',
          maxLength: AGENT_SHELL_MAX_CWD_BYTES,
          minLength: 1,
          type: 'string',
        },
        env: {
          additionalProperties: {
            maxLength: 2_048,
            type: 'string',
          },
          description: '可选的非敏感环境变量覆盖；PATH、HOME、凭据类变量禁止覆盖。',
          maxProperties: AGENT_SHELL_MAX_ENVIRONMENT_ENTRIES,
          type: 'object',
        },
        providerId: {
          description: '可选 Shell Provider ID。省略时使用当前平台默认 Provider。',
          maxLength: 128,
          minLength: 1,
          type: 'string',
        },
        timeoutMs: {
          default: 600_000,
          description: '进程超时毫秒数，最大 21600000。',
          maximum: AGENT_SHELL_MAX_TIMEOUT_MS,
          minimum: 1,
          type: 'integer',
        },
      },
      required: ['command'],
      type: 'object',
    },
    name: AGENT_SHELL_RUN_TOOL_NAME,
    prepareMain: (input, requestedAction, context) => runtime.prepare(
      input,
      requestedAction,
      context,
    ),
    preparedRisk: 'dynamic' as const,
    registrationId: AGENT_SHELL_TOOL_REGISTRATION_ID,
    risk: 'destructive' as const,
    cancellationSettleTimeoutMs: 45_000,
    timeoutMs: AGENT_SHELL_MAX_TIMEOUT_MS,
    validate(input) {
      try {
        normalizeAgentShellRunInputV1(input);
        return { ok: true as const };
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : 'Agent Shell 输入无效',
          ok: false as const,
        };
      }
    },
  };
  return Object.freeze(tool);
}
