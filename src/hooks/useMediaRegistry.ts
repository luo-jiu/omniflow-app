import { useSyncExternalStore } from 'react';
import { mediaRegistry } from '@/contexts/media-registry.singleton';
import {
  type MediaEntry,
  type MediaRegistryAPI,
} from '@/contexts/media-registry.context';

// 直接返回模块级单例。Provider 不再参与 registry 生命周期。
// 详见 docs/media-hub-contract.md。
export function useMediaRegistry(): MediaRegistryAPI {
  return mediaRegistry;
}

export function useMediaEntries(): MediaEntry[] {
  return useSyncExternalStore(mediaRegistry.subscribe, mediaRegistry.getEntries, mediaRegistry.getEntries);
}

// 历史的 useRegisterMediaEntry 已删除。
// 任何"出声实体"必须改走服务层自注册（globalAudioPlayer / floatingVideoService）。
// 详见 docs/media-hub-contract.md §1.3 与 §5。
