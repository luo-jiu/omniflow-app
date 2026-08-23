import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';
import type { AgentReasoningEffort } from '@/shared/agent/agent.types';
import type { AgentTool } from './agent-tool-registry';

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
  messages: AgentProviderMessage[];
  model: string;
  reasoningEffort?: AgentReasoningEffort;
  systemPrompt: string;
  tools: AgentTool[];
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

export interface AgentProviderStreamState {
  content: string;
  toolCalls: Map<number, StreamingToolCallState>;
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

function createProviderToolNameMap(tools: AgentTool[]): AgentProviderToolNameMap {
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

function openAITool(tool: AgentTool, names: AgentProviderToolNameMap) {
  return {
    function: {
      description: tool.description,
      name: requireProviderToolName(tool.name, names),
      parameters: tool.inputSchema,
    },
    type: 'function',
  };
}

function claudeTool(tool: AgentTool, names: AgentProviderToolNameMap) {
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
              name: requireProviderToolName(call.name, names),
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
          name: requireProviderToolName(call.name, names),
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
  const reasoningEffort = input.reasoningEffort && input.reasoningEffort !== 'auto'
    ? input.reasoningEffort
    : null;
  if (connection.providerType === 'claude') {
    return {
      max_tokens: 4096,
      messages: buildClaudeMessages(input, toolNames),
      model: input.model,
      ...(reasoningEffort ? { output_config: { effort: reasoningEffort } } : {}),
      stream: true,
      system: input.systemPrompt,
      tools: input.tools.map(tool => claudeTool(tool, toolNames)),
    };
  }
  return {
    messages: buildOpenAIMessages(input, toolNames),
    model: input.model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream: true,
    tools: input.tools.map(tool => openAITool(tool, toolNames)),
  };
}

export function createAgentProviderStreamState(): AgentProviderStreamState {
  return { content: '', toolCalls: new Map() };
}

function toolCallAt(state: AgentProviderStreamState, index: number): StreamingToolCallState {
  const current = state.toolCalls.get(index) || {
    arguments: '',
    id: '',
    name: '',
  };
  state.toolCalls.set(index, current);
  return current;
}

export function consumeAgentProviderStreamEvent(
  providerType: AIServiceRuntimeConnection['providerType'],
  event: unknown,
  state: AgentProviderStreamState,
): string {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return '';
  const payload = event as Record<string, any>;
  if (providerType === 'claude') {
    const index = Number(payload.index);
    if (payload.type === 'content_block_start' && payload.content_block?.type === 'tool_use') {
      const call = toolCallAt(state, Number.isFinite(index) ? index : state.toolCalls.size);
      call.id = String(payload.content_block.id || call.id);
      call.name = String(payload.content_block.name || call.name);
      call.input = payload.content_block.input;
      return '';
    }
    if (payload.type !== 'content_block_delta') return '';
    if (payload.delta?.type === 'input_json_delta') {
      const call = toolCallAt(state, Number.isFinite(index) ? index : state.toolCalls.size);
      call.arguments += String(payload.delta.partial_json || '');
      return '';
    }
    if (payload.delta?.type !== 'text_delta') return '';
    const delta = String(payload.delta.text || '');
    state.content += delta;
    return delta;
  }

  const delta = payload.choices?.[0]?.delta;
  if (!delta || typeof delta !== 'object') return '';
  const content = typeof delta.content === 'string' ? delta.content : '';
  state.content += content;
  if (Array.isArray(delta.tool_calls)) {
    delta.tool_calls.forEach((chunk: Record<string, any>, fallbackIndex: number) => {
      const index = Number.isFinite(Number(chunk.index)) ? Number(chunk.index) : fallbackIndex;
      const call = toolCallAt(state, index);
      if (chunk.id) call.id = String(chunk.id);
      call.name += String(chunk.function?.name || '');
      call.arguments += String(chunk.function?.arguments || '');
    });
  }
  return content;
}

export function finalizeAgentProviderToolCalls(
  state: AgentProviderStreamState,
  tools: AgentTool[],
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
