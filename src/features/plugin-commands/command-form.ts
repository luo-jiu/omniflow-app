import type { PluginToolSchema } from '../../../packages/plugin-sdk/index.js';

/** Resource and destination identities are always supplied by host pickers. */
export function commandParameterSchema(schema: PluginToolSchema): PluginToolSchema {
  const reserved = new Set(['resource', 'resources', 'destination']);
  return { ...schema, properties: Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => !reserved.has(key))),
    required: (schema.required ?? []).filter(key => !reserved.has(key)) };
}

export function initialCommandValue(schema: PluginToolSchema): unknown {
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case 'object': return Object.fromEntries((schema.required ?? []).map(key => [key, initialCommandValue(schema.properties![key])]));
    case 'array': return Array.from({ length: schema.minItems ?? 0 }, () => initialCommandValue(schema.items!));
    case 'boolean': return false;
    case 'null': return null;
    default: return '';
  }
}

/** Converts only schema-declared fields; never forwards arbitrary renderer JSON. */
export function parseCommandValue(schema: PluginToolSchema, draft: unknown, label = '参数'): unknown {
  const fail = (reason: string): never => { throw new Error(`${label}：${reason}`); };
  let value: unknown;
  switch (schema.type) {
    case 'object': {
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return fail('需要填写对象');
      const record = draft as Record<string, unknown>;
      const required = new Set(schema.required ?? []);
      const entries: Array<[string, unknown]> = [];
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (Object.prototype.hasOwnProperty.call(record, key)) entries.push([key, parseCommandValue(child, record[key], `${label}.${key}`)]);
        else if (required.has(key)) return fail(`请填写 ${key}`);
      }
      value = Object.fromEntries(entries);
      break;
    }
    case 'array': {
      if (!Array.isArray(draft)) return fail('需要填写列表');
      if (draft.length < (schema.minItems ?? 0) || draft.length > (schema.maxItems ?? 256)) return fail(`列表数量应为 ${schema.minItems ?? 0}–${schema.maxItems ?? 256}`);
      value = draft.map((item, index) => parseCommandValue(schema.items!, item, `${label}[${index + 1}]`));
      if (schema.uniqueItems && new Set((value as unknown[]).map(item => JSON.stringify(item))).size !== draft.length) return fail('列表不能有重复值');
      break;
    }
    case 'number':
    case 'integer': {
      if ((typeof draft !== 'string' && typeof draft !== 'number') || String(draft).trim() === '') return fail('请填写数字');
      const numeric = Number(draft);
      if (!Number.isFinite(numeric) || (schema.type === 'integer' && !Number.isSafeInteger(numeric))) return fail('数字格式不正确');
      if (numeric < schema.minimum! || numeric > schema.maximum!) return fail(`应为 ${schema.minimum}–${schema.maximum}`);
      value = numeric;
      break;
    }
    case 'string': {
      if (typeof draft !== 'string') return fail('请填写文字');
      const length = Array.from(draft).length;
      if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? 4096)) return fail(`长度应为 ${schema.minLength ?? 0}–${schema.maxLength ?? 4096} 个字符`);
      value = draft;
      break;
    }
    case 'boolean': if (typeof draft !== 'boolean') return fail('请选择是或否'); value = draft; break;
    case 'null': value = null; break;
  }
  if (schema.enum && !schema.enum.includes(value as never)) return fail('请选择列表中的值');
  return value;
}
