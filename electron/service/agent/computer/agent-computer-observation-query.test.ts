import { describe, expect, it } from 'vitest';
import { getObservationChanges, normalizeObservationQuery, projectObservationElements,
  type ComputerObservationDiffEntry, type ComputerObservationElement } from './agent-computer-observation-query';

function element(index: number, overrides: Partial<ComputerObservationElement> = {}): ComputerObservationElement {
  return { elementId: `reference-${index}`, role: 'AXButton', label: `Button ${index}`, operations: ['press'], ...overrides };
}

describe('computer observation query', () => {
  it('uses bounded defaults and accepts exact query limits with Unicode', () => {
    expect(normalizeObservationQuery(undefined)).toEqual({ offset: 0, limit: 32 });
    expect(normalizeObservationQuery({})).toEqual({ offset: 0, limit: 32 });
    expect(normalizeObservationQuery({ query: '😀'.repeat(200), role: 'AXButton', operation: 'press', offset: 128, limit: 128 }))
      .toEqual({ query: '😀'.repeat(200), role: 'AXButton', operation: 'press', offset: 128, limit: 128 });
  });

  it.each([
    null, [], 'button', 1, true, { query: '' }, { query: ' ' }, { query: 12 }, { query: 'a'.repeat(201) },
    { query: undefined }, { role: '' }, { role: 'a'.repeat(81) }, { role: null }, { role: undefined },
    { operation: 'constructor' }, { operation: 'click' }, { operation: 1 }, { operation: undefined },
    { offset: -1 }, { offset: 129 }, { offset: 0.5 }, { offset: '1' }, { offset: NaN }, { offset: undefined },
    { limit: 0 }, { limit: 129 }, { limit: Infinity }, { limit: '32' }, { limit: undefined },
    { windowRef: 'unapproved' }, { path: [0, 1] }, new Date(),
  ])('rejects invalid or unrelated query input: %j', input => {
    expect(() => normalizeObservationQuery(input)).toThrow('控件查询无效');
  });

  it('rejects inherited properties, symbol fields and accessors without invoking them', () => {
    let reads = 0;
    expect(() => normalizeObservationQuery(Object.create({ query: 'Button' }))).toThrow();
    expect(() => normalizeObservationQuery({ [Symbol('query')]: 'Button' })).toThrow();
    expect(() => normalizeObservationQuery(Object.defineProperty({}, 'query', {
      enumerable: true, get: () => { reads += 1; return 'Button'; },
    }))).toThrow();
    expect(reads).toBe(0);
    expect(() => normalizeObservationQuery(Object.defineProperty({}, 'query', { value: 'Button' }))).toThrow();
  });

  it('combines case-insensitive public text matching, exact role and declared operation', () => {
    const records = [
      element(1, { label: 'Save', description: 'Document ACTION' }),
      element(2, { label: 'Save', role: 'AXTextArea', operations: ['replaceText'] }),
      element(3, { label: 'ACTION', role: 'axbutton' }),
      element(4, { label: 'ACTION', operations: ['scrollDownPage'] }),
    ];
    const result = projectObservationElements(records, normalizeObservationQuery({ query: 'action', role: 'AXButton', operation: 'press' }));
    expect(result).toEqual({ elements: [records[0]], totalMatched: 1, offset: 0, limit: 32, hasMore: false, searchScope: 'observed-controls' });
    expect(records.map(record => record.elementId)).toEqual(['reference-1', 'reference-2', 'reference-3', 'reference-4']);
  });

  it('paginates only observed controls without modifying IDs, order or capability arrays', () => {
    const records = Array.from({ length: 70 }, (_, index) => element(index));
    const before = JSON.stringify(records);
    const first = projectObservationElements(records, normalizeObservationQuery({}));
    const second = projectObservationElements(records, normalizeObservationQuery({ offset: 32, limit: 32 }));
    const last = projectObservationElements(records, normalizeObservationQuery({ offset: 64, limit: 32 }));
    expect(first.elements).toEqual(records.slice(0, 32));
    expect(first.hasMore).toBe(true);
    expect(second.elements).toEqual(records.slice(32, 64));
    expect(second.hasMore).toBe(true);
    expect(last.elements).toEqual(records.slice(64));
    expect(last).toMatchObject({ totalMatched: 70, offset: 64, limit: 32, hasMore: false, searchScope: 'observed-controls' });
    expect(JSON.stringify(records)).toBe(before);
  });

  it('reports an empty match or an offset past the matches without implying a full AX search', () => {
    const records = [element(1)];
    expect(projectObservationElements(records, normalizeObservationQuery({ query: 'absent' })))
      .toMatchObject({ elements: [], totalMatched: 0, hasMore: false, searchScope: 'observed-controls' });
    expect(projectObservationElements(records, normalizeObservationQuery({ offset: 128 })))
      .toMatchObject({ elements: [], totalMatched: 1, offset: 128, hasMore: false });
  });
});

describe('computer observation changes', () => {
  function entry(key: string, overrides: Partial<ComputerObservationElement> = {}): ComputerObservationDiffEntry {
    return { key, value: element(0, overrides) };
  }

  it('ignores random element IDs and excludes private identities from the public changes', () => {
    const previous = [entry('private-path-1', { elementId: 'old-id' })];
    const current = [entry('private-path-1', { elementId: 'new-id' })];
    expect(getObservationChanges(previous, current)).toEqual({ added: [], removed: [], changed: [],
      totalAdded: 0, totalRemoved: 0, totalChanged: 0, hasMore: false, searchScope: 'observed-controls' });
    const changes = getObservationChanges(previous, [entry('private-path-1', { label: 'Changed', elementId: 'new-id' })]);
    expect(changes.changed).toEqual([{ before: { role: 'AXButton', label: 'Button 0', operations: ['press'] },
      after: { role: 'AXButton', label: 'Changed', operations: ['press'] } }]);
    expect(JSON.stringify(changes)).not.toMatch(/private-path|old-id|new-id|elementId/u);
  });

  it('keeps duplicate public labels separate by main-only identity and records observed membership changes', () => {
    const changes = getObservationChanges([entry('removed'), entry('retained')], [entry('retained'), entry('added')]);
    expect(changes).toMatchObject({ totalAdded: 1, totalRemoved: 1, totalChanged: 0, hasMore: false, searchScope: 'observed-controls' });
    expect(changes.added).toHaveLength(1);
    expect(changes.removed).toHaveLength(1);
  });

  it('bounds the combined returned changes while preserving exact counts', () => {
    const previous = [entry('removed'), entry('changed')];
    const current = [entry('added'), entry('changed', { operations: ['scrollDownPage'] })];
    expect(getObservationChanges(previous, current, 2)).toEqual({
      added: [{ role: 'AXButton', label: 'Button 0', operations: ['press'] }],
      removed: [{ role: 'AXButton', label: 'Button 0', operations: ['press'] }], changed: [],
      totalAdded: 1, totalRemoved: 1, totalChanged: 1, hasMore: true, searchScope: 'observed-controls',
    });
  });

  it('rejects ambiguous duplicate main identities and invalid change limits', () => {
    expect(() => getObservationChanges([entry('same'), entry('same')], [])).toThrow('差异身份无效');
    expect(() => getObservationChanges([], [entry('same'), entry('same')])).toThrow('差异身份无效');
    expect(() => getObservationChanges([entry('')], [])).toThrow('差异身份无效');
    for (const limit of [0, 129, 0.5, NaN]) expect(() => getObservationChanges([], [], limit)).toThrow();
  });
});
