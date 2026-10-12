import { COMPUTER_ELEMENT_OPERATIONS, type ComputerElementOperation } from '../../../../src/shared/computer-use/computer-use-contract';

const QUERY_FIELDS = new Set(['query', 'role', 'operation', 'offset', 'limit']);
const OPERATIONS = new Set<string>(COMPUTER_ELEMENT_OPERATIONS);
const MAX_PAGE_SIZE = 128;
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export interface ComputerObservationQuery {
  query?: string;
  role?: string;
  operation?: ComputerElementOperation;
  offset: number;
  limit: number;
}

export interface ComputerObservationElement {
  elementId: string;
  role: string;
  label: string;
  description?: string;
  operations: readonly ComputerElementOperation[];
}

function invalidQuery(): Error {
  return new Error('应用窗口控件查询无效');
}

function queryText(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > maximumLength) throw invalidQuery();
  return value;
}

function pageNumber(value: unknown, minimum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > MAX_PAGE_SIZE) throw invalidQuery();
  return value;
}

/** Accepts query fields only, never the containing observe input or an AX path. */
export function normalizeObservationQuery(input: unknown): ComputerObservationQuery {
  if (input === undefined) return { offset: 0, limit: 32 };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalidQuery();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !QUERY_FIELDS.has(key))) throw invalidQuery();
  const values: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor) || !descriptor.enumerable) throw invalidQuery();
    values[key] = descriptor.value;
  }
  const query = own(values, 'query') ? queryText(values.query, 200) : undefined;
  const role = own(values, 'role') ? queryText(values.role, 80) : undefined;
  const operation = own(values, 'operation') ? values.operation : undefined;
  if (own(values, 'operation') && (typeof operation !== 'string' || !OPERATIONS.has(operation))) throw invalidQuery();
  if (own(values, 'offset') && values.offset === undefined
    || own(values, 'limit') && values.limit === undefined) throw invalidQuery();
  return {
    ...(query === undefined ? {} : { query }),
    ...(role === undefined ? {} : { role }),
    ...(operation === undefined ? {} : { operation: operation as ComputerElementOperation }),
    offset: pageNumber(values.offset, 0, 0),
    limit: pageNumber(values.limit, 1, 32),
  };
}

/** Filters already confirmed public records; it neither scans nor grants capabilities. */
export function projectObservationElements<T extends ComputerObservationElement>(
  elements: readonly T[],
  query: ComputerObservationQuery,
): { elements: T[]; totalMatched: number; offset: number; limit: number; hasMore: boolean; searchScope: 'observed-controls' } {
  const normalized = normalizeObservationQuery(query);
  const term = normalized.query?.toLowerCase();
  const matching = elements.filter(element => (
    (term === undefined || element.label.toLowerCase().includes(term) || element.description?.toLowerCase().includes(term))
    && (normalized.role === undefined || element.role === normalized.role)
    && (normalized.operation === undefined || element.operations.includes(normalized.operation))
  ));
  return {
    elements: matching.slice(normalized.offset, normalized.offset + normalized.limit),
    totalMatched: matching.length,
    offset: normalized.offset,
    limit: normalized.limit,
    hasMore: normalized.offset + normalized.limit < matching.length,
    searchScope: 'observed-controls',
  };
}

export interface ComputerObservationDiffValue {
  role: string;
  label: string;
  operations: readonly ComputerElementOperation[];
  description?: string;
  subrole?: string;
  source?: string;
  labelSource?: string;
  screenshotBounds?: { x: number; y: number; width: number; height: number };
}

export interface ComputerObservationDiffEntry {
  /** Main-only stable identity. It is never included in the returned changes. */
  key: string;
  value: ComputerObservationDiffValue;
}

function diffValue(value: ComputerObservationDiffValue): ComputerObservationDiffValue {
  // Explicit projection excludes random elementId and any accidental private fields.
  return {
    role: value.role, label: value.label, operations: [...value.operations],
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.subrole === undefined ? {} : { subrole: value.subrole }),
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.labelSource === undefined ? {} : { labelSource: value.labelSource }),
    ...(value.screenshotBounds === undefined ? {} : { screenshotBounds: {
      x: value.screenshotBounds.x, y: value.screenshotBounds.y,
      width: value.screenshotBounds.width, height: value.screenshotBounds.height,
    } }),
  };
}

function diffEntries(entries: readonly ComputerObservationDiffEntry[]): Map<string, ComputerObservationDiffValue> {
  const map = new Map<string, ComputerObservationDiffValue>();
  for (const entry of entries) {
    if (typeof entry.key !== 'string' || !entry.key || map.has(entry.key)) throw new Error('应用窗口观察差异身份无效');
    map.set(entry.key, diffValue(entry.value));
  }
  return map;
}

/** Describes membership in two bounded observations, never absence from the full AX tree. */
export function getObservationChanges(
  previous: readonly ComputerObservationDiffEntry[],
  current: readonly ComputerObservationDiffEntry[],
  limit = 32,
): {
  added: ComputerObservationDiffValue[];
  removed: ComputerObservationDiffValue[];
  changed: Array<{ before: ComputerObservationDiffValue; after: ComputerObservationDiffValue }>;
  totalAdded: number; totalRemoved: number; totalChanged: number; hasMore: boolean; searchScope: 'observed-controls';
} {
  const maximum = pageNumber(limit, 1, 32);
  const before = diffEntries(previous);
  const after = diffEntries(current);
  const added: ComputerObservationDiffValue[] = [];
  const removed: ComputerObservationDiffValue[] = [];
  const changed: Array<{ before: ComputerObservationDiffValue; after: ComputerObservationDiffValue }> = [];
  for (const [key, value] of after) {
    const oldValue = before.get(key);
    if (oldValue === undefined) added.push(value);
    else if (JSON.stringify(oldValue) !== JSON.stringify(value)) changed.push({ before: oldValue, after: value });
  }
  for (const [key, value] of before) if (!after.has(key)) removed.push(value);
  const retainedAdded = added.slice(0, maximum);
  const retainedRemoved = removed.slice(0, maximum - retainedAdded.length);
  const retainedChanged = changed.slice(0, maximum - retainedAdded.length - retainedRemoved.length);
  return {
    added: retainedAdded, removed: retainedRemoved, changed: retainedChanged,
    totalAdded: added.length, totalRemoved: removed.length, totalChanged: changed.length,
    hasMore: added.length + removed.length + changed.length > maximum,
    searchScope: 'observed-controls',
  };
}
