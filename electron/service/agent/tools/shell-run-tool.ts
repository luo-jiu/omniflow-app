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
import {
  AGENT_SHELL_PROVIDER_OUTPUT_MAX_BYTES,
  projectAgentShellProviderOutput,
  type AgentShellProviderOutputV1,
} from '../shell/agent-shell-output-projection';

const AGENT_SHELL_TOOL_REGISTRATION_ID = 'shell.run@1';
const AGENT_SHELL_RENDERER_OUTPUT_BYTES = 4 * 1024;
const AGENT_SHELL_RENDERER_OMISSION_MARKER_RESERVE_BYTES = 96;
// AgentToolBroker currently admits at most 100,000 JSON characters of
// canonical result data. Keep headroom for sanitization and transport fields.
const AGENT_SHELL_CANONICAL_RESULT_JSON_CHARACTERS = 90_000;

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

function formattedProviderStream(
  output: AgentShellProviderOutputV1['stdout'],
): string {
  const emptyStream = {
    head: '',
    omittedBytes: 0,
    tail: '',
    totalBytes: 0,
    truncated: false,
  };
  const projected = projectAgentShellProviderOutput({
    stderr: emptyStream,
    stdout: output,
    version: 1,
  }, AGENT_SHELL_RENDERER_OUTPUT_BYTES - AGENT_SHELL_RENDERER_OMISSION_MARKER_RESERVE_BYTES)
    .stdout;
  const text = projected.truncated
    ? `${projected.head}\n[... ${projected.omittedBytes} bytes omitted ...]\n${projected.tail}`
    : projected.head;
  return text;
}

function buildShellResultData(
  result: AgentShellRuntimeResult,
  providerOutput: AgentShellProviderOutputV1,
) {
  const stdout = formattedProviderStream(providerOutput.stdout);
  const stderr = formattedProviderStream(providerOutput.stderr);
  return {
    droppedOutputBytes: result.droppedOutputBytes,
    durationMs: result.durationMs,
    executionId: result.executionId,
    exitCode: result.exitCode,
    logRef: result.logRef,
    providerOutput,
    status: result.status,
    stderrTail: stderr,
    stdoutTail: stdout,
  };
}

function fitProviderOutputToCanonicalResult(
  result: AgentShellRuntimeResult,
  output: AgentShellProviderOutputV1,
): AgentShellProviderOutputV1 {
  const boundedOutput = projectAgentShellProviderOutput(
    output,
    AGENT_SHELL_PROVIDER_OUTPUT_MAX_BYTES,
  );
  if (
    JSON.stringify(buildShellResultData(result, boundedOutput)).length
    <= AGENT_SHELL_CANONICAL_RESULT_JSON_CHARACTERS
  ) return boundedOutput;

  let lowerBound = 1;
  let upperBound = AGENT_SHELL_PROVIDER_OUTPUT_MAX_BYTES - 1;
  let best = projectAgentShellProviderOutput(output, lowerBound);
  while (lowerBound <= upperBound) {
    const candidateBytes = Math.floor((lowerBound + upperBound) / 2);
    const candidate = projectAgentShellProviderOutput(output, candidateBytes);
    if (
      JSON.stringify(buildShellResultData(result, candidate)).length
      <= AGENT_SHELL_CANONICAL_RESULT_JSON_CHARACTERS
    ) {
      best = candidate;
      lowerBound = candidateBytes + 1;
    } else {
      upperBound = candidateBytes - 1;
    }
  }
  return best;
}

function projectShellResult(result: AgentShellRuntimeResult): AgentToolResult {
  const providerOutput = fitProviderOutputToCanonicalResult(
    result,
    result.outputProjection,
  );
  return {
    data: buildShellResultData(result, providerOutput),
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
    description: '运行一条完整的非交互式原生 Shell 命令。默认在当前 Agent Run 的隔离工作区执行；需要检查、读取或操作本机文件与工具时，显式使用 executionContext=host。命令、Provider、环境、宿主 cwd 和实际风险会在执行前由主进程分析并冻结。只有不存在 _omniflowProjection.truncated=true，且需要使用的 stdout/stderr 流均包含 content、truncated=false、omittedBytes=0，才表示这些命令输出已完整交付；这仍不表示命令覆盖了完整源文件。只有命令读取完整来源且所需输出也完整时，才能声称全文已读取。',
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
          description: '要执行的完整非交互式 Shell 命令。Shell 语法、管道、重定向和条件命令按所选 Provider 交给宿主执行；不要把命令名当作固定白名单。run-workspace 中的 ~ 指向虚拟 home，host 中的 ~ 指向宿主 home。',
          maxLength: AGENT_SHELL_MAX_COMMAND_BYTES,
          minLength: 1,
          type: 'string',
        },
        cwd: {
          default: 'work',
          description: '工作目录，不能是文件路径。run-workspace 下使用逻辑目录，例如 work、input 或 output/result；host 下使用宿主绝对目录、~ 或相对冻结 host cwd 的目录。用户给出文件路径时使用其父目录或省略本字段；省略时分别默认为 work 或宿主默认 cwd。',
          maxLength: AGENT_SHELL_MAX_CWD_BYTES,
          minLength: 1,
          type: 'string',
        },
        executionContext: {
          default: 'run-workspace',
          description: '执行上下文。run-workspace 使用本次 Run 的虚拟工作区；host 使用当前 macOS 用户的真实宿主环境。不要仅因为 full-access 就省略这个字段。',
          enum: ['run-workspace', 'host'],
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
