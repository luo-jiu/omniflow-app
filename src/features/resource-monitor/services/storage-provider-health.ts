import type {
  ResourceMonitorProbeStatus,
  ResourceMonitorProbeTarget,
  ResourceMonitorSnapshot,
} from './resource-monitor.api';
import { resourceMonitorProbeRuntime } from './resource-monitor-runtime';

export const STORAGE_PROVIDER_WRITE_PROBE_MAX_AGE_MS = 60 * 1000;

type ProbeRuntime = Pick<typeof resourceMonitorProbeRuntime, 'getState' | 'refresh' | 'start'>;

export interface StorageProviderAvailability {
  available: boolean;
  message: string;
  status: ResourceMonitorProbeStatus;
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

export function findStorageProviderProbe(
  snapshot: ResourceMonitorSnapshot | null,
  providerAlias: string,
): ResourceMonitorProbeTarget | null {
  const alias = normalizeAlias(providerAlias);
  if (!snapshot || !alias) {
    return null;
  }
  return snapshot.probes.find(probe => (
    probe.kind === 'object_storage' && normalizeAlias(probe.provider || '') === alias
  )) || null;
}

export function getStorageProviderProbeStatus(
  snapshot: ResourceMonitorSnapshot | null,
  providerAlias: string,
): ResourceMonitorProbeStatus {
  return findStorageProviderProbe(snapshot, providerAlias)?.status || 'unknown';
}

export function selectPreferredStorageProvider(
  providers: Array<{ alias: string }>,
  defaultProvider: string,
  snapshot: ResourceMonitorSnapshot | null,
): string {
  const availableProviders = providers.filter(provider => provider.alias.trim());
  if (availableProviders.length === 0) {
    return '';
  }

  const normalizedDefault = normalizeAlias(defaultProvider);
  const defaultItem = availableProviders.find(
    provider => normalizeAlias(provider.alias) === normalizedDefault,
  );
  const healthyProviders = availableProviders.filter(
    provider => getStorageProviderProbeStatus(snapshot, provider.alias) === 'ok',
  );
  const healthyDefault = healthyProviders.find(
    provider => normalizeAlias(provider.alias) === normalizedDefault,
  );
  if (healthyDefault) {
    return healthyDefault.alias;
  }
  if (healthyProviders.length > 0) {
    return healthyProviders[0].alias;
  }
  if (defaultItem) {
    return defaultItem.alias;
  }

  const unknownProvider = availableProviders.find(
    provider => getStorageProviderProbeStatus(snapshot, provider.alias) === 'unknown',
  );
  return unknownProvider?.alias || availableProviders[0].alias;
}

export function isStorageProviderProbeFresh(
  probe: ResourceMonitorProbeTarget | null,
  now = Date.now(),
  maxAgeMs = STORAGE_PROVIDER_WRITE_PROBE_MAX_AGE_MS,
): boolean {
  if (!probe?.checkedAt) {
    return false;
  }
  const checkedAt = Date.parse(probe.checkedAt);
  return Number.isFinite(checkedAt) && Math.abs(now - checkedAt) <= maxAgeMs;
}

export async function ensureStorageProviderAvailable(
  providerAlias: string,
  options: {
    maxAgeMs?: number;
    now?: () => number;
    runtime?: ProbeRuntime;
  } = {},
): Promise<StorageProviderAvailability> {
  const alias = providerAlias.trim();
  if (!alias) {
    return { available: false, message: '请选择存储桶', status: 'unknown' };
  }

  const runtime = options.runtime || resourceMonitorProbeRuntime;
  const getNow = options.now || Date.now;
  const maxAgeMs = options.maxAgeMs ?? STORAGE_PROVIDER_WRITE_PROBE_MAX_AGE_MS;
  runtime.start();

  let probe = findStorageProviderProbe(runtime.getState().snapshot, alias);
  if (!isStorageProviderProbeFresh(probe, getNow(), maxAgeMs)) {
    try {
      await runtime.refresh();
    } catch {
      return {
        available: false,
        message: `无法确认存储桶「${alias}」是否可用，请稍后重试`,
        status: 'unknown',
      };
    }
    probe = findStorageProviderProbe(runtime.getState().snapshot, alias);
    if (!isStorageProviderProbeFresh(probe, getNow(), maxAgeMs)) {
      return {
        available: false,
        message: `无法确认存储桶「${alias}」是否可用，请稍后重试`,
        status: 'unknown',
      };
    }
  }

  if (probe?.status === 'ok') {
    return { available: true, message: '', status: 'ok' };
  }
  if (probe?.status === 'error') {
    return {
      available: false,
      message: `存储桶「${alias}」连接失败，请选择可用的存储桶`,
      status: 'error',
    };
  }
  return {
    available: false,
    message: `尚未确认存储桶「${alias}」可用，请稍后重试`,
    status: 'unknown',
  };
}
