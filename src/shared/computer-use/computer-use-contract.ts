export const COMPUTER_ELEMENT_OPERATIONS = Object.freeze([
  'press', 'replaceText', 'insertText',
  'scrollUpPage', 'scrollDownPage', 'scrollLeftPage', 'scrollRightPage',
  'scrollUpStep', 'scrollDownStep', 'scrollLeftStep', 'scrollRightStep',
  'scrollUpFraction', 'scrollDownFraction', 'scrollLeftFraction', 'scrollRightFraction',
] as const);

export type ComputerElementOperation = typeof COMPUTER_ELEMENT_OPERATIONS[number];
export type ComputerTextMode = 'replace' | 'insert';
export type ComputerScrollDirection = 'up' | 'down' | 'left' | 'right';
export type ComputerScrollUnit = 'page' | 'step' | 'fraction';

export const COMPUTER_TEXT_MAX_UNICODE_SCALARS = 4_096;
export const COMPUTER_TEXT_MAX_UTF8_BYTES = 16_384;
const UTF8_ENCODER = new TextEncoder();
const OPERATIONS = new Set<string>(COMPUTER_ELEMENT_OPERATIONS);

export function normalizeComputerElementOperations(input: unknown): ComputerElementOperation[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype
    || input.length < 1 || input.length > COMPUTER_ELEMENT_OPERATIONS.length
    || Object.getOwnPropertySymbols(input).length) {
    throw new Error('应用窗口操作许可无效');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1
    || Array.from({ length: input.length }, (_, index) => descriptors[String(index)]).some(descriptor => (
      !descriptor || !('value' in descriptor) || !descriptor.enumerable
    ))) throw new Error('应用窗口操作许可无效');
  const operations = Array.from({ length: input.length }, (_, index) => descriptors[String(index)].value as unknown);
  if (operations.some(operation => typeof operation !== 'string' || !OPERATIONS.has(operation))
    || new Set(operations).size !== operations.length) throw new Error('应用窗口操作许可无效');
  return operations as ComputerElementOperation[];
}

/** Exact text remains main-only; callers may persist only the returned counts. */
export function validateComputerText(input: unknown, mode: ComputerTextMode): {
  text: string;
  textLength: number;
  textBytes: number;
} {
  if ((mode !== 'replace' && mode !== 'insert') || typeof input !== 'string'
    || input.length > COMPUTER_TEXT_MAX_UNICODE_SCALARS * 2 || (mode === 'insert' && input.length === 0)) {
    throw new Error('应用窗口文字输入无效');
  }
  let textLength = 0;
  for (const character of input) {
    const code = character.charCodeAt(0);
    if (++textLength > COMPUTER_TEXT_MAX_UNICODE_SCALARS
      || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      || (code >= 127 && code <= 159)
      || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
      || (character.length === 1 && code >= 0xd800 && code <= 0xdfff)) {
      throw new Error('应用窗口文字输入无效');
    }
  }
  const textBytes = UTF8_ENCODER.encode(input).byteLength;
  if (textBytes > COMPUTER_TEXT_MAX_UTF8_BYTES) throw new Error('应用窗口文字输入超过上限');
  return { text: input, textLength, textBytes };
}
