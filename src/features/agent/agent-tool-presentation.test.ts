import { describe, expect, it } from 'vitest';

import type { AgentComputerInputPreparedActionPublicV1, AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import {
  buildAgentToolPresentation,
  buildAgentToolSummary,
  getAgentToolNameTitle,
} from './agent-tool-presentation';

function completedActivity(
  toolName: string,
  data: unknown,
): AgentToolActivitySnapshot {
  return {
    call: { id: 'call-1', input: {}, name: toolName },
    createdAt: '2026-08-23T00:00:00.000Z',
    finishedAt: '2026-08-23T00:00:01.000Z',
    id: 'activity-1',
    ordinal: 1,
    permissionBehavior: 'allow',
    revision: 1,
    result: { data, message: '完成', ok: true },
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
  };
}

const IMAGE_ID = 'eddf85c3-f841-46a2-8016-2a061b58983e';
const OBSERVATION_ID = '237e3952-2a40-4c7b-b2f4-bec335a79cce';
const WINDOW_TARGET_ID = '12022dc1-f61c-4c2a-aac6-2963b60e5f7a';

function computerObservation(): AgentToolActivitySnapshot {
  return {
    ...completedActivity('computer.observe', {
      imageId: IMAGE_ID, observationId: OBSERVATION_ID, displayId: '1', screenshotWidth: 1024, screenshotHeight: 640,
      url: 'https://untrusted.invalid/image.png', screenshotPath: '/private/screenshot.png',
    }),
    toolMetadata: { kind: 'business', risk: 'read', builtinComputerTool: 'observe' },
    preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: {
      kind: 'computer.observe', version: 1, libraryId: 3, displayId: '1', displayLabel: '内置屏幕',
    } },
  };
}

function computerClick(): AgentToolActivitySnapshot {
  return {
    ...completedActivity('computer.click', {
      operation: 'computer.click', operationId: 'activity-1', dispatchState: 'dispatched', mutationCommitState: 'committed',
      observationId: OBSERVATION_ID, displayId: '1', x: 300, y: 200,
    }),
    toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: 'click' },
    preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: {
      kind: 'computer.click', version: 1, libraryId: 3, displayId: '1', displayLabel: '内置屏幕', observationId: OBSERVATION_ID,
      screenshotWidth: 1024, screenshotHeight: 640, x: 300, y: 200, button: 'left', clickCount: 1,
    } },
  };
}

function directedWindowInput(operation: AgentComputerInputPreparedActionPublicV1['operation'] = 'shortcut'): AgentToolActivitySnapshot {
  const identity = { libraryId: 3, targetId: WINDOW_TARGET_ID, applicationLabel: 'OmniFlow', windowLabel: '测试窗口', observationId: OBSERVATION_ID };
  const fields = operation === 'shortcut' ? { operation, shortcut: { key: 'a' as const, modifiers: ['command' as const] } }
    : operation === 'drag' ? { operation, point: { x: 10, y: 20 }, endPoint: { x: 30, y: 40 }, durationMs: 100 }
      : { operation, point: { x: 10, y: 20 } };
  return { ...completedActivity('computer.input', { ...identity, ...fields, operation: 'computer.input', inputOperation: operation,
    operationId: 'activity-1', dispatchState: 'dispatched', mutationCommitState: 'committed',
    inputMethod: 'CGEventPostToPid', releaseState: 'confirmed', nextAction: 'observe', retryAllowed: false }),
  toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: 'input' },
  preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: { kind: 'computer.input', version: 1, ...identity, ...fields } } };
}

describe('directed window input presentation', () => {
  it.each([['shortcut', '已发送快捷键'], ['rightClick', '已发送右键'], ['doubleClick', '已发送双击'], ['drag', '已发送拖拽']] as const)(
    'shows %s as a compact dispatch record without asserting target success', (operation, label) => {
      const source = directedWindowInput(operation);
      expect(buildAgentToolSummary(source, 3)).toEqual({ label, ...(operation === 'shortcut' ? { subject: 'Command + A' } : {}) });
      expect(buildAgentToolPresentation(source, 3)).toEqual([]);
    },
  );

  it.each([
    ['operation', 'computer.click'], ['inputOperation', 'rightClick'], ['operationId', 'other-tool'], ['targetId', IMAGE_ID],
    ['libraryId', 4], ['windowLabel', 'Other'], ['observationId', IMAGE_ID], ['dispatchState', 'unknown'],
    ['mutationCommitState', 'commit_unknown'], ['nextAction', 'retry'], ['retryAllowed', true],
    ['inputMethod', 'global'], ['releaseState', 'unconfirmed'], ['shortcut', { key: 'b', modifiers: ['command'] }],
  ])('keeps details when directed input %s mismatches the immutable action', (field, value) => {
    const source = directedWindowInput();
    (source.result!.data as Record<string, unknown>)[String(field)] = value;
    expect(buildAgentToolSummary(source, 3).label).not.toContain('已发送');
    expect(buildAgentToolPresentation(source, 3)).not.toEqual([]);
  });

  it('does not compact an input from untrusted origin or wrong library, and retains unknown failure guidance', () => {
    const source = directedWindowInput();
    for (const untrusted of [{ ...source, toolMetadata: undefined }, { ...source, pluginSource: { pluginId: 'fake',
      pluginVersion: '1', packageFingerprint: 'a', toolId: 'input', registrationId: 'builtin:computer.input@1' } }]) {
      expect(buildAgentToolSummary(untrusted, 3).label).not.toContain('已发送');
      expect(buildAgentToolPresentation(untrusted, 3)).not.toEqual([]);
    }
    expect(buildAgentToolSummary(source, 4).label).not.toContain('已发送');
    source.status = 'failed'; source.result = { ok: false, message: '输入结果不确定，请重新查看，勿重复发送', data: { dispatchState: 'unknown' } };
    expect(buildAgentToolPresentation(source, 3)).toEqual([{ type: 'notice', tone: 'danger', message: source.result.message }]);
  });
});

function windowObservation(): AgentToolActivitySnapshot {
  return { ...computerObservation(),
    preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: {
      kind: 'computer.observe', version: 2, libraryId: 3, targetId: WINDOW_TARGET_ID,
      applicationLabel: 'OmniFlow', windowLabel: 'win 的聊天窗口',
    } },
    result: { ok: true, message: '已查看窗口', data: {
      captureScope: 'window', targetId: WINDOW_TARGET_ID, imageId: IMAGE_ID, observationId: OBSERVATION_ID,
      screenshotWidth: 1024, screenshotHeight: 640,
    } },
  };
}

const ELEMENT_ID = 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba';

function computerInput(operation: 'setText' | 'scroll'): AgentToolActivitySnapshot {
  const identity = { libraryId: 3, targetId: WINDOW_TARGET_ID, applicationLabel: 'OmniFlow',
    windowLabel: '测试窗口', observationId: OBSERVATION_ID, elementId: ELEMENT_ID };
  const operationFields = operation === 'setText'
    ? { mode: 'insert' as const, textLength: 2, textBytes: 6 }
    : { direction: 'down' as const, unit: 'page' as const };
  return {
    ...completedActivity(`computer.${operation}`, {
      ...identity, ...operationFields, operation: `computer.${operation}`, operationId: 'activity-1',
      dispatchState: 'dispatched', mutationCommitState: 'committed', nextAction: 'observe', retryAllowed: false,
    }),
    call: { id: 'call-1', name: `computer.${operation}`, input: { text: 'private input body' } },
    toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: operation },
    preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: operation === 'setText'
      ? { kind: 'computer.setText', version: 1, ...identity, mode: 'insert', textLength: 2, textBytes: 6 }
      : { kind: 'computer.scroll', version: 1, ...identity, direction: 'down', unit: 'page' } },
  };
}

function semanticClick(): AgentToolActivitySnapshot {
  const identity = { libraryId: 3, targetId: WINDOW_TARGET_ID, applicationLabel: 'OmniFlow',
    windowLabel: '测试窗口', observationId: OBSERVATION_ID, elementId: ELEMENT_ID };
  return { ...computerClick(),
    preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: {
      kind: 'computer.click', version: 3, ...identity, button: 'left', clickCount: 1,
    } },
    result: { ok: true, message: '已发送点击', data: {
      ...identity, operation: 'computer.click', operationId: 'activity-1', dispatchState: 'dispatched',
      mutationCommitState: 'committed', nextAction: 'observe', retryAllowed: false,
    } },
  };
}

function axObservation(): AgentToolActivitySnapshot {
  const activity = windowObservation();
  activity.preparation!.action = { ...activity.preparation!.action, mode: 'ax' } as never;
  activity.result!.data = { captureScope: 'window', targetId: WINDOW_TARGET_ID, observationId: OBSERVATION_ID,
    observationSource: 'ax', axTree: 'AXWindow "OmniFlow"', axTreeTruncated: false,
    elements: [{ elementId: ELEMENT_ID, role: 'AXButton', label: '显示边栏', operations: ['press'] }] };
  return activity;
}

describe('Agent Tool presentation registry', () => {
  it.each([false, true])('projects local AX scope without presenting it as a complete window: %s', scopeScanComplete => {
    const activity = axObservation();
    Object.assign(activity.result!.data as Record<string, unknown>, {
      scope: { kind: 'element-ancestor', ancestorLevels: 1 }, scopeScanComplete,
      candidateScanComplete: false, coordinateClickReady: false,
    });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([
      { type: 'computer-ax', tree: 'AXWindow "OmniFlow"', truncated: false,
        scope: { kind: 'element-ancestor', ancestorLevels: 1 }, scopeScanComplete },
      { type: 'details', title: '控件', entries: [{ label: '显示边栏', value: 'AXButton · 点击' }] },
    ]);
  });

  it.each([
    { scope: null }, { scope: [] }, { scope: 'window' }, { scope: {} }, { scope: { kind: 'unknown' } },
    { scope: { kind: 'window', ancestorLevels: 0 } }, { scope: { kind: 'element-ancestor' } },
    { scope: { kind: 'element-ancestor', ancestorLevels: -1 } }, { scope: { kind: 'element-ancestor', ancestorLevels: 4 } },
    { scope: { kind: 'element-ancestor', ancestorLevels: 1.5 } }, { scope: { kind: 'element-ancestor', ancestorLevels: '0' } },
    { scope: { kind: 'element-ancestor', ancestorLevels: 0, path: [0] } },
    { scope: { kind: 'element-ancestor', ancestorLevels: 0, anchor: 'private' } },
    { scopeScanComplete: undefined }, { scopeScanComplete: 'true' },
    { candidateScanComplete: true }, { coordinateClickReady: true },
  ])('suppresses scoped AX and controls on invalid scope while preserving the approved window image: %j', invalid => {
    const activity = axObservation();
    Object.assign(activity.result!.data as Record<string, unknown>, {
      scope: { kind: 'element-ancestor', ancestorLevels: 0 }, scopeScanComplete: true,
      candidateScanComplete: false, coordinateClickReady: false, ...invalid,
    });
    const blocks = buildAgentToolPresentation(activity, 3);
    expect(blocks).not.toContainEqual(expect.objectContaining({ type: 'computer-ax' }));
    expect(blocks).not.toContainEqual(expect.objectContaining({ type: 'details' }));
    const window = windowObservation();
    Object.assign(window.result!.data as Record<string, unknown>, activity.result!.data, { observationSource: 'screenshot' });
    expect(buildAgentToolPresentation(window, 3)).toEqual([{
      type: 'attachment-image', attachmentId: IMAGE_ID, alt: 'OmniFlow · win 的聊天窗口的窗口截图',
    }]);
  });

  it('rejects hidden private scope fields and accessors without evaluating them', () => {
    const activity = axObservation();
    let reads = 0;
    const data = activity.result!.data as Record<string, unknown>;
    data.scopeScanComplete = true;
    data.scope = Object.defineProperty({}, 'kind', { enumerable: true, get: () => { reads += 1; return 'window'; } });
    expect(buildAgentToolPresentation(activity, 3)).not.toContainEqual(expect.objectContaining({ type: 'computer-ax' }));
    expect(reads).toBe(0);
    data.scope = Object.defineProperty({ kind: 'window' }, 'path', { value: [0], enumerable: false });
    expect(buildAgentToolPresentation(activity, 3)).not.toContainEqual(expect.objectContaining({ type: 'computer-ax' }));
    delete data.scope;
    expect(buildAgentToolPresentation(activity, 3)).not.toContainEqual(expect.objectContaining({ type: 'computer-ax' }));
  });

  it('shows AX and declared controls without requesting or inventing an image', () => {
    const activity = axObservation();
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '已查看窗口' });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([
      { type: 'computer-ax', tree: 'AXWindow "OmniFlow"', truncated: false },
      { type: 'details', title: '控件', entries: [{ label: '显示边栏', value: 'AXButton · 点击' }] },
    ]);
    Object.assign(activity.result!.data as Record<string, unknown>, {
      imageId: IMAGE_ID, screenshotWidth: 1024, screenshotHeight: 640,
    });
    expect(buildAgentToolPresentation(activity, 3)).not.toContainEqual(expect.objectContaining({ type: 'attachment-image' }));
  });

  it('shows declared first-party controls even when an AX-only observation has no AX tree', () => {
    const activity = axObservation();
    const data = activity.result!.data as Record<string, unknown>;
    delete data.axTree; delete data.axTreeTruncated;
    data.elements = [{ elementId: ELEMENT_ID, role: 'TextArea', label: 'Agent 输入',
      source: 'omniflow-control', operations: ['replaceText', 'insertText'], screenshotBounds: { x: 0, y: 0 } }];
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{ type: 'details', title: '控件',
      entries: [{ label: 'Agent 输入', value: 'TextArea · 替换文本、插入文本' }] }]);
    expect(JSON.stringify(buildAgentToolPresentation(activity, 3))).not.toContain('screenshotBounds');
  });

  it.each(['wrong-source', 'wrong-target', 'wrong-library', 'plugin', 'missing-provenance'] as const)(
    'does not expose AX-only controls from %s', reason => {
      let activity = axObservation();
      const data = activity.result!.data as Record<string, unknown>;
      if (reason === 'wrong-source') data.observationSource = 'screenshot';
      if (reason === 'wrong-target') data.targetId = ELEMENT_ID;
      if (reason === 'missing-provenance') activity.toolMetadata = undefined;
      if (reason === 'plugin') activity = { ...activity, pluginSource: { pluginId: 'fake', pluginVersion: '1', packageFingerprint: 'a'.repeat(64),
        toolId: 'computer.observe', registrationId: 'fake' } };
      const blocks = buildAgentToolPresentation(activity, reason === 'wrong-library' ? 4 : 3);
      expect(blocks).not.toContainEqual(expect.objectContaining({ type: 'computer-ax' }));
      expect(blocks).not.toContainEqual(expect.objectContaining({ type: 'details', title: '控件' }));
    },
  );

  it.each([
    { elementId: 'AXButton' }, { role: '' }, { label: '\u202eunsafe' }, { label: 'x'.repeat(201) },
    { operations: ['arbitrary-click'] }, { operations: ['press', 'press'] },
  ])('omits invalid AX-only controls while retaining the real AX tree: %j', invalid => {
    const activity = axObservation();
    const data = activity.result!.data as Record<string, unknown>;
    data.elements = [{ elementId: ELEMENT_ID, role: 'AXButton', label: '显示边栏', operations: ['press'], ...invalid }];
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{ type: 'computer-ax', tree: 'AXWindow "OmniFlow"', truncated: false }]);
  });

  it('does not show AX or controls on screenshot-only observations', () => {
    const activity = windowObservation();
    activity.preparation!.action = { ...activity.preparation!.action, mode: 'screenshot' } as never;
    Object.assign(activity.result!.data as Record<string, unknown>, {
      observationSource: 'screenshot', axTree: 'AXWindow "OmniFlow"', axTreeTruncated: false,
      elements: [{ elementId: ELEMENT_ID, role: 'AXButton', label: '显示边栏', operations: ['press'] }],
    });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      type: 'attachment-image', attachmentId: IMAGE_ID, alt: 'OmniFlow · win 的聊天窗口的窗口截图',
    }]);
  });

  it('keeps committed semantic clicks compact without coordinates', () => {
    const activity = semanticClick();
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '已发送点击' });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([]);
    activity.status = 'running';
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '正在点击窗口' });
  });

  it.each([
    ['operation', 'computer.setText'], ['operationId', 'another-tool'], ['libraryId', 4],
    ['targetId', ELEMENT_ID], ['observationId', ELEMENT_ID], ['elementId', WINDOW_TARGET_ID],
    ['applicationLabel', 'Another App'], ['windowLabel', 'Another Window'],
    ['dispatchState', 'unknown'], ['mutationCommitState', 'commit_unknown'],
    ['nextAction', 'retry'], ['retryAllowed', true],
  ])('preserves semantic click details when %s does not match its prepared action', (field, value) => {
    const activity = semanticClick();
    (activity.result!.data as Record<string, unknown>)[String(field)] = value;
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '点击窗口' });
    expect(buildAgentToolPresentation(activity, 3)).not.toEqual([]);
  });
  it.each([
    ['file.stage', '暂存文件'],
    ['file.publish', '发布 Agent 输出'],
    ['file.upload', '上传本机文件'],
    ['computer.observe', '查看屏幕'],
    ['computer.click', '点击屏幕'],
    ['computer.setText', '输入文本'],
    ['computer.scroll', '滚动窗口'],
  ])('uses a readable title for %s', (toolName, title) => {
    expect(getAgentToolNameTitle(toolName)).toBe(title);
  });

  it.each([
    ['computer.observe', '已查看屏幕'],
    ['computer.click', '点击屏幕'],
  ])('keeps %s compact without exposing screenshot references or raw Tool input', (name, label) => {
    const activity = completedActivity(name, { imageId: 'private-ref', screenshotPath: '/private/screenshot.png', x: 500, y: 400 });
    activity.call.input = { displayLabel: 'forged label', arbitraryHtml: '<script>bad()</script>' };
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{ message: '完成', tone: 'success', type: 'notice' }]);
    activity.status = 'running';
    expect(buildAgentToolSummary(activity, 3).label).toBe(`正在${getAgentToolNameTitle(name)}`);
  });

  it('projects a managed screenshot reference only from the proven built-in observation', () => {
    const activity = computerObservation();
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      type: 'attachment-image', attachmentId: IMAGE_ID, alt: '内置屏幕的屏幕截图',
    }]);
    const output = JSON.stringify(buildAgentToolPresentation(activity, 3));
    expect(output).not.toContain('/private/');
    expect(output).not.toContain('https://untrusted.invalid');
    expect(output).not.toContain('base64');
  });

  it('labels and previews a frozen shared window while retaining historical display screenshots', () => {
    const activity = windowObservation();
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '已查看窗口' });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      type: 'attachment-image', attachmentId: IMAGE_ID, alt: 'OmniFlow · win 的聊天窗口的窗口截图',
    }]);
    activity.status = 'running';
    expect(buildAgentToolSummary(activity, 3).label).toBe('正在查看窗口');
    expect(buildAgentToolPresentation(computerObservation(), 3)).toContainEqual({
      type: 'attachment-image', attachmentId: IMAGE_ID, alt: '内置屏幕的屏幕截图',
    });
  });

  it.each(['display-capture', 'wrong-target', 'missing-scope'] as const)('rejects a shared-window image with %s', reason => {
    const activity = windowObservation();
    const data = activity.result!.data as Record<string, unknown>;
    if (reason === 'display-capture') data.captureScope = 'display';
    if (reason === 'wrong-target') data.targetId = '225e4470-7819-4fa1-bbcb-c805f3e4eac9';
    if (reason === 'missing-scope') delete data.captureScope;
    expect(buildAgentToolPresentation(activity, 3)).not.toContainEqual(expect.objectContaining({ type: 'attachment-image' }));
  });

  it('adds a bounded plain AX summary for the same approved window alongside its screenshot', () => {
    const activity = windowObservation();
    const tree = 'AXWindow "win 的聊天窗口"\n  AXButton "<img src=x onerror=alert(1)>"';
    Object.assign(activity.result!.data as Record<string, unknown>, { axTree: tree, axTreeTruncated: true });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([
      { type: 'attachment-image', attachmentId: IMAGE_ID, alt: 'OmniFlow · win 的聊天窗口的窗口截图' },
      { type: 'computer-ax', tree, truncated: true },
    ]);
  });

  it('can show a real window-bound AX observation when no valid screenshot reference is present', () => {
    const activity = windowObservation();
    const data = activity.result!.data as Record<string, unknown>;
    delete data.imageId;
    Object.assign(data, { axTree: 'AXWindow "OmniFlow"', axTreeTruncated: false });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{ type: 'computer-ax', tree: data.axTree, truncated: false }]);
  });

  it.each(['missing-provenance', 'plugin', 'wrong-target', 'display-capture', 'wrong-library', 'historical-display', 'wrong-observation'] as const)(
    'does not expose AX from an observation with %s', reason => {
      let activity = reason === 'historical-display' ? computerObservation() : windowObservation();
      const data = activity.result!.data as Record<string, unknown>;
      Object.assign(data, { axTree: 'AXWindow "Private title"', axTreeTruncated: false });
      if (reason === 'missing-provenance') activity.toolMetadata = undefined;
      if (reason === 'plugin') activity = { ...activity, pluginSource: {
        pluginId: 'fake', pluginVersion: '1', packageFingerprint: 'a'.repeat(64), toolId: 'computer.observe', registrationId: 'plugin-tool:fake',
      } };
      if (reason === 'wrong-target') data.targetId = '225e4470-7819-4fa1-bbcb-c805f3e4eac9';
      if (reason === 'display-capture') data.captureScope = 'display';
      if (reason === 'wrong-observation') data.observationId = 'not-a-uuid';
      expect(buildAgentToolPresentation(activity, reason === 'wrong-library' ? 4 : 3))
        .not.toContainEqual(expect.objectContaining({ type: 'computer-ax' }));
    },
  );

  it.each([
    { axTree: '', axTreeTruncated: false }, { axTree: 'AXWindow', axTreeTruncated: 'false' },
    { axTree: 'x'.repeat(12 * 1024 + 1), axTreeTruncated: true },
    { axTree: '窗'.repeat(4097), axTreeTruncated: true },
    { axTree: { role: 'AXWindow' }, axTreeTruncated: false },
    { axTree: 'AXWindow\u0000title', axTreeTruncated: false },
    { axTree: 'AXWindow\u202etitle', axTreeTruncated: false },
    { axTree: 'AXWindow\ud800', axTreeTruncated: false },
  ])('hides invalid AX content without losing the screenshot', invalid => {
    const activity = windowObservation();
    Object.assign(activity.result!.data as Record<string, unknown>, invalid);
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      type: 'attachment-image', attachmentId: IMAGE_ID, alt: 'OmniFlow · win 的聊天窗口的窗口截图',
    }]);
  });

  it('uses the committed window-target receipt for the compact click line', () => {
    const activity: AgentToolActivitySnapshot = { ...computerClick(),
      preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.click', version: 2, libraryId: 3, targetId: WINDOW_TARGET_ID,
        applicationLabel: 'OmniFlow', windowLabel: 'win 的聊天窗口', observationId: OBSERVATION_ID,
        screenshotWidth: 1024, screenshotHeight: 640, x: 300, y: 200, button: 'left', clickCount: 1,
      } },
      result: { ok: true, message: '已发送点击', data: {
        operation: 'computer.click', operationId: 'activity-1', dispatchState: 'dispatched', mutationCommitState: 'committed',
        observationId: OBSERVATION_ID, targetId: WINDOW_TARGET_ID, x: 300, y: 200,
      } },
    };
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '已发送点击' });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([]);
    (activity.result!.data as Record<string, unknown>).targetId = '225e4470-7819-4fa1-bbcb-c805f3e4eac9';
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '点击窗口' });
    expect(buildAgentToolPresentation(activity, 3)).not.toEqual([]);
  });

  it.each([
    'missing provenance', 'plugin source', 'missing action', 'wrong library', 'wrong display',
    'invalid image id', 'invalid observation id', 'invalid dimensions', 'failed result',
  ])('does not preview an observation with %s', (reason) => {
    let activity = computerObservation();
    const data = activity.result!.data as Record<string, unknown>;
    if (reason === 'missing provenance') activity.toolMetadata = undefined;
    if (reason === 'plugin source') activity = { ...activity, pluginSource: {
      pluginId: 'computer', pluginVersion: '1', packageFingerprint: 'a'.repeat(64),
      toolId: 'computer.observe', registrationId: 'plugin-tool:' + 'b'.repeat(64),
    } };
    if (reason === 'missing action') activity.preparation = undefined;
    if (reason === 'wrong display') data.displayId = '2';
    if (reason === 'invalid image id') data.imageId = 'https://untrusted.invalid/screenshot.png';
    if (reason === 'invalid observation id') data.observationId = 'fake';
    if (reason === 'invalid dimensions') data.screenshotWidth = '1024';
    if (reason === 'failed result') activity.result!.ok = false;
    expect(buildAgentToolPresentation(activity, reason === 'wrong library' ? 4 : 3))
      .not.toContainEqual(expect.objectContaining({ type: 'attachment-image' }));
  });

  it('keeps an authoritative dispatched click on one line while preserving uncertain results', () => {
    const activity = computerClick();
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: '已发送点击' });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([]);
    activity.status = 'failed';
    activity.result = { ok: false, message: '点击结果不确定，请重新查看屏幕，勿直接重复点击',
      data: { ...(activity.result?.data as Record<string, unknown>), dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } };
    expect(buildAgentToolSummary(activity, 3).label).not.toContain('已发送');
    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      type: 'notice', tone: 'danger', message: '点击结果不确定，请重新查看屏幕，勿直接重复点击',
    }]);
  });

  it.each(['missing provenance', 'mismatched receipt'])('does not hide click details with %s', (reason) => {
    const activity = computerClick();
    if (reason === 'missing provenance') activity.toolMetadata = undefined;
    else (activity.result!.data as Record<string, unknown>).operationId = 'other-tool';
    expect(buildAgentToolSummary(activity, 3).label).not.toContain('已发送');
    expect(buildAgentToolPresentation(activity, 3)).not.toEqual([]);
  });

  it.each(['setText', 'scroll'] as const)('keeps a proven %s receipt on one operation line without exposing input', operation => {
    const activity = computerInput(operation);
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: operation === 'setText' ? '已发送文本输入' : '已发送滚动' });
    expect(buildAgentToolPresentation(activity, 3)).toEqual([]);
    expect(JSON.stringify(buildAgentToolSummary(activity, 3))).not.toContain('private input body');
    activity.status = 'running';
    expect(buildAgentToolSummary(activity, 3)).toEqual({ label: operation === 'setText' ? '正在输入文本' : '正在滚动窗口' });
  });

  it.each((['setText', 'scroll'] as const).flatMap(operation => [
    ['operation', 'computer.click'], ['operationId', 'other-tool'], ['libraryId', 4],
    ['targetId', ELEMENT_ID], ['applicationLabel', 'Other App'], ['windowLabel', 'Other Window'],
    ['observationId', ELEMENT_ID], ['elementId', WINDOW_TARGET_ID],
    ['dispatchState', 'unknown'], ['mutationCommitState', 'commit_unknown'],
    ['nextAction', 'retry'], ['retryAllowed', true],
    ...(operation === 'setText' ? [['mode', 'replace'], ['textLength', 3], ['textBytes', 7]]
      : [['direction', 'up'], ['unit', 'step']]),
  ].map(([field, value]) => [operation, field, value] as const)))(
    'preserves %s details when the receipt %s mismatches', (operation, field, value) => {
      const activity = computerInput(operation);
      (activity.result!.data as Record<string, unknown>)[String(field)] = value;
      expect(buildAgentToolSummary(activity, 3).label).not.toContain('已发送');
      expect(buildAgentToolPresentation(activity, 3)).not.toEqual([]);
    },
  );

  it.each((['setText', 'scroll'] as const).flatMap(operation => (
    ['missing-provenance', 'control-provenance', 'plugin', 'wrong-library', 'malformed-action', 'mismatched-marker', 'failed', 'unknown'] as const
  ).map(reason => [operation, reason] as const)))(
    'does not hide %s audit details for %s', (operation, reason) => {
      let activity = computerInput(operation);
      if (reason === 'missing-provenance') activity.toolMetadata = undefined;
      if (reason === 'control-provenance') activity.toolMetadata!.kind = 'control';
      if (reason === 'plugin') activity = { ...activity, pluginSource: { pluginId: 'fake', pluginVersion: '1',
        packageFingerprint: 'a'.repeat(64), toolId: `computer.${operation}`, registrationId: 'plugin-tool:fake' } };
      if (reason === 'malformed-action') activity.preparation!.action = { ...activity.preparation!.action, text: 'private body' } as never;
      if (reason === 'mismatched-marker') activity.toolMetadata!.builtinComputerTool = 'click';
      if (reason === 'failed' || reason === 'unknown') {
        activity.status = 'failed';
        activity.result = { ...activity.result!, ok: false, message: '未确认界面结果，请重新查看；不要重复发送',
          ...(reason === 'unknown' ? { data: { ...activity.result!.data as Record<string, unknown>,
            dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } } : {}) };
      }
      const libraryId = reason === 'wrong-library' ? 4 : 3;
      expect(buildAgentToolSummary(activity, libraryId).label).not.toContain('已发送');
      expect(buildAgentToolPresentation(activity, libraryId)).not.toEqual([]);
      expect(JSON.stringify(buildAgentToolPresentation(activity, libraryId))).not.toContain('private');
      if (reason === 'failed' || reason === 'unknown') expect(buildAgentToolPresentation(activity, libraryId)).toEqual([
        { type: 'notice', tone: 'danger', message: '未确认界面结果，请重新查看；不要重复发送' },
      ]);
    },
  );

  it('shows preparation as an active state instead of a failure', () => {
    const activity = completedActivity('media.extractAudio', {});
    activity.status = 'preparing';
    activity.result = undefined;

    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      label: '正在准备执行目标',
      tone: 'info',
      type: 'status',
    }]);
  });

  it('creates only a semantic tree action for a persisted library artifact', () => {
    const blocks = buildAgentToolPresentation(completedActivity('media.extractAudio', {
      createdNodeId: 22,
      format: 'm4a',
      name: 'movie-audio.m4a',
      parentId: 10,
      verified: true,
    }), 3);

    expect(blocks).toEqual([expect.objectContaining({
      actions: [{
        action: 'tree.revealNode',
        label: '在目录树中定位',
        libraryId: 3,
        nodeId: 22,
      }],
      artifact: expect.objectContaining({ kind: 'audio', name: 'movie-audio.m4a', nodeId: 22 }),
      type: 'artifact',
    })]);
  });

  it('whitelists media metadata instead of rendering arbitrary Tool result fields', () => {
    const blocks = buildAgentToolPresentation(completedActivity('media.inspect', {
      file: { name: 'movie.mp4', nodeId: 8 },
      format: {
        durationSeconds: 62,
        longName: 'QuickTime / MOV',
        secret: 'must-not-render',
        sizeBytes: 1024,
      },
      sourceUrl: 'https://storage.example/signed?secret=value',
      streamCount: 2,
    }), 3);

    expect(JSON.stringify(blocks)).toContain('QuickTime / MOV');
    expect(JSON.stringify(blocks)).not.toContain('must-not-render');
    expect(JSON.stringify(blocks)).not.toContain('sourceUrl');
    expect(JSON.stringify(blocks)).not.toContain('storage.example');
  });

  it('does not create an artifact action for an invalid node identity', () => {
    const blocks = buildAgentToolPresentation(completedActivity('directory.create', {
      createdNodeId: 0,
      name: '测试',
    }), 3);

    expect(blocks).toEqual([{ message: '完成', tone: 'success', type: 'notice' }]);
  });

  it('keeps Shell result metadata and output out of the generic presentation registry', () => {
    const blocks = buildAgentToolPresentation(completedActivity('shell.run', {
      durationMs: 13,
      exitCode: 0,
      status: 'completed',
      stderrTail: 'private stderr',
      stdoutTail: 'private stdout',
      previewTruncated: true,
    }), 3);

    expect(blocks).toEqual([{ message: '完成', tone: 'success', type: 'notice' }]);
    expect(JSON.stringify(blocks)).not.toContain('durationMs');
    expect(JSON.stringify(blocks)).not.toContain('exitCode');
    expect(JSON.stringify(blocks)).not.toContain('private stderr');
    expect(JSON.stringify(blocks)).not.toContain('private stdout');
    expect(JSON.stringify(blocks)).not.toContain('previewTruncated');
  });

  it('projects only controlled choice fields from a persisted interaction', () => {
    const activity = completedActivity('interaction.request', {});
    activity.status = 'awaiting_interaction';
    activity.interaction = {
      interactionId: 'interaction-1',
      request: {
        kind: 'choice',
        options: [
          { description: '说明', id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        prompt: '请选择',
        submitLabel: '继续',
        title: '确认格式',
      },
      status: 'pending',
    };

    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      interactionId: 'interaction-1',
      options: [
        { description: '说明', id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      prompt: '请选择',
      status: 'pending',
      submitLabel: '继续',
      title: '确认格式',
      type: 'choice',
    }]);
  });

  it('keeps a submitted form response read-only in its controlled projection', () => {
    const activity = completedActivity('interaction.request', {});
    activity.interaction = {
      interactionId: 'interaction-2',
      request: {
        fields: [{ id: 'name', label: '名称', required: true, type: 'text' }],
        kind: 'form',
        prompt: '请输入名称',
      },
      response: { kind: 'form', values: { name: '测试' } },
      status: 'submitted',
    };

    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      fields: [{ id: 'name', label: '名称', required: true, type: 'text' }],
      interactionId: 'interaction-2',
      prompt: '请输入名称',
      response: { kind: 'form', values: { name: '测试' } },
      status: 'submitted',
      type: 'form',
    }]);
  });
});

function renameActivity(): AgentToolActivitySnapshot {
  const operationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
  return { ...completedActivity('example.rename.propose', {
    operationId, mutationCommitState: 'committed', items: [{ nodeId: 11, parentId: 10, name: 'new', ext: 'txt' }],
  }), pluginSource: { pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.rename.propose', registrationId: `plugin-tool:${'b'.repeat(64)}` },
  preparation: { preparedActionId: 'prepared', snapshotHash: 'c'.repeat(64), action: {
    kind: 'plugin.rename', version: 1, libraryId: 3, operationId, pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64),
    items: [{ nodeId: 11, parentId: 10, oldName: 'old.txt', newName: 'new.txt' }],
  } } };
}

describe('plugin rename receipt presentation', () => {
  it('offers a fixed query action only for an approved unknown plugin operation', () => {
    const activity = renameActivity(); activity.status = 'interrupted';
    activity.result = { ok: false, data: { ...(activity.result!.data as object), mutationCommitState: 'commit_unknown' } };
    activity.approval = { approvalId: 'approval', status: 'approved', preview: { title: '', description: '', risk: 'write' } };
    const block = buildAgentToolPresentation(activity, 3).find(item => item.type === 'details' && item.title === '提交回执');
    expect(block).toMatchObject({ actions: [{ action: 'agent.operation.reconcile', label: '查询回执', libraryId: 3,
      sessionId: activity.sessionId, toolRunId: activity.id, expectedRevision: activity.revision }] });
    activity.approval.status = 'denied';
    expect(buildAgentToolPresentation(activity, 3).some(item => item.type === 'details' && item.actions?.length)).toBe(false);
    const old = completedActivity('file.upload', { uploadCommitState: 'commit_unknown' }); old.status = 'failed';
    expect(buildAgentToolPresentation(old, 3).some(item => item.type === 'details' && item.actions?.length)).toBe(false);
  });
  it('shows host-recorded source and the matching committed receipt without exposing arbitrary fields', () => {
    const activity = renameActivity();
    activity.result!.data = { ...(activity.result!.data as object), source: 'forged plugin', secretUrl: 'https://example.invalid/private' };
    const blocks = buildAgentToolPresentation(activity, 3);
    expect(blocks).toContainEqual({ type: 'details', title: '提交回执', entries: [
      { label: '操作 ID', value: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68' }, { label: '提交状态', value: '已提交' },
    ] });
    expect(JSON.stringify(blocks)).toContain('example.rename');
    expect(JSON.stringify(blocks)).not.toContain('forged plugin'); expect(JSON.stringify(blocks)).not.toContain('secretUrl');
  });

  it.each(['uncommitted', 'commit_unknown'] as const)('preserves %s after failure or cancellation', state => {
    for (const status of ['failed', 'cancelled', 'interrupted'] as const) {
      const activity = renameActivity(); activity.status = status;
      activity.result = { ok: false, data: { ...(activity.result!.data as object), mutationCommitState: state } };
      const blocks = buildAgentToolPresentation(activity, 3);
      expect(JSON.stringify(blocks)).toContain(state === 'uncommitted' ? '未提交' : '尚不能确认，请查询回执');
      expect(blocks).not.toContainEqual(expect.objectContaining({ tone: 'success' }));
    }
  });

  it('does not label mismatched, failed or malformed claimed receipts as committed', () => {
    for (const change of [{ operationId: 'other' }, { items: [] }, { items: [{ nodeId: 99, parentId: 10, name: 'new', ext: 'txt' }] }]) {
      const activity = renameActivity(); activity.result!.data = { ...(activity.result!.data as object), ...change };
      expect(JSON.stringify(buildAgentToolPresentation(activity, 3))).toContain('尚不能确认，请查询回执');
    }
    const failed = renameActivity(); failed.status = 'failed'; failed.result!.ok = false;
    expect(JSON.stringify(buildAgentToolPresentation(failed, 3))).toContain('尚不能确认，请查询回执');
    const mismatchedFailure = renameActivity(); mismatchedFailure.result!.data = { ...(mismatchedFailure.result!.data as object), mutationCommitState: 'uncommitted' };
    expect(JSON.stringify(buildAgentToolPresentation(mismatchedFailure, 3))).toContain('尚不能确认，请查询回执');
  });

  it('does not fabricate a rename receipt from result fields, foreign sources or another library', () => {
    const activity = renameActivity();
    for (const invalid of [{ ...activity, pluginSource: undefined }, { ...activity, preparation: undefined },
      { ...activity, pluginSource: { ...activity.pluginSource!, pluginVersion: '9.0.0' } }]) {
      expect(buildAgentToolPresentation(invalid, 3)).not.toContainEqual(expect.objectContaining({ title: '提交回执' }));
    }
    expect(buildAgentToolPresentation(activity, 4)).not.toContainEqual(expect.objectContaining({ title: '提交回执' }));
  });
});
