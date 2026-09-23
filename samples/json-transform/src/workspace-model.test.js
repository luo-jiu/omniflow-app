import { describe, expect, it, vi } from 'vitest';
import { transformJson } from './json-transform.js';
import { createWorkspacePreview, describeJsonSource, requestWorkspacePrepare, workspaceParameters } from './workspace-model.js';

describe('JSON transform workspace', () => {
  it('discovers own top-level fields across array objects without changing primitive items', () => {
    const source = '[{"name":"小明","__proto__":{"safe":true}},null,7,{"other":"后续字段"}]';
    expect(describeJsonSource(source)).toEqual({
      summary: '数组 · 4 项',
      fields: [{ name: 'name', selectable: true }, { name: '__proto__', selectable: true }, { name: 'other', selectable: true }],
      hasMoreFields: false,
    });
    const input = workspaceParameters(false, ['__proto__', 'name'], true);
    expect(createWorkspacePreview(source, input).text).toBe(transformJson(source, input).text);
    expect(JSON.parse(createWorkspacePreview(source, input).text)).toEqual([{ ['__proto__']: { safe: true }, name: '小明' }, null, 7, {}]);
  });

  it('bounds field controls without dropping source fields from the full-field output', () => {
    const object = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key${index}`, index]));
    const source = JSON.stringify(object);
    const fields = describeJsonSource(source);
    expect(fields.fields).toHaveLength(256);
    expect(fields.hasMoreFields).toBe(true);
    expect(JSON.parse(createWorkspacePreview(source, workspaceParameters(true, [], false)).text)).toEqual(object);
  });

  it('marks unsupported field names while preserving them in full-field mode', () => {
    const source = JSON.stringify({ '': 'empty', ['x'.repeat(129)]: 'long', normal: 'ok' });
    expect(describeJsonSource(source).fields.map(field => field.selectable)).toEqual([false, false, true]);
    expect(createWorkspacePreview(source, { pretty: false }).text).toBe(source);
    expect(() => workspaceParameters(false, [], true)).toThrow('至少勾选一个字段');
    expect(() => workspaceParameters(false, ['x'.repeat(129)], true)).toThrow();
    expect(() => workspaceParameters(false, Array.from({ length: 65 }, (_, i) => `key${i}`), true)).toThrow();
  });

  it('truncates only the displayed preview and preserves Unicode boundaries', () => {
    const source = JSON.stringify({ text: 'x'.repeat(23990) + '😀' + 'y'.repeat(100) });
    const result = createWorkspacePreview(source, {});
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(24000);
    expect(result.text).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(result.bytes).toBe(new TextEncoder().encode(transformJson(source, {}).text).length);
    expect(transformJson(source, {}).text).toBe(source);
  });

  it('rejects an oversized complete result before requesting any preparation', async () => {
    const client = { prepareWorkspaceCommand: vi.fn() };
    const source = JSON.stringify({ text: '字'.repeat(350000) });
    expect(() => createWorkspacePreview(source, {})).toThrow('超过大小上限');
    await expect(requestWorkspacePrepare(client, source, {})).rejects.toThrow('超过大小上限');
    expect(client.prepareWorkspaceCommand).not.toHaveBeenCalled();
  });

  it('requests preparation using only the existing business parameters', async () => {
    const client = { prepareWorkspaceCommand: vi.fn(async () => ({ requestId: 'request-1' })) };
    const parameters = workspaceParameters(false, ['name'], true);
    await expect(requestWorkspacePrepare(client, '{"name":"小明","secret":1}', parameters)).resolves.toEqual({ requestId: 'request-1' });
    expect(client.prepareWorkspaceCommand).toHaveBeenCalledWith({ select: ['name'], pretty: true });
    await expect(requestWorkspacePrepare(client, '{}', { resource: { nodeId: 1 } })).rejects.toThrow();
    expect(client.prepareWorkspaceCommand).toHaveBeenCalledTimes(1);
  });
});
