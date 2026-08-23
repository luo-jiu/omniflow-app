import type {
  AgentInteractionField,
  AgentInteractionOption,
  AgentInteractionRequest,
  AgentInteractionResponse,
  AgentInteractionValue,
} from '@/shared/agent/agent.types';
import {
  containsAgentSensitiveData,
  isAgentSensitiveFieldName,
} from './agent-sensitive-data';

const INTERACTION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_FIELDS = 20;
const MAX_OPTIONS = 30;
const MAX_PROMPT_LENGTH = 1_000;
const MAX_RESPONSE_TEXT_LENGTH = 4_000;
const MAX_INSPECTED_INPUT_DEPTH = 8;
const MAX_INSPECTED_INPUT_NODES = 512;
const SENSITIVE_INTERACTION_MESSAGE = '交互请求不能索取 API Key、密码、Cookie、令牌、私钥或其他凭据';

const SENSITIVE_INTERACTION_TERM_PATTERN = /(?:api\s*[-_.]?\s*key|password|passwd|passphrase|private\s*[-_.]?\s*key|client\s*[-_.]?\s*secret|secret\s*[-_.]?\s*access\s*[-_.]?\s*key|authorization|credential|cookie|密码|口令|密钥|私钥|令牌|凭据)/iu;
const SENSITIVE_TOKEN_REQUEST_PATTERN = /(?:access|refresh|identity|id|auth|bearer|session|oauth)\s*[-_.]?\s*token/iu;

export class AgentSensitiveInteractionRequestError extends Error {
  readonly code = 'AGENT_INTERACTION_SECRET_REQUEST';

  constructor() {
    super(SENSITIVE_INTERACTION_MESSAGE);
    this.name = 'AgentSensitiveInteractionRequestError';
  }
}

export function isAgentSensitiveInteractionRequestError(
  error: unknown,
): error is AgentSensitiveInteractionRequestError {
  return error instanceof AgentSensitiveInteractionRequestError;
}

function hasSensitiveInteractionTerm(value: string): boolean {
  const normalized = String(value || '').normalize('NFKC');
  const compact = normalized.replace(/[\s._\-:/\\|]+/g, '');
  return SENSITIVE_INTERACTION_TERM_PATTERN.test(normalized)
    || SENSITIVE_INTERACTION_TERM_PATTERN.test(compact)
    || SENSITIVE_TOKEN_REQUEST_PATTERN.test(normalized)
    || SENSITIVE_TOKEN_REQUEST_PATTERN.test(compact)
    || isAgentSensitiveFieldName(normalized);
}

function assertInteractionInputDoesNotRequestSecrets(input: unknown): void {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: input }];
  const seen = new WeakSet<object>();
  let inspectedNodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    inspectedNodes += 1;
    if (inspectedNodes > MAX_INSPECTED_INPUT_NODES || current.depth > MAX_INSPECTED_INPUT_DEPTH) {
      throw new Error('交互请求结构过于复杂');
    }
    if (typeof current.value === 'string') {
      if (
        containsAgentSensitiveData(current.value)
        || hasSensitiveInteractionTerm(current.value)
      ) {
        throw new AgentSensitiveInteractionRequestError();
      }
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) throw new Error('交互请求不能包含循环引用');
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      current.value.forEach(value => pending.push({ depth: current.depth + 1, value }));
      continue;
    }
    Object.entries(current.value as Record<string, unknown>).forEach(([key, value]) => {
      if (isAgentSensitiveFieldName(key) || hasSensitiveInteractionTerm(key)) {
        throw new AgentSensitiveInteractionRequestError();
      }
      pending.push({ depth: current.depth + 1, value });
    });
  }
}

function assertAllowedKeys(
  source: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(source).find(key => !allowed.has(key));
  if (unknownKey) throw new Error(`${label}包含不允许的字段：${unknownKey}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}过长`);
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredText(value, label, maxLength);
}

function normalizedId(value: unknown, label: string): string {
  const id = String(value || '').trim();
  if (!INTERACTION_ID_PATTERN.test(id)) {
    throw new Error(`${label}只能包含字母、数字、点、下划线和短横线，且不超过 64 个字符`);
  }
  return id;
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  if (new Set(items.map(item => item.id)).size !== items.length) {
    throw new Error(`${label} ID 不能重复`);
  }
}

function normalizeOption(
  value: unknown,
  label: string,
  allowDescription = true,
): AgentInteractionOption {
  const source = asRecord(value);
  if (!source) throw new Error(`${label}格式无效`);
  assertAllowedKeys(
    source,
    allowDescription ? ['description', 'id', 'label'] : ['id', 'label'],
    label,
  );
  const description = allowDescription
    ? optionalText(source.description, `${label}说明`, 500)
    : undefined;
  return {
    ...(description ? { description } : {}),
    id: normalizedId(source.id, `${label} ID`),
    label: requiredText(source.label, `${label}名称`, 160),
  };
}

function normalizeField(value: unknown, index: number): AgentInteractionField {
  const source = asRecord(value);
  const label = `第 ${index + 1} 个字段`;
  if (!source) throw new Error(`${label}格式无效`);
  assertAllowedKeys(
    source,
    ['id', 'label', 'placeholder', 'required', 'type', 'values'],
    label,
  );
  const type = source.type === 'text'
    || source.type === 'number'
    || source.type === 'boolean'
    || source.type === 'select'
    ? source.type
    : null;
  if (!type) throw new Error(`${label}类型无效`);

  let values: Array<{ id: string; label: string }> | undefined;
  if (type === 'select') {
    if (!Array.isArray(source.values) || source.values.length < 1 || source.values.length > MAX_OPTIONS) {
      throw new Error(`${label}必须提供 1-${MAX_OPTIONS} 个可选值`);
    }
    values = source.values.map((item, valueIndex) => {
      const normalized = normalizeOption(
        item,
        `${label}的第 ${valueIndex + 1} 个可选值`,
        false,
      );
      return { id: normalized.id, label: normalized.label };
    });
    assertUniqueIds(values, `${label}的可选值`);
  } else if (source.values !== undefined) {
    throw new Error(`${label}不是选择类型，不能提供可选值`);
  }

  const placeholder = optionalText(source.placeholder, `${label}占位内容`, 240);
  return {
    id: normalizedId(source.id, `${label} ID`),
    label: requiredText(source.label, `${label}名称`, 160),
    ...(placeholder ? { placeholder } : {}),
    ...(source.required === true ? { required: true } : {}),
    type,
    ...(values ? { values } : {}),
  };
}

export function normalizeAgentInteractionRequest(input: unknown): AgentInteractionRequest {
  assertInteractionInputDoesNotRequestSecrets(input);
  const source = asRecord(input);
  if (!source) throw new Error('交互请求格式无效');
  const kind = source.kind === 'choice' || source.kind === 'form' ? source.kind : null;
  if (!kind) throw new Error('交互请求类型无效');
  assertAllowedKeys(
    source,
    kind === 'choice'
      ? ['kind', 'multiple', 'options', 'prompt', 'submitLabel', 'title']
      : ['fields', 'kind', 'prompt', 'submitLabel', 'title'],
    '交互请求',
  );
  const prompt = requiredText(source.prompt, '交互问题', MAX_PROMPT_LENGTH);
  const title = optionalText(source.title, '交互标题', 160);
  const submitLabel = optionalText(source.submitLabel, '提交按钮名称', 40);

  if (kind === 'choice') {
    if (!Array.isArray(source.options) || source.options.length < 2 || source.options.length > MAX_OPTIONS) {
      throw new Error(`选择交互必须提供 2-${MAX_OPTIONS} 个选项`);
    }
    const options = source.options.map((option, index) => normalizeOption(option, `第 ${index + 1} 个选项`));
    assertUniqueIds(options, '选择项');
    return {
      kind,
      ...(source.multiple === true ? { multiple: true } : {}),
      options,
      prompt,
      ...(submitLabel ? { submitLabel } : {}),
      ...(title ? { title } : {}),
    };
  }

  if (!Array.isArray(source.fields) || source.fields.length < 1 || source.fields.length > MAX_FIELDS) {
    throw new Error(`表单交互必须提供 1-${MAX_FIELDS} 个字段`);
  }
  const fields = source.fields.map(normalizeField);
  assertUniqueIds(fields, '表单字段');
  return {
    fields,
    kind,
    prompt,
    ...(submitLabel ? { submitLabel } : {}),
    ...(title ? { title } : {}),
  };
}

function normalizeFormValue(field: AgentInteractionField, value: unknown): AgentInteractionValue {
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${field.label}必须是开关值`);
    return value;
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${field.label}必须是有效数字`);
    }
    return value;
  }
  if (typeof value !== 'string') throw new Error(`${field.label}必须是文字`);
  if (value.length > MAX_RESPONSE_TEXT_LENGTH) throw new Error(`${field.label}内容过长`);
  if (containsAgentSensitiveData(value)) {
    throw new Error('交互回答不能包含 API Key、密码、Cookie、令牌、私钥或其他凭据');
  }
  if (field.type === 'select' && !field.values?.some(option => option.id === value)) {
    throw new Error(`${field.label}选择值无效`);
  }
  if (field.required && !value.trim()) throw new Error(`${field.label}不能为空`);
  return value;
}

export function normalizeAgentInteractionResponse(
  request: AgentInteractionRequest,
  input: unknown,
): AgentInteractionResponse {
  const source = asRecord(input);
  if (!source || source.kind !== request.kind) throw new Error('交互回答类型不匹配');

  if (request.kind === 'choice') {
    assertAllowedKeys(source, ['kind', 'selectedOptionIds'], '交互回答');
    if (!Array.isArray(source.selectedOptionIds)) throw new Error('请选择至少一个选项');
    const selectedOptionIds = Array.from(new Set(source.selectedOptionIds.map(value => String(value || '').trim())));
    if (selectedOptionIds.length < 1) throw new Error('请选择至少一个选项');
    if (!request.multiple && selectedOptionIds.length !== 1) throw new Error('当前问题只能选择一个选项');
    const validIds = new Set(request.options.map(option => option.id));
    if (selectedOptionIds.some(id => !validIds.has(id))) throw new Error('选择项无效');
    return { kind: 'choice', selectedOptionIds };
  }

  assertAllowedKeys(source, ['kind', 'values'], '交互回答');
  const inputValues = asRecord(source.values);
  if (!inputValues) throw new Error('表单回答格式无效');
  const fieldsById = new Map(request.fields.map(field => [field.id, field]));
  if (Object.keys(inputValues).some(id => !fieldsById.has(id))) {
    throw new Error('表单包含未知字段');
  }
  const entries: Array<[string, AgentInteractionValue]> = [];
  request.fields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(inputValues, field.id)) {
      if (field.required) throw new Error(`${field.label}不能为空`);
      return;
    }
    entries.push([field.id, normalizeFormValue(field, inputValues[field.id])]);
  });
  return { kind: 'form', values: Object.fromEntries(entries) };
}
