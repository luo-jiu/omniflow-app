import crypto from 'node:crypto';

import type {
  AgentRunPlanSnapshot,
  AgentRunPlanStepSnapshot,
} from '@/shared/agent/agent.types';
import type { AgentProviderToolDefinition } from './agent-provider-model';
import { containsAgentSensitiveData } from './agent-sensitive-data';

export const AGENT_PLAN_CONTROL_TOOL_NAME = 'agent.plan.set';

const MIN_PLAN_STEPS = 2;
const MAX_PLAN_STEPS = 8;
const MAX_PLAN_TITLE_LENGTH = 80;
const MAX_PLAN_STEP_TITLE_LENGTH = 100;
const ALLOWED_PLAN_KEYS = new Set(['steps', 'title']);
const ALLOWED_PLAN_STEP_KEYS = new Set(['title', 'toolName']);
const ALLOWED_STORED_PLAN_KEYS = new Set(['createdAt', 'steps', 'title', 'version']);
const ALLOWED_STORED_PLAN_STEP_KEYS = new Set([
  'expectedToolName',
  'id',
  'ordinal',
  'title',
]);

export const agentPlanControlTool: AgentProviderToolDefinition = {
  description: '为需要多个真实 Tool 的任务声明一次简短计划。计划只描述将要执行的动作，不代表动作已经执行，也不授予任何权限。简单问答或只需一个 Tool 时不要调用。',
  inputSchema: {
    additionalProperties: false,
    properties: {
      steps: {
        items: {
          additionalProperties: false,
          properties: {
            title: {
              description: '用户可读的具体动作，不包含状态、百分比或结果。',
              maxLength: MAX_PLAN_STEP_TITLE_LENGTH,
              minLength: 1,
              type: 'string',
            },
            toolName: {
              description: '预计执行该动作的本轮业务 Tool 完整名称。',
              minLength: 1,
              type: 'string',
            },
          },
          required: ['title', 'toolName'],
          type: 'object',
        },
        maxItems: MAX_PLAN_STEPS,
        minItems: MIN_PLAN_STEPS,
        type: 'array',
      },
      title: {
        description: '可选的简短任务标题。',
        maxLength: MAX_PLAN_TITLE_LENGTH,
        minLength: 1,
        type: 'string',
      },
    },
    required: ['steps'],
    type: 'object',
  },
  name: AGENT_PLAN_CONTROL_TOOL_NAME,
};

function normalizeText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  if (Array.from(normalized).length > maximumLength) {
    throw new Error(`${label}不能超过 ${maximumLength} 个字符`);
  }
  return normalized;
}

function normalizePlanDisplayText(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  const normalized = normalizeText(value, label, maximumLength);
  if (containsAgentSensitiveData(normalized)) {
    throw new Error(`${label}不能包含 API Key、密码、Cookie、令牌、私钥或其他凭据`);
  }
  return normalized;
}

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}格式无效`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  const unknownKey = Object.keys(value).find(key => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`${label}包含不允许的字段：${unknownKey}`);
}

export function normalizeAgentRunPlan(
  value: unknown,
  availableToolNames: ReadonlySet<string>,
  createdAt: string,
  createId: () => string = crypto.randomUUID,
): AgentRunPlanSnapshot {
  const input = requirePlainObject(value, 'Agent 计划');
  rejectUnknownKeys(input, ALLOWED_PLAN_KEYS, 'Agent 计划');
  if (!Array.isArray(input.steps)) throw new Error('Agent 计划步骤必须是数组');
  if (input.steps.length < MIN_PLAN_STEPS || input.steps.length > MAX_PLAN_STEPS) {
    throw new Error(`Agent 计划必须包含 ${MIN_PLAN_STEPS} 至 ${MAX_PLAN_STEPS} 个步骤`);
  }

  const generatedIds = new Set<string>();
  const steps = input.steps.map((rawStep, index): AgentRunPlanStepSnapshot => {
    const step = requirePlainObject(rawStep, `Agent 计划第 ${index + 1} 步`);
    rejectUnknownKeys(step, ALLOWED_PLAN_STEP_KEYS, `Agent 计划第 ${index + 1} 步`);
    const expectedToolName = normalizeText(
      step.toolName,
      `Agent 计划第 ${index + 1} 步的 Tool 名称`,
      120,
    );
    if (!availableToolNames.has(expectedToolName)) {
      throw new Error(`Agent 计划引用了本轮不可用的 Tool：${expectedToolName}`);
    }
    const id = normalizeText(createId(), 'Agent 计划步骤 ID', 200);
    if (generatedIds.has(id)) throw new Error('Agent 计划步骤 ID 生成冲突');
    generatedIds.add(id);
    return {
      expectedToolName,
      id,
      ordinal: index + 1,
      title: normalizePlanDisplayText(
        step.title,
        `Agent 计划第 ${index + 1} 步标题`,
        MAX_PLAN_STEP_TITLE_LENGTH,
      ),
    };
  });
  const title = input.title === undefined
    ? undefined
    : normalizePlanDisplayText(input.title, 'Agent 计划标题', MAX_PLAN_TITLE_LENGTH);
  return {
    createdAt,
    steps,
    ...(title ? { title } : {}),
    version: 1,
  };
}

export function parseStoredAgentRunPlan(value: string | null): AgentRunPlanSnapshot | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Agent 计划记录损坏');
  }
  const input = requirePlainObject(parsed, 'Agent 计划记录');
  rejectUnknownKeys(input, ALLOWED_STORED_PLAN_KEYS, 'Agent 计划记录');
  if (input.version !== 1 || typeof input.createdAt !== 'string' || !Array.isArray(input.steps)) {
    throw new Error('Agent 计划记录损坏');
  }
  if (input.steps.length < MIN_PLAN_STEPS || input.steps.length > MAX_PLAN_STEPS) {
    throw new Error('Agent 计划记录损坏');
  }
  const ids = new Set<string>();
  const steps = input.steps.map((rawStep, index): AgentRunPlanStepSnapshot => {
    const step = requirePlainObject(rawStep, 'Agent 计划步骤记录');
    rejectUnknownKeys(step, ALLOWED_STORED_PLAN_STEP_KEYS, 'Agent 计划步骤记录');
    const id = normalizeText(step.id, 'Agent 计划步骤 ID', 200);
    if (ids.has(id) || Number(step.ordinal) !== index + 1) {
      throw new Error('Agent 计划记录损坏');
    }
    ids.add(id);
    return {
      expectedToolName: normalizeText(step.expectedToolName, 'Agent 计划 Tool 名称', 120),
      id,
      ordinal: index + 1,
      title: normalizeText(step.title, 'Agent 计划步骤标题', MAX_PLAN_STEP_TITLE_LENGTH),
    };
  });
  const title = input.title === undefined
    ? undefined
    : normalizeText(input.title, 'Agent 计划标题', MAX_PLAN_TITLE_LENGTH);
  return {
    createdAt: normalizeText(input.createdAt, 'Agent 计划创建时间', 100),
    steps,
    ...(title ? { title } : {}),
    version: 1,
  };
}
