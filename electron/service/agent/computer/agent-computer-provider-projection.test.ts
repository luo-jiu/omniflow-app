import { describe, expect, it } from 'vitest';

import type { AgentToolResult } from '../../../../src/shared/agent/agent.types';
import { projectAgentToolResultForProvider } from '../agent-tool-result-projection';
import { AGENT_COMPUTER_PROVIDER_RESULT_TOKENS, normalizeAgentComputerObservationScopeForProvider } from './agent-computer-provider-projection';
import { COMPUTER_ELEMENT_OPERATIONS } from '../../../../src/shared/computer-use/computer-use-contract';

function reference(index: number): string {
  return `805f4b48-ec6e-4f78-b45b-${index.toString(16).padStart(12, '0')}`;
}

function observationResult(): AgentToolResult {
  return { ok: true, message: '已查看窗口', data: {
    captureScope: 'window', targetId: reference(1000), imageId: reference(1001), observationId: reference(1002),
    applicationLabel: '测试应用', windowLabel: '测试窗口', screenshotWidth: 2048, screenshotHeight: 1280,
    capturedAt: '2026-10-10T03:00:00.000Z', expiresInMs: 60_000, clickReady: true, textReady: true, scrollReady: true, operations: ['press', 'replaceText', 'scrollDownPage'],
    coordinateClickReady: true, candidateScanComplete: true,
    clickMethod: 'AXPress', observationSource: 'screenshot', elementsScope: 'stable-AX-controls',
    elements: Array.from({ length: 128 }, (_, index) => ({ elementId: reference(index), role: 'AXButton',
      operations: ['press', 'replaceText', 'scrollDownPage'], label: `按钮${index}${'中'.repeat(12)}`, description: '界面控件'.repeat(3) })),
    axTree: '中'.repeat(4096), axTreeTruncated: false,
  } };
}

function windowResult(): AgentToolResult {
  return { ok: true, message: '已查找可共享的应用窗口', data: {
    windows: Array.from({ length: 64 }, (_, index) => ({ windowRef: reference(index),
      applicationLabel: '应'.repeat(200), windowLabel: '窗'.repeat(200) })), truncated: false,
  } };
}

describe('computer provider result projection', () => {
  it.each([AGENT_COMPUTER_PROVIDER_RESULT_TOKENS, 2048])('retains local scope and independent scan completeness under budget %s', budget => {
    const base = observationResult();
    const result: AgentToolResult = { ...base, data: { ...base.data as Record<string, unknown>,
      scope: { kind: 'element-ancestor', ancestorLevels: 2 }, scopeScanComplete: true,
      candidateScanComplete: false, coordinateClickReady: false,
      changeSummary: { baselineAvailable: true, candidateScanComplete: false,
        scopeScanComplete: true, previousScopeScanComplete: false },
    } };
    const projection = projectAgentToolResultForProvider(result, budget, { mode: 'computer-observe' });
    const payload = JSON.parse(projection.content);
    expect(payload.data).toMatchObject({ scope: { kind: 'element-ancestor', ancestorLevels: 2 },
      scopeScanComplete: true, candidateScanComplete: false, coordinateClickReady: false,
      changeSummary: { scopeScanComplete: true, previousScopeScanComplete: false } });
    expect(projection.estimatedTokens).toBeLessThanOrEqual(budget);
    if (budget === 2048) {
      expect(payload.data.elementsTruncated).toBe(true);
      expect(payload.data.axTreeTruncated).toBe(true);
    } else expect(payload).toEqual(result);
  });

  it.each([0, 1, 2, 3])('normalizes only public local scope fields at ancestor level %s', ancestorLevels => {
    const base = observationResult();
    const result = { ...base, data: { ...base.data as Record<string, unknown>,
      scope: { kind: 'element-ancestor', ancestorLevels }, scopeScanComplete: false,
      candidateScanComplete: false, coordinateClickReady: false } };
    expect(normalizeAgentComputerObservationScopeForProvider(result)).toEqual(result);
  });

  it('keeps legacy window observations exact and supports explicit window scope', () => {
    const legacy = observationResult();
    expect(normalizeAgentComputerObservationScopeForProvider(legacy)).toBe(legacy);
    const current = { ...legacy, data: { ...legacy.data as Record<string, unknown>,
      scope: { kind: 'window' }, scopeScanComplete: false } };
    expect(JSON.parse(projectAgentToolResultForProvider(current, AGENT_COMPUTER_PROVIDER_RESULT_TOKENS,
      { mode: 'computer-observe' }).content)).toEqual(current);
  });

  it.each([AGENT_COMPUTER_PROVIDER_RESULT_TOKENS, 1024])(
    'rejects scoped observations without an own enumerable data array of controls under budget %s', budget => {
      const base = observationResult();
      for (const invalid of ['missing', 'null', 'hidden', 'accessor'] as const) {
        let reads = 0;
        const data: Record<string, unknown> = {
          ...base.data as Record<string, unknown>, scope: { kind: 'window' }, scopeScanComplete: true,
        };
        if (invalid === 'missing') delete data.elements;
        if (invalid === 'null') data.elements = null;
        if (invalid === 'hidden') Object.defineProperty(data, 'elements', { enumerable: false, value: [] });
        if (invalid === 'accessor') Object.defineProperty(data, 'elements', {
          enumerable: true, get: () => { reads += 1; return []; },
        });
        expect(() => projectAgentToolResultForProvider({ ...base, data }, budget,
          { mode: 'computer-observe' })).toThrow('观察范围无效');
        expect(reads).toBe(0);
      }
    },
  );

  it.each([
    { scope: null }, { scope: [] }, { scope: 'window' }, { scope: {} }, { scope: { kind: 'unknown' } },
    { scope: { kind: 'window', ancestorLevels: 0 } },
    { scope: { kind: 'element-ancestor' } }, { scope: { kind: 'element-ancestor', ancestorLevels: -1 } },
    { scope: { kind: 'element-ancestor', ancestorLevels: 4 } }, { scope: { kind: 'element-ancestor', ancestorLevels: 0.5 } },
    { scope: { kind: 'element-ancestor', ancestorLevels: '0' } },
    { scope: { kind: 'element-ancestor', ancestorLevels: 0, path: [0, 1] } },
    { scope: { kind: 'element-ancestor', ancestorLevels: 0, anchor: { nativeId: 'private' } } },
    { scopeScanComplete: undefined }, { scopeScanComplete: 'true' },
    { candidateScanComplete: true }, { coordinateClickReady: true },
    { changeSummary: { scopeScanComplete: false } }, { changeSummary: { previousScopeScanComplete: 1 } },
  ])('rejects malformed, private or broadened scope even with a full Provider budget: %j', invalid => {
    const base = observationResult();
    const result = { ...base, data: { ...base.data as Record<string, unknown>,
      scope: { kind: 'element-ancestor', ancestorLevels: 0 }, scopeScanComplete: true,
      candidateScanComplete: false, coordinateClickReady: false, ...invalid } };
    expect(() => projectAgentToolResultForProvider(result, AGENT_COMPUTER_PROVIDER_RESULT_TOKENS,
      { mode: 'computer-observe' })).toThrow('观察范围无效');
  });

  it('rejects accessors and hidden private scope fields without invoking them', () => {
    let reads = 0;
    const base = observationResult();
    const scope = Object.defineProperty({}, 'kind', { enumerable: true, get: () => { reads += 1; return 'window'; } });
    const result = { ...base, data: { ...base.data as Record<string, unknown>, scope, scopeScanComplete: true } };
    expect(() => projectAgentToolResultForProvider(result, AGENT_COMPUTER_PROVIDER_RESULT_TOKENS,
      { mode: 'computer-observe' })).toThrow('观察范围无效');
    expect(reads).toBe(0);
    result.data.scope = Object.defineProperty({ kind: 'window' }, 'path', { value: [0], enumerable: false });
    expect(() => normalizeAgentComputerObservationScopeForProvider(result)).toThrow('观察范围无效');
    delete (result.data as Record<string, unknown>).scope;
    expect(() => normalizeAgentComputerObservationScopeForProvider(result)).toThrow('观察范围无效');
  });

  it.each([AGENT_COMPUTER_PROVIDER_RESULT_TOKENS, 1024])('retains explicit fraction permissions and complete control capabilities under budget %s', budget => {
    const base = observationResult();
    const original = base.data as Record<string, unknown>;
    const operations = ['scrollUpFraction', 'scrollDownFraction', 'scrollUpStep', 'scrollDownStep'];
    const result: AgentToolResult = { ...base, data: { ...original, operations: [...COMPUTER_ELEMENT_OPERATIONS],
      elements: (original.elements as Record<string, unknown>[]).map(element => ({ ...element, role: 'AXScrollBar', operations })) } };
    const projection = projectAgentToolResultForProvider(result, budget, { mode: 'computer-observe' });
    const payload = JSON.parse(projection.content);
    expect(payload.data.operations).toEqual(COMPUTER_ELEMENT_OPERATIONS);
    expect(payload.data.elements.length).toBeGreaterThan(0);
    expect(payload.data.elements.every((element: Record<string, unknown>) => JSON.stringify(element.operations) === JSON.stringify(operations))).toBe(true);
    if (budget === AGENT_COMPUTER_PROVIDER_RESULT_TOKENS) {
      expect(payload).toEqual(result);
      expect(projection.truncated).toBe(false);
    }
  });

  it('preserves AX-only observation and query identity while explicitly omitting optional diffs under context pressure', () => {
    const base = observationResult();
    const data = { ...base.data as Record<string, unknown> };
    delete data.imageId;
    delete data.screenshotWidth;
    delete data.screenshotHeight;
    const result = { ...base, data: { ...data, mode: 'ax', observationSource: 'ax', coordinateClickReady: false,
      totalMatched: 128, offset: 0, limit: 128, hasMore: false, searchScope: 'observed-controls',
      changeSummary: { baselineAvailable: true, candidateScanComplete: false, noLongerObserved: 2 },
      changes: { noLongerObserved: [{ label: 'Old control', role: 'AXButton', operations: ['press'] }] } } };
    const projection = projectAgentToolResultForProvider(result, 2048, { mode: 'computer-observe' });
    const payload = JSON.parse(projection.content);
    expect(payload.data).toMatchObject({ mode: 'ax', observationSource: 'ax', coordinateClickReady: false,
      totalMatched: 128, offset: 0, limit: 128, hasMore: false, searchScope: 'observed-controls',
      changeSummary: { baselineAvailable: true, candidateScanComplete: false, noLongerObserved: 2 }, changesOmittedForContext: true });
    expect(payload.data).not.toHaveProperty('imageId');
    expect(payload.data).not.toHaveProperty('screenshotWidth');
    expect(payload.data.elementsTruncated).toBe(true);
    expect(payload.data.elements).toEqual(data.elements && (data.elements as unknown[]).slice(0, payload.data.elements.length));
  });

  it('delivers all 128 controls and the complete 12 KiB Chinese AX summary under its dedicated budget', () => {
    const result = observationResult();
    const projection = projectAgentToolResultForProvider(result, AGENT_COMPUTER_PROVIDER_RESULT_TOKENS,
      { mode: 'computer-observe' });
    expect(projection.truncated).toBe(false);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(AGENT_COMPUTER_PROVIDER_RESULT_TOKENS);
    expect(JSON.parse(projection.content)).toEqual(result);
  });

  it.each([AGENT_COMPUTER_PROVIDER_RESULT_TOKENS, 1024])(
    'preserves screenshot text identity and complete pixel rectangles under budget %s', budget => {
      const base = observationResult();
      const original = base.data as Record<string, unknown>;
      const elements = (original.elements as Array<{ elementId: string }>).map(({ elementId }, index) => ({
        elementId, role: 'AXTextArea', label: '原生文本区域', labelSource: 'native-text-screenshot-bounds',
        screenshotBounds: { x: index * 10, y: index * 5, width: 2048 - index * 10, height: 1280 - index * 5 },
        operations: ['replaceText', 'insertText'],
      }));
      const result: AgentToolResult = { ...base, data: { ...original, elements,
        clickReady: false, textReady: true, scrollReady: false,
        coordinateClickReady: false, candidateScanComplete: false,
        notice: '控件扫描不完整；仅可使用本次确认的 elementId。',
      } };
      const projection = projectAgentToolResultForProvider(result, budget, { mode: 'computer-observe' });
      const payload = JSON.parse(projection.content);
      expect(projection.estimatedTokens).toBeLessThanOrEqual(budget);
      expect(payload.data).toMatchObject({ imageId: reference(1001), screenshotWidth: 2048, screenshotHeight: 1280,
        clickReady: false, textReady: true, coordinateClickReady: false, candidateScanComplete: false,
      });
      expect(payload.data.elements.length).toBeGreaterThan(0);
      expect(payload.data.elements).toEqual(elements.slice(0, payload.data.elements.length));
      if (budget === AGENT_COMPUTER_PROVIDER_RESULT_TOKENS) {
        expect(payload).toEqual(result);
        expect(projection.truncated).toBe(false);
      } else {
        expect(payload.data.elements.length).toBeLessThan(elements.length);
        expect(payload.data.elementsTruncated).toBe(true);
        expect(payload.data.omittedElements).toBe(elements.length - payload.data.elements.length);
        expect(projection.truncated).toBe(true);
      }
    });

  it('delivers 64 complete window references even when both labels reach 200 Chinese characters', () => {
    const result = windowResult();
    const projection = projectAgentToolResultForProvider(result, AGENT_COMPUTER_PROVIDER_RESULT_TOKENS,
      { mode: 'computer-windows' });
    expect(projection.truncated).toBe(false);
    expect(JSON.parse(projection.content)).toEqual(result);
  });

  it('keeps observation identity and whole control records when remaining context is small', () => {
    const result = observationResult();
    const projection = projectAgentToolResultForProvider(result, 1024, { mode: 'computer-observe' });
    const payload = JSON.parse(projection.content);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(1024);
    expect(payload).toMatchObject({ ok: true, _omniflowProjection: { truncated: true }, data: {
      captureScope: 'window', targetId: reference(1000), imageId: reference(1001), observationId: reference(1002),
      screenshotWidth: 2048, screenshotHeight: 1280, elementsTruncated: true, axTreeTruncated: true,
      clickReady: true, textReady: true, scrollReady: true, operations: ['press', 'replaceText', 'scrollDownPage'], coordinateClickReady: true, candidateScanComplete: true,
    } });
    expect(payload.data.elements.length).toBeGreaterThan(0);
    expect(payload.data.elements).toEqual((result.data as { elements: unknown[] }).elements.slice(0, payload.data.elements.length));
    expect(payload.data.omittedElements).toBe(128 - payload.data.elements.length);
    expect(projection.truncated).toBe(true);
  });

  it.each([
    { candidateScanComplete: false, budget: AGENT_COMPUTER_PROVIDER_RESULT_TOKENS },
    { candidateScanComplete: false, budget: 1024 },
    { candidateScanComplete: true, budget: AGENT_COMPUTER_PROVIDER_RESULT_TOKENS },
    { candidateScanComplete: true, budget: 1024 },
  ])('preserves semantic-only click restrictions independently of context clipping: %j', ({ candidateScanComplete, budget }) => {
    const base = observationResult();
    const result: AgentToolResult = { ...base, data: {
      ...(base.data as Record<string, unknown>),
      candidateScanComplete, coordinateClickReady: false,
      notice: candidateScanComplete ? '部分控件在截图期间变化；请使用 elementId。' : '控件扫描不完整；请使用 elementId。',
    } };
    const projection = projectAgentToolResultForProvider(result, budget, { mode: 'computer-observe' });
    const payload = JSON.parse(projection.content);
    expect(payload.data).toMatchObject({
      observationId: reference(1002), clickReady: true, coordinateClickReady: false, candidateScanComplete,
      notice: (result.data as Record<string, unknown>).notice,
    });
    expect(payload.data.elements.length).toBeGreaterThan(0);
    expect(payload.data.elements).toEqual((result.data as { elements: unknown[] }).elements.slice(0, payload.data.elements.length));
    if (budget === 1024) {
      expect(payload.data.elementsTruncated).toBe(true);
      expect(payload.data.omittedElements).toBe(128 - payload.data.elements.length);
    } else {
      expect(JSON.parse(projection.content)).toEqual(result);
    }
    expect(projection.estimatedTokens).toBeLessThanOrEqual(budget);
  });

  it('marks partial discovery and preserves every returned window reference and label exactly', () => {
    const result = windowResult();
    const projection = projectAgentToolResultForProvider(result, 1024, { mode: 'computer-windows' });
    const payload = JSON.parse(projection.content);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(1024);
    expect(payload.data.windows.length).toBeGreaterThan(0);
    expect(payload.data.windows).toEqual((result.data as { windows: unknown[] }).windows.slice(0, payload.data.windows.length));
    expect(payload.data.truncated).toBe(true);
    expect(payload.data.omittedWindows).toBe(64 - payload.data.windows.length);
    expect(projection.truncated).toBe(true);
  });

  it('shortens AX independently after retaining every actionable control', () => {
    const result = observationResult();
    const projection = projectAgentToolResultForProvider(result, 10_000, { mode: 'computer-observe' });
    const payload = JSON.parse(projection.content);
    expect(payload.data.elements).toEqual((result.data as { elements: unknown[] }).elements);
    expect(payload.data.elementsTruncated).toBe(false);
    expect(payload.data.axTreeTruncated).toBe(true);
    expect(payload.data.axTree.length).toBeGreaterThan(0);
    expect(payload.data.axTree.length).toBeLessThan(4096);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(10_000);
  });

  it('fails clearly when the observation identity itself cannot fit', () => {
    expect(() => projectAgentToolResultForProvider(observationResult(), 1, { mode: 'computer-observe' }))
      .toThrow('窗口观察身份');
  });
});
