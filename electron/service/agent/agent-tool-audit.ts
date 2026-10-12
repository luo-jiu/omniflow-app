import {
  containsAgentSensitiveData,
  isAgentSensitiveFieldName,
  sanitizeAgentSensitiveText,
} from './agent-sensitive-data';
import type { AgentActionPreview, AgentComputerSetTextPreparedActionPublicV1, AgentToolResult } from '../../../src/shared/agent/agent.types';
import { COMPUTER_TEXT_MAX_UNICODE_SCALARS, COMPUTER_TEXT_MAX_UTF8_BYTES,
  validateComputerText } from '../../../src/shared/computer-use/computer-use-contract';
import { toAgentProviderToolName } from './agent-provider-tool-name';

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
const COMPUTER_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

interface AgentToolAuditSource {
  name: string;
  registrationId: string;
  executor?: 'main' | 'renderer';
  kind?: 'business' | 'control';
  risk: string;
  pluginSource?: unknown;
  pluginOperation?: unknown;
  prepareMain?: unknown;
}

export function isBuiltinComputerSetTextTool(source?: AgentToolAuditSource | null): boolean {
  return source?.name === 'computer.setText' && source.registrationId === 'builtin:computer.setText@1'
    && source.executor === 'main' && source.kind === 'business' && source.risk === 'write'
    && !source.pluginSource && !source.pluginOperation && typeof source.prepareMain === 'function';
}

/** Legacy privacy defense only; names do not establish builtin identity or execution authority. */
export function isAgentComputerTextLegacyAuditName(name?: string): boolean {
  return name === 'computer.setText' || name === toAgentProviderToolName('computer.setText');
}

export type AgentComputerTextAuditSourceResolver = (name: string) => AgentToolAuditSource | null;

/** Capture privacy identity before model filtering; this resolver grants no execution authority. */
export function createAgentComputerTextAuditSourceResolver(snapshot: {
  get: (name: string) => AgentToolAuditSource | null;
}): AgentComputerTextAuditSourceResolver {
  const registered = snapshot.get('computer.setText');
  if (!registered || !isBuiltinComputerSetTextTool(registered)) return () => null;
  const source: AgentToolAuditSource = Object.freeze({
    name: registered.name,
    registrationId: registered.registrationId,
    executor: registered.executor,
    kind: registered.kind,
    risk: registered.risk,
    prepareMain: registered.prepareMain,
  });
  const providerName = toAgentProviderToolName(source.name);
  const providerAliasAvailable = !snapshot.get(providerName);
  return name => (name === source.name || (providerAliasAvailable && name === providerName)) ? source : null;
}

/** Also protects legacy renderer snapshots; this projection grants no execution authority. */
export function projectAgentComputerTextInput(input: unknown): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || !isPlainRecord(input)) return output;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const read = (key: string): unknown => descriptors[key] && 'value' in descriptors[key] ? descriptors[key].value : undefined;
  for (const key of ['observationId', 'elementId']) {
    const value = read(key);
    if (typeof value === 'string' && COMPUTER_ID_PATTERN.test(value)) output[key] = value;
  }
  const mode = read('mode');
  if (mode !== 'replace' && mode !== 'insert') return output;
  output.mode = mode;
  if (Object.prototype.hasOwnProperty.call(descriptors, 'text')) {
    try {
      const { textLength, textBytes } = validateComputerText(read('text'), mode);
      Object.assign(output, { textLength, textBytes });
    } catch { /* Invalid text is never echoed into a denied audit. */ }
  } else {
    const textLength = read('textLength'), textBytes = read('textBytes');
    if (typeof textLength === 'number' && Number.isSafeInteger(textLength) && textLength >= 0 && textLength <= COMPUTER_TEXT_MAX_UNICODE_SCALARS
      && typeof textBytes === 'number' && Number.isSafeInteger(textBytes) && textBytes >= textLength
      && textBytes <= textLength * 4 && textBytes <= COMPUTER_TEXT_MAX_UTF8_BYTES && (mode === 'replace' || textLength > 0)) {
      Object.assign(output, { textLength, textBytes });
    }
  }
  return output;
}

export function projectAgentComputerTextPreview(action?: AgentComputerSetTextPreparedActionPublicV1): AgentActionPreview {
  return { title: '输入窗口文字', risk: 'write', description: action
    ? `${action.mode === 'replace' ? '替换' : '插入'} ${action.textLength} 个字符，${action.textBytes} 字节；操作后重新查看窗口。`
    : '文字正文不进入会话审计；操作后重新查看窗口。',
  ...(action ? { details: [{ label: '应用', value: action.applicationLabel }, { label: '窗口', value: action.windowLabel }] } : {}) };
}

export function projectAgentComputerTextResult(result: AgentToolResult, action?: AgentComputerSetTextPreparedActionPublicV1): AgentToolResult {
  const source = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? result.data as Record<string, unknown> : {};
  const state = source.dispatchState;
  const validState = state === 'dispatched' || state === 'not-dispatched' || state === 'unknown';
  const commitState = state === 'dispatched' ? 'committed' : state === 'not-dispatched' ? 'uncommitted' : 'commit_unknown';
  const receipt = action && validState && source.operation === 'computer.setText'
    && result.ok === (state === 'dispatched')
    && typeof source.operationId === 'string' && COMPUTER_ID_PATTERN.test(source.operationId)
    && source.mutationCommitState === commitState && source.nextAction === 'observe' && source.retryAllowed === false
    && (['libraryId', 'targetId', 'applicationLabel', 'windowLabel', 'observationId', 'elementId', 'mode', 'textLength', 'textBytes'] as const)
      .every(key => source[key] === action[key]);
  const mutationMarker = Object.keys(source).some(key => ['dispatchState', 'mutationCommitState', 'operation', 'operationId'].includes(key));
  const safeDenial = !result.ok && !mutationMarker && ['Agent Tool 参数包含不能进入会话的敏感凭据', 'Agent Tool 参数超过安全审计上限',
    '文字输入参数无效', '文字输入准备失败，请重新查看窗口'].includes(result.message || '') ? result.message : undefined;
  const unknown = !receipt && (result.ok || mutationMarker);
  return { ok: receipt ? result.ok : false, message: receipt && state === 'dispatched' ? '已发送文字输入'
    : unknown || (receipt && state === 'unknown') ? '文字输入结果未知，请先查看窗口，勿重复输入'
    : safeDenial || '文字输入未发送，请重新查看窗口',
  ...(receipt ? { data: { libraryId: action.libraryId, targetId: action.targetId, applicationLabel: action.applicationLabel,
    windowLabel: action.windowLabel, observationId: action.observationId, elementId: action.elementId, mode: action.mode,
    textLength: action.textLength, textBytes: action.textBytes, operation: 'computer.setText', operationId: source.operationId,
    dispatchState: state, mutationCommitState: commitState, nextAction: 'observe', retryAllowed: false,
    ...(source.inputMethod === 'omniflow-control' ? { inputMethod: 'omniflow-control' } : {}) } }
    : unknown ? { data: { operation: 'computer.setText', dispatchState: 'unknown', mutationCommitState: 'commit_unknown',
      nextAction: 'observe', retryAllowed: false } } : {}) };
}

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

export function projectAgentToolAuditInput(input: unknown, source?: AgentToolAuditSource | null): AgentToolAuditProjection {
  const inspection = inspectInput(input);
  const projection = isBuiltinComputerSetTextTool(source)
    ? { input: projectAgentComputerTextInput(input), truncated: false }
    : projectInput(input);
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
