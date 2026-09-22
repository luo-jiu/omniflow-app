import { describe, expect, it, vi } from 'vitest';
import { JsonTransformError, transformJson, validateTransformInput } from './json-transform.js';
import { runJsonTransform } from './tool-runner.js';

describe('JSON transform sample', () => {
  it('supports object and array roots, field selection, equality filtering and pretty output', () => {
    expect(transformJson('{"name":"Omni","secret":1}', { select: ['name'] })).toEqual({ mediaType: 'application/json', text: '{"name":"Omni"}' });
    expect(JSON.parse(transformJson('[{"name":"a"},{"name":"b"}]', { pretty: true }).text)).toEqual([{ name: 'a' }, { name: 'b' }]);
  });
  it('keeps nested values and rejects scalar roots, invalid UTF-8-independent input and output overflow', () => {
    expect(transformJson('{"用户":{"姓名":"小明"}}', { select: ['用户'] }).text).toContain('小明');
    expect(() => transformJson('1', {})).toThrow(JsonTransformError);
    expect(() => transformJson('{"long":"' + 'x'.repeat(100) + '"}', {}, 10)).toThrow('超过大小上限');
  });
  it('rejects unsafe input and never accepts a non-JSON destination', () => {
    for (const input of [{ select: [''] }, { unknown: true }]) expect(() => validateTransformInput(input)).toThrow();
  });
  it('uses opaque reads and the dedicated file output completion', async () => {
    const bytes = new TextEncoder().encode('{"name":"小明"}');
    const client = { toolInvocation: vi.fn(async () => ({ invocationId: 'call', toolId: 'export', input: { select: ['name'] } })),
      context: vi.fn(async () => ({ kind: 'tool', toolId: 'export', resource: { handle: 'opaque', size: bytes.length, revision: 'r1' }, capabilities: ['resource.read', 'resource.output.propose'], output: { maxBytes: 1048576 } })),
      read: vi.fn(async () => ({ bytes, nextOffset: bytes.length, eof: true, revision: 'r1' })), completeFileOutput: vi.fn(async () => undefined), failTool: vi.fn(async () => undefined) };
    await runJsonTransform(client, 65536); expect(client.completeFileOutput).toHaveBeenCalledWith('call', { mediaType: 'application/json', text: '{"name":"小明"}' }); expect(client.failTool).not.toHaveBeenCalled();
  });
});
