import { createHash } from 'node:crypto';
import { net } from 'electron';
import { buildAIServiceModelsRequest, type AIServiceRuntimeConnection } from '../aiServiceClientModel';
import { AI_SERVICE_HTTP_BODY_LIMITS, readBoundedAIServiceResponseText } from '../aiServiceStreamLimits';
import { parseAgentModelMetadata, type AgentModelMetadata } from './agent-model-context';

export function createAgentModelCatalog() {
  const cache = new Map<string, { expiresAt: number; models: Map<string, AgentModelMetadata> }>();
  const pending = new Map<string, Promise<Map<string, AgentModelMetadata>>>();
  async function read(connection: AIServiceRuntimeConnection): Promise<Map<string, AgentModelMetadata>> {
    // Credentials partition in-memory entries without being retained as cache keys.
    const key = createHash('sha256').update(JSON.stringify([
      connection.providerType, connection.baseUrl, connection.apiKey,
    ])).digest('hex');
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = (async () => {
      let models = cached?.models ?? new Map<string, AgentModelMetadata>();
      let ttl = 30_000;
      try {
        const spec = buildAIServiceModelsRequest(connection);
        const response = await net.fetch(spec.url, {
          headers: spec.headers, method: spec.method, signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Model catalog unavailable');
        }
        const text = await readBoundedAIServiceResponseText(
          response, AI_SERVICE_HTTP_BODY_LIMITS.jsonBytes, '模型目录',
        );
        models = parseAgentModelMetadata(JSON.parse(text));
        ttl = 5 * 60_000;
      } catch { /* Discovery failure must not block an otherwise usable model. */ }
      if (cache.size >= 32) cache.delete(cache.keys().next().value as string);
      cache.set(key, { expiresAt: Date.now() + ttl, models });
      return models;
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
  }
  return { async get(connection: AIServiceRuntimeConnection, model: string) {
    return (await read(connection)).get(model.trim());
  } };
}

export const agentModelCatalog = createAgentModelCatalog();
