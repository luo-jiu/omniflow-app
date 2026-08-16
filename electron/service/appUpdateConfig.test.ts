import { describe, expect, it } from 'vitest';

import { normalizeAppUpdateBaseUrl } from './appUpdateConfig';

describe('normalizeAppUpdateBaseUrl', () => {
  it('accepts https feeds and normalizes a trailing slash', () => {
    expect(normalizeAppUpdateBaseUrl('https://updates.example.com/stable/mac'))
      .toBe('https://updates.example.com/stable/mac/');
  });

  it('accepts loopback http feeds for packaged local verification', () => {
    expect(normalizeAppUpdateBaseUrl('http://127.0.0.1:8899'))
      .toBe('http://127.0.0.1:8899/');
    expect(normalizeAppUpdateBaseUrl('http://localhost:8899/feed/'))
      .toBe('http://localhost:8899/feed/');
  });

  it('rejects insecure remote feeds and credential-bearing urls', () => {
    expect(normalizeAppUpdateBaseUrl('http://updates.example.com')).toBeNull();
    expect(normalizeAppUpdateBaseUrl('https://user:secret@updates.example.com')).toBeNull();
  });
});
