import { describe, expect, it, vi } from 'vitest';
import {
  WINDOW_INPUT_NAMED_KEYS, WINDOW_INPUT_OPERATIONS,
  normalizeWindowInputOperations, normalizeWindowInputPoint, normalizeWindowInputShortcut,
} from './window-input-contract';

describe('directed window input contract', () => {
  it('accepts only explicit key names, deduplicates modifiers and copies all collections', () => {
    const source = { key: 'a', modifiers: ['control', 'command', 'command'] };
    expect(normalizeWindowInputShortcut(source)).toEqual({ key: 'a', modifiers: ['command', 'control'] });
    expect(source.modifiers).toEqual(['control', 'command', 'command']);
    for (const key of 'abcdefghijklmnopqrstuvwxyz0123456789') {
      expect(normalizeWindowInputShortcut({ key, modifiers: ['command'] })).toEqual({ key, modifiers: ['command'] });
    }
    for (const key of WINDOW_INPUT_NAMED_KEYS) expect(normalizeWindowInputShortcut({ key, modifiers: [] })).toEqual({ key, modifiers: [] });
    const grant = [...WINDOW_INPUT_OPERATIONS];
    expect(normalizeWindowInputOperations(grant)).toEqual(grant);
    expect(normalizeWindowInputOperations(grant)).not.toBe(grant);
  });

  it('does not turn shortcut audit records into a printable text input bypass', () => {
    for (const key of 'abcdefghijklmnopqrstuvwxyz0123456789') {
      for (const modifiers of [[], ['shift'], ['option'], ['shift', 'option']]) {
        expect(() => normalizeWindowInputShortcut({ key, modifiers })).toThrow('Command 或 Control');
      }
      expect(normalizeWindowInputShortcut({ key, modifiers: ['control', 'shift'] })).toEqual({ key, modifiers: ['shift', 'control'] });
    }
  });

  it.each(['A', ' a', 'a ', 'cmd+a', 'Enter', 'enter', 'F1', 'é', 'aa', 'constructor', '', '\u0000'])(
    'does not infer a key alias from %j', key => {
      expect(() => normalizeWindowInputShortcut({ key, modifiers: [] })).toThrow();
    },
  );

  it.each([undefined, null, 'command', ['cmd'], ['alt'], ['meta'], ['Command'], ['control', 1], Array(1),
    ['command', 'shift', 'option', 'control', 'command']])('rejects malformed modifier lists: %j', modifiers => {
    expect(() => normalizeWindowInputShortcut({ key: 'a', modifiers })).toThrow();
  });

  it('rejects inherited, accessor, hidden and unknown nested fields without reading getters', () => {
    const getter = vi.fn(() => 'a');
    for (const source of [Object.create({ key: 'a', modifiers: [] }),
      { key: 'a', modifiers: [], text: 'not typing' }, { key: 'a', modifiers: [], [Symbol('extra')]: true },
      Object.defineProperty({ modifiers: [] }, 'key', { enumerable: true, get: getter }),
      Object.defineProperty({ modifiers: [] }, 'key', { enumerable: false, value: 'a' })]) {
      expect(() => normalizeWindowInputShortcut(source)).toThrow();
    }
    const listGetter = vi.fn(() => 'command');
    const modifiers = Object.defineProperty(['command'], '0', { enumerable: true, get: listGetter });
    expect(() => normalizeWindowInputShortcut({ key: 'a', modifiers })).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(listGetter).not.toHaveBeenCalled();
  });

  it.each([undefined, null, [], ['shortcut', 'shortcut'], ['press'], 'shortcut', ['drag', false]])(
    'rejects malformed input operation grants: %j', grant => {
      expect(() => normalizeWindowInputOperations(grant)).toThrow();
    },
  );

  it('bounds integer screenshot coordinates and never accepts native/global coordinates', () => {
    expect(normalizeWindowInputPoint({ x: 0, y: 2047 })).toEqual({ x: 0, y: 2047 });
    for (const point of [{ x: -1, y: 0 }, { x: 2048, y: 0 }, { x: 0.5, y: 0 }, { x: '1', y: 0 },
      { x: Infinity, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: 0, global: true }, { x: 0 }]) {
      expect(() => normalizeWindowInputPoint(point)).toThrow();
    }
    const getter = vi.fn(() => 1);
    expect(() => normalizeWindowInputPoint(Object.defineProperty({ y: 0 }, 'x', { get: getter, enumerable: true }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
