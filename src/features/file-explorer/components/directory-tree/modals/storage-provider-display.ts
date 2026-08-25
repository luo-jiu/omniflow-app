import type { OverlayStorageProvider } from '@/service/overlay/types';

const LOOPBACK_HOSTS = new Set([
  'localhost',
  '::1',
  '0:0:0:0:0:0:0:1',
]);

function extractEndpointHost(endpoint: string): string {
  const value = endpoint.trim();
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

export function isLocalStorageProvider(provider: OverlayStorageProvider): boolean {
  const host = extractEndpointHost(provider.endpoint);
  return LOOPBACK_HOSTS.has(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function formatStorageProviderAlias(
  provider: OverlayStorageProvider,
  defaultProvider?: string,
): string {
  const alias = provider.alias.trim() || provider.label.trim();
  if (alias === defaultProvider?.trim()) {
    return `${alias}（默认）`;
  }
  if (isLocalStorageProvider(provider)) {
    return `${alias}（本机）`;
  }
  return alias;
}
