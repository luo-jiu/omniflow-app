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
  type AgentProviderStreamLimits,
  type AgentProviderTurnInput,
} from './agent-provider-model';

export interface AgentProviderTurnResult {
  content: string;
  toolCalls: ReturnType<typeof finalizeAgentProviderToolCalls>;
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

export async function streamAgentProviderTurn(
  profile: AIServiceRuntimeConnection,
  input: AgentProviderTurnInput,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
  limits?: AgentProviderStreamLimits,
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
    throw new Error(extractAIServiceErrorMessage(body, 'Agent 请求失败'));
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
      if (!raw || raw === '[DONE]') return;
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      if (event && typeof event === 'object' && !Array.isArray(event)) {
        const payload = event as Record<string, unknown>;
        if (payload.type === 'error' || payload.error) {
          throw new Error(extractAIServiceErrorMessage(payload, 'Agent 流式请求失败'));
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
  if (!state.content.trim() && toolCalls.length === 0) {
    throw new Error('模型未返回可用内容或工具调用');
  }
  return { content: state.content, toolCalls };
}
