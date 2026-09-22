import type { PluginToolContribution, PluginToolSchema } from '../../../packages/plugin-sdk/index.js';
export type { PluginToolSchema } from '../../../packages/plugin-sdk/index.js';

export const TOOL_SCHEMA_LIMITS = Object.freeze({ schemaBytes: 8192, depth: 6, nodes: 128, properties: 64, stringLength: 4096, arrayItems: 256, inputBytes: 16384, outputBytes: 32768 });
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const boundedInteger = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
type ToolKind = PluginToolContribution['kind'];
export const RENAME_PROPOSAL_OUTPUT_SCHEMA: PluginToolSchema = {
  type: 'object', additionalProperties: false, required: ['changes'], properties: {
    changes: { type: 'array', minItems: 0, maxItems: 50, items: {
      type: 'object', additionalProperties: false, required: ['id', 'name'], properties: {
        id: { type: 'string', minLength: 1, maxLength: 64 },
        name: { type: 'string', minLength: 1, maxLength: 240 },
      },
    } },
  },
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function jsonBytes(value: unknown, limit: number): number {
  const seen = new Set<object>(); let nodes = 0;
  function check(item: unknown, depth: number): void {
    if (++nodes > limit || depth > TOOL_SCHEMA_LIMITS.depth * 3 + 4) throw new Error('Tool JSON budget exceeded');
    if (scalar(item)) { if (typeof item === 'string' && item.length > limit) throw new Error('Tool JSON budget exceeded'); return; }
    if ((!Array.isArray(item) && !record(item)) || seen.has(item as object)) throw new Error('Tool values must be JSON');
    seen.add(item as object);
    if (Object.getOwnPropertySymbols(item as object).length || Object.values(Object.getOwnPropertyDescriptors(item)).some(property => !('value' in property))) throw new Error('Tool values must be plain JSON');
    if (Array.isArray(item) && Object.keys(item).length !== item.length) throw new Error('Tool arrays must be dense JSON');
    for (const [key, child] of Object.entries(item as object)) { if (RESERVED_KEYS.has(key) || key.length > limit) throw new Error('Invalid Tool JSON property'); check(child, depth + 1); }
    seen.delete(item as object);
  }
  check(value, 0);
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > limit) throw new Error('Tool JSON byte budget exceeded');
  return bytes;
}

function validateSchema(value: unknown): asserts value is PluginToolSchema {
  jsonBytes(value, TOOL_SCHEMA_LIMITS.schemaBytes);
  let nodes = 0; let properties = 0;
  function visit(schema: unknown, depth: number): void {
    if (!record(schema) || ++nodes > TOOL_SCHEMA_LIMITS.nodes || depth > TOOL_SCHEMA_LIMITS.depth) throw new Error('Tool schema budget exceeded');
    const allowed = new Set(['type', 'description']);
    if (schema.description !== undefined && (typeof schema.description !== 'string' || schema.description.length > 512)) throw new Error('Invalid Tool schema description');
    switch (schema.type) {
      case 'object': {
        ['properties', 'required', 'additionalProperties'].forEach(key => allowed.add(key));
        if (!record(schema.properties) || schema.additionalProperties !== false || !Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length || schema.required.some(key => typeof key !== 'string' || !hasOwn(schema.properties as object, key))) throw new Error('Tool object schema must be closed');
        const entries = Object.entries(schema.properties);
        properties += entries.length;
        if (properties > TOOL_SCHEMA_LIMITS.properties) throw new Error('Too many Tool schema properties');
        for (const [key, child] of entries) {
          if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || RESERVED_KEYS.has(key)) throw new Error('Invalid Tool schema property');
          visit(child, depth + 1);
        }
        break;
      }
      case 'array':
        ['items', 'minItems', 'maxItems', 'uniqueItems'].forEach(key => allowed.add(key));
        if (!boundedInteger(schema.maxItems, 0, TOOL_SCHEMA_LIMITS.arrayItems) || (schema.minItems !== undefined && !boundedInteger(schema.minItems, 0, schema.maxItems))) throw new Error('Tool array schema must be bounded');
        if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') throw new Error('Invalid array uniqueness constraint');
        visit(schema.items, depth + 1);
        break;
      case 'string':
        ['minLength', 'maxLength', 'enum'].forEach(key => allowed.add(key));
        if (!boundedInteger(schema.maxLength, 0, TOOL_SCHEMA_LIMITS.stringLength) || (schema.minLength !== undefined && !boundedInteger(schema.minLength, 0, schema.maxLength))) throw new Error('Tool string schema must be bounded');
        break;
      case 'number':
      case 'integer':
        ['minimum', 'maximum', 'enum'].forEach(key => allowed.add(key));
        if (typeof schema.minimum !== 'number' || typeof schema.maximum !== 'number' || !Number.isFinite(schema.minimum) || !Number.isFinite(schema.maximum) || schema.minimum > schema.maximum || (schema.type === 'integer' && (!Number.isSafeInteger(schema.minimum) || !Number.isSafeInteger(schema.maximum)))) throw new Error('Tool numeric schema must be bounded');
        break;
      case 'boolean':
      case 'null':
        allowed.add('enum'); break;
      default: throw new Error('Unsupported Tool schema type');
    }
    if (Object.keys(schema).some(key => !allowed.has(key))) throw new Error('Unsupported Tool schema keyword');
    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 32 || new Set(schema.enum.map(item => JSON.stringify(item))).size !== schema.enum.length) throw new Error('Invalid Tool schema enum');
      for (const item of schema.enum) {
        if (!scalar(item)) throw new Error('Invalid Tool schema enum');
        validateValue({ ...schema, enum: undefined } as unknown as PluginToolSchema, item);
      }
    }
  }
  visit(value, 0);
  if (!record(value) || value.type !== 'object') throw new Error('Tool schema root must be an object');
}

function validateValue(schema: PluginToolSchema, value: unknown): void {
  if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) throw new Error('Tool value is outside enum');
  switch (schema.type) {
    case 'object':
      if (!record(value) || schema.required!.some(key => !hasOwn(value, key)) || Object.keys(value).some(key => !hasOwn(schema.properties!, key))) throw new Error('Invalid Tool object');
      for (const [key, child] of Object.entries(value)) validateValue(schema.properties![key], child);
      break;
    case 'array':
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > schema.maxItems!) throw new Error('Invalid Tool array');
      for (const child of value) validateValue(schema.items!, child);
      if (schema.uniqueItems && new Set(value.map(stableJson)).size !== value.length) throw new Error('Duplicate Tool array item');
      break;
    case 'string': {
      if (typeof value !== 'string') throw new Error('Invalid Tool string');
      const length = Array.from(value).length;
      if (length < (schema.minLength ?? 0) || length > schema.maxLength!) throw new Error('Invalid Tool string length');
      break;
    }
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum! || value > schema.maximum! || (schema.type === 'integer' && !Number.isSafeInteger(value))) throw new Error('Invalid Tool number');
      break;
    case 'boolean': if (typeof value !== 'boolean') throw new Error('Invalid Tool boolean'); break;
    case 'null': if (value !== null) throw new Error('Invalid Tool null'); break;
  }
}

function validateResourceSchema(schema: PluginToolSchema, kind?: ToolKind): void {
  if (kind === 'rename-proposal') {
    const resources = schema.properties?.resources;
    const nodeId = resources?.items;
    if (!schema.required?.includes('resources') || resources?.type !== 'array' || resources.minItems !== 1
      || resources.maxItems !== 50 || resources.uniqueItems !== true || nodeId?.type !== 'integer'
      || nodeId.minimum !== 1 || nodeId.maximum !== Number.MAX_SAFE_INTEGER || nodeId.enum
      || hasOwn(schema.properties ?? {}, 'resource')) throw new Error('Proposal resources must be 1 to 50 unique positive safe nodeIds');
    return;
  }
  if (kind !== undefined && kind !== 'file-output') throw new Error('Unsupported Tool kind');
  const resource = schema.properties?.resource;
  const nodeId = resource?.properties?.nodeId;
  if (!schema.required?.includes('resource') || resource?.type !== 'object' || resource.required?.length !== 1 || resource.required[0] !== 'nodeId' || Object.keys(resource.properties ?? {}).length !== 1 || nodeId?.type !== 'integer' || nodeId.minimum !== 1 || nodeId.maximum !== Number.MAX_SAFE_INTEGER || nodeId.enum) throw new Error('Tool resource must be a required positive safe nodeId');
  if (kind === 'file-output') {
    const destination = schema.properties?.destination, parentId = destination?.properties?.parentId, fileName = destination?.properties?.fileName;
    if (!schema.required?.includes('destination') || destination?.type !== 'object' || destination.required?.length !== 2
      || !destination.required.includes('parentId') || !destination.required.includes('fileName') || Object.keys(destination.properties ?? {}).length !== 2
      || parentId?.type !== 'integer' || parentId.minimum !== 1 || parentId.maximum !== Number.MAX_SAFE_INTEGER || parentId.enum
      || fileName?.type !== 'string' || fileName.minLength !== 1 || fileName.maxLength !== 240 || fileName.enum) throw new Error('File output requires a bounded host destination');
  }
}

function validateProposalOutputSchema(schema: PluginToolSchema): void {
  // Descriptions are documentation; constraints and the public result shape are host-owned.
  const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized)
    : record(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, child]) => [key, normalized(child)])) : value;
  const canonical = normalized(schema) as PluginToolSchema;
  if (canonical.properties?.changes?.minItems === undefined && canonical.properties?.changes) canonical.properties.changes.minItems = 0;
  if (stableJson(canonical) !== stableJson(RENAME_PROPOSAL_OUTPUT_SCHEMA)) throw new Error('Proposal output must contain bounded id/name changes');
}

export function validateToolSchemas(inputSchema: unknown, outputSchema: unknown, kind?: ToolKind): void {
  if (kind === 'file-output') throw new Error('File output uses a fixed output declaration');
  validateSchema(inputSchema); validateResourceSchema(inputSchema, kind); validateSchema(outputSchema);
  if (kind === 'rename-proposal') validateProposalOutputSchema(outputSchema);
}

export function validateToolContribution(tool: PluginToolContribution): void {
  if (tool.kind !== 'file-output') { validateToolSchemas(tool.inputSchema, tool.outputSchema, tool.kind); return; }
  validateSchema(tool.inputSchema); validateResourceSchema(tool.inputSchema, tool.kind);
  const output = tool.output;
  if (!record(output) || Object.keys(output).length !== 2 || !Array.isArray(output.mediaTypes) || !output.mediaTypes.length
    || output.mediaTypes.length > 2 || new Set(output.mediaTypes).size !== output.mediaTypes.length
    || output.mediaTypes.some(type => !['text/csv', 'application/json'].includes(type))
    || !boundedInteger(output.maxBytes, 1, 1048576) || hasOwn(tool, 'outputSchema') || hasOwn(tool, 'maxResultBytes')) throw new Error('Invalid file output declaration');
}

export function validateToolInput(tool: { inputSchema: PluginToolSchema; kind?: ToolKind }, input: unknown): asserts input is Record<string, unknown> {
  validateSchema(tool.inputSchema); validateResourceSchema(tool.inputSchema, tool.kind);
  jsonBytes(input, TOOL_SCHEMA_LIMITS.inputBytes); validateValue(tool.inputSchema, input);
  if (tool.kind === 'file-output') {
    const fileName = (input as { destination: { fileName: string } }).destination.fileName;
    if (fileName !== fileName.trim() || fileName === '.' || fileName === '..' || /[\p{Cc}/\\]/u.test(fileName)
      || Buffer.byteLength(fileName, 'utf8') > 240 || Buffer.from(fileName, 'utf8').toString('utf8') !== fileName) throw new Error('Invalid output file name');
  }
}

export function validateToolOutput(tool: { outputSchema: PluginToolSchema; maxResultBytes: number; kind?: ToolKind }, output: unknown): void {
  validateSchema(tool.outputSchema);
  if (tool.kind === 'rename-proposal') validateProposalOutputSchema(tool.outputSchema);
  if (!boundedInteger(tool.maxResultBytes, 1, TOOL_SCHEMA_LIMITS.outputBytes)) throw new Error('Invalid Tool result budget');
  jsonBytes(output, tool.maxResultBytes); validateValue(tool.outputSchema, output);
}
