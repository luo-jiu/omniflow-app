import { describe, expect, it, vi } from 'vitest';
import { createAgentToolRegistry, type AgentToolExecutionContext, type AgentToolMainPreparationContext } from '../agent-tool-registry';
import { getBuiltInAgentComputerTools, isBuiltinComputerHidePointerTool } from './computer-tools';

const runtime = vi.hoisted(() => ({
  prepareWindows: vi.fn(), prepareObserve: vi.fn(), prepareClick: vi.fn(),
  prepareSetText: vi.fn(), prepareScroll: vi.fn(), prepareInput: vi.fn(), prepareMenu: vi.fn(), menu: vi.fn(),
}));
vi.mock('../computer/agent-computer-service-runtime', () => ({ agentComputerRuntime: runtime }));

function snapshot(platform = 'darwin') {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform });
    return createAgentToolRegistry(getBuiltInAgentComputerTools()).createSnapshot();
  } finally { Object.defineProperty(process, 'platform', descriptor); }
}
const observationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
const elementId = '43b39553-9a74-4ba1-a976-1a6738397275';
const titledToolCases = [
  { name: 'computer.windows', prepare: 'prepareWindows', input: { query: '文本编辑' } },
  { name: 'computer.observe', prepare: 'prepareObserve', input: { mode: 'ax', focus: { observationId, elementId } } },
  { name: 'computer.click', prepare: 'prepareClick', input: { observationId, elementId } },
  { name: 'computer.setText', prepare: 'prepareSetText', input: { observationId, elementId, mode: 'replace', text: '测试正文' } },
  { name: 'computer.scroll', prepare: 'prepareScroll', input: { observationId, elementId, direction: 'down', unit: 'page' } },
  { name: 'computer.input', prepare: 'prepareInput', input: { observationId, operation: 'rightClick', point: { x: 10, y: 20 } } },
  { name: 'computer.menu', prepare: 'prepareMenu', input: { observationId, elementId, operation: 'open' } },
] as const;

describe('built-in computer input contracts', () => {
  it('registers discovery and control only on macOS', () => {
    expect(snapshot().list().map(tool => tool.name)).toEqual(['computer.windows', 'computer.observe', 'computer.click', 'computer.setText', 'computer.scroll', 'computer.input', 'computer.menu', 'computer.hidePointer']);
    expect(snapshot('win32').list()).toEqual([]);
  });
  it('only accepts empty pointer cleanup input and requires the current-Run main closure', async () => {
    const tools = snapshot();
    const tool = tools.get('computer.hidePointer')!;
    expect(tools.validateInput(tool.name, {}).ok).toBe(true);
    for (const input of [null, [], '', { runId: observationId }, { windowRef: elementId }, { ownerWebContentsId: 77 }, { all: true },
      { title: '' }, { title: '隐藏操作箭头' }]) {
      expect(tools.validateInput(tool.name, input).ok).toBe(false);
    }
    const signal = new AbortController().signal;
    const context: AgentToolExecutionContext = {
      appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] }, onProgress: vi.fn(), signal,
    };
    expect(await tool.assess!({}, context)).toMatchObject({ behavior: 'deny', risk: 'read' });
    expect(await tool.execute!({}, context)).toMatchObject({ ok: false });
    const result = { ok: false, message: 'AI箭头关闭未确认', data: { closeConfirmed: false } };
    const hideComputerPointer = vi.fn(async () => result);
    const controlled = { ...context, hideComputerPointer };
    expect(await tool.assess!({}, controlled)).toEqual({ behavior: 'allow', risk: 'read' });
    expect(await tool.execute!({}, controlled)).toBe(result);
    expect(hideComputerPointer).toHaveBeenCalledOnce();
    expect(hideComputerPointer).toHaveBeenCalledWith(signal);
    expect(tool.prepareMain).toBeUndefined();
  });
  it('recognizes only the exact builtin main read lifecycle implementation', () => {
    const tool = snapshot().get('computer.hidePointer')!;
    expect(isBuiltinComputerHidePointerTool(tool)).toBe(true);
    for (const changed of [
      { name: 'computer.observe' }, { registrationId: 'builtin:computer.hidePointer@999' },
      { executor: 'renderer' as const }, { kind: 'control' as const }, { risk: 'write' as const },
      { pluginOperation: 'rename' as const }, { execute: undefined },
      { createRendererRequest: () => ({}) }, { createRendererPrepareRequest: () => ({}) },
      { prepareMain: () => { throw new Error('unused'); } },
      { finalizeRendererPreparation: () => { throw new Error('unused'); } }, { preparedRisk: 'dynamic' as const },
      { pluginSource: { pluginId: 'test', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64), toolId: tool.name, registrationId: tool.registrationId } },
    ]) expect(isBuiltinComputerHidePointerTool({ ...tool, ...changed })).toBe(false);
    expect(isBuiltinComputerHidePointerTool()).toBe(false);
  });
  it('accepts an optional bounded step title for each host operation without making it required', () => {
    const tools = snapshot();
    for (const { name, input } of titledToolCases) {
      expect(tools.validateInput(name, input).ok, `${name} without title`).toBe(true);
      for (const title of ['', '验证关闭按钮', '查看当前选区', '窗'.repeat(80), '🪟'.repeat(80)]) {
        expect(tools.validateInput(name, { ...input, title }).ok, `${name} valid title`).toBe(true);
      }
      for (const title of [null, 12, false, [], {}, '窗'.repeat(81), '🪟'.repeat(81)]) {
        expect(tools.validateInput(name, { ...input, title }).ok, `${name} invalid title`).toBe(false);
      }
    }
  });
  it('removes only the display title before calling the real registered preparation hook', async () => {
    const tools = snapshot();
    const context = { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
      signal: new AbortController().signal } as unknown as AgentToolMainPreparationContext;
    const prepared = { binding: { frozenTarget: true }, decision: { behavior: 'allow', risk: 'read' },
      publicAction: { kind: 'computer.windows', version: 1, libraryId: 3 } };
    for (const { name, prepare, input } of titledToolCases) {
      const prepareRuntime = runtime[prepare].mockResolvedValue(prepared);
      for (const title of [undefined, '', ' 验证关闭按钮 ']) {
        const supplied = Object.freeze({ ...input, ...(title === undefined ? {} : { title }) });
        expect(tools.validateInput(name, supplied).ok).toBe(true);
        expect(await tools.get(name)!.prepareMain!(supplied, undefined, context)).toBe(prepared);
        expect(prepareRuntime).toHaveBeenLastCalledWith(input, context);
        expect(prepareRuntime.mock.lastCall![0]).not.toHaveProperty('title');
        expect(supplied).toEqual({ ...input, ...(title === undefined ? {} : { title }) });
      }
    }
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
  it('exposes menu observation and forwards only main-owned menu preparation and commit settlement', async () => {
    const tools = snapshot();
    for (const mode of ['ax', 'both', 'screenshot']) expect(tools.validateInput('computer.observe', { scope: 'menu', mode }).ok).toBe(true);
    for (const invalid of [{ scope: 'other' }, { scope: 'menu', focus: { observationId, elementId } },
      { scope: 'menu', operation: 'press' }, { scope: 'menu', includeChanges: false }]) {
      expect(tools.validateInput('computer.observe', invalid).ok).toBe(false);
    }
    for (const operation of ['open', 'press', 'cancel']) expect(tools.validateInput('computer.menu', { observationId, elementId, operation }).ok).toBe(true);
    for (const invalid of [{ observationId, elementId, operation: 'hover' }, { observationId, elementId, operation: 'press', itemId: 'native' },
      { observationId, elementId, operation: 'press', x: 10 }, { observationId, operation: 'press' }]) {
      expect(tools.validateInput('computer.menu', invalid).ok).toBe(false);
    }
    const preparation = { marker: 'main-preparation' } as unknown as AgentToolExecutionContext['preparation'];
    const commitSettlement = { begin: vi.fn(), settle: vi.fn() };
    const signal = new AbortController().signal;
    const context: AgentToolExecutionContext = { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
      signal, preparation, commitSettlement, onProgress: vi.fn() };
    runtime.menu.mockResolvedValueOnce({ ok: true });
    await tools.get('computer.menu')!.execute!({ forged: 'model-input' }, context);
    expect(runtime.menu).toHaveBeenCalledWith(preparation, signal, commitSettlement);
    await expect(tools.get('computer.menu')!.execute!({}, { ...context, preparation: undefined })).rejects.toThrow(/已批准/);
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
      { observationId, operation: 'click', point },
      { observationId, operation: 'typeText', text: '中文🌟\r\n\t' },
      { observationId, operation: 'typeText', text: '🌟'.repeat(4096) },
      { observationId, operation: 'scroll', point, deltaX: 0, deltaY: -1000 },
      { observationId, operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } },
      { observationId, operation: 'shortcut', shortcut: { key: 'escape', modifiers: [] } },
      { observationId, operation: 'rightClick', point }, { observationId, operation: 'doubleClick', point },
      { observationId, operation: 'drag', point, endPoint, durationMs: 100 },
    ]) expect(tools.validateInput('computer.input', input).ok).toBe(true);
    for (const input of [
      { observationId, operation: 'click', point, text: 'must not leak' },
      { observationId, operation: 'typeText', text: '' },
      { observationId, operation: 'typeText', text: 'x'.repeat(4097) },
      { observationId, operation: 'typeText', text: 'x', point },
      { observationId, operation: 'scroll', point, deltaX: 0, deltaY: 0 },
      { observationId, operation: 'scroll', point, deltaX: 0, deltaY: -1001 },
      { observationId, operation: 'scroll', point, deltaX: 0, deltaY: -1, text: 'x' },
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
        for (const title of [undefined, '', '验证关闭按钮']) {
          const input = { observationId, operation, ...Object.fromEntries(entries.filter((_, index) => mask & (1 << index))),
            ...(title === undefined ? {} : { title }) };
          expect(tools.validateInput('computer.input', input).ok, `${operation} payload ${mask}, title ${String(title)}`).toBe(mask === allowedMask);
        }
      }
    }
  });

});
