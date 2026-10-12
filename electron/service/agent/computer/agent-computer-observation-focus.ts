const FOCUS_FIELDS = new Set(['observationId', 'elementId', 'ancestorLevels']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export interface ComputerObservationFocus {
  observationId: string;
  elementId: string;
  ancestorLevels: number;
}

/** Only issued IDs locate a region; native paths and arbitrary selectors stay private. */
export function normalizeObservationFocus(input: unknown): ComputerObservationFocus {
  const invalid = () => new Error('局部 AX 观察参数无效');
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
  const values: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !FOCUS_FIELDS.has(key)) throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) throw invalid();
    values[key] = descriptor.value;
  }
  if (typeof values.observationId !== 'string' || !UUID.test(values.observationId)
    || typeof values.elementId !== 'string' || !UUID.test(values.elementId)) throw invalid();
  const ancestorLevels = Object.prototype.hasOwnProperty.call(values, 'ancestorLevels') ? values.ancestorLevels : 0;
  if (typeof ancestorLevels !== 'number' || !Number.isSafeInteger(ancestorLevels)
    || ancestorLevels < 0 || ancestorLevels > 3) throw invalid();
  return { observationId: values.observationId, elementId: values.elementId, ancestorLevels };
}
