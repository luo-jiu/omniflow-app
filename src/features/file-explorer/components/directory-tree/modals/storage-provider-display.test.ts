import { describe, expect, it } from 'vitest';
import type { OverlayStorageProvider } from '@/service/overlay/types';
import {
  formatStorageProviderAlias,
  isLocalStorageProvider,
} from './storage-provider-display';

function provider(overrides: Partial<OverlayStorageProvider> = {}): OverlayStorageProvider {
  return {
    alias: 'win-minio',
    type: 'minio',
    endpoint: '192.168.1.10:9000',
    bucket: 'default',
    label: 'Windows MinIO',
    useSSL: false,
    ...overrides,
  };
}

describe('storage provider display', () => {
  it('shows only the alias for a remote provider', () => {
    expect(formatStorageProviderAlias(provider(), 'local-minio')).toBe('win-minio');
  });

  it('marks a loopback provider as local', () => {
    const localProvider = provider({ alias: 'local-minio', endpoint: 'localhost:9000' });

    expect(isLocalStorageProvider(localProvider)).toBe(true);
    expect(formatStorageProviderAlias(localProvider, 'win-minio')).toBe('local-minio（本机）');
  });

  it('lets the default marker take precedence over the local marker', () => {
    const localProvider = provider({ alias: 'local-minio', endpoint: 'http://127.0.0.1:9000' });

    expect(formatStorageProviderAlias(localProvider, 'local-minio')).toBe('local-minio（默认）');
  });
});
