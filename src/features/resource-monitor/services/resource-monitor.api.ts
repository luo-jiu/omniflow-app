import { ipcRequest as request } from '@/service/request/ipcRequest';

export interface ResourceMonitorSummary {
  providerCount: number;
  bucketCount: number;
  objectCount: number;
  fileRefCount: number;
  physicalBytes: number;
  unmatchedCount: number;
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
};

export async function fetchResourceMonitorSnapshot(): Promise<ResourceMonitorSnapshot> {
  const body = await request('/v1/resource-monitor/snapshot', { method: 'GET' });
  return (body?.data || emptySnapshot) as ResourceMonitorSnapshot;
}
