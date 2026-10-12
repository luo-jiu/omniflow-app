import { describe, expect, it, vi } from 'vitest';
import { createAgentToolRegistry } from '../agent-tool-registry';
import { getBuiltInAgentComputerTools } from './computer-tools';

vi.mock('../computer/agent-computer-service-runtime', () => ({ agentComputerRuntime: {} }));

function snapshot(platform = 'darwin') {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform });
    return createAgentToolRegistry(getBuiltInAgentComputerTools()).createSnapshot();
  } finally { Object.defineProperty(process, 'platform', descriptor); }
}
const observationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
const elementId = '43b39553-9a74-4ba1-a976-1a6738397275';

describe('built-in computer input contracts', () => {
  it('registers discovery and control only on macOS', () => {
    expect(snapshot().list().map(tool => tool.name)).toEqual(['computer.windows', 'computer.observe', 'computer.click', 'computer.setText', 'computer.scroll', 'computer.input']);
    expect(snapshot('win32').list()).toEqual([]);
  });
  it('accepts either element identity or coordinates and rejects ambiguous or partial input', () => {
    const tools = snapshot();
    for (const input of [{ observationId, elementId }, { observationId, x: 0, y: 2047 }]) {
      expect(tools.validateInput('computer.click', input).ok).toBe(true);
    }
    for (const input of [{ observationId }, { observationId, x: 1 }, { observationId, elementId, x: 1 },
      { observationId, elementId, y: 1 }, { observationId, elementId, x: 1, y: 2 }, { observationId, elementId: 'AXButton' },
      { observationId, x: 1, y: 2, button: 'right' }, { observationId, x: 1, y: 2, clickCount: 2 },
      { observationId, x: 2048, y: 2 }, { observationId, elementId, pid: 100 }]) {
      expect(tools.validateInput('computer.click', input).ok).toBe(false);
    }
  });
  it('allows a discovered reference or legacy exact labels without mixing selectors', () => {
    const tools = snapshot();
    for (const input of [{}, { windowRef: elementId }, { application: '计算器', windowTitle: '计算器' }]) {
      expect(tools.validateInput('computer.observe', input).ok).toBe(true);
    }
    for (const input of [{ windowRef: elementId, application: '计算器' }, { windowRef: elementId, windowTitle: '计算器' },
      { windowRef: '24' }, { pid: 800 }]) {
      expect(tools.validateInput('computer.observe', input).ok).toBe(false);
    }
    expect(tools.validateInput('computer.windows', { query: 'calc', application: 'Calculator' }).ok).toBe(true);
    expect(tools.validateInput('computer.windows', { query: '', pid: 800 }).ok).toBe(false);
  });
  it('only accepts bounded text and finite semantic scroll routes', () => {
    const tools = snapshot();
    expect(tools.validateInput('computer.setText', { observationId, elementId, mode: 'replace', text: '' }).ok).toBe(true);
    expect(tools.validateInput('computer.setText', { observationId, elementId, mode: 'insert', text: '中文👩🏽‍💻\n' }).ok).toBe(true);
    for (const input of [{ observationId, elementId, mode: 'replace', text: 'x'.repeat(4097) },
      { observationId, elementId, mode: 'type', text: 'x' }, { observationId, x: 1, y: 2, mode: 'replace', text: 'x' },
      { observationId, elementId, mode: 'replace', text: 'x', clipboard: true }]) {
      expect(tools.validateInput('computer.setText', input).ok).toBe(false);
    }
    for (const direction of ['up', 'down', 'left', 'right']) for (const unit of ['page', 'step', 'fraction']) {
      expect(tools.validateInput('computer.scroll', { observationId, elementId, direction, unit }).ok).toBe(true);
    }
    for (const input of [{ observationId, elementId, direction: 'down', unit: 'pixels' },
      { observationId, elementId, direction: 'down', unit: 'page', count: 2 },
      { observationId, x: 1, y: 2, direction: 'down', unit: 'step' },
      { observationId, elementId, direction: 'AXIncrement', unit: 'step' },
      { observationId, elementId, direction: 'down', unit: 'fraction', amount: 0.1 },
      { observationId, elementId, direction: 'down', unit: 'fraction', value: 0.1 },
      { observationId, elementId, direction: 'down', unit: 'fraction', scrollState: { value: 0, minValue: 0, maxValue: 1 } }]) {
      expect(tools.validateInput('computer.scroll', input).ok).toBe(false);
    }
  });

  it('validates independent observation modes and bounded observed-control queries', () => {
    const tools = snapshot();
    for (const mode of ['ax', 'screenshot', 'both']) {
      expect(tools.validateInput('computer.observe', { mode }).ok).toBe(true);
    }
    expect(tools.validateInput('computer.observe', { mode: 'ax', query: 'sidebar', role: 'AXButton', operation: 'press',
      offset: 0, limit: 1, includeChanges: true }).ok).toBe(true);
    for (const input of [{ mode: 'screen' }, { query: '' }, { role: '' }, { operation: 'AXRaise' },
      { offset: -1 }, { limit: 0 }, { limit: 129 }, { includeChanges: 'yes' }, { subtree: [0] }]) {
      expect(tools.validateInput('computer.observe', input).ok).toBe(false);
    }
  });

  it('separates bounded targeted shortcut and pointer gestures without hidden receiver arguments', () => {
    const tools = snapshot();
    const point = { x: 0, y: 2047 };
    const endPoint = { x: 100, y: 20 };
    for (const input of [
      { observationId, operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } },
      { observationId, operation: 'shortcut', shortcut: { key: 'escape', modifiers: [] } },
      { observationId, operation: 'rightClick', point }, { observationId, operation: 'doubleClick', point },
      { observationId, operation: 'drag', point, endPoint, durationMs: 100 },
    ]) expect(tools.validateInput('computer.input', input).ok).toBe(true);
    for (const input of [
      { observationId, operation: 'shortcut', shortcut: { key: 'A', modifiers: ['cmd'] } },
      { observationId, operation: 'shortcut', shortcut: { key: 'a', modifiers: [] } },
      { observationId, operation: 'shortcut', shortcut: { key: 'a', modifiers: ['shift', 'option'] } },
      { observationId, operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command', 'command'] } },
      { observationId, operation: 'shortcut', shortcut: { key: 'a', modifiers: [] }, point },
      { observationId, operation: 'rightClick', point, endPoint },
      { observationId, operation: 'doubleClick', point: { x: 0.5, y: 0 } },
      { observationId, operation: 'drag', point, endPoint, durationMs: 99 },
      { observationId, operation: 'drag', point, endPoint, durationMs: 1001 },
      { observationId, operation: 'drag', point, durationMs: 500 },
      { observationId, operation: 'rightClick', point, pid: 100 },
      { observationId, operation: 'rightClick', point, profile: 'appkit-fixture-v1' },
    ]) expect(tools.validateInput('computer.input', input).ok).toBe(false);
  });

  it('accepts bounded issued-ID focus and rejects mixing it with another window or image-only mode', () => {
    const tools = snapshot();
    const focus = { observationId, elementId };
    for (const input of [{ focus }, { focus, mode: 'ax', query: 'toolbar' }, { focus: { ...focus, ancestorLevels: 3 }, mode: 'both' }]) {
      expect(tools.validateInput('computer.observe', input).ok).toBe(true);
    }
    for (const input of [{ focus, windowRef: elementId }, { focus, application: 'Finder' }, { focus, windowTitle: 'Files' },
      { focus, mode: 'screenshot' }, { focus: { ...focus, ancestorLevels: 4 } }, { focus: { ...focus, ancestorLevels: -1 } },
      { focus: { ...focus, ancestorLevels: 0.5 } }, { focus: { ...focus, path: [0] } }, { focus: { observationId } },
      { focus: { ...focus, elementId: 'AXButton' } }]) {
      expect(tools.validateInput('computer.observe', input).ok).toBe(false);
    }
  });

  it('rejects every partial or mixed gesture payload after compacting the schema', () => {
    const tools = snapshot();
    const payload = { shortcut: { key: 'a', modifiers: ['command'] }, point: { x: 1, y: 2 },
      endPoint: { x: 3, y: 4 }, durationMs: 100 };
    const entries = Object.entries(payload);
    for (const [operation, allowedMask] of [['shortcut', 1], ['rightClick', 2], ['doubleClick', 2], ['drag', 14]] as const) {
      for (let mask = 0; mask < 16; mask += 1) {
        const input = { observationId, operation, ...Object.fromEntries(entries.filter((_, index) => mask & (1 << index))) };
        expect(tools.validateInput('computer.input', input).ok, `${operation} payload ${mask}`).toBe(mask === allowedMask);
      }
    }
  });

});
