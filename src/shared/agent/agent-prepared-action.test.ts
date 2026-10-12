import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
  AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
  AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
  AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES,
} from './agent.types';
import {
  equalAgentPreparedActionPublic,
  normalizeAgentPreparedActionPublic,
} from './agent-prepared-action';
import { COMPUTER_ELEMENT_OPERATIONS } from '../computer-use/computer-use-contract';

function renameAction(overrides: Record<string, unknown> = {}) {
  return { kind: 'plugin.rename', version: 1, libraryId: 3, operationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
    pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64),
    items: [{ nodeId: 8, parentId: 2, oldName: 'old.jpg', newName: 'new.jpg' }], ...overrides };
}

function computerObserveAction(overrides: Record<string, unknown> = {}) {
  return { kind: 'computer.observe', version: 1, libraryId: 3,
    displayId: '1', displayLabel: '内置屏幕', ...overrides };
}

function computerClickAction(overrides: Record<string, unknown> = {}) {
  return { ...computerObserveAction(), kind: 'computer.click',
    observationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
    screenshotWidth: 2048, screenshotHeight: 1280, x: 2047, y: 1279,
    button: 'left', clickCount: 1, ...overrides };
}

function computerWindowObserveAction(overrides: Record<string, unknown> = {}) {
  return { kind: 'computer.observe', version: 2, libraryId: 3,
    targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试资料库', ...overrides };
}

function computerWindowClickAction(overrides: Record<string, unknown> = {}) {
  return { ...computerWindowObserveAction(), kind: 'computer.click',
    observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', screenshotWidth: 2048, screenshotHeight: 1280,
    x: 2047, y: 1279, button: 'left', clickCount: 1, ...overrides };
}

function computerSemanticClickAction(overrides: Record<string, unknown> = {}) {
  return { ...computerWindowObserveAction(), kind: 'computer.click', version: 3,
    observationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
    elementId: COMPUTER_ELEMENT_ID, button: 'left', clickCount: 1, ...overrides };
}

const COMPUTER_ELEMENT_ID = '805f4b48-ec6e-4f78-b45b-e01f10bb247e';

describe('computer observation mode and semantic click boundary', () => {
  it('accepts only declared observation modes while preserving historical missing mode', () => {
    for (const mode of ['ax', 'screenshot', 'both']) {
      const source = computerWindowObserveAction({ mode });
      expect(normalizeAgentPreparedActionPublic(source)).toEqual(source);
      expect(equalAgentPreparedActionPublic(source, computerWindowObserveAction())).toBe(false);
    }
    expect(normalizeAgentPreparedActionPublic(computerWindowObserveAction())).not.toHaveProperty('mode');
    for (const mode of [undefined, null, '', 'AX', 'image', 1, false, ['ax']]) {
      expect(() => normalizeAgentPreparedActionPublic(computerWindowObserveAction({ mode }))).toThrow();
    }
    expect(() => normalizeAgentPreparedActionPublic(computerObserveAction({ mode: 'ax' }))).toThrow();
  });

  it('rejects accessor or hidden modes without invoking a getter', () => {
    const getter = vi.fn(() => 'ax');
    expect(() => normalizeAgentPreparedActionPublic(Object.defineProperty(computerWindowObserveAction(), 'mode',
      { enumerable: true, get: getter }))).toThrow();
    expect(() => normalizeAgentPreparedActionPublic(Object.defineProperty(computerWindowObserveAction(), 'mode',
      { enumerable: false, value: 'ax' }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('registers semantic clicks without image dimensions or coordinates', () => {
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.click', version: 3 });
    const source = computerSemanticClickAction();
    expect(normalizeAgentPreparedActionPublic(source)).toEqual(source);
    expect(normalizeAgentPreparedActionPublic(Object.assign(Object.create(null), source))).toEqual(source);
    expect(equalAgentPreparedActionPublic(source, { ...source })).toBe(true);
    for (const field of ['targetId', 'observationId', 'elementId']) {
      expect(equalAgentPreparedActionPublic(source, { ...source, [field]: '01000000-0000-4000-8000-000000000000' })).toBe(false);
    }
  });

  it.each([
    { version: 4 }, { version: '3' }, { libraryId: '3' }, { libraryId: 0 },
    { targetId: 'window' }, { observationId: 'old' }, { elementId: undefined }, { elementId: 'AXButton' },
    { applicationLabel: '' }, { windowLabel: '\ud800' }, { button: 'right' }, { clickCount: 2 },
    { screenshotWidth: 100 }, { screenshotHeight: 100 }, { x: 0 }, { y: 0 }, { mode: 'ax' },
    { pid: 1 }, { windowId: 1 }, { path: [0] },
  ])('rejects semantic clicks with invalid identities or image/native fields: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerSemanticClickAction(overrides))).toThrow();
  });

  it('requires enumerable own data fields for semantic clicks', () => {
    const source = computerSemanticClickAction();
    for (const field of Object.keys(source)) {
      const missing = { ...source } as Record<string, unknown>;
      delete missing[field];
      const getter = vi.fn(() => Reflect.get(source, field));
      const accessor = Object.defineProperty({ ...source }, field, { enumerable: true, get: getter });
      const hidden = Object.defineProperty({ ...source }, field, { enumerable: false, value: Reflect.get(source, field) });
      for (const invalid of [missing, accessor, hidden]) expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
      expect(getter).not.toHaveBeenCalled();
    }
    for (const invalid of [Object.create(source), { ...source, [Symbol('private')]: true }]) {
      expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
    }
  });
});

function computerWindowsAction(overrides: Record<string, unknown> = {}) {
  return { kind: 'computer.windows', version: 1, libraryId: 3, ...overrides };
}

function computerSetTextAction(overrides: Record<string, unknown> = {}) {
  return { ...computerWindowObserveAction(), kind: 'computer.setText', version: 1,
    observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', elementId: COMPUTER_ELEMENT_ID,
    mode: 'replace', textLength: 3, textBytes: 8, ...overrides };
}

function computerScrollAction(overrides: Record<string, unknown> = {}) {
  return { ...computerWindowObserveAction(), kind: 'computer.scroll', version: 1,
    observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', elementId: COMPUTER_ELEMENT_ID,
    direction: 'down', unit: 'page', ...overrides };
}

describe('computer text and scroll prepared action boundary', () => {
  it('registers exact identities without plaintext or native execution material', () => {
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.setText', version: 1 });
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.scroll', version: 1 });
    for (const action of [computerSetTextAction(), computerSetTextAction({ mode: 'insert' }), computerScrollAction()]) {
      expect(normalizeAgentPreparedActionPublic(action)).toEqual(action);
      expect(normalizeAgentPreparedActionPublic(Object.assign(Object.create(null), action))).toEqual(action);
      expect(equalAgentPreparedActionPublic(action, { ...action })).toBe(true);
      for (const field of ['observationId', 'elementId', 'targetId']) {
        expect(equalAgentPreparedActionPublic(action, { ...action, [field]: '01000000-0000-4000-8000-000000000000' })).toBe(false);
      }
    }
    expect(equalAgentPreparedActionPublic(computerSetTextAction(), computerSetTextAction({ mode: 'insert' }))).toBe(false);
    expect(equalAgentPreparedActionPublic(computerSetTextAction(), computerSetTextAction({ textLength: 4 }))).toBe(false);
    expect(equalAgentPreparedActionPublic(computerSetTextAction(), computerSetTextAction({ textBytes: 9 }))).toBe(false);
    expect(equalAgentPreparedActionPublic(computerScrollAction(), computerScrollAction({ direction: 'up' }))).toBe(false);
    expect(equalAgentPreparedActionPublic(computerScrollAction(), computerScrollAction({ unit: 'step' }))).toBe(false);
  });

  it('accepts empty replacement and exact Unicode count limits without interpreting the missing body', () => {
    for (const counts of [{ textLength: 0, textBytes: 0 }, { textLength: 1, textBytes: 1 },
      { textLength: 4096, textBytes: 4096 }, { textLength: 4096, textBytes: 16384 }]) {
      const action = computerSetTextAction(counts);
      expect(normalizeAgentPreparedActionPublic(action)).toEqual(action);
      expect(normalizeAgentPreparedActionPublic(action)).not.toHaveProperty('text');
    }
  });

  it.each([
    { mode: 'append' }, { mode: null }, { mode: 'insert', textLength: 0, textBytes: 0 },
    { textLength: -1 }, { textLength: 4097 }, { textLength: '3' }, { textLength: 0.5 },
    { textLength: NaN }, { textLength: Infinity }, { textBytes: -1 }, { textBytes: '8' },
    { textBytes: 0.5 }, { textBytes: NaN }, { textBytes: Infinity }, { textBytes: 16385 },
    { textLength: 0, textBytes: 1 }, { textLength: 3, textBytes: 2 }, { textLength: 3, textBytes: 13 },
  ])('rejects invalid text counts or mode: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerSetTextAction(overrides))).toThrow();
  });

  it('accepts exactly one page, step or fixed fraction in all four directions and rejects arbitrary gestures', () => {
    for (const direction of ['up', 'down', 'left', 'right']) for (const unit of ['page', 'step', 'fraction']) {
      const action = computerScrollAction({ direction, unit });
      expect(normalizeAgentPreparedActionPublic(action)).toEqual(action);
    }
    for (const overrides of [{ direction: 'Down' }, { direction: 'diagonal' }, { direction: 1 },
      { unit: 'pixel' }, { unit: 1 }, { count: 2 }, { deltaY: 10 }, { mode: 'replace' },
      { unit: 'fraction', amount: 0.1 }, { unit: 'fraction', value: 0.1 },
      { unit: 'fraction', scrollState: { value: 0, minValue: 0, maxValue: 1 } }]) {
      expect(() => normalizeAgentPreparedActionPublic(computerScrollAction(overrides))).toThrow();
    }
  });

  it.each([
    { version: 2 }, { version: '1' }, { libraryId: '3' }, { libraryId: 0 },
    { observationId: 'missing' }, { observationId: null }, { elementId: undefined }, { elementId: 'AXTextField' },
    { targetId: '1' }, { applicationLabel: '' }, { windowLabel: '\ud800' },
    { text: 'must remain private' }, { textHash: 'a'.repeat(64) }, { preview: 'body' },
    { pid: 1 }, { windowId: 1 }, { path: [0] }, { x: 1 }, { operations: ['press'] },
  ])('rejects forged identities, plaintext and nonpublic fields: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerSetTextAction(overrides))).toThrow();
    expect(() => normalizeAgentPreparedActionPublic(computerScrollAction(overrides))).toThrow();
  });

  it('rejects missing, hidden, accessor, symbolic and inherited fields without invoking getters', () => {
    for (const action of [computerSetTextAction(), computerScrollAction()]) {
      for (const field of Object.keys(action)) {
        const missing = { ...action } as Record<string, unknown>;
        delete missing[field];
        const getter = vi.fn(() => 'forged');
        const accessor = Object.defineProperty({ ...action }, field, { enumerable: true, get: getter });
        const hidden = Object.defineProperty({ ...action }, field, { enumerable: false, value: Reflect.get(action, field) });
        for (const invalid of [missing, accessor, hidden]) expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
        expect(getter).not.toHaveBeenCalled();
      }
      for (const invalid of [Object.create(action), { ...action, [Symbol('private')]: true }]) {
        expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
      }
    }
  });
});

describe('computer window operation grant boundary', () => {
  it('preserves the exact explicit grant independently of historical missing grants', () => {
    const action = computerWindowObserveAction({ operations: [...COMPUTER_ELEMENT_OPERATIONS] });
    const normalized = normalizeAgentPreparedActionPublic(action);
    expect(normalized).toEqual(action);
    if (normalized.kind !== 'computer.observe' || normalized.version !== 2) throw new Error('wrong action');
    expect(normalized.operations).not.toBe(Reflect.get(action, 'operations'));
    expect(normalizeAgentPreparedActionPublic(computerWindowObserveAction())).not.toHaveProperty('operations');
    expect(equalAgentPreparedActionPublic(action, computerWindowObserveAction())).toBe(false);
    expect(equalAgentPreparedActionPublic(action, computerWindowObserveAction({ operations: ['press'] }))).toBe(false);
    expect(() => normalizeAgentPreparedActionPublic(computerObserveAction({ operations: ['press'] }))).toThrow();
    expect(() => normalizeAgentPreparedActionPublic(computerWindowClickAction({ operations: ['press'] }))).toThrow();
  });

  it.each([undefined, null, [], ['press', 'press'], ['text'], 'press', ['press', false]])('rejects malformed optional grants: %j', operations => {
    expect(() => normalizeAgentPreparedActionPublic(computerWindowObserveAction({ operations }))).toThrow();
  });

  it('rejects non-JSON grant fields without invoking getters', () => {
    const getter = vi.fn(() => ['press']);
    const accessor = Object.defineProperty(computerWindowObserveAction(), 'operations', { enumerable: true, get: getter });
    const hidden = Object.defineProperty(computerWindowObserveAction(), 'operations', { enumerable: false, value: ['press'] });
    for (const invalid of [accessor, hidden]) expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('computer window discovery prepared action boundary', () => {
  it('registers a strict metadata discovery identity with optional bounded filters', () => {
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.windows', version: 1 });
    for (const filters of [{}, { query: '计算' }, { application: 'Calculator' },
      { application: '计算器', query: '🪟'.repeat(200) }]) {
      const source = computerWindowsAction(filters);
      expect(normalizeAgentPreparedActionPublic(source)).toEqual(source);
      expect(normalizeAgentPreparedActionPublic(Object.assign(Object.create(null), source))).toEqual(source);
    }
  });

  it.each([
    { version: 2 }, { version: '1' }, { libraryId: '3' }, { libraryId: 0 }, { libraryId: NaN },
    { pid: 12 }, { windowId: 42 }, { targetId: COMPUTER_ELEMENT_ID }, { permission: 'approved' },
  ])('rejects unsupported identities and private execution fields: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerWindowsAction(overrides))).toThrow();
  });

  it.each(['query', 'application'])('rejects malformed, unsafe and unbounded %s without coercion', field => {
    for (const value of [undefined, null, 123, false, '', ' leading', 'trailing ', 'x'.repeat(201),
      '🪟'.repeat(201), 'window\nother', 'window\u007f', 'window\u0085', 'window\u202e', 'window\u2066', '\ud800']) {
      expect(() => normalizeAgentPreparedActionPublic(computerWindowsAction({ [field]: value }))).toThrow();
    }
    const getter = vi.fn(() => 'forged');
    const accessor = Object.defineProperty(computerWindowsAction(), field, { enumerable: true, get: getter });
    const hidden = Object.defineProperty(computerWindowsAction(), field, { enumerable: false, value: 'Finder' });
    expect(() => normalizeAgentPreparedActionPublic(accessor)).toThrow();
    expect(() => normalizeAgentPreparedActionPublic(hidden)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects missing, inherited and symbolic fields while comparing exact discovery filters', () => {
    const source = computerWindowsAction({ query: 'Finder', application: 'Finder' });
    const missing = { ...source } as Record<string, unknown>;
    delete missing.libraryId;
    for (const invalid of [missing, Object.create(source), { ...source, [Symbol('private')]: true }]) {
      expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
    }
    expect(equalAgentPreparedActionPublic(source, { ...source })).toBe(true);
    expect(equalAgentPreparedActionPublic(source, computerWindowsAction({ query: 'Finder' }))).toBe(false);
    expect(equalAgentPreparedActionPublic(source, { ...source, query: 'Calculator' })).toBe(false);
    expect(equalAgentPreparedActionPublic(source, { ...source, application: 'Calculator' })).toBe(false);
  });
});

describe('window-bound computer prepared action V2 boundary', () => {
  it('registers distinct window identities while preserving the historical display protocol', () => {
    const observe = computerWindowObserveAction();
    const click = computerWindowClickAction();
    expect(normalizeAgentPreparedActionPublic(observe)).toEqual(observe);
    expect(normalizeAgentPreparedActionPublic(click)).toEqual(click);
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.observe', version: 2 });
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.click', version: 2 });
    expect(normalizeAgentPreparedActionPublic(computerObserveAction())).toEqual(computerObserveAction());
    expect(normalizeAgentPreparedActionPublic(computerClickAction({ button: 'right', clickCount: 2 })))
      .toEqual(computerClickAction({ button: 'right', clickCount: 2 }));
    expect(equalAgentPreparedActionPublic(observe, { ...observe })).toBe(true);
    expect(equalAgentPreparedActionPublic(observe, computerObserveAction())).toBe(false);
    expect(equalAgentPreparedActionPublic(observe, { ...observe, targetId: click.observationId })).toBe(false);
    expect(equalAgentPreparedActionPublic(observe, { ...observe, windowLabel: '另一个窗口' })).toBe(false);
  });

  it('accepts the smallest and largest delivered image edges without coordinate coercion', () => {
    const smallest = computerWindowClickAction({ screenshotWidth: 1, screenshotHeight: 1, x: 0, y: 0 });
    expect(normalizeAgentPreparedActionPublic(smallest)).toEqual(smallest);
    const largest = computerWindowClickAction({ screenshotHeight: 2048, y: 2047 });
    expect(normalizeAgentPreparedActionPublic(largest)).toEqual(largest);
    const unicode = computerWindowObserveAction({ applicationLabel: '🪟'.repeat(200), windowLabel: '中文窗口' });
    expect(normalizeAgentPreparedActionPublic(unicode)).toEqual(unicode);
  });

  it('preserves an optional main-issued element identity alongside frozen image coordinates', () => {
    const action = computerWindowClickAction({ elementId: COMPUTER_ELEMENT_ID });
    expect(normalizeAgentPreparedActionPublic(action)).toEqual(action);
    expect(normalizeAgentPreparedActionPublic(computerWindowClickAction())).not.toHaveProperty('elementId');
    expect(equalAgentPreparedActionPublic(action, { ...action })).toBe(true);
    expect(equalAgentPreparedActionPublic(action, computerWindowClickAction())).toBe(false);
    for (const change of [{ elementId: action.observationId }, { observationId: COMPUTER_ELEMENT_ID },
      { targetId: COMPUTER_ELEMENT_ID }, { x: 1 }, { y: 1 }]) {
      expect(equalAgentPreparedActionPublic(action, { ...action, ...change })).toBe(false);
    }
    expect(() => normalizeAgentPreparedActionPublic(computerClickAction({ elementId: COMPUTER_ELEMENT_ID }))).toThrow();
    expect(() => normalizeAgentPreparedActionPublic(computerWindowObserveAction({ elementId: COMPUTER_ELEMENT_ID }))).toThrow();
  });

  it.each([undefined, null, 42, false, '', 'missing', ` ${COMPUTER_ELEMENT_ID}`, `${COMPUTER_ELEMENT_ID} `,
    COMPUTER_ELEMENT_ID.toUpperCase(), '00000000-0000-0000-0000-000000000000'])('rejects malformed element identities: %j', elementId => {
    const action = computerWindowClickAction({ elementId });
    expect(() => normalizeAgentPreparedActionPublic(action)).toThrow();
    expect(equalAgentPreparedActionPublic(action, action)).toBe(false);
  });

  it('rejects hidden and accessor element identities without invoking getters', () => {
    const getter = vi.fn(() => COMPUTER_ELEMENT_ID);
    const accessor = Object.defineProperty(computerWindowClickAction(), 'elementId', { enumerable: true, get: getter });
    const hidden = Object.defineProperty(computerWindowClickAction(), 'elementId', { enumerable: false, value: COMPUTER_ELEMENT_ID });
    for (const invalid of [accessor, hidden]) {
      expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
      expect(equalAgentPreparedActionPublic(invalid, computerWindowClickAction())).toBe(false);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    { version: 1 }, { version: 3 }, { libraryId: '3' }, { libraryId: 0 },
    { targetId: 123 }, { targetId: '500' }, { targetId: '' },
    { targetId: '00000000-0000-0000-0000-000000000000' }, { targetId: '237E3952-2A40-4C7B-B2F4-BEC335A79CCE' },
    { applicationLabel: '' }, { applicationLabel: ' OmniFlow' }, { applicationLabel: 'OmniFlow\n' },
    { applicationLabel: 'x'.repeat(201) }, { applicationLabel: '\ud800' },
    { windowLabel: '' }, { windowLabel: 'trailing ' }, { windowLabel: 'x'.repeat(201) },
    { windowLabel: '窗口\u202e' }, { windowLabel: '窗口\u2066' }, { windowLabel: '\udfff' },
    { pid: 500 }, { windowId: 42 }, { nativeHandle: 1 }, { displayId: '1' }, { displayLabel: '屏幕' },
  ])('rejects invalid opaque targets, native fields, and unsafe labels: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerWindowObserveAction(overrides))).toThrow();
    expect(() => normalizeAgentPreparedActionPublic(computerWindowClickAction(overrides))).toThrow();
  });

  it.each([
    { observationId: 500 }, { observationId: 'missing' }, { observationId: '00000000-0000-0000-0000-000000000000' },
    { screenshotWidth: 0 }, { screenshotHeight: 0 }, { screenshotWidth: 2049 }, { screenshotHeight: 2049 },
    { screenshotWidth: '2048' }, { screenshotHeight: 1.5 },
    { x: -1 }, { x: 2048 }, { y: 1280 }, { x: 0.5 }, { y: '1' }, { x: NaN }, { y: Infinity },
    { button: 'right' }, { button: 'middle' }, { clickCount: 2 }, { clickCount: '1' },
  ])('rejects unsupported gestures and image coordinates: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerWindowClickAction(overrides))).toThrow();
  });

  it.each(['kind', 'version', 'libraryId', 'targetId', 'applicationLabel', 'windowLabel', 'observationId',
    'screenshotWidth', 'screenshotHeight', 'x', 'y', 'button', 'clickCount'])('rejects missing, hidden, and accessor %s without evaluating it', field => {
    const source = computerWindowClickAction();
    const missing = { ...source } as Record<string, unknown>;
    delete missing[field];
    const getter = vi.fn(() => 'forged');
    const accessor = Object.defineProperty({ ...source }, field, { enumerable: true, get: getter });
    const hidden = Object.defineProperty({ ...source }, field, { enumerable: false, value: Reflect.get(source, field) });
    for (const invalid of [missing, accessor, hidden]) expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects inherited and symbolic identities while accepting exact plain or null-prototype JSON objects', () => {
    const source = computerWindowObserveAction();
    for (const invalid of [Object.create(source), { ...source, [Symbol('private')]: true }]) {
      expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
    }
    expect(normalizeAgentPreparedActionPublic(Object.assign(Object.create(null), source))).toEqual(source);
  });
});

describe('computer prepared action boundary', () => {
  it('preserves the exact scope, observation, and bounded screenshot coordinates', () => {
    expect(normalizeAgentPreparedActionPublic(computerObserveAction())).toEqual(computerObserveAction());
    expect(normalizeAgentPreparedActionPublic(computerClickAction())).toEqual(computerClickAction());
    expect(normalizeAgentPreparedActionPublic(computerClickAction({ x: 0, y: 0, button: 'right', clickCount: 2 })))
      .toEqual(computerClickAction({ x: 0, y: 0, button: 'right', clickCount: 2 }));
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.observe', version: 1 });
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.click', version: 1 });
  });

  it.each([
    { version: 2 }, { libraryId: '3' }, { libraryId: 0 }, { displayId: '' }, { displayId: 1 },
    { displayId: ' 1' }, { displayId: 'x'.repeat(129) }, { displayLabel: 'x'.repeat(201) },
    { displayLabel: 'screen\nother' }, { displayLabel: 'screen\u202e' }, { displayLabel: '\ud800' },
    { rawHandle: 1 }, { ownerScope: {} },
  ])('rejects scope coercion, private fields, and unsafe screen labels: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerObserveAction(overrides))).toThrow();
  });

  it.each([
    { screenshotWidth: 0 }, { screenshotWidth: 2049 }, { screenshotHeight: 2049 },
    { screenshotWidth: '2048' }, { screenshotHeight: 1.5 }, { x: -1 }, { x: 2048 },
    { y: 1280 }, { y: '1' }, { x: 0.5 }, { x: NaN }, { y: Infinity },
    { observationId: 'missing' }, { observationId: '00000000-0000-0000-0000-000000000000' },
    { button: 'middle' }, { clickCount: 3 }, { clickCount: '1' },
  ])('rejects stale identity shapes and clicks outside the delivered screenshot: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(computerClickAction(overrides))).toThrow();
  });

  it('rejects missing fields, symbols, hidden fields, and accessors without evaluating getters', () => {
    const missing = { ...computerObserveAction() } as Record<string, unknown>;
    delete missing.displayId;
    const hidden = Object.defineProperty(computerObserveAction(), 'displayId', { value: '1', enumerable: false });
    for (const field of ['kind', 'version', 'displayLabel']) {
      const getter = vi.fn(() => field === 'kind' ? 'computer.observe' : field === 'version' ? 1 : 'screen');
      const accessor = Object.defineProperty(computerObserveAction(), field, { enumerable: true, get: getter });
      expect(() => normalizeAgentPreparedActionPublic(accessor)).toThrow();
      expect(getter).not.toHaveBeenCalled();
    }
    for (const invalid of [missing, hidden, { ...computerObserveAction(), [Symbol('private')]: true }, Object.create(computerObserveAction())]) {
      expect(() => normalizeAgentPreparedActionPublic(invalid)).toThrow();
    }
  });
});

describe('plugin rename prepared action', () => {
  it('normalizes the exact proposal and registers its persistent public identity', () => {
    expect(normalizeAgentPreparedActionPublic(renameAction())).toEqual(renameAction());
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'plugin.rename', version: 1 });
    const value = renameAction(); const normalized = normalizeAgentPreparedActionPublic(value);
    value.items[0].newName = 'changed.jpg';
    expect(normalized).toMatchObject({ items: [{ newName: 'new.jpg' }] });
  });

  it.each([
    { kind: 'plugin.write' }, { version: 2 }, { libraryId: '3' }, { libraryId: 0 },
    { operationId: 'some-operation' }, { operationId: '00000000-0000-0000-0000-000000000000' },
    { pluginId: '../evil' }, { pluginId: 'invalid' }, { pluginVersion: '01.0.0' }, { pluginVersion: '1.0' },
    { packageFingerprint: 'g'.repeat(64) }, { packageFingerprint: 'a'.repeat(63) }, { credentials: 'hidden' },
    { items: [] }, { items: Array.from({ length: 51 }, (_, i) => ({ nodeId: i + 1, parentId: 100, oldName: 'old.jpg', newName: `${i}.jpg` })) },
  ])('rejects invalid identity, scope, or extra fields: %j', overrides => {
    expect(() => normalizeAgentPreparedActionPublic(renameAction(overrides))).toThrow();
  });

  it('rejects duplicate targets, unchanged names, foreign fields, and invalid node IDs', () => {
    const item = renameAction().items[0];
    for (const items of [[item, item], [item, { ...item, nodeId: 9 }], [{ ...item, newName: item.oldName }],
      [{ ...item, nodeId: 0 }], [{ ...item, parentId: 0 }], [{ ...item, path: '/other' }],
      [{ ...item, nodeId: Number.MAX_SAFE_INTEGER + 1 }], [{ ...item, oldName: undefined }]]) {
      expect(() => normalizeAgentPreparedActionPublic(renameAction({ items }))).toThrow();
    }
    expect(() => normalizeAgentPreparedActionPublic(renameAction({ items: [item, { ...item, nodeId: 9, parentId: 3 }] }))).not.toThrow();
  });

  it('bounds names in UTF-8 without truncation, trimming, or accepting paths and controls', () => {
    const item = renameAction().items[0];
    for (const name of ['', '.', '..', ' leading.jpg', 'trailing.jpg ', 'a/b.jpg', 'a\\b.jpg', 'a\n.jpg', `a${String.fromCharCode(127)}.jpg`, 'x'.repeat(241), '中'.repeat(81), '\ud800.jpg']) {
      expect(() => normalizeAgentPreparedActionPublic(renameAction({ items: [{ ...item, newName: name }] }))).toThrow();
      expect(() => normalizeAgentPreparedActionPublic(renameAction({ items: [{ ...item, oldName: name }] }))).toThrow();
    }
    expect(() => normalizeAgentPreparedActionPublic(renameAction({ items: [{ ...item, newName: '中'.repeat(80) }] }))).not.toThrow();
  });

  it('rejects accessors, sparse arrays, and inherited item identities', () => {
    const item = renameAction().items[0];
    const getter = vi.fn(() => 'new.jpg');
    const accessor = Object.defineProperty({ ...item }, 'newName', { enumerable: true, get: getter });
    expect(() => normalizeAgentPreparedActionPublic(renameAction({ items: [accessor] }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => normalizeAgentPreparedActionPublic(renameAction({ items: new Array(1) }))).toThrow();
    expect(() => normalizeAgentPreparedActionPublic(renameAction({ items: [Object.create(item)] }))).toThrow();
  });
});

function libraryAction(overrides: Record<string, unknown> = {}) {
  return {
    conflictPolicy: 'auto_rename',
    destination: 'library',
    fallbackPolicy: 'prompt_local',
    kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
    libraryId: 3,
    outputFileName: 'movie-audio.m4a',
    outputFormat: 'm4a',
    parentId: 10,
    sourceNodeId: 8,
    targetLabel: '视频',
    version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function fileStageAction(overrides: Record<string, unknown> = {}) {
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    sourceKind: 'local-picker',
    targetLabel: '当前任务 input 目录',
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function libraryFileStageAction(overrides: Record<string, unknown> = {}) {
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    libraryId: 3,
    sourceDisplayName: 'source.txt',
    sourceIdentity: `sha256:${'b'.repeat(64)}`,
    sourceKind: 'library-node',
    sourceNodeId: 8,
    sourceSizeBytes: 12,
    targetLabel: '当前任务 input 目录',
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function localPathFileStageAction(overrides: Record<string, unknown> = {}) {
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    sourceDisplayName: 'source.txt',
    sourceIdentity: `sha256:${'c'.repeat(64)}`,
    sourceKind: 'local-path',
    sourcePath: '/Users/example/Documents/source.txt',
    sourceSizeBytes: 12,
    targetLabel: '当前任务 input 目录',
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function filePublishAction(overrides: Record<string, unknown> = {}) {
  return {
    contentHash: `sha256:${'a'.repeat(64)}`,
    destinationKind: 'local-save-as',
    displayName: 'result.txt',
    kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
    sizeBytes: 12,
    sourcePath: 'output/result.txt',
    suggestedFileName: 'result.txt',
    targetLabel: '本机（执行时选择位置）',
    version: AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function libraryFilePublishAction(overrides: Record<string, unknown> = {}) {
  return filePublishAction({
    conflictPolicy: 'rename',
    destinationKind: 'library',
    libraryId: 3,
    parentId: 9,
    providerId: 'local',
    targetLabel: '资料库目录“Output” / 本机存储',
    ...overrides,
  });
}

describe('Agent prepared action public contract', () => {
  it('normalizes file.stage and file.publish v1 branches canonically', () => {
    expect(normalizeAgentPreparedActionPublic(fileStageAction({
      targetLabel: '  当前任务 input 目录  ',
    }))).toEqual(fileStageAction());
    expect(normalizeAgentPreparedActionPublic(filePublishAction({
      displayName: ' result.txt ',
      sourcePath: ' output/result.txt ',
      suggestedFileName: ' result.txt ',
      targetLabel: ' 本机（执行时选择位置） ',
    }))).toEqual(filePublishAction());
    expect(normalizeAgentPreparedActionPublic(libraryFileStageAction({
      sourceDisplayName: ' source.txt ',
    }))).toEqual(libraryFileStageAction());
    expect(normalizeAgentPreparedActionPublic(libraryFilePublishAction({
      providerId: ' local ',
    }))).toEqual(libraryFilePublishAction());
  });

  it('normalizes renderer-side local paths without a Node Buffer global', () => {
    vi.stubGlobal('Buffer', undefined);
    try {
      expect(normalizeAgentPreparedActionPublic(localPathFileStageAction({
        sourcePath: ' /Users/example/Documents/字幕.txt ',
      }))).toEqual(localPathFileStageAction({
        sourcePath: '/Users/example/Documents/字幕.txt',
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['stage extra field', fileStageAction({ path: '/tmp/private.txt' })],
    ['stage source kind', fileStageAction({ sourceKind: 'library-node' })],
    ['stage mixed local fields', fileStageAction({ libraryId: 3 })],
    ['stage invalid library identity', libraryFileStageAction({ sourceIdentity: 'sha256:bad' })],
    ['stage invalid library ID', libraryFileStageAction({ libraryId: 0 })],
    ['stage invalid node ID', libraryFileStageAction({ sourceNodeId: Number.MAX_SAFE_INTEGER + 1 })],
    ['stage invalid size', libraryFileStageAction({ sourceSizeBytes: -1 })],
    ['publish extra field', filePublishAction({ targetPath: '/tmp/result.txt' })],
    ['publish destination', filePublishAction({ destinationKind: 'library' })],
    ['publish mixed local fields', filePublishAction({ libraryId: 3 })],
    ['publish invalid provider', libraryFilePublishAction({ providerId: '../local' })],
    ['publish invalid library ID', libraryFilePublishAction({ libraryId: 0 })],
    ['publish invalid parent ID', libraryFilePublishAction({ parentId: 0 })],
    ['publish invalid conflict policy', libraryFilePublishAction({ conflictPolicy: 'replace' })],
    ['publish traversal', filePublishAction({ sourcePath: 'output/../private.txt' })],
    ['publish non-output path', filePublishAction({ sourcePath: 'work/result.txt' })],
    ['publish invalid hash', filePublishAction({ contentHash: `sha256:${'A'.repeat(64)}` })],
    ['publish unsafe size', filePublishAction({ sizeBytes: Number.MAX_SAFE_INTEGER + 1 })],
    ['publish unsafe name', filePublishAction({ suggestedFileName: '../result.txt' })],
  ])('rejects malformed file bridge prepared actions: %s', (_label, input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow();
  });

  it('normalizes the supported media.extractAudio v1 branch canonically', () => {
    expect(normalizeAgentPreparedActionPublic(libraryAction({
      outputFileName: '  movie-audio.m4a  ',
      outputFormat: ' M4A ',
      targetLabel: '  视频  ',
    }))).toEqual(libraryAction());

    const localAction = libraryAction();
    Reflect.deleteProperty(localAction, 'parentId');
    expect(normalizeAgentPreparedActionPublic({
      ...localAction,
      destination: 'local',
      fallbackPolicy: 'prompt_local',
      targetLabel: '本机（执行时选择位置）',
    })).toEqual({
      conflictPolicy: 'auto_rename',
      destination: 'local',
      fallbackPolicy: 'none',
      kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
      libraryId: 3,
      outputFileName: 'movie-audio.m4a',
      outputFormat: 'm4a',
      sourceNodeId: 8,
      targetLabel: '本机（执行时选择位置）',
      version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
    });
  });

  it.each([
    null,
    [],
    'media.extractAudio',
    new Date(0),
  ])('rejects a non-plain root: %s', (input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow('无效');
  });

  it.each([
    ['missing kind', libraryAction({ kind: undefined })],
    ['unknown kind', libraryAction({ kind: 'shell.other' })],
    ['missing version', libraryAction({ version: undefined })],
    ['string version', libraryAction({ version: '1' })],
    ['unknown version', libraryAction({ version: 2 })],
  ])('rejects an unsupported discriminator: %s', (_label, input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow('类型或版本不受支持');
  });

  it.each([
    ['unknown field', libraryAction({ unexpected: true })],
    ['string library ID', libraryAction({ libraryId: '3' })],
    ['unsafe source ID', libraryAction({ sourceNodeId: Number.MAX_SAFE_INTEGER + 1 })],
    ['unsupported format', libraryAction({ outputFormat: 'flac' })],
    ['invalid destination', libraryAction({ destination: 'remote' })],
    ['invalid fallback policy', libraryAction({ fallbackPolicy: 'always_local' })],
    ['invalid conflict policy', libraryAction({ conflictPolicy: 'overwrite' })],
    ['unsafe file name', libraryAction({ outputFileName: '../movie.m4a' })],
    ['control character in target label', libraryAction({ targetLabel: '视频\n目录' })],
    ['non-string target label', libraryAction({ targetLabel: 10 })],
    ['oversized file name', libraryAction({ outputFileName: 'a'.repeat(256) })],
    ['oversized target label', libraryAction({ targetLabel: 'a'.repeat(501) })],
  ])('rejects a malformed media branch: %s', (_label, input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow();
  });

  it('enforces destination-specific parent constraints', () => {
    const libraryWithoutParent = libraryAction();
    Reflect.deleteProperty(libraryWithoutParent, 'parentId');
    expect(() => normalizeAgentPreparedActionPublic(libraryWithoutParent))
      .toThrow('资料库目标目录无效');

    expect(() => normalizeAgentPreparedActionPublic({
      ...libraryAction(),
      destination: 'local',
      fallbackPolicy: 'none',
      targetLabel: '本机（执行时选择位置）',
    })).toThrow('本机目标不能包含资料库目录');
  });

  it('counts Unicode code points consistently with SQLite', () => {
    const outputFileName = `${'😀'.repeat(251)}.m4a`;
    expect(normalizeAgentPreparedActionPublic(libraryAction({ outputFileName })))
      .toMatchObject({ outputFileName });
    expect(() => normalizeAgentPreparedActionPublic(libraryAction({
      outputFileName: `${'😀'.repeat(252)}.m4a`,
    }))).toThrow('输出文件名无效');
  });

  it('compares canonical actions and treats malformed inputs as unequal', () => {
    expect(equalAgentPreparedActionPublic(
      libraryAction({ outputFormat: ' M4A ', targetLabel: ' 视频 ' }),
      libraryAction(),
    )).toBe(true);
    expect(equalAgentPreparedActionPublic(
      libraryAction(),
      libraryAction({ outputFileName: 'renamed.m4a' }),
    )).toBe(false);
    expect(equalAgentPreparedActionPublic(
      libraryAction(),
      libraryAction({ version: 2 }),
    )).toBe(false);
    expect(equalAgentPreparedActionPublic(libraryAction(), null)).toBe(false);
  });
});
