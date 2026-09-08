import { net } from 'electron';

import {
  extractAIServiceErrorMessage,
  type AIServiceRuntimeConnection,
} from '../aiServiceClientModel';
import {
  AI_SERVICE_HTTP_BODY_LIMITS,
  appendBoundedAIServiceStreamText,
  readBoundedAIServiceResponseText,
} from '../aiServiceStreamLimits';
import {
  buildAgentProviderRequestBody,
  consumeAgentProviderStreamEvent,
  createAgentProviderStreamState,
  finalizeAgentProviderToolCalls,
  type AgentProviderTokenUsage,
  type AgentProviderStreamLimits,
  type AgentProviderTurnInput,
} from './agent-provider-model';

export interface AgentProviderTurnResult {
  content: string;
  toolCalls: ReturnType<typeof finalizeAgentProviderToolCalls>;
  usage?: AgentProviderTokenUsage;
}

export type AgentProviderErrorKind = 'context_window_exceeded' | 'provider_error';

interface AgentProviderErrorOptions {
  code?: string;
  kind: AgentProviderErrorKind;
  status?: number;
  type?: string;
}

export class AgentProviderError extends Error {
  readonly code?: string;
  readonly kind: AgentProviderErrorKind;
  readonly status?: number;
  readonly type?: string;

  constructor(message: string, options: AgentProviderErrorOptions) {
    super(message);
    this.name = 'AgentProviderError';
    this.kind = options.kind;
    if (options.code !== undefined) this.code = options.code;
    if (options.status !== undefined) this.status = options.status;
    if (options.type !== undefined) this.type = options.type;
  }
}

export function isAgentProviderContextWindowExceeded(
  error: unknown,
): error is AgentProviderError {
  return error instanceof AgentProviderError && error.kind === 'context_window_exceeded';
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalProviderErrorField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isExplicitClaudeContextWindowMessage(message: string): boolean {
  return /\bprompt\s+is\s+too\s+long\b/iu.test(message)
    || /\b(?:input|prompt)\b.*\bexceeds?\b.*\bcontext\s+(?:window|length)\b/iu.test(message)
    || /\bcontext\s+(?:window|length)\b.*\b(?:exceeds?|exceeded|limit|maximum|too\s+(?:large|long))\b/iu.test(message)
    || /\bmaximum\s+context\s+(?:window|length)\b/iu.test(message);
}

function createAgentProviderError(input: {
  body: unknown;
  fallbackMessage: string;
  providerType: AIServiceRuntimeConnection['providerType'];
  status?: number;
}): AgentProviderError {
  const payload = objectRecord(input.body);
  const nestedError = objectRecord(payload?.error);
  const code = optionalProviderErrorField(nestedError?.code)
    || optionalProviderErrorField(payload?.code);
  const type = optionalProviderErrorField(nestedError?.type)
    || optionalProviderErrorField(payload?.type);
  const message = extractAIServiceErrorMessage(input.body, input.fallbackMessage);
  const contextWindowExceeded = input.providerType === 'claude'
    ? type === 'invalid_request_error' && isExplicitClaudeContextWindowMessage(message)
    : code === 'context_length_exceeded';
  return new AgentProviderError(message, {
    ...(code ? { code } : {}),
    kind: contextWindowExceeded ? 'context_window_exceeded' : 'provider_error',
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(type ? { type } : {}),
  });
}

function buildHeaders(providerType: string, apiKey: string): Record<string, string> {
  if (providerType === 'claude') {
    return {
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    };
  }
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function appendPath(baseUrl: string, path: string): string {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function streamAgentProviderTurnOnce(
  profile: AIServiceRuntimeConnection,
  input: AgentProviderTurnInput,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
  limits?: AgentProviderStreamLimits,
  onActivity: () => void = () => undefined,
): Promise<AgentProviderTurnResult> {
  const url = appendPath(
    profile.baseUrl,
    profile.providerType === 'claude' ? 'messages' : 'chat/completions',
  );
  const response = await net.fetch(url, {
    body: JSON.stringify(buildAgentProviderRequestBody(profile, input)),
    headers: buildHeaders(profile.providerType, profile.apiKey),
    method: 'POST',
    signal,
  });
  onActivity();
  if (!response.ok) {
    const text = await readBoundedAIServiceResponseText(
      response,
      AI_SERVICE_HTTP_BODY_LIMITS.errorBytes,
      'Agent Provider 错误响应',
    );
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : text;
    } catch {
      // Keep the provider's plain-text error.
    }
    throw createAgentProviderError({
      body,
      fallbackMessage: 'Agent 请求失败',
      providerType: profile.providerType,
      status: response.status,
    });
  }
  if (!response.body) throw new Error('AI 服务未返回流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = createAgentProviderStreamState(limits);
  let buffer = '';
  const consume = (flush = false) => {
    const lines = buffer.split(/\r?\n/);
    if (flush) buffer = '';
    else buffer = lines.pop() || '';
    lines.forEach((line) => {
      if (!line.startsWith('data:')) return;
      const raw = line.slice(5).trim();
      if (!raw) return;
      if (raw === '[DONE]') {
        state.streamCompleted = true;
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      if (event && typeof event === 'object' && !Array.isArray(event)) {
        const payload = event as Record<string, unknown>;
        if (payload.type === 'error' || payload.error) {
          throw createAgentProviderError({
            body: payload,
            fallbackMessage: 'Agent 流式请求失败',
            providerType: profile.providerType,
            status: response.status,
          });
        }
      }
      const delta = consumeAgentProviderStreamEvent(profile.providerType, event, state);
      if (delta) onDelta(delta);
    });
  };

  try {
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      onActivity();
      done = chunk.done;
      if (chunk.value) {
        const fragment = decoder.decode(chunk.value, { stream: !done });
        buffer = appendBoundedAIServiceStreamText(
          buffer,
          fragment,
          state.limits.maxEventBufferCharacters,
          'Agent Provider 流式事件',
        );
        if (fragment.includes('\n')) consume();
        if (state.streamCompleted) {
          done = true;
          await reader.cancel();
        }
      }
    }
    buffer = appendBoundedAIServiceStreamText(
      buffer,
      decoder.decode(),
      state.limits.maxEventBufferCharacters,
      'Agent Provider 流式事件',
    );
    consume(true);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const toolCalls = finalizeAgentProviderToolCalls(state, input.tools);
  const reason = state.finishReason;
  if (reason === 'length' || reason === 'max_tokens') {
    throw new AgentProviderError('模型输出达到 token 上限，回答或工具参数未完成；可调整输出预算后继续', {
      code: 'output_limit', kind: 'provider_error',
    });
  }
  const expectedReasons = profile.providerType === 'claude'
    ? ['end_turn', 'tool_use', 'stop_sequence'] : ['stop', 'tool_calls'];
  if (!reason || (profile.providerType === 'claude' && !state.streamCompleted)) {
    throw new AgentProviderError('模型响应在完成前中断，当前内容不代表任务已完成', {
      code: 'stream_incomplete', kind: 'provider_error',
    });
  }
  if (!expectedReasons.includes(reason)
    || (input.tools.length === 0 && toolCalls.length > 0)
    || ((reason === 'tool_calls' || reason === 'tool_use') !== (toolCalls.length > 0))) {
    throw new AgentProviderError(`模型未正常完成响应（${reason}），已停止执行后续工具`, {
      code: 'invalid_completion', kind: 'provider_error',
    });
  }
  if (!state.content.trim() && toolCalls.length === 0) {
    throw new Error('模型未返回可用内容或工具调用');
  }
  return {
    content: state.content,
    toolCalls,
    ...(state.usage ? { usage: { ...state.usage } } : {}),
  };
}

interface AgentProviderRequestPolicy {
  idleTimeoutMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
}

export async function streamAgentProviderTurn(
  profile: AIServiceRuntimeConnection,
  input: AgentProviderTurnInput,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
  limits?: AgentProviderStreamLimits,
  policy: AgentProviderRequestPolicy = {},
): Promise<AgentProviderTurnResult> {
  let emittedContent = false;
  const maxRetries = policy.maxRetries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const resetIdle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, policy.idleTimeoutMs ?? 120_000);
    };
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    resetIdle();
    let failure: unknown;
    try {
      return await streamAgentProviderTurnOnce(profile, input, delta => {
        emittedContent = true;
        onDelta(delta);
      }, controller.signal, limits, resetIdle);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      failure = timedOut ? new AgentProviderError('等待模型响应超时，当前任务未完成', {
        code: 'request_timeout', kind: 'provider_error',
      }) : error;
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener('abort', abort);
    }
    const retryable = failure instanceof TypeError
      || failure instanceof AgentProviderError && (
        ['stream_incomplete', 'request_timeout'].includes(failure.code || '')
        || [408, 429, 500, 502, 503, 504].includes(failure.status || 0)
      );
    // Never replay a partially displayed turn or any Tool execution.
    if (!retryable || emittedContent || attempt >= maxRetries) throw failure;
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(delay);
        signal.removeEventListener('abort', cancel);
        reject(signal.reason);
      };
      const delay = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, (policy.retryDelayMs ?? 500) * 2 ** attempt);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
}
