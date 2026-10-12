import { normalizeComputerElementOperations, validateComputerText, type ComputerElementOperation } from './computer-use-contract';

/** Fixed first-party controls only. These references never identify AX or DOM nodes. */
export const FIRST_PARTY_CONTROL_LABELS = Object.freeze({
  'agent-composer': 'Agent 输入',
  'agent-conversation': 'Agent 对话区域',
});
export type FirstPartyControlId = keyof typeof FIRST_PARTY_CONTROL_LABELS;
export interface FirstPartyControlContext {
  ownerScope: { accountScope: string; backendScope: string };
  libraryId: number;
  sessionId: string;
}
export interface FirstPartyRegistrationInput {
  instanceId: string;
  context: FirstPartyControlContext;
}
export interface FirstPartyRegistrationToken {
  registrationId: string;
  documentGeneration: string;
}
export interface FirstPartyControlRect { x: number; y: number; width: number; height: number }
export interface FirstPartyControlSnapshot {
  controlId: FirstPartyControlId;
  instanceId: string;
  revision: number;
  bounds: FirstPartyControlRect;
  operations: ComputerElementOperation[];
  state: { kind: 'text'; selectionStart: number; selectionEnd: number; textLength: number }
    | { kind: 'scroll'; top: number; clientHeight: number; scrollHeight: number };
}
export interface FirstPartyControlObservation extends FirstPartyRegistrationToken {
  controls: FirstPartyControlSnapshot[];
}
export interface FirstPartyBoundControl extends FirstPartyRegistrationToken {
  snapshot: FirstPartyControlSnapshot;
  /** Screen points, mapped by main from the trusted owner's content geometry. */
  bounds: FirstPartyControlRect;
}
export type FirstPartyControlRequest = FirstPartyRegistrationToken & {
  requestId: string;
  context: FirstPartyControlContext;
  runId: string;
  expiresAt: number;
} & ({ kind: 'observe' } | {
  kind: 'verify' | 'dispatch';
  snapshot: FirstPartyControlSnapshot;
  operation: ComputerElementOperation;
  text?: string;
});
export type FirstPartyControlResponse = FirstPartyRegistrationToken & {
  requestId: string;
} & ({ status: 'observed'; controls: FirstPartyControlSnapshot[] }
  | { status: 'verified' | 'applied' | 'rejected' | 'unknown' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function fields(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('第一方控件协议无效');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
    || ![...required, ...optional].includes(key) || !descriptors[key].enumerable || !('value' in descriptors[key]))) {
    throw new Error('第一方控件协议字段无效');
  }
  return Object.fromEntries(keys.map(key => [key, descriptors[key as string].value]));
}
function uuid(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new Error('第一方控件引用无效');
  return input;
}
function number(input: unknown, positive = false): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < (positive ? 1 : 0) || input > 16_777_216) {
    throw new Error('第一方控件几何或状态无效');
  }
  return input;
}
function integer(input: unknown, positive = false): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < (positive ? 1 : 0)) throw new Error('第一方控件版本无效');
  return input;
}
export function normalizeFirstPartyControlContext(input: unknown): FirstPartyControlContext {
  const data = fields(input, ['ownerScope', 'libraryId', 'sessionId']);
  const owner = fields(data.ownerScope, ['accountScope', 'backendScope']);
  for (const value of Object.values(owner)) {
    if (typeof value !== 'string' || !value || value.length > 512
      || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('第一方控件归属无效');
  }
  return { ownerScope: owner as unknown as FirstPartyControlContext['ownerScope'], libraryId: integer(data.libraryId, true), sessionId: uuid(data.sessionId) };
}
export function normalizeFirstPartyRegistration(input: unknown): FirstPartyRegistrationInput {
  const data = fields(input, ['instanceId', 'context']);
  return { instanceId: uuid(data.instanceId), context: normalizeFirstPartyControlContext(data.context) };
}
export function normalizeFirstPartyRegistrationToken(input: unknown): FirstPartyRegistrationToken {
  const data = fields(input, ['registrationId', 'documentGeneration']);
  return { registrationId: uuid(data.registrationId), documentGeneration: uuid(data.documentGeneration) };
}
export function normalizeFirstPartyControlSnapshot(input: unknown): FirstPartyControlSnapshot {
  const data = fields(input, ['controlId', 'instanceId', 'revision', 'bounds', 'operations', 'state']);
  if (data.controlId !== 'agent-composer' && data.controlId !== 'agent-conversation') throw new Error('第一方控件未注册');
  const rect = fields(data.bounds, ['x', 'y', 'width', 'height']);
  const bounds = { x: number(rect.x), y: number(rect.y), width: number(rect.width, true), height: number(rect.height, true) };
  const operations = normalizeComputerElementOperations(data.operations);
  let state: FirstPartyControlSnapshot['state'];
  if (data.controlId === 'agent-composer') {
    const text = fields(data.state, ['kind', 'selectionStart', 'selectionEnd', 'textLength']);
    if (text.kind !== 'text' || operations.some(operation => operation !== 'replaceText' && operation !== 'insertText')) throw new Error('第一方文本能力无效');
    state = { kind: 'text', selectionStart: integer(text.selectionStart), selectionEnd: integer(text.selectionEnd), textLength: integer(text.textLength) };
    if (state.textLength > 128_000 || state.selectionStart > state.selectionEnd || state.selectionEnd > state.textLength
      || (operations.includes('insertText') && (state.selectionStart !== state.textLength || state.selectionEnd !== state.textLength))) {
      throw new Error('第一方文本选区无效');
    }
  } else {
    const scroll = fields(data.state, ['kind', 'top', 'clientHeight', 'scrollHeight']);
    if (scroll.kind !== 'scroll' || operations.some(operation => !['scrollUpPage', 'scrollDownPage', 'scrollUpStep', 'scrollDownStep', 'scrollUpFraction', 'scrollDownFraction'].includes(operation))) throw new Error('第一方滚动能力无效');
    state = { kind: 'scroll', top: number(scroll.top), clientHeight: number(scroll.clientHeight, true), scrollHeight: number(scroll.scrollHeight, true) };
    if (state.scrollHeight <= state.clientHeight || state.top > state.scrollHeight - state.clientHeight + 1) throw new Error('第一方滚动范围无效');
  }
  return { controlId: data.controlId, instanceId: uuid(data.instanceId), revision: integer(data.revision, true), bounds, operations, state };
}
export function normalizeFirstPartyControlSnapshots(input: unknown): FirstPartyControlSnapshot[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > 2) throw new Error('第一方控件列表无效');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1
    || Array.from({ length: input.length }, (_, index) => descriptors[String(index)]).some(descriptor => (
      !descriptor || !('value' in descriptor) || !descriptor.enumerable
    ))) throw new Error('第一方控件列表无效');
  const controls = Array.from({ length: input.length }, (_, index) => normalizeFirstPartyControlSnapshot(descriptors[String(index)].value));
  if (new Set(controls.map(control => control.controlId)).size !== controls.length) throw new Error('第一方控件重复');
  return controls;
}
export function normalizeFirstPartyControlRequest(input: unknown): FirstPartyControlRequest {
  const data = fields(input, ['requestId', 'registrationId', 'documentGeneration', 'context', 'runId', 'expiresAt', 'kind'], ['snapshot', 'operation', 'text']);
  const base = { requestId: uuid(data.requestId), registrationId: uuid(data.registrationId), documentGeneration: uuid(data.documentGeneration),
    context: normalizeFirstPartyControlContext(data.context), runId: uuid(data.runId), expiresAt: integer(data.expiresAt, true) };
  if (data.kind === 'observe') {
    if ('snapshot' in data || 'operation' in data || 'text' in data) throw new Error('第一方观察不能含操作');
    return { ...base, kind: 'observe' };
  }
  if (data.kind !== 'verify' && data.kind !== 'dispatch') throw new Error('第一方控件请求类型无效');
  const snapshot = normalizeFirstPartyControlSnapshot(data.snapshot);
  const [operation] = normalizeComputerElementOperations([data.operation]);
  if (!snapshot.operations.includes(operation)) throw new Error('第一方控件未声明该操作');
  const text = operation === 'replaceText' || operation === 'insertText';
  if (data.kind === 'verify' && 'text' in data || !text && 'text' in data) throw new Error('第一方控件正文无效');
  return { ...base, kind: data.kind, snapshot, operation,
    ...(text && data.kind === 'dispatch' ? { text: validateComputerText(data.text, operation === 'replaceText' ? 'replace' : 'insert').text } : {}) };
}
export function normalizeFirstPartyControlResponse(input: unknown): FirstPartyControlResponse {
  const data = fields(input, ['requestId', 'registrationId', 'documentGeneration', 'status'], ['controls']);
  const base = { requestId: uuid(data.requestId), registrationId: uuid(data.registrationId), documentGeneration: uuid(data.documentGeneration) };
  if (data.status === 'observed') return { ...base, status: 'observed', controls: normalizeFirstPartyControlSnapshots(data.controls) };
  if (!['verified', 'applied', 'rejected', 'unknown'].includes(data.status as string) || 'controls' in data) throw new Error('第一方控件回执无效');
  return { ...base, status: data.status as 'verified' | 'applied' | 'rejected' | 'unknown' };
}
