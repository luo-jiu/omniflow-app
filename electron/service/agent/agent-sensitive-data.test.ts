import { describe, expect, it } from 'vitest';

import {
  containsAgentSensitiveData,
  isAgentSensitiveFieldName,
  sanitizeAgentSensitiveText,
  sanitizeAgentSensitiveValue,
} from './agent-sensitive-data';

describe('Agent sensitive data boundary', () => {
  it('recognizes normalized provider and environment secret field names', () => {
    [
      'api_key',
      'OPENAI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_ACCESS_KEY_ID',
      'GITHUB_TOKEN',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'AZURE_CLIENT_SECRET',
      'account-key',
      'Proxy-Authorization',
      'oauth_code',
      'sessionid',
      'connect.sid',
    ].forEach(field => expect(isAgentSensitiveFieldName(field)).toBe(true));
    ['model', 'tokenBudget', 'contextWindowTokens', 'fileName'].forEach(
      field => expect(isAgentSensitiveFieldName(field)).toBe(false),
    );
  });

  it('uses the same sanitizer for high-confidence secret detection', () => {
    expect(containsAgentSensitiveData('Authorization: Basic dXNlcjpwYXNz')).toBe(true);
    expect(containsAgentSensitiveData('password=correct horse battery staple')).toBe(true);
    expect(containsAgentSensitiveData('sessionid=private-session-value')).toBe(true);
    expect(containsAgentSensitiveData('connect.sid=private-session-value')).toBe(true);
    expect(containsAgentSensitiveData('密码=abc123')).toBe(true);
    expect(containsAgentSensitiveData('API 密钥为 sk-secret-value')).toBe(true);
    expect(containsAgentSensitiveData(
      'https://example.com/callback?code=private-code&state=public',
    )).toBe(true);
    expect(containsAgentSensitiveData(
      'https://example.com/callback?sessionid=private-session-value',
    )).toBe(true);
    expect(containsAgentSensitiveData(
      'https://example.com/[SIGNED_QUERY_REDACTED]?token=still-private',
    )).toBe(true);
    expect(containsAgentSensitiveData('password=[REDACTED]still-private')).toBe(true);
    expect(containsAgentSensitiveData(
      '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----',
    )).toBe(true);
    expect(containsAgentSensitiveData('https://example.com/docs?view=1')).toBe(false);
    expect(containsAgentSensitiveData('tokenBudget=8192')).toBe(false);
    expect(containsAgentSensitiveData('我想了解密码应该如何保存')).toBe(false);
    expect(containsAgentSensitiveData('[REDACTED]')).toBe(false);
  });

  it('is idempotent after sanitizing mixed structured and free-form input', () => {
    const sanitized = sanitizeAgentSensitiveText([
      '{"api_key":"secret value","model":"gpt"}',
      "'client_secret': 'another secret'",
      'AWS_SESSION_TOKEN=session-secret visible=value',
      'Bearer raw-bearer-token',
    ].join('\n'));

    expect(sanitized).not.toContain('secret value');
    expect(sanitized).not.toContain('another secret');
    expect(sanitized).not.toContain('session-secret');
    expect(sanitized).not.toContain('raw-bearer-token');
    expect(sanitized).toContain('"model":"gpt"');
    expect(sanitizeAgentSensitiveText(sanitized)).toBe(sanitized);
  });

  it('sanitizes structured values without corrupting their JSON shape', () => {
    const source = {
      apiKey: 'secret-value',
      nested: {
        name: 'api_key=another-secret',
        url: 'https://example.com/file?X-Amz-Signature=private',
      },
      visible: 'kept',
    };
    const sanitized = sanitizeAgentSensitiveValue(source);

    expect(sanitized).toEqual({
      apiKey: '[REDACTED]',
      nested: {
        name: 'api_key=[REDACTED]',
        url: 'https://example.com/file?[SIGNED_QUERY_REDACTED]',
      },
      visible: 'kept',
    });
    expect(source.apiKey).toBe('secret-value');
    expect(() => JSON.stringify(sanitized)).not.toThrow();
  });

  it('omits prototype mutation keys before JSON round-trips or object merging', () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},'
      + '"prototype":{"polluted":true},"visible":"kept"}',
    );
    const sanitized = sanitizeAgentSensitiveValue(source);
    const roundTripped = JSON.parse(JSON.stringify(sanitized));
    const merged = Object.assign({}, roundTripped);

    expect(roundTripped).toEqual({
      _omniflowUnsafeProperties: '[UNSAFE_VALUE_OMITTED]',
      visible: 'kept',
    });
    expect(merged.polluted).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('returns idempotent JSON-safe values for unsupported primitives', () => {
    const once = sanitizeAgentSensitiveValue({
      bigint: BigInt(42),
      callable: () => undefined,
      infinity: Number.POSITIVE_INFINITY,
      missing: undefined,
      nan: Number.NaN,
      nested: ['visible', undefined, Number.NEGATIVE_INFINITY],
      symbol: Symbol('private-description'),
    });
    const twice = sanitizeAgentSensitiveValue(once);

    expect(once).toEqual({
      bigint: '[UNSUPPORTED_bigint]',
      callable: '[UNSUPPORTED_function]',
      infinity: null,
      missing: null,
      nan: null,
      nested: ['visible', null, null],
      symbol: '[UNSUPPORTED_symbol]',
    });
    expect(twice).toEqual(once);
    expect(() => JSON.parse(JSON.stringify(once))).not.toThrow();
  });

  it('stops traversing oversized structured values at hard collection limits', () => {
    const oversizedArray = Array.from({ length: 20_000 }, (_, index) => index);
    const oversizedObject = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, index) => [`key-${index}`, index]),
    );
    const sanitizedArray = sanitizeAgentSensitiveValue(oversizedArray) as unknown[];
    const sanitizedObject = sanitizeAgentSensitiveValue(oversizedObject) as Record<string, unknown>;

    expect(sanitizedArray.length).toBeLessThan(oversizedArray.length);
    expect(sanitizedArray.at(-1)).toBe('[VALUE_TRUNCATED]');
    expect(Object.keys(sanitizedObject).length).toBeLessThan(Object.keys(oversizedObject).length);
    expect(sanitizedObject._omniflowSanitized).toBe('[VALUE_TRUNCATED]');
    expect(sanitizeAgentSensitiveValue(sanitizedArray)).toEqual(sanitizedArray);
    expect(sanitizeAgentSensitiveValue(sanitizedObject)).toEqual(sanitizedObject);
  });
});
