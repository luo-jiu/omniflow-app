import { ipcRequest as request } from '@/service/request/ipcRequest';

export interface ProviderItem {
  alias: string;
  type: string;
  endpoint: string;
  publicEndpoint?: string;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
  bucket: string;
  region: string;
  label: string;
}

export interface ProviderListResponse {
  providers: ProviderItem[];
  defaultProvider: string;
}

export interface AddProviderPayload {
  alias: string;
  type: string;
  endpoint: string;
  publicEndpoint?: string;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
  bucket: string;
  region: string;
  label: string;
}

export interface UpdateProviderPayload {
  type: string;
  endpoint: string;
  publicEndpoint?: string;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
  bucket: string;
  region: string;
  label: string;
}

export interface RoutingRuleConditions {
  minFileSizeBytes: number;
  maxFileSizeBytes: number;
  extensions: string[];
  mimePrefixes: string[];
}

export interface RoutingRule {
  name: string;
  conditions: RoutingRuleConditions;
  targetProvider: string;
}

export interface TestProviderResult {
  success: boolean;
  message: string;
}

export interface ResolveTargetResult {
  providerAlias: string;
  label: string;
}

export async function fetchProviders(): Promise<ProviderListResponse> {
  const body = await request('/v1/storage/providers', { method: 'GET' });
  return (body?.data || { providers: [], defaultProvider: '' }) as ProviderListResponse;
}

export async function addProvider(payload: AddProviderPayload): Promise<void> {
  await request('/v1/storage/providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateProvider(alias: string, payload: UpdateProviderPayload): Promise<void> {
  await request(`/v1/storage/providers/${encodeURIComponent(alias)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteProvider(alias: string): Promise<void> {
  await request(`/v1/storage/providers/${encodeURIComponent(alias)}`, {
    method: 'DELETE',
  });
}

export async function fetchDefault(): Promise<string> {
  const body = await request('/v1/storage/default', { method: 'GET' });
  return (body?.data as { defaultProvider: string })?.defaultProvider || '';
}

export async function setDefault(alias: string): Promise<void> {
  await request('/v1/storage/default', {
    method: 'PUT',
    body: JSON.stringify({ alias }),
  });
}

export async function fetchRoutingRules(): Promise<RoutingRule[]> {
  const body = await request('/v1/storage/routing-rules', { method: 'GET' });
  return ((body?.data as { rules: RoutingRule[] })?.rules || []) as RoutingRule[];
}

export async function updateRoutingRules(rules: RoutingRule[]): Promise<void> {
  await request('/v1/storage/routing-rules', {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  });
}

export async function testProvider(alias: string): Promise<TestProviderResult> {
  const body = await request(`/v1/storage/providers/${encodeURIComponent(alias)}/test`, {
    method: 'POST',
  });
  return (body?.data || { success: false, message: 'unknown error' }) as TestProviderResult;
}

export async function resolveTarget(
  fileSize: number,
  extension: string,
  contentType: string,
): Promise<ResolveTargetResult> {
  const body = await request('/v1/storage/resolve-target', {
    method: 'POST',
    body: JSON.stringify({ fileSize, extension, contentType }),
  });
  return (body?.data || { providerAlias: '', label: '' }) as ResolveTargetResult;
}
