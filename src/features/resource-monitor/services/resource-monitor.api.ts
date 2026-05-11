import { ipcRequest as request } from '@/service/request/ipcRequest';

export interface ResourceMonitorSummary {
  providerCount: number;
  bucketCount: number;
  objectCount: number;
  fileRefCount: number;
  physicalBytes: number;
  unmatchedCount: number;
}

export interface ResourceMonitorProbeSummary {
  total: number;
  ok: number;
  error: number;
  unknown: number;
}

export type ResourceMonitorProbeStatus = 'ok' | 'error' | 'unknown';

export interface ResourceMonitorProbeTarget {
  key: string;
  kind: string;
  label: string;
  provider?: string;
  providerType?: string;
  endpoint?: string;
  bucket?: string;
  isDefault?: boolean;
  status: ResourceMonitorProbeStatus;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export interface ResourceMonitorStorageItem {
  provider: string;
  providerType?: string;
  providerLabel?: string;
  endpoint?: string;
  bucket: string;
  isDefault: boolean;
  objectCount: number;
  fileRefCount: number;
  physicalBytes: number;
  percent: number;
  matchedConfig: boolean;
}

export interface ResourceMonitorSnapshot {
  generatedAt: string;
  summary: ResourceMonitorSummary;
  storage: ResourceMonitorStorageItem[];
  distributionError?: string;
  probeSummary: ResourceMonitorProbeSummary;
  probes: ResourceMonitorProbeTarget[];
}

const emptySnapshot: ResourceMonitorSnapshot = {
  generatedAt: '',
  summary: {
    providerCount: 0,
    bucketCount: 0,
    objectCount: 0,
    fileRefCount: 0,
    physicalBytes: 0,
    unmatchedCount: 0,
  },
  storage: [],
  distributionError: '',
  probeSummary: {
    total: 0,
    ok: 0,
    error: 0,
    unknown: 0,
  },
  probes: [],
};

export async function fetchResourceMonitorSnapshot(): Promise<ResourceMonitorSnapshot> {
  const body = await request('/v1/resource-monitor/snapshot', { method: 'GET' });
  return (body?.data || emptySnapshot) as ResourceMonitorSnapshot;
}
