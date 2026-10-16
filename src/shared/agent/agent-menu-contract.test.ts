import { describe, expect, it, vi } from 'vitest';
import { AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES } from './agent.types';
import { equalAgentPreparedActionPublic, normalizeAgentPreparedActionPublic } from './agent-prepared-action';
import { WINDOW_MENU_OPERATIONS, normalizeWindowMenuOperations } from '../computer-use/window-menu-contract';

const target = { libraryId: 3, targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
  applicationLabel: '菜单测试', windowLabel: 'QA' };
const observe = { kind: 'computer.observe', version: 2, ...target, mode: 'ax', operations: ['press'] };
const action = { kind: 'computer.menu', version: 1, ...target,
  observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', elementId: '805f4b48-ec6e-4f78-b45b-e01f10bb247e',
  elementLabel: '更多操作', operation: 'open' };

describe('native menu public contract', () => {
  it('keeps menu access explicit and independent of historical window click/input grants', () => {
    expect(normalizeAgentPreparedActionPublic(observe)).not.toHaveProperty('menuOperations');
    const menu = { ...observe, scope: 'menu', menuOperations: [...WINDOW_MENU_OPERATIONS] };
    expect(normalizeAgentPreparedActionPublic(menu)).toEqual(menu);
    expect(equalAgentPreparedActionPublic(menu, observe)).toBe(false);
    expect(equalAgentPreparedActionPublic(menu, { ...menu, menuOperations: ['open'] })).toBe(false);
    expect(equalAgentPreparedActionPublic(menu, { ...menu, scope: undefined })).toBe(false);
    for (const scope of [undefined, null, {}, 'window', 'all', 'application']) {
      expect(() => normalizeAgentPreparedActionPublic({ ...observe, scope })).toThrow();
    }
    for (const menuOperations of [undefined, null, [], ['open', 'open'], ['rightClick'], ['press', 'open', 'cancel', 'press']]) {
      expect(() => normalizeAgentPreparedActionPublic({ ...observe, menuOperations })).toThrow();
    }
  });

  it('seals each menu action, observation, target and displayed element label', () => {
    expect(AGENT_PREPARED_ACTION_PUBLIC_IDENTITIES).toContainEqual({ kind: 'computer.menu', version: 1 });
    for (const operation of WINDOW_MENU_OPERATIONS) {
      const source = { ...action, operation };
      expect(normalizeAgentPreparedActionPublic(source)).toEqual(source);
      for (const field of ['elementLabel', 'windowLabel', 'applicationLabel']) {
        expect(equalAgentPreparedActionPublic(source, { ...source, [field]: '其他' })).toBe(false);
      }
    }
    for (const field of Object.keys(action)) {
      const missing: Record<string, unknown> = { ...action }; delete missing[field];
      expect(() => normalizeAgentPreparedActionPublic(missing)).toThrow();
    }
    for (const extra of [{ pid: 123 }, { nativeWindowId: 456 }, { path: [0, 1] }, { x: 1 }, { text: 'private' },
      { operation: 'hover' }, { elementId: 'native-123' }, { elementLabel: '\u202eunsafe' }]) {
      expect(() => normalizeAgentPreparedActionPublic({ ...action, ...extra })).toThrow();
    }
  });

  it('rejects accessor/sparse/extra-property grants without invoking hidden values', () => {
    const getter = vi.fn(() => 'open');
    const array = Object.defineProperty(['open'], '0', { get: getter, enumerable: true });
    for (const value of [array, Array(1), Object.assign(['open'], { nativeId: 1 })]) {
      expect(() => normalizeWindowMenuOperations(value)).toThrow();
    }
    for (const field of ['operation', 'elementLabel']) {
      expect(() => normalizeAgentPreparedActionPublic(Object.defineProperty({ ...action }, field,
        { get: getter, enumerable: true }))).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
