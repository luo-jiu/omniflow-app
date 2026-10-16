/** Menu actions are a separate grant; ordinary click/input never implies it. */
export const WINDOW_MENU_OPERATIONS = Object.freeze(['open', 'press', 'cancel'] as const);
export type WindowMenuOperation = typeof WINDOW_MENU_OPERATIONS[number];

export function normalizeWindowMenuOperation(input: unknown): WindowMenuOperation {
  if (typeof input !== 'string' || !WINDOW_MENU_OPERATIONS.includes(input as WindowMenuOperation)) {
    throw new Error('应用窗口菜单操作无效');
  }
  return input as WindowMenuOperation;
}

export function normalizeWindowMenuOperations(input: unknown): WindowMenuOperation[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype
    || input.length < 1 || input.length > WINDOW_MENU_OPERATIONS.length) throw new Error('应用窗口菜单许可无效');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) throw new Error('应用窗口菜单许可无效');
  const values = Array.from({ length: input.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('应用窗口菜单许可无效');
    return normalizeWindowMenuOperation(descriptor.value);
  });
  if (new Set(values).size !== values.length) throw new Error('应用窗口菜单许可无效');
  return values;
}
