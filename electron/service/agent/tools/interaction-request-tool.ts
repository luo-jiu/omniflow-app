import type { AgentTool } from '../agent-tool-registry';
import { normalizeAgentInteractionRequest } from '../agent-interaction-model';

export const AGENT_INTERACTION_TIMEOUT_MS = 30 * 60 * 1_000;
export const AGENT_INTERACTION_SETTLEMENT_GRACE_MS = 30_000;
export const INTERACTION_REQUEST_TOOL_REGISTRATION_ID = 'builtin:interaction.request@1';

export const interactionRequestTool: AgentTool = {
  assess(input) {
    normalizeAgentInteractionRequest(input);
    return { behavior: 'allow', risk: 'write' };
  },
  description: '当任务缺少一个必须由用户决定的有限选项或少量参数时，显示受控选择卡片或表单并等待用户回答。已有信息足够、可以直接执行或只需普通说明时不要调用。',
  inputSchema: {
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          kind: { const: 'choice' },
          multiple: { type: 'boolean' },
          options: {
            items: {
              additionalProperties: false,
              properties: {
                description: { type: 'string' },
                id: { type: 'string' },
                label: { type: 'string' },
              },
              required: ['id', 'label'],
              type: 'object',
            },
            type: 'array',
          },
          prompt: { type: 'string' },
          submitLabel: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['kind', 'prompt', 'options'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          fields: {
            items: {
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                placeholder: { type: 'string' },
                required: { type: 'boolean' },
                type: { enum: ['text', 'number', 'boolean', 'select'] },
                values: {
                  items: {
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                    },
                    required: ['id', 'label'],
                    type: 'object',
                  },
                  type: 'array',
                },
              },
              required: ['id', 'label', 'type'],
              type: 'object',
            },
            type: 'array',
          },
          kind: { const: 'form' },
          prompt: { type: 'string' },
          submitLabel: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['kind', 'prompt', 'fields'],
        type: 'object',
      },
    ],
    type: 'object',
  },
  executor: 'main',
  name: 'interaction.request',
  registrationId: INTERACTION_REQUEST_TOOL_REGISTRATION_ID,
  risk: 'write',
  timeoutMs: AGENT_INTERACTION_TIMEOUT_MS + AGENT_INTERACTION_SETTLEMENT_GRACE_MS,
  validate(input) {
    try {
      normalizeAgentInteractionRequest(input);
      return { ok: true };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '交互请求无效',
        ok: false,
      };
    }
  },
  async execute(input, context) {
    if (!context.requestInteraction) {
      return { message: '当前 Agent 运行时不支持交互请求', ok: false };
    }
    const request = normalizeAgentInteractionRequest(input);
    const response = await context.requestInteraction(request, context.signal);
    return {
      data: { response },
      message: request.kind === 'choice' ? '用户已提交选择' : '用户已提交表单',
      ok: true,
    };
  },
};
