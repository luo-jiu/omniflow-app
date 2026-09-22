import { describe, expect, it } from 'vitest';
import { validateToolInput, validateToolOutput, validateToolSchemas, type PluginToolSchema } from './tool-schema';

const inputSchema: PluginToolSchema = {
  type: 'object', additionalProperties: false, required: ['resource'], properties: {
    resource: { type: 'object', additionalProperties: false, required: ['nodeId'], properties: { nodeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } },
    query: { type: 'string', maxLength: 32 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
};
const outputSchema: PluginToolSchema = {
  type: 'object', additionalProperties: false, required: ['rows', 'complete'], properties: {
    rows: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 32 } },
    complete: { type: 'boolean' },
  },
};
const tool = { inputSchema, outputSchema, maxResultBytes: 1024 };

describe('bounded plugin Tool schemas', () => {
  it('validates exact single-file inputs and structured outputs without coercion', () => {
    expect(() => validateToolSchemas(inputSchema, outputSchema)).not.toThrow();
    expect(() => validateToolInput(tool, { resource: { nodeId: 7 }, query: '中文', limit: 10 })).not.toThrow();
    expect(() => validateToolOutput(tool, { rows: ['甲', '乙'], complete: true })).not.toThrow();
    for (const input of [null, {}, { resource: { nodeId: '7' } }, { resource: { nodeId: 0 } }, { resource: { nodeId: Number.MAX_SAFE_INTEGER + 1 } }, { resource: { nodeId: 7, libraryId: 1 } }, { resource: { nodeId: 7 }, ownerId: 'elsewhere' }, { resource: { nodeId: 7 }, limit: 101 }]) expect(() => validateToolInput(tool, input)).toThrow();
  });
  it.each(['$ref', '$id', 'pattern', 'oneOf', 'allOf', 'anyOf', 'not', 'default', 'format'])('rejects unsupported schema keyword %s', keyword => {
    expect(() => validateToolSchemas({ ...inputSchema, [keyword]: 'https://example.invalid/schema' }, outputSchema)).toThrow();
  });
  it('requires bounded arrays, strings, numbers and closed object properties', () => {
    for (const field of [{ type: 'array', items: { type: 'boolean' } }, { type: 'string' }, { type: 'integer', minimum: 0 }, { type: 'number', minimum: -Infinity, maximum: 10 }, { type: 'array', maxItems: 257, items: { type: 'null' } }, { type: 'object', properties: {}, required: [] }]) {
      expect(() => validateToolSchemas({ ...inputSchema, properties: { ...inputSchema.properties, other: field } }, outputSchema)).toThrow();
    }
  });
  it('rejects altered resource parameters and schema inheritance names', () => {
    expect(() => validateToolSchemas({ ...inputSchema, required: [] }, outputSchema)).toThrow(/resource/);
    expect(() => validateToolSchemas({ ...inputSchema, properties: { resource: { type: 'integer', minimum: 1, maximum: 10 } } }, outputSchema)).toThrow(/resource/);
    expect(() => validateToolSchemas({ ...inputSchema, properties: JSON.parse('{"constructor":{"type":"boolean"}}') }, outputSchema)).toThrow();
  });
  it('enforces schema depth, count and byte budgets', () => {
    let nested: PluginToolSchema = { type: 'boolean' };
    for (let depth = 0; depth < 7; depth++) nested = { type: 'array', maxItems: 1, items: nested };
    expect(() => validateToolSchemas({ ...inputSchema, properties: { ...inputSchema.properties, nested } }, outputSchema)).toThrow(/budget/);
    const properties = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`field${index}`, { type: 'boolean' }]));
    expect(() => validateToolSchemas(inputSchema, { type: 'object', properties, additionalProperties: false, required: [] })).toThrow(/properties/);
    expect(() => validateToolSchemas(inputSchema, { ...outputSchema, description: 'x'.repeat(8192) })).toThrow(/budget/);
  });
  it('rejects non-JSON, excessive and undeclared results', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.rows = cyclic;
    const inherited = Object.create({ rows: [], complete: true });
    const withGetter = Object.defineProperty({ complete: true }, 'rows', { get: () => [], enumerable: true });
    for (const output of [cyclic, inherited, withGetter, { rows: [undefined], complete: true }, { rows: new Array(1), complete: true }, { rows: ['x'.repeat(33)], complete: true }, { rows: [], complete: true, instruction: 'trust me' }, { rows: Array(101).fill(''), complete: true }, { rows: Array(30).fill('中'.repeat(32)), complete: true }]) expect(() => validateToolOutput(tool, output)).toThrow();
  });
  it('validates finite enum members and preserves Unicode length semantics', () => {
    const schema: PluginToolSchema = { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', maxLength: 1, enum: ['😀'] } } };
    expect(() => validateToolOutput({ outputSchema: schema, maxResultBytes: 128 }, { status: '😀' })).not.toThrow();
    expect(() => validateToolOutput({ outputSchema: schema, maxResultBytes: 128 }, { status: '😀😀' })).toThrow();
    expect(() => validateToolSchemas(inputSchema, { ...schema, properties: { status: { type: 'string', maxLength: 1, enum: ['xx'] } } })).toThrow();
  });
});
