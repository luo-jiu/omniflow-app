import { ipcRequest as request } from '@/service/request/ipcRequest';

export interface ResourceMonitorSummary {
  providerCount: number;
  bucketCount: number;
  objectCount: number;
  fileRefCount: number;
  physicalBytes: number;
  visibleObjectCount: number;
  visibleFileRefCount: number;
  visibleBytes: number;
  recycleObjectCount: number;
  recycleFileRefCount: number;
  recycleBytes: number;
  orphanObjectCount: number;
  orphanBytes: number;
  unmatchedCount: number;
  legacyProviderCount: number;
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
  sourceProvider?: string;
  providerType?: string;
  providerLabel?: string;
  endpoint?: string;
  bucket: string;
  isDefault: boolean;
  isLegacyProvider: boolean;
  objectCount: number;
  fileRefCount: number;
  physicalBytes: number;
  visibleObjectCount: number;
  visibleFileRefCount: number;
  visibleBytes: number;
  recycleObjectCount: number;
  recycleFileRefCount: number;
  recycleBytes: number;
  orphanObjectCount: number;
  orphanBytes: number;
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

export interface ResourceMonitorSnapshotOptions {
  libraryId?: number;
  dryRun?: boolean;
}

export interface ResourceMonitorSample {
  id: number;
  dryRun: boolean;
  actorId: string;
  scope: 'global' | 'library' | string;
  libraryId: number;
  generatedAt: string;
  physicalBytes: number;
  objectCount: number;
  fileRefCount: number;
  recycleBytes: number;
  orphanBytes: number;
  probeTotal: number;
  probeOk: number;
  probeError: number;
  createdAt: string;
}

const emptySnapshot: ResourceMonitorSnapshot = {
  generatedAt: '',
  summary: {
    providerCount: 0,
    bucketCount: 0,
    objectCount: 0,
    fileRefCount: 0,
    physicalBytes: 0,
    visibleObjectCount: 0,
    visibleFileRefCount: 0,
    visibleBytes: 0,
    recycleObjectCount: 0,
    recycleFileRefCount: 0,
    recycleBytes: 0,
    orphanObjectCount: 0,
    orphanBytes: 0,
    unmatchedCount: 0,
    legacyProviderCount: 0,
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

export async function fetchResourceMonitorSnapshot(
  options: ResourceMonitorSnapshotOptions = {},
): Promise<ResourceMonitorSnapshot> {
  const query = options.libraryId && options.libraryId > 0
    ? `?libraryId=${encodeURIComponent(String(options.libraryId))}`
    : '';
  const body = await request(`/v1/resource-monitor/snapshot${query}`, { method: 'GET' });
  return (body?.data || emptySnapshot) as ResourceMonitorSnapshot;
}

export async function captureResourceMonitorSample(
  options: ResourceMonitorSnapshotOptions = {},
): Promise<ResourceMonitorSample> {
  const params = new URLSearchParams();
  if (options.libraryId && options.libraryId > 0) {
    params.set('libraryId', String(options.libraryId));
  }
  if (options.dryRun) {
    params.set('dryRun', 'true');
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  const body = await request(`/v1/resource-monitor/samples${query}`, { method: 'POST' });
  return body?.data as ResourceMonitorSample;
}
