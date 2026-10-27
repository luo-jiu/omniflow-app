import { normalizeAIServiceFastMode, resolveAIServiceFastTier, type AIServiceRequestTier } from '../../src/shared/ai-fast-mode';
import type { AIServiceRuntimeConnection } from './aiServiceClientModel';
import { aiServiceModelDiscoveryCache } from './aiServiceModelDiscoveryCache';

/** Fresh exact discovery overrides bundled tiers; unknown models require discovery. */
export function getAIServiceFastTier(connection: AIServiceRuntimeConnection, model: string) {
  const snapshot = aiServiceModelDiscoveryCache.read(connection);
  const metadata = snapshot && snapshot.expiresAt > Date.now() ? snapshot.models.get(model.trim()) : undefined;
  return resolveAIServiceFastTier(connection, model, metadata);
}

export function resolveAIServiceRequestTier(
  connection: AIServiceRuntimeConnection, model: string, requested: unknown,
): AIServiceRequestTier | undefined {
  const fastMode = normalizeAIServiceFastMode(requested);
  if (fastMode === undefined) return undefined;
  const tier = getAIServiceFastTier(connection, model);
  if (fastMode && !tier) throw new Error('当前连接尚未确认支持 Fast 模式，请刷新模型列表或关闭 Fast 后重试');
  return tier ? fastMode ? tier : 'default' : undefined;
}

export function createFrozenAIServiceRequestTierResolver(connection: AIServiceRuntimeConnection) {
  const frozenConnection = { ...connection };
  const snapshot = aiServiceModelDiscoveryCache.read(connection);
  const models = new Map(snapshot && snapshot.expiresAt > Date.now() ? snapshot.models : []);
  return (model: string, requested: unknown): AIServiceRequestTier | undefined => {
    const fastMode = normalizeAIServiceFastMode(requested);
    if (fastMode === undefined) return undefined;
    const tier = resolveAIServiceFastTier(frozenConnection, model, models.get(model.trim()));
    if (fastMode && !tier) throw new Error('当前任务连接尚未确认支持 Fast 模式，请刷新模型列表后重新开始任务');
    return tier ? fastMode ? tier : 'default' : undefined;
  };
}
