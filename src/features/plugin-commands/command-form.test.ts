import { describe, expect, it } from 'vitest';
import type { PluginToolSchema } from '../../../packages/plugin-sdk/index.js';
import { commandParameterSchema, initialCommandValue, parseCommandValue } from './command-form';

const schema: PluginToolSchema = { type: 'object', additionalProperties: false, required: ['format'], properties: {
  format: { type: 'string', maxLength: 4, enum: ['csv', 'json'] },
  column: { type: 'integer', minimum: 0, maximum: 127 },
  equals: { type: 'string', maxLength: 256 },
  pretty: { type: 'boolean' },
  select: { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } },
} };
describe('manual command parameter form', () => {
  it('keeps omitted parameters distinct from explicit empty strings and false', () => {
    expect(initialCommandValue(schema)).toEqual({ format: 'csv' });
    expect(parseCommandValue(schema, { format: 'json', equals: '', pretty: false })).toEqual({ format: 'json', equals: '', pretty: false });
  });
  it('validates user numbers and bounded arrays before requesting preparation', () => {
    expect(parseCommandValue(schema, { format: 'csv', column: '0', select: ['name'] })).toEqual({ format: 'csv', column: 0, select: ['name'] });
    expect(() => parseCommandValue(schema, { format: 'csv', column: '' })).toThrow('请填写数字');
    expect(() => parseCommandValue(schema, { format: 'csv', column: '1.5' })).toThrow('格式');
    expect(() => parseCommandValue(schema, { format: 'csv', select: ['a', 'a'] })).toThrow('重复');
    expect(() => parseCommandValue(schema, { format: 'csv', select: ['a', 'b', 'c'] })).toThrow('数量');
  });
  it('never lets the parameter form override host-selected resource identities', () => {
    const filtered = commandParameterSchema({ ...schema, required: ['resource', 'resources', 'destination', 'format'], properties: {
      ...schema.properties, resource: { type: 'object' }, resources: { type: 'array' }, destination: { type: 'object' },
    } });
    expect(Object.keys(filtered.properties!)).not.toContain('resource');
    expect(filtered.required).toEqual(['format']);
    expect(parseCommandValue(filtered, { format: 'json', resource: { nodeId: 7 }, destination: { parentId: 9 }, extra: true })).toEqual({ format: 'json' });
  });
});
