import { net } from 'electron';
import { buildAIServiceModelsRequest, type AIServiceRuntimeConnection } from '../aiServiceClientModel';
import { AI_SERVICE_HTTP_BODY_LIMITS, readBoundedAIServiceResponseText } from '../aiServiceStreamLimits';
import {
  aiServiceModelDiscoveryCache, createAIServiceModelDiscoveryCache,
  type AIServiceModelDiscoveryCache, type AIServiceModelMetadata,
} from '../aiServiceModelDiscoveryCache';

export function createAgentModelCatalog(discoveryCache: AIServiceModelDiscoveryCache = createAIServiceModelDiscoveryCache()) {
  const retryAt = new Map<string, number>();
  const pending = new Map<string, Promise<ReadonlyMap<string, AIServiceModelMetadata>>>();
  async function read(connection: AIServiceRuntimeConnection): Promise<ReadonlyMap<string, AIServiceModelMetadata>> {
    const cached = discoveryCache.read(connection);
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    const ticket = discoveryCache.begin(connection);
    const key = ticket.connectionKey;
    if ((retryAt.get(key) ?? 0) > Date.now()) return cached?.models ?? new Map();
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = (async () => {
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
        if (!discoveryCache.publish(ticket, JSON.parse(text))) throw new Error('Invalid model catalog');
        retryAt.delete(key);
      } catch {
        // A failed discovery must not erase a successful UI refresh that completed in parallel.
        if (retryAt.size >= 32 && !retryAt.has(key)) retryAt.delete(retryAt.keys().next().value as string);
        retryAt.set(key, Date.now() + 30_000);
      }
      return discoveryCache.read(connection)?.models ?? new Map<string, AIServiceModelMetadata>();
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
  }
  return { async get(connection: AIServiceRuntimeConnection, model: string) {
    return (await read(connection)).get(model.trim());
  } };
}

export const agentModelCatalog = createAgentModelCatalog(aiServiceModelDiscoveryCache);
