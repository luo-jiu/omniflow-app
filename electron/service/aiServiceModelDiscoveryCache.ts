import { createHash } from 'node:crypto';
import type { AIServiceRuntimeConnection } from './aiServiceClientModel';
import { AI_SERVICE_EXPLICIT_REASONING_EFFORTS, type AIServiceExplicitReasoningEffort } from '../../src/shared/ai-model-catalog';

export interface AIServiceModelMetadata {
  serviceTiers?: readonly string[];
  listedModelId?: string;
  supportsImages?: boolean;
  supportsToolCalling?: boolean;
  supportsParallelToolCalls?: boolean;
  supportsShellTool?: boolean;
  reasoningEfforts?: readonly AIServiceExplicitReasoningEffort[];
  contextWindowTokens?: number;
  maxContextWindowTokens?: number;
  outputReserveTokens?: number;
}

function positiveLimit(value: unknown, maximum = 10_000_000): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function parseAIServiceModelMetadata(body: unknown): Map<string, AIServiceModelMetadata> {
  const root = record(body);
  const items = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : [];
  const result = new Map<string, AIServiceModelMetadata>();
  for (const value of items.slice(0, 10_000)) {
    const item = record(value);
    const id = item.id ?? item.slug ?? item.name;
    if (typeof id !== 'string' || !id.trim() || id.length > 200) continue;
    const contextWindowTokens = positiveLimit(item.context_window ?? item.context_length);
    const maxContextWindowTokens = positiveLimit(item.max_context_window);
    const outputReserveTokens = positiveLimit(
      item.max_output_tokens ?? record(item.top_provider).max_completion_tokens, 1_000_000,
    );
    const capabilities: AIServiceModelMetadata = {};
    if (Array.isArray(item.service_tiers) && item.service_tiers.length <= 16) {
      const tiers = item.service_tiers.map(tier => typeof tier === 'string' ? tier : record(tier).id);
      if (tiers.every(tier => typeof tier === 'string' && ['auto', 'default', 'flex', 'scale', 'priority', 'fast', 'ultrafast'].includes(tier))) {
        capabilities.serviceTiers = Object.freeze([...new Set(tiers as string[])]);
      }
    }
    if (typeof item.supports_image_input === 'boolean') capabilities.supportsImages = item.supports_image_input;
    if (typeof item.supports_tool_calling === 'boolean') capabilities.supportsToolCalling = item.supports_tool_calling;
    if (typeof item.supports_parallel_tool_calls === 'boolean') capabilities.supportsParallelToolCalls = item.supports_parallel_tool_calls;
    if (item.shell_type === 'disabled') capabilities.supportsShellTool = false;
    if (Array.isArray(item.supported_reasoning_levels) && item.supported_reasoning_levels.length <= 16) {
      const levels = item.supported_reasoning_levels.map(level => typeof level === 'string' ? level : record(level).effort);
      if (levels.every(level => typeof level === 'string' && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(level))) {
        capabilities.reasoningEfforts = Object.freeze(AI_SERVICE_EXPLICIT_REASONING_EFFORTS.filter(level => levels.includes(level)));
      }
    }
    result.set(id.trim(), Object.freeze({ listedModelId: id.trim(),
      ...(contextWindowTokens ? { contextWindowTokens } : {}),
      ...(maxContextWindowTokens ? { maxContextWindowTokens } : {}),
      ...(outputReserveTokens ? { outputReserveTokens } : {}),
      ...capabilities,
    }));
  }
  return result;
}

export interface AIServiceModelDiscoveryTicket {
  readonly connectionKey: string;
  readonly requestSequence: number;
}

export interface AIServiceModelDiscoverySnapshot {
  readonly models: ReadonlyMap<string, AIServiceModelMetadata>;
  readonly expiresAt: number;
  readonly requestSequence: number;
}

export function createAIServiceModelDiscoveryCache() {
  const successes = new Map<string, AIServiceModelDiscoverySnapshot>();
  let requestSequence = 0;
  let evictedSuccessSequence = 0;
  const connectionKey = (connection: AIServiceRuntimeConnection) => createHash('sha256').update(JSON.stringify([
    connection.providerType, connection.baseUrl, connection.apiKey,
  ])).digest('hex');
  return {
    begin(connection: AIServiceRuntimeConnection): AIServiceModelDiscoveryTicket {
      return { connectionKey: connectionKey(connection), requestSequence: ++requestSequence };
    },
    read(connection: AIServiceRuntimeConnection): AIServiceModelDiscoverySnapshot | undefined {
      return successes.get(connectionKey(connection));
    },
    publish(ticket: AIServiceModelDiscoveryTicket, body: unknown): AIServiceModelDiscoverySnapshot | undefined {
      const previous = successes.get(ticket.connectionKey);
      const root = record(body);
      if (!Array.isArray(root.data) && !Array.isArray(root.models)) return undefined;
      // Evicted entries cannot retain per-connection watermarks forever. A global
      // floor conservatively rejects older in-flight discoveries, including ones
      // for other connections, so an evicted newer success cannot be resurrected.
      if (ticket.requestSequence <= evictedSuccessSequence) return previous;
      if (previous && previous.requestSequence > ticket.requestSequence) return previous;
      const snapshot = Object.freeze({ models: parseAIServiceModelMetadata(body),
        expiresAt: Date.now() + 5 * 60_000, requestSequence: ticket.requestSequence });
      if (successes.size >= 32 && !successes.has(ticket.connectionKey)) {
        const oldestKey = successes.keys().next().value as string;
        evictedSuccessSequence = Math.max(evictedSuccessSequence, successes.get(oldestKey)!.requestSequence);
        successes.delete(oldestKey);
      }
      successes.set(ticket.connectionKey, snapshot);
      return snapshot;
    },
  };
}

export type AIServiceModelDiscoveryCache = ReturnType<typeof createAIServiceModelDiscoveryCache>;
export const aiServiceModelDiscoveryCache = createAIServiceModelDiscoveryCache();
