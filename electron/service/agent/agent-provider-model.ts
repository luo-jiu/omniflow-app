import {
  buildAIServiceOutputTokenFields,
  resolveAIServiceOutputTokenLimit,
  type AIServiceRuntimeConnection,
} from '../aiServiceClientModel';
import {
  AIServiceStreamLimitError,
  appendBoundedAIServiceStreamText,
} from '../aiServiceStreamLimits';
import type { AgentReasoningEffort } from '@/shared/agent/agent.types';

export interface AgentProviderToolDefinition {
  description: string;
  inputSchema: unknown;
  name: string;
}

export interface AgentProviderToolCall {
  id: string;
  input: unknown;
  inputError?: string;
  name: string;
}

export type AgentProviderMessage =
  | { content: string; role: 'user' }
  | { content: string; role: 'assistant'; toolCalls?: AgentProviderToolCall[] }
  | { content: string; name: string; role: 'tool'; toolCallId: string };

export interface AgentProviderTurnInput {
  maxOutputTokens: number;
  messages: AgentProviderMessage[];
  model: string;
  reasoningEffort?: AgentReasoningEffort;
  systemPrompt: string;
  tools: AgentProviderToolDefinition[];
}

interface StreamingToolCallState {
  arguments: string;
  id: string;
  input?: unknown;
  name: string;
}

interface AgentProviderToolNameMap {
  canonicalToProvider: Map<string, string>;
  providerToCanonical: Map<string, string>;
}

const PROVIDER_TOOL_NAME_MAX_LENGTH = 64;
const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PROVIDER_TOOL_CALL_ID_MAX_LENGTH = 128;

export interface AgentProviderStreamLimits {
  maxAssistantContentCharacters?: number;
  maxEventBufferCharacters?: number;
  maxToolArgumentCharacters?: number;
  maxToolArgumentTotalCharacters?: number;
  maxToolCalls?: number;
}

export interface ResolvedAgentProviderStreamLimits {
  maxAssistantContentCharacters: number;
  maxEventBufferCharacters: number;
  maxToolArgumentCharacters: number;
  maxToolArgumentTotalCharacters: number;
  maxToolCalls: number;
}

export const DEFAULT_AGENT_PROVIDER_STREAM_LIMITS: Readonly<ResolvedAgentProviderStreamLimits> = Object.freeze({
  maxAssistantContentCharacters: 64_000,
  maxEventBufferCharacters: 128_000,
  maxToolArgumentCharacters: 64_000,
  maxToolArgumentTotalCharacters: 128_000,
  maxToolCalls: 16,
});

export interface AgentProviderStreamState {
  content: string;
  limits: ResolvedAgentProviderStreamLimits;
  toolArgumentCharacters: number;
  toolCalls: Map<number, StreamingToolCallState>;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveAgentProviderStreamLimits(
  limits: AgentProviderStreamLimits = {},
): ResolvedAgentProviderStreamLimits {
  return {
    maxAssistantContentCharacters: positiveInteger(
      limits.maxAssistantContentCharacters,
      DEFAULT_AGENT_PROVIDER_STREAM_LIMITS.maxAssistantContentCharacters,
    ),
    maxEventBufferCharacters: positiveInteger(
      limits.maxEventBufferCharacters,
      DEFAULT_AGENT_PROVIDER_STREAM_LIMITS.maxEventBufferCharacters,
    ),
    maxToolArgumentCharacters: positiveInteger(
      limits.maxToolArgumentCharacters,
      DEFAULT_AGENT_PROVIDER_STREAM_LIMITS.maxToolArgumentCharacters,
    ),
    maxToolArgumentTotalCharacters: positiveInteger(
      limits.maxToolArgumentTotalCharacters,
      DEFAULT_AGENT_PROVIDER_STREAM_LIMITS.maxToolArgumentTotalCharacters,
    ),
    maxToolCalls: positiveInteger(
      limits.maxToolCalls,
      DEFAULT_AGENT_PROVIDER_STREAM_LIMITS.maxToolCalls,
    ),
  };
}

function toProviderToolName(name: string): string {
  const canonicalName = String(name || '').trim();
  const providerName = canonicalName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, PROVIDER_TOOL_NAME_MAX_LENGTH);
  if (!providerName || !PROVIDER_TOOL_NAME_PATTERN.test(providerName)) {
    throw new Error(`Agent Tool 名称无法转换为 Provider 支持的格式：${canonicalName || '(empty)'}`);
  }
  return providerName;
}

function createProviderToolNameMap(tools: AgentProviderToolDefinition[]): AgentProviderToolNameMap {
  const canonicalToProvider = new Map<string, string>();
  const providerToCanonical = new Map<string, string>();
  tools.forEach((tool) => {
    const canonicalName = String(tool.name || '').trim();
    const providerName = toProviderToolName(canonicalName);
    const collision = providerToCanonical.get(providerName);
    if (collision && collision !== canonicalName) {
      throw new Error(
        `Agent Tool 名称在 Provider 协议中发生冲突：${collision}、${canonicalName} -> ${providerName}`,
      );
    }
    canonicalToProvider.set(canonicalName, providerName);
    providerToCanonical.set(providerName, canonicalName);
  });
  return { canonicalToProvider, providerToCanonical };
}

function requireProviderToolName(name: string, names: AgentProviderToolNameMap): string {
  const canonicalName = String(name || '').trim();
  const providerName = names.canonicalToProvider.get(canonicalName);
  if (!providerName) {
    throw new Error(`Agent Provider 请求引用了未注册 Tool：${canonicalName || '(empty)'}`);
  }
  return providerName;
}

function providerToolHistoryName(name: string, names: AgentProviderToolNameMap): string {
  const canonicalName = String(name || '').trim();
  return names.canonicalToProvider.get(canonicalName) || toProviderToolName(canonicalName);
}

function openAITool(tool: AgentProviderToolDefinition, names: AgentProviderToolNameMap) {
  return {
    function: {
      description: tool.description,
      name: requireProviderToolName(tool.name, names),
      parameters: tool.inputSchema,
    },
    type: 'function',
  };
}

function claudeTool(tool: AgentProviderToolDefinition, names: AgentProviderToolNameMap) {
  return {
    description: tool.description,
    input_schema: tool.inputSchema,
    name: requireProviderToolName(tool.name, names),
  };
}

function buildOpenAIMessages(input: AgentProviderTurnInput, names: AgentProviderToolNameMap) {
  return [
    { content: input.systemPrompt, role: 'system' },
    ...input.messages.map((message) => {
      if (message.role === 'tool') {
        return {
          content: message.content,
          role: 'tool',
          tool_call_id: message.toolCallId,
        };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          content: message.content || null,
          role: 'assistant',
          tool_calls: message.toolCalls.map(call => ({
            function: {
              arguments: JSON.stringify(call.input ?? {}),
              name: providerToolHistoryName(call.name, names),
            },
            id: call.id,
            type: 'function',
          })),
        };
      }
      return { content: message.content, role: message.role };
    }),
  ];
}

function buildClaudeMessages(input: AgentProviderTurnInput, names: AgentProviderToolNameMap) {
  const messages: Array<{ content: unknown; role: 'assistant' | 'user' }> = [];
  const append = (role: 'assistant' | 'user', content: unknown) => {
    const previous = messages.at(-1);
    if (role === 'user' && previous?.role === 'user' && Array.isArray(previous.content) && Array.isArray(content)) {
      previous.content.push(...content);
      return;
    }
    messages.push({ content, role });
  };

  input.messages.forEach((message) => {
    if (message.role === 'tool') {
      append('user', [{
        content: message.content,
        tool_use_id: message.toolCallId,
        type: 'tool_result',
      }]);
      return;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      append('assistant', [
        ...(message.content ? [{ text: message.content, type: 'text' }] : []),
        ...message.toolCalls.map(call => ({
          id: call.id,
          input: call.input ?? {},
          name: providerToolHistoryName(call.name, names),
          type: 'tool_use',
        })),
      ]);
      return;
    }
    append(message.role, message.content);
  });
  return messages;
}

export function buildAgentProviderRequestBody(
  connection: AIServiceRuntimeConnection,
  input: AgentProviderTurnInput,
): Record<string, unknown> {
  const toolNames = createProviderToolNameMap(input.tools);
  const maxOutputTokens = resolveAIServiceOutputTokenLimit(input.maxOutputTokens);
  if (maxOutputTokens === undefined) {
    throw new Error('Agent Provider 请求缺少输出 token 上限');
  }
  const outputTokenFields = buildAIServiceOutputTokenFields(
    connection.providerType,
    maxOutputTokens,
  );
  const reasoningEffort = input.reasoningEffort && input.reasoningEffort !== 'auto'
    ? input.reasoningEffort
    : null;
  if (connection.providerType === 'claude') {
    return {
      ...outputTokenFields,
      messages: buildClaudeMessages(input, toolNames),
      model: input.model,
      ...(reasoningEffort ? { output_config: { effort: reasoningEffort } } : {}),
      stream: true,
      system: input.systemPrompt,
      tools: input.tools.map(tool => claudeTool(tool, toolNames)),
    };
  }
  return {
    ...outputTokenFields,
    messages: buildOpenAIMessages(input, toolNames),
    model: input.model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream: true,
    tools: input.tools.map(tool => openAITool(tool, toolNames)),
  };
}

export function createAgentProviderStreamState(
  limits: AgentProviderStreamLimits = {},
): AgentProviderStreamState {
  return {
    content: '',
    limits: resolveAgentProviderStreamLimits(limits),
    toolArgumentCharacters: 0,
    toolCalls: new Map(),
  };
}

function toolCallAt(state: AgentProviderStreamState, index: number): StreamingToolCallState {
  const existing = state.toolCalls.get(index);
  if (existing) return existing;
  if (state.toolCalls.size >= state.limits.maxToolCalls) {
    throw new Error(`Agent Tool 调用数量超过安全上限（最多 ${state.limits.maxToolCalls} 个）`);
  }
  const current = {
    arguments: '',
    id: '',
    name: '',
  };
  state.toolCalls.set(index, current);
  return current;
}

function toolCallIndex(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedToolCallIdentity(value: unknown, maximum: number, label: string): string {
  return appendBoundedAIServiceStreamText('', String(value || ''), maximum, label);
}

function appendToolArguments(
  state: AgentProviderStreamState,
  call: StreamingToolCallState,
  fragment: string,
): void {
  const nextArguments = appendBoundedAIServiceStreamText(
    call.arguments,
    fragment,
    state.limits.maxToolArgumentCharacters,
    'Agent Tool 参数',
  );
  if (fragment.length > state.limits.maxToolArgumentTotalCharacters - state.toolArgumentCharacters) {
    throw new AIServiceStreamLimitError(
      'Agent Tool 参数总量',
      state.limits.maxToolArgumentTotalCharacters,
    );
  }
  call.arguments = nextArguments;
  state.toolArgumentCharacters += fragment.length;
}

function setInitialToolInput(
  state: AgentProviderStreamState,
  call: StreamingToolCallState,
  input: unknown,
): void {
  if (input === undefined) return;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new Error('模型返回的 Tool 参数无法序列化');
  }
  if (serialized === undefined) throw new Error('模型返回的 Tool 参数格式无效');
  if (serialized.length > state.limits.maxToolArgumentCharacters) {
    throw new AIServiceStreamLimitError(
      'Agent Tool 参数',
      state.limits.maxToolArgumentCharacters,
    );
  }
  if (serialized.length > state.limits.maxToolArgumentTotalCharacters - state.toolArgumentCharacters) {
    throw new AIServiceStreamLimitError(
      'Agent Tool 参数总量',
      state.limits.maxToolArgumentTotalCharacters,
    );
  }
  state.toolArgumentCharacters += serialized.length;
  call.input = input;
}

export function consumeAgentProviderStreamEvent(
  providerType: AIServiceRuntimeConnection['providerType'],
  event: unknown,
  state: AgentProviderStreamState,
): string {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return '';
  const payload = event as Record<string, any>;
  if (providerType === 'claude') {
    const index = toolCallIndex(payload.index, state.toolCalls.size);
    if (payload.type === 'content_block_start' && payload.content_block?.type === 'tool_use') {
      const call = toolCallAt(state, index);
      call.id = boundedToolCallIdentity(
        payload.content_block.id || call.id,
        PROVIDER_TOOL_CALL_ID_MAX_LENGTH,
        'Agent Tool 调用 ID',
      );
      call.name = boundedToolCallIdentity(
        payload.content_block.name || call.name,
        PROVIDER_TOOL_NAME_MAX_LENGTH,
        'Agent Tool 名称',
      );
      setInitialToolInput(state, call, payload.content_block.input);
      return '';
    }
    if (payload.type !== 'content_block_delta') return '';
    if (payload.delta?.type === 'input_json_delta') {
      const call = toolCallAt(state, index);
      appendToolArguments(state, call, String(payload.delta.partial_json || ''));
      return '';
    }
    if (payload.delta?.type !== 'text_delta') return '';
    const delta = String(payload.delta.text || '');
    state.content = appendBoundedAIServiceStreamText(
      state.content,
      delta,
      state.limits.maxAssistantContentCharacters,
      'Agent 回答',
    );
    return delta;
  }

  const delta = payload.choices?.[0]?.delta;
  if (!delta || typeof delta !== 'object') return '';
  const content = typeof delta.content === 'string' ? delta.content : '';
  state.content = appendBoundedAIServiceStreamText(
    state.content,
    content,
    state.limits.maxAssistantContentCharacters,
    'Agent 回答',
  );
  if (Array.isArray(delta.tool_calls)) {
    delta.tool_calls.forEach((chunk: Record<string, any>, fallbackIndex: number) => {
      const index = toolCallIndex(chunk.index, fallbackIndex);
      const call = toolCallAt(state, index);
      if (chunk.id) {
        call.id = boundedToolCallIdentity(
          chunk.id,
          PROVIDER_TOOL_CALL_ID_MAX_LENGTH,
          'Agent Tool 调用 ID',
        );
      }
      call.name = appendBoundedAIServiceStreamText(
        call.name,
        String(chunk.function?.name || ''),
        PROVIDER_TOOL_NAME_MAX_LENGTH,
        'Agent Tool 名称',
      );
      appendToolArguments(state, call, String(chunk.function?.arguments || ''));
    });
  }
  return content;
}

export function finalizeAgentProviderToolCalls(
  state: AgentProviderStreamState,
  tools: AgentProviderToolDefinition[],
): AgentProviderToolCall[] {
  const toolNames = createProviderToolNameMap(tools);
  return Array.from(state.toolCalls.entries())
    .sort(([left], [right]) => left - right)
    .map(([, call], index) => {
      const id = call.id || `tool-call-${index + 1}`;
      const providerName = call.name.trim();
      const name = toolNames.providerToCanonical.get(providerName) || providerName;
      if (!call.arguments.trim()) {
        return { id, input: call.input ?? {}, name };
      }
      try {
        return { id, input: JSON.parse(call.arguments), name };
      } catch {
        return {
          id,
          input: {},
          inputError: '模型返回的工具参数不是有效 JSON',
          name,
        };
      }
    })
    .filter(call => call.name);
}
