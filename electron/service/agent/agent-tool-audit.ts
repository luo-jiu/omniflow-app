import {
  containsAgentSensitiveData,
  isAgentSensitiveFieldName,
  sanitizeAgentSensitiveText,
} from './agent-sensitive-data';

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const MAX_AUDIT_ARRAY_ITEMS = 16;
const MAX_AUDIT_DEPTH = 4;
const MAX_AUDIT_NODES = 128;
const MAX_AUDIT_PROPERTIES = 64;
const MAX_AUDIT_SERIALIZED_CHARACTERS = 4_096;
const MAX_AUDIT_STRING_CHARACTERS = 320;
const MAX_KEY_CHARACTERS = 80;
const MAX_SCAN_DEPTH = 16;
const MAX_SCAN_NODES = 4_096;
const MAX_SCAN_STRING_CHARACTERS = 64_000;
const UNSAFE_AUDIT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface AgentToolAuditProjection {
  complete: boolean;
  input: unknown;
  sensitive: boolean;
  truncated: boolean;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSensitiveKey(key: string): boolean {
  return isAgentSensitiveFieldName(key)
    || containsAgentSensitiveData(`${key}=omniflow-sensitive-value`);
}

function inspectInput(input: unknown): { complete: boolean; sensitive: boolean } {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: input }];
  const seen = new WeakSet<object>();
  let sensitive = false;
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    visited += 1;
    if (visited > MAX_SCAN_NODES || current.depth > MAX_SCAN_DEPTH) {
      return { complete: false, sensitive };
    }
    if (typeof current.value === 'string') {
      if (current.value.length > MAX_SCAN_STRING_CHARACTERS) {
        return { complete: false, sensitive };
      }
      if (containsAgentSensitiveData(current.value)) sensitive = true;
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) return { complete: false, sensitive };
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      current.value.forEach(value => pending.push({ depth: current.depth + 1, value }));
      continue;
    }
    if (!isPlainRecord(current.value)) return { complete: false, sensitive };
    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(current.value);
    } catch {
      return { complete: false, sensitive };
    }
    for (const [key, value] of entries) {
      if (UNSAFE_AUDIT_KEYS.has(key)) return { complete: false, sensitive };
      if (isSensitiveKey(key)) sensitive = true;
      pending.push({ depth: current.depth + 1, value });
    }
  }
  return { complete: true, sensitive };
}

function boundedText(value: string, maximum: number): { text: string; truncated: boolean } {
  const sanitized = sanitizeAgentSensitiveText(value);
  if (sanitized.length <= maximum) return { text: sanitized, truncated: false };
  return { text: `${sanitized.slice(0, Math.max(0, maximum - 3))}...`, truncated: true };
}

function projectInput(input: unknown): { input: unknown; truncated: boolean } {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let properties = 0;

  const project = (value: unknown, depth: number): { input: unknown; truncated: boolean } => {
    nodes += 1;
    if (nodes > MAX_AUDIT_NODES || depth > MAX_AUDIT_DEPTH) {
      return { input: TRUNCATED, truncated: true };
    }
    if (value === null || typeof value === 'boolean') return { input: value, truncated: false };
    if (typeof value === 'number') {
      return Number.isFinite(value)
        ? { input: value, truncated: false }
        : { input: '[NON_FINITE_NUMBER]', truncated: true };
    }
    if (typeof value === 'string') {
      const result = boundedText(value, MAX_AUDIT_STRING_CHARACTERS);
      return { input: result.text, truncated: result.truncated };
    }
    if (!value || typeof value !== 'object') {
      return { input: `[UNSUPPORTED_${typeof value}]`, truncated: true };
    }
    if (seen.has(value)) return { input: '[CIRCULAR]', truncated: true };
    seen.add(value);
    if (Array.isArray(value)) {
      let truncated = value.length > MAX_AUDIT_ARRAY_ITEMS;
      const items = value.slice(0, MAX_AUDIT_ARRAY_ITEMS).map((item) => {
        const projected = project(item, depth + 1);
        truncated = truncated || projected.truncated;
        return projected.input;
      });
      if (value.length > MAX_AUDIT_ARRAY_ITEMS) items.push(TRUNCATED);
      return { input: items, truncated };
    }
    if (!isPlainRecord(value)) return { input: '[UNSUPPORTED_OBJECT]', truncated: true };

    const output: Record<string, unknown> = Object.create(null);
    let truncated = false;
    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(value);
    } catch {
      return { input: '[UNREADABLE_OBJECT]', truncated: true };
    }
    for (const [rawKey, child] of entries) {
      if (properties >= MAX_AUDIT_PROPERTIES) {
        truncated = true;
        break;
      }
      properties += 1;
      if (UNSAFE_AUDIT_KEYS.has(rawKey)) {
        truncated = true;
        continue;
      }
      const keyResult = boundedText(rawKey, MAX_KEY_CHARACTERS);
      const key = keyResult.text || '[EMPTY_KEY]';
      truncated = truncated || keyResult.truncated;
      if (isSensitiveKey(rawKey)) {
        output[key] = REDACTED;
        continue;
      }
      const projected = project(child, depth + 1);
      output[key] = projected.input;
      truncated = truncated || projected.truncated;
    }
    if (entries.length > Object.keys(output).length) {
      output._omniflowAuditTruncated = true;
      truncated = true;
    }
    return { input: output, truncated };
  };

  return project(input, 0);
}

export function projectAgentToolAuditInput(input: unknown): AgentToolAuditProjection {
  const inspection = inspectInput(input);
  const projection = projectInput(input);
  let serialized = '';
  try {
    serialized = JSON.stringify(projection.input);
  } catch {
    return {
      complete: false,
      input: { _omniflowAudit: 'Tool 参数无法安全投影' },
      sensitive: inspection.sensitive,
      truncated: true,
    };
  }
  if (serialized.length > MAX_AUDIT_SERIALIZED_CHARACTERS) {
    return {
      complete: inspection.complete,
      input: { _omniflowAudit: 'Tool 参数审计投影超过安全上限' },
      sensitive: inspection.sensitive,
      truncated: true,
    };
  }
  return {
    complete: inspection.complete,
    input: projection.input,
    sensitive: inspection.sensitive,
    truncated: projection.truncated,
  };
}
