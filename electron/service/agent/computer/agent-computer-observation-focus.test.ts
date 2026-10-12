import { describe, expect, it } from 'vitest';
import { normalizeObservationFocus } from './agent-computer-observation-focus';

const observationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
const elementId = '43b39553-9a74-4ba1-a976-1a6738397275';
const ids = { observationId, elementId };

describe('issued-ID AX region selection', () => {
  it('defaults to the element and permits only three bounded ancestor levels', () => {
    expect(normalizeObservationFocus(ids)).toEqual({ ...ids, ancestorLevels: 0 });
    for (let ancestorLevels = 0; ancestorLevels <= 3; ancestorLevels += 1) {
      expect(normalizeObservationFocus({ ...ids, ancestorLevels })).toEqual({ ...ids, ancestorLevels });
    }
  });
  it('rejects native selectors, malformed IDs and invalid levels', () => {
    for (const input of [null, [], {}, { ...ids, path: [0] }, { ...ids, pid: 123 }, { ...ids, role: 'AXButton' },
      { ...ids, observationId: 'other' }, { ...ids, elementId: 'AXButton' },
      ...[-1, 4, 0.5, '1', null, undefined, NaN].map(ancestorLevels => ({ ...ids, ancestorLevels }))]) {
      expect(() => normalizeObservationFocus(input)).toThrow('参数无效');
    }
  });
  it('does not invoke getters or accept hidden, inherited or symbol fields', () => {
    let invoked = false;
    const accessor = { ...ids };
    Object.defineProperty(accessor, 'ancestorLevels', { enumerable: true, get: () => { invoked = true; return 1; } });
    const hidden = { ...ids };
    Object.defineProperty(hidden, 'ancestorLevels', { value: 1 });
    for (const input of [accessor, hidden, Object.create(ids), { ...ids, [Symbol('path')]: [0] }]) {
      expect(() => normalizeObservationFocus(input)).toThrow('参数无效');
    }
    expect(invoked).toBe(false);
  });
});
