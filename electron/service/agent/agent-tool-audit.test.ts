import { describe, expect, it } from 'vitest';

import { projectAgentToolAuditInput } from './agent-tool-audit';

describe('Agent Tool audit projection', () => {
  it('redacts disguised sensitive keys and sensitive nested string values', () => {
    const projection = projectAgentToolAuditInput({
      'a.p.i-k_e_y': 'top-secret-value',
      nested: {
        note: 'Authorization: Bearer abcdefghijklmnop',
        password: 'another-secret',
      },
      safe: 'visible',
    });
    const serialized = JSON.stringify(projection.input);

    expect(projection).toMatchObject({ complete: true, sensitive: true });
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('visible');
    expect(serialized).not.toContain('top-secret-value');
    expect(serialized).not.toContain('abcdefghijklmnop');
    expect(serialized).not.toContain('another-secret');
  });

  it('bounds oversized and structurally unsafe inputs without serializing them raw', () => {
    const circular: Record<string, unknown> = {
      items: Array.from({ length: 200 }, (_, index) => ({
        index,
        value: 'x'.repeat(1_000),
      })),
    };
    circular.self = circular;

    const projection = projectAgentToolAuditInput(circular);
    const serialized = JSON.stringify(projection.input);

    expect(projection.complete).toBe(false);
    expect(projection.truncated).toBe(true);
    expect(serialized.length).toBeLessThanOrEqual(4_096);
    expect(serialized).not.toContain('x'.repeat(500));
  });

  it('rejects prototype mutation keys and omits them from the audit projection', () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},'
      + '"prototype":{"polluted":true},"safe":"visible"}',
    );
    const projection = projectAgentToolAuditInput(input);
    const projectedInput = projection.input as Record<string, unknown>;
    const serialized = JSON.stringify(projectedInput);

    expect(projection).toMatchObject({ complete: false, sensitive: false, truncated: true });
    expect(Object.getPrototypeOf(projectedInput)).toBeNull();
    expect(serialized).toContain('visible');
    expect(serialized).toContain('_omniflowAuditTruncated');
    expect(serialized).not.toContain('polluted');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
