export const WINDOW_INPUT_OPERATIONS = Object.freeze(['shortcut', 'rightClick', 'doubleClick', 'drag'] as const);
export type WindowInputOperation = typeof WINDOW_INPUT_OPERATIONS[number];

export const WINDOW_INPUT_MODIFIERS = Object.freeze(['command', 'shift', 'option', 'control'] as const);
export type WindowInputModifier = typeof WINDOW_INPUT_MODIFIERS[number];
export const WINDOW_INPUT_NAMED_KEYS = Object.freeze([
  'space', 'return', 'escape', 'tab', 'backspace', 'delete',
  'arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight', 'pageUp', 'pageDown', 'home', 'end',
] as const);
type LetterKey = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';
type DigitKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type WindowInputKey = LetterKey | DigitKey | typeof WINDOW_INPUT_NAMED_KEYS[number];
export interface WindowInputShortcut { key: WindowInputKey; modifiers: WindowInputModifier[] }
export interface WindowInputPoint { x: number; y: number }

export const WINDOW_INPUT_POINT_MAX = 2_047;
export const WINDOW_INPUT_DRAG_MIN_DURATION_MS = 100;
export const WINDOW_INPUT_DRAG_MAX_DURATION_MS = 1_000;

function strictFields(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('应用窗口输入字段无效');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== fields.length
    || fields.some(field => !descriptors[field] || !descriptors[field].enumerable || !('value' in descriptors[field]))) {
    throw new Error('应用窗口输入字段无效');
  }
  return Object.fromEntries(fields.map(field => [field, descriptors[field].value]));
}

function strictArray(input: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype
    || input.length < minimum || input.length > maximum) throw new Error('应用窗口输入列表无效');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1
    || Array.from({ length: input.length }, (_, index) => descriptors[String(index)]).some(descriptor => (
      !descriptor || !descriptor.enumerable || !('value' in descriptor)
    ))) throw new Error('应用窗口输入列表无效');
  return Array.from({ length: input.length }, (_, index) => descriptors[String(index)].value as unknown);
}

export function normalizeWindowInputOperations(input: unknown): WindowInputOperation[] {
  const values = strictArray(input, WINDOW_INPUT_OPERATIONS.length, 1);
  if (values.some(value => typeof value !== 'string' || !WINDOW_INPUT_OPERATIONS.includes(value as WindowInputOperation))
    || new Set(values).size !== values.length) throw new Error('应用窗口输入许可无效');
  return values as WindowInputOperation[];
}

export function normalizeWindowInputShortcut(input: unknown): WindowInputShortcut {
  const source = strictFields(input, ['key', 'modifiers']);
  if (typeof source.key !== 'string' || !( /^[a-z0-9]$/u.test(source.key)
    || WINDOW_INPUT_NAMED_KEYS.includes(source.key as typeof WINDOW_INPUT_NAMED_KEYS[number]))) {
    throw new Error('应用窗口快捷键无效');
  }
  const modifiers = strictArray(source.modifiers, WINDOW_INPUT_MODIFIERS.length);
  if (modifiers.some(value => typeof value !== 'string' || !WINDOW_INPUT_MODIFIERS.includes(value as WindowInputModifier))) {
    throw new Error('应用窗口快捷键修饰键无效');
  }
  if (/^[a-z0-9]$/u.test(source.key) && !modifiers.includes('command') && !modifiers.includes('control')) {
    throw new Error('字母或数字快捷键必须包含 Command 或 Control；文字正文需使用受控文本输入');
  }
  return { key: source.key as WindowInputKey, modifiers: WINDOW_INPUT_MODIFIERS.filter(modifier => modifiers.includes(modifier)) };
}

export function normalizeWindowInputPoint(input: unknown): WindowInputPoint {
  const source = strictFields(input, ['x', 'y']);
  if (['x', 'y'].some(field => typeof source[field] !== 'number' || !Number.isSafeInteger(source[field])
    || Number(source[field]) < 0 || Number(source[field]) > WINDOW_INPUT_POINT_MAX)) throw new Error('应用窗口输入坐标无效');
  return { x: source.x as number, y: source.y as number };
}
