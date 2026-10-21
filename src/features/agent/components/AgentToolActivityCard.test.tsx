import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerStyleSheet } from 'styled-components';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentOwnerScope,
  AgentShellPreparedActionPublicV1,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import type { AgentShellLogPageV1 } from '@/shared/agent/shell/agent-shell.types';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { previewAgentAttachment, readAgentShellLogPage } from '../services/agent.api';
import AgentToolActivityCard from './AgentToolActivityCard';
import AgentToolActivityGroup from './AgentToolActivityGroup';
import AgentActivityText from './AgentActivityText';
import AgentConfirmationCard from './AgentConfirmationCard';
import AgentInteractionBlock from './AgentInteractionBlock';

vi.mock('@douyinfe/semi-icons', () => ({
  IconAlertCircle: () => null,
  IconChevronRightStroked: () => null,
  IconFile: () => null,
  IconFolder: () => null,
  IconTickCircle: () => null,
}));

vi.mock('../services/agent.api', () => ({
  previewAgentAttachment: vi.fn(),
  readAgentShellLogPage: vi.fn(),
}));

vi.mock('./AgentConfirmationCard', () => ({
  default: () => React.createElement('div', { 'data-testid': 'confirmation-card' }),
}));

vi.mock('./AgentInteractionBlock', () => ({
  default: () => null,
}));

vi.mock('./AgentAttachmentPreview', () => ({
  default: () => null,
}));

const OWNER_SCOPE: AgentOwnerScope = {
  accountScope: 'account-7',
  backendScope: 'https://api.example.test',
};
const renderers: TestRenderer.ReactTestRenderer[] = [];
const readShellLogPageMock = vi.mocked(readAgentShellLogPage);

describe('plugin operation receipt action', () => {
  it('renders the fixed query action and disables it while the host query is pending', () => {
    const operationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
    const activity: AgentToolActivitySnapshot = { id: 'rename-tool', sessionId: 'session', runId: 'run', ordinal: 1, revision: 4, createdAt: '', status: 'interrupted', permissionBehavior: 'ask',
      call: { id: 'call', name: 'example.rename.propose', input: {} },
      pluginSource: { pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.rename.propose', registrationId: `plugin-tool:${'b'.repeat(64)}` },
      approval: { approvalId: 'approval', status: 'approved', preview: { title: '', description: '', risk: 'write' } },
      preparation: { preparedActionId: 'prepared', snapshotHash: 'c'.repeat(64), action: { kind: 'plugin.rename', version: 1, libraryId: 3, operationId,
        pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), items: [{ nodeId: 11, parentId: 10, oldName: 'old.txt', newName: 'new.txt' }] } },
      result: { ok: false, data: { mutationCommitState: 'commit_unknown', operationId } },
    };
    const onAction = vi.fn();
    const props = { activity, onAction, approvalBusy: false, interactionBusy: false, libraryId: 3, ownerScope: OWNER_SCOPE, onResolveApproval: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(AgentToolActivityCard, props)); }); renderers.push(renderer);
    const button = renderer.root.findAllByType('button').find(node => node.children.includes('查询回执'))!;
    expect(button.props.disabled).toBe(false); act(() => button.props.onClick());
    expect(onAction).toHaveBeenCalledWith({ action: 'agent.operation.reconcile', label: '查询回执', libraryId: 3, sessionId: 'session', toolRunId: 'rename-tool', expectedRevision: 4 });
    act(() => renderer.update(React.createElement(AgentToolActivityCard, { ...props, receiptBusy: true })));
    expect(renderer.root.findAllByType('button').find(node => node.children.includes('正在查询回执…'))?.props.disabled).toBe(true);
  });
});

function shellAction(command = 'pwd\nprintf "done"'): AgentShellPreparedActionPublicV1 {
  return {
    aiDestination: {
      identityHash: `v1:${'a'.repeat(64)}`,
      profileLabel: 'Local AI',
      providerType: 'openai',
    },
    assessment: {
      facets: ['filesystem.read', 'process_launch'],
      operations: [{ argvPrefix: [], effects: ['filesystem.read'], executable: 'pwd' }],
      persistentRuleEligible: false,
      risk: 'read',
      unresolved: [],
    },
    command,
    commandHash: `sha256:${'b'.repeat(64)}`,
    cwd: { kind: 'run-workspace', path: 'work' },
    dataScope: { stagedInputs: [], unresolvedWorkspaceRead: false },
    environment: [],
    kind: 'shell.run',
    provider: { dialect: 'zsh', id: 'system-zsh', version: '5.9' },
    timeoutMs: 10_000,
    version: 1,
  };
}

function shellActivity(
  overrides: Partial<AgentToolActivitySnapshot> = {},
): AgentToolActivitySnapshot {
  return {
    call: { id: 'call-1', input: { command: 'untrusted call input' }, name: 'shell.run' },
    createdAt: '2026-09-02T00:00:00.000Z',
    finishedAt: '2026-09-02T00:00:01.000Z',
    id: 'tool-run-1',
    ordinal: 1,
    permissionBehavior: 'allow',
    preparation: {
      action: shellAction(),
      preparedActionId: 'prepared-1',
      snapshotHash: 'c'.repeat(64),
    },
    result: {
      data: {
        durationMs: 13,
        exitCode: 0,
        previewTruncated: true,
        stderrTail: 'must stay hidden',
        stdoutTail: 'must stay hidden',
      },
      message: 'Shell 命令执行完成',
      ok: true,
    },
    revision: 2,
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
    ...overrides,
  };
}

function logPage(overrides: Partial<AgentShellLogPageV1> = {}): AgentShellLogPageV1 {
  return {
    availableRanges: [{ firstSequence: 1, lastSequence: 1 }],
    executionId: 'execution-1',
    expired: false,
    frames: [{
      executionId: 'execution-1',
      observedAt: '2026-09-02T00:00:00.100Z',
      sequence: 1,
      stream: 'stdout',
      text: 'first page\n',
    }],
    nextAvailableSequence: null,
    pageFirstSequence: 1,
    pageLastSequence: 1,
    requestedAfter: null,
    unavailableThrough: null,
    ...overrides,
  };
}

function renderCard(
  activity: AgentToolActivitySnapshot,
  ownerScope: AgentOwnerScope | null = OWNER_SCOPE,
  onExpand?: () => void,
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(cardElement(activity, ownerScope, 3, onExpand));
  });
  renderers.push(renderer);
  return renderer;
}

function cardElement(
  activity: AgentToolActivitySnapshot,
  ownerScope: AgentOwnerScope | null = OWNER_SCOPE,
  libraryId = 3,
  onExpand?: () => void,
) {
  return React.createElement(AgentToolActivityCard, {
    activity,
    approvalBusy: false,
    interactionBusy: false,
    libraryId,
    onExpand,
    onResolveApproval: vi.fn(),
    ownerScope,
  });
}

function textContent(instance: TestRenderer.ReactTestInstance): string {
  return instance.children.map(child => (
    typeof child === 'string' ? child : textContent(child)
  )).join('');
}

const SCREEN_IMAGE_ID = 'eddf85c3-f841-46a2-8016-2a061b58983e';
const SCREEN_OBSERVATION_ID = '237e3952-2a40-4c7b-b2f4-bec335a79cce';

function observationActivity(): AgentToolActivitySnapshot {
  return {
    ...shellActivity(), call: { id: 'observe-call', name: 'computer.observe', input: {} },
    toolMetadata: { kind: 'business', risk: 'read', builtinComputerTool: 'observe' },
    preparation: { preparedActionId: 'screen-action', snapshotHash: 'a'.repeat(64), action: {
      kind: 'computer.observe', version: 1, libraryId: 3, displayId: '1', displayLabel: '内置屏幕',
    } },
    result: { ok: true, message: '已查看屏幕', data: {
      imageId: SCREEN_IMAGE_ID, observationId: SCREEN_OBSERVATION_ID, displayId: '1', screenshotWidth: 1024, screenshotHeight: 640,
    } },
  };
}

function axControlsActivity(withTree = true): AgentToolActivitySnapshot {
  return {
    ...observationActivity(),
    preparation: { preparedActionId: 'window-action', snapshotHash: 'a'.repeat(64), action: {
      kind: 'computer.observe', version: 2, libraryId: 3, mode: 'ax',
      targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', applicationLabel: 'OmniFlow', windowLabel: 'win',
    } },
    result: { ok: true, data: {
      captureScope: 'window', observationSource: 'ax',
      targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', observationId: SCREEN_OBSERVATION_ID,
      ...(withTree ? { axTree: 'AXWindow "win"\n  AXButton "验证关闭按钮"', axTreeTruncated: false } : {}),
      elements: [{
        elementId: 'e2564a07-1d96-4b28-a5b5-9831aa2fc3fe', label: '验证关闭按钮', role: 'AXButton',
        operations: ['press'], identifier: 'private-ax-identifier', screenshotBounds: { x: 13, y: 27 },
      }, {
        elementId: '64006031-e1a2-456a-a1a6-431c2b24c1e0', label: 'invalid\ncontrol', role: 'AXButton',
        operations: ['press'],
      }],
      elementsTruncated: false,
    } },
  };
}

function disclosure(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('details').find(node => (
    textContent(node.findByType('summary')) === label
  ))!;
}

function finishToolCollapse(renderer: TestRenderer.ReactTestRenderer, propertyName = 'grid-template-rows') {
  const target = {};
  act(() => renderer.root.findByProps({ className: 'agent-activity-collapse' })
    .props.onTransitionEnd?.({ currentTarget: target, target, propertyName }));
}

describe('AgentToolActivityCard computer presentation', () => {
  it('retains AX and controls through the closing transition and releases them only after the height settles', () => {
    const renderer = renderCard(axControlsActivity());
    const toggle = () => act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    toggle();
    act(() => disclosure(renderer, 'AX').props.onToggle({ currentTarget: { open: true } }));
    act(() => disclosure(renderer, '控件').props.onToggle({ currentTarget: { open: true } }));
    toggle();
    const collapse = renderer.root.findByProps({ className: 'agent-activity-collapse' });
    expect(collapse.props['aria-hidden']).toBe(true);
    expect(collapse.props.inert).toBe('');
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    expect(renderer.root.findAllByType('dl')).toHaveLength(1);
    finishToolCollapse(renderer, 'opacity');
    act(() => collapse.props.onTransitionEnd({ currentTarget: {}, target: {}, propertyName: 'grid-template-rows' }));
    expect(renderer.root.findAllByType('details')).toHaveLength(2);
    finishToolCollapse(renderer);
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    toggle();
    expect(disclosure(renderer, 'AX').props.open).toBe(false);
    expect(disclosure(renderer, '控件').props.open).toBe(false);
  });

  it('reverses a closing detail without dropping its content and bounds cleanup when no transition event arrives', () => {
    vi.useFakeTimers();
    const renderer = renderCard(axControlsActivity());
    const toggle = () => act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    toggle();
    act(() => disclosure(renderer, 'AX').props.onToggle({ currentTarget: { open: true } }));
    toggle();
    act(() => { vi.advanceTimersByTime(100); });
    toggle();
    finishToolCollapse(renderer);
    act(() => { vi.advanceTimersByTime(500); });
    expect(renderer.root.findByType('pre').children).toEqual(['AXWindow "win"\n  AXButton "验证关闭按钮"']);
    toggle();
    act(() => { vi.advanceTimersByTime(100); });
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(500); });
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases closing content immediately when reduced motion is requested', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const renderer = renderCard(axControlsActivity());
    const toggle = () => act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    toggle();
    expect(renderer.root.findAllByType('details')).toHaveLength(2);
    toggle();
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
  });

  it('cancels deferred release when the workspace hides or the Tool unmounts during closing', () => {
    vi.useFakeTimers();
    const content = (visible: boolean) => <WorkspaceVisibilityContext.Provider value={visible}>
      {cardElement(axControlsActivity())}
    </WorkspaceVisibilityContext.Provider>;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(content(true)); });
    renderers.push(renderer);
    const toggle = () => act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    toggle();
    toggle();
    act(() => renderer.update(content(false)));
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => renderer.update(content(true)));
    toggle();
    toggle();
    expect(vi.getTimerCount()).toBe(1);
    act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops a closing screenshot on owner changes without loading it in the new scope', async () => {
    vi.useFakeTimers();
    let finish!: (src: string) => void;
    const preview = vi.mocked(previewAgentAttachment);
    preview.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const activity = observationActivity();
    const renderer = renderCard(activity);
    const toggle = () => act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    toggle();
    toggle();
    act(() => renderer.update(cardElement(activity, { ...OWNER_SCOPE, accountScope: 'account-8' })));
    await act(async () => { finish('data:image/png;base64,YQ=='); });
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(preview).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['shortcut', 'rightClick', 'doubleClick', 'drag'] as const)('renders directed %s as a compact row and keeps release uncertainty inspectable', operation => {
    const identity = { libraryId: 3, targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
      applicationLabel: 'OmniFlow', windowLabel: '测试窗口', observationId: SCREEN_OBSERVATION_ID };
    const fields = operation === 'shortcut' ? { operation, shortcut: { key: 'a' as const, modifiers: ['command' as const] } }
      : operation === 'drag' ? { operation, point: { x: 10, y: 20 }, endPoint: { x: 30, y: 40 }, durationMs: 100 }
        : { operation, point: { x: 10, y: 20 } };
    const activity: AgentToolActivitySnapshot = { ...observationActivity(),
      call: { id: 'input-call', name: 'computer.input', input: { key: 'forged', pid: 999 } },
      toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: 'input' },
      preparation: { preparedActionId: 'input-action', snapshotHash: 'a'.repeat(64), action: { kind: 'computer.input', version: 1, ...identity, ...fields } },
      result: { ok: true, message: '已发送，请重新观察确认', data: {
        ...identity, ...fields, operation: 'computer.input', inputOperation: operation, operationId: 'tool-run-1',
        dispatchState: 'dispatched', mutationCommitState: 'committed', nextAction: 'observe', retryAllowed: false,
        inputMethod: 'CGEventPostToPid', releaseState: 'confirmed',
      } } };
    const renderer = renderCard(activity);
    const labels = { shortcut: '已发送快捷键Command + A', rightClick: '已发送右键', doubleClick: '已发送双击', drag: '已发送拖拽' };
    expect(textContent(renderer.root)).toBe(labels[operation]);
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'agent-activity-collapse' })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick).toBeUndefined();
    act(() => renderer.update(cardElement({ ...activity, status: 'failed', result: { ok: false,
      message: '释放结果不确定，请重新观察，勿重复发送', data: { dispatchState: 'unknown', releaseState: 'unconfirmed' } } })));
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-header' }))).not.toContain('已发送');
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(textContent(renderer.root)).toContain('勿重复发送');
    expect(textContent(renderer.root)).not.toContain('forged');
  });
  it('renders the approved local AX range without loading a screenshot or expanding coordinate permission', () => {
    const activity: AgentToolActivitySnapshot = { ...observationActivity(),
      preparation: { preparedActionId: 'window-action', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.observe', version: 2, libraryId: 3, mode: 'ax',
        targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', applicationLabel: 'OmniFlow', windowLabel: 'win',
      } },
      result: { ok: true, data: { captureScope: 'window', observationSource: 'ax',
        targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', observationId: SCREEN_OBSERVATION_ID,
        scope: { kind: 'element-ancestor', ancestorLevels: 0 }, scopeScanComplete: true,
        candidateScanComplete: false, coordinateClickReady: false,
        axTree: 'AXButton "局部目标"', axTreeTruncated: true } },
    };
    const renderer = renderCard(activity);
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(textContent(renderer.root.findByType('summary'))).toBe('AX · 局部');
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('p').children).toEqual(['局部范围：控件自身；控件扫描完整，不代表全窗口。']);
    expect(previewAgentAttachment).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
  });

  it('expands AX-only details without loading an attachment or showing a thumbnail', () => {
    const activity: AgentToolActivitySnapshot = { ...observationActivity(),
      preparation: { preparedActionId: 'window-action', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.observe', version: 2, libraryId: 3, mode: 'ax',
        targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', applicationLabel: 'OmniFlow', windowLabel: 'win',
      } },
      result: { ok: true, data: { captureScope: 'window', observationSource: 'ax',
        targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', observationId: SCREEN_OBSERVATION_ID,
        axTree: 'AXWindow "win"\n  AXButton "展开目录树"', axTreeTruncated: false } },
    };
    const renderer = renderCard(activity);
    expect(textContent(renderer.root)).toBe('已查看窗口');
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(textContent(renderer.root.findByType('summary'))).toBe('AX');
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('pre').children).toEqual(['AXWindow "win"\n  AXButton "展开目录树"']);
    expect(previewAgentAttachment).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    finishToolCollapse(renderer);
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
  });

  it('keeps AX and controls independently closed until requested and resets them when the Tool closes', () => {
    const renderer = renderCard(axControlsActivity());
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(renderer.root.findAllByType('summary').map(textContent)).toEqual(['AX', '控件']);
    expect(disclosure(renderer, 'AX').props.open).toBe(false);
    expect(disclosure(renderer, '控件').props.open).toBe(false);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);

    act(() => disclosure(renderer, '控件').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('dt').children).toEqual(['验证关闭按钮']);
    expect(renderer.root.findByType('dd').children).toEqual(['AXButton · 点击']);
    expect(disclosure(renderer, 'AX').props.open).toBe(false);
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    expect(textContent(renderer.root)).not.toContain('private-ax-identifier');
    expect(textContent(renderer.root)).not.toContain('invalid');

    act(() => disclosure(renderer, 'AX').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('pre').children).toEqual(['AXWindow "win"\n  AXButton "验证关闭按钮"']);
    expect(disclosure(renderer, '控件').props.open).toBe(true);
    act(() => disclosure(renderer, '控件').props.onToggle({ currentTarget: { open: false } }));
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    expect(disclosure(renderer, 'AX').props.open).toBe(true);
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);

    act(() => disclosure(renderer, '控件').props.onToggle({ currentTarget: { open: true } }));
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    finishToolCollapse(renderer);
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(disclosure(renderer, 'AX').props.open).toBe(false);
    expect(disclosure(renderer, '控件').props.open).toBe(false);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    expect(previewAgentAttachment).not.toHaveBeenCalled();
  });

  it('releases controls in a retained Tool when its group closes and remounts the list closed', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentToolActivityGroup activities={[axControlsActivity()]}
      approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={3}
      onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />); });
    renderers.push(renderer);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    act(() => disclosure(renderer, '控件').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findAllByType('dl')).toHaveLength(1);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(disclosure(renderer, '控件').props.open).toBe(false);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    expect(disclosure(renderer, 'AX').props.open).toBe(false);
  });

  it('keeps controls-only observations naturally sized and restores a closed list after workspace hiding', () => {
    const activity = axControlsActivity(false);
    const content = (visible: boolean) => <WorkspaceVisibilityContext.Provider value={visible}>
      {cardElement(activity)}
    </WorkspaceVisibilityContext.Provider>;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(content(true)); });
    renderers.push(renderer);
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    const body = renderer.root.findByProps({ className: 'agent-activity-body' });
    expect(body.props['data-observation']).toBe(true);
    expect(body.props['data-scrollable']).toBeUndefined();
    expect(renderer.root.findAllByType('summary').map(textContent)).toEqual(['控件']);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    act(() => disclosure(renderer, '控件').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('dd').children).toEqual(['AXButton · 点击']);
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    act(() => renderer.update(content(false)));
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    act(() => renderer.update(content(true)));
    expect(disclosure(renderer, '控件').props.open).toBe(false);
    expect(renderer.root.findAllByType('dl')).toHaveLength(0);
    expect(previewAgentAttachment).not.toHaveBeenCalled();
  });

  it('releases expanded AX text when its retained Tool group is collapsed and remounts it closed', async () => {
    vi.mocked(previewAgentAttachment).mockResolvedValue('data:image/png;base64,YQ==');
    const activity: AgentToolActivitySnapshot = { ...observationActivity(),
      preparation: { preparedActionId: 'window-action', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.observe', version: 2, libraryId: 3,
        targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', applicationLabel: 'OmniFlow', windowLabel: 'win',
      } },
      result: { ok: true, data: { captureScope: 'window', targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
        imageId: SCREEN_IMAGE_ID, observationId: SCREEN_OBSERVATION_ID, screenshotWidth: 1024, screenshotHeight: 640,
        axTree: 'AXWindow "win"\n  AXButton "展开目录树"', axTreeTruncated: false } },
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentToolActivityGroup activities={[activity]}
      approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={3}
      onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />); });
    renderers.push(renderer);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    await act(async () => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(textContent(renderer.root.findByType('summary'))).toBe('AX');
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('pre').children).toEqual(['AXWindow "win"\n  AXButton "展开目录树"']);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    await act(async () => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    expect(textContent(renderer.root.findByType('summary'))).toBe('AX');
  });

  it('releases an expanded screenshot when its retained parent Tool group is collapsed', async () => {
    const preview = vi.mocked(previewAgentAttachment);
    let finish!: (src: string) => void;
    preview.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    preview.mockResolvedValueOnce('data:image/png;base64,Yg==');
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<AgentToolActivityGroup activities={[observationActivity()]}
        approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={3}
        onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />);
    });
    renderers.push(renderer);
    expect(preview).not.toHaveBeenCalled();
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(preview).toHaveBeenCalledOnce();
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    await act(async () => { finish('data:image/png;base64,YQ=='); });
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    await act(async () => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(preview).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType('img').props.src).toBe('data:image/png;base64,Yg==');
  });

  it('loads the actual screenshot only while expanded or closing and never repeats the status in its body', async () => {
    const activity = observationActivity();
    const preview = vi.mocked(previewAgentAttachment);
    let finish!: (src: string) => void;
    preview.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    preview.mockResolvedValueOnce('data:image/png;base64,Yg==');
    const renderer = renderCard(activity);
    expect(textContent(renderer.root)).toBe('已查看屏幕');
    expect(preview).not.toHaveBeenCalled();
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(preview).toHaveBeenCalledWith({ id: SCREEN_IMAGE_ID, libraryId: 3, ownerScope: OWNER_SCOPE, sessionId: activity.sessionId });
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    finishToolCollapse(renderer);
    await act(async () => { finish('data:image/png;base64,YQ=='); });
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    await act(async () => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(preview).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType('img').props).toMatchObject({ src: 'data:image/png;base64,Yg==', alt: '内置屏幕的屏幕截图' });
    expect(textContent(renderer.root)).toBe('已查看屏幕');
  });

  it('releases a screenshot inside an open group when its parent Run process is collapsed', async () => {
    const preview = vi.mocked(previewAgentAttachment);
    preview.mockResolvedValue('data:image/png;base64,YQ==');
    const group = (detailsVisible: boolean) => <AgentToolActivityGroup activities={[observationActivity()]}
      detailsVisible={detailsVisible} approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={3}
      onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(group(true)); });
    renderers.push(renderer);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    await act(async () => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(renderer.root.findAllByType('img')).toHaveLength(1);
    act(() => renderer.update(group(false)));
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    await act(async () => renderer.update(group(true)));
    expect(preview).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAllByType('img')).toHaveLength(1);
  });

  it('uses one non-expandable operation line for an authoritative dispatched click', () => {
    const activity: AgentToolActivitySnapshot = {
      ...observationActivity(), call: { id: 'click-call', name: 'computer.click', input: {} },
      toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: 'click' },
      preparation: { preparedActionId: 'click-action', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.click', version: 1, libraryId: 3, displayId: '1', displayLabel: '内置屏幕',
        observationId: SCREEN_OBSERVATION_ID, screenshotWidth: 1024, screenshotHeight: 640,
        x: 300, y: 200, button: 'left', clickCount: 1,
      } },
      result: { ok: true, message: '已发送点击，请重新查看屏幕确认结果', data: {
        operation: 'computer.click', operationId: 'tool-run-1', dispatchState: 'dispatched', mutationCommitState: 'committed',
        observationId: SCREEN_OBSERVATION_ID, displayId: '1', x: 300, y: 200,
      } },
    };
    const renderer = renderCard(activity);
    expect(textContent(renderer.root)).toBe('已发送点击');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'agent-activity-collapse' })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick).toBeUndefined();
    const unknown = { ...activity, status: 'failed' as const,
      result: { ok: false, message: '点击结果不确定，请重新查看屏幕，勿直接重复点击', data: { dispatchState: 'unknown' } } };
    act(() => renderer.update(cardElement(unknown)));
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-header' }))).not.toContain('已发送点击');
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(renderer.root.findByProps({ className: 'agent-activity-collapse' }).props['aria-hidden']).toBe(false);
    expect(textContent(renderer.root)).toContain('勿直接重复点击');
  });

  it.each(['setText', 'scroll'] as const)('shows an authoritative %s as one line and keeps unknown results inspectable', operation => {
    const identity = { libraryId: 3, targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
      applicationLabel: 'OmniFlow', windowLabel: '测试窗口', observationId: SCREEN_OBSERVATION_ID,
      elementId: 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba' };
    const operationFields = operation === 'setText' ? { mode: 'replace' as const, textLength: 2, textBytes: 6 }
      : { direction: 'down' as const, unit: 'page' as const };
    const activity: AgentToolActivitySnapshot = {
      ...observationActivity(), call: { id: 'input-call', name: `computer.${operation}`, input: { text: 'private body' } },
      toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: operation },
      preparation: { preparedActionId: 'input-action', snapshotHash: 'a'.repeat(64), action: operation === 'setText'
        ? { ...identity, kind: 'computer.setText', version: 1, mode: 'replace', textLength: 2, textBytes: 6 }
        : { ...identity, kind: 'computer.scroll', version: 1, direction: 'down', unit: 'page' } },
      result: { ok: true, message: '已发送操作，请重新查看确认结果', data: {
        ...identity, ...operationFields, operation: `computer.${operation}`, operationId: 'tool-run-1',
        dispatchState: 'dispatched', mutationCommitState: 'committed', nextAction: 'observe', retryAllowed: false,
      } },
    };
    const renderer = renderCard(activity);
    expect(textContent(renderer.root)).toBe(operation === 'setText' ? '已发送文本输入' : '已发送滚动');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'agent-activity-collapse' })).toHaveLength(0);
    expect(renderer.root.findByProps({ 'data-tool-icon': operation === 'setText' ? 'edit' : 'move' })).toBeDefined();
    const unknown = { ...activity, status: 'failed' as const, result: { ok: false,
      message: '操作结果不确定，请重新查看，勿直接重复发送', data: { dispatchState: 'unknown' } } };
    act(() => renderer.update(cardElement(unknown)));
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-header' }))).not.toContain('已发送');
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(textContent(renderer.root)).toContain('勿直接重复发送');
    expect(textContent(renderer.root)).not.toContain('private body');
  });
});

afterEach(() => {
  renderers.splice(0).forEach((renderer) => {
    act(() => renderer.unmount());
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AgentToolActivityCard approval transitions and mixed groups', () => {
  it.each(['host', 'library'])('renders a committed %s patch as a saved file with an edit icon', scope => {
    const renderer = renderCard(shellActivity({ call: { id: 'patch-call', name: 'file.patch', input: { scope } },
      preparation: undefined, result: { ok: true, data: { scope, fileName: 'patched.txt', writeCommitState: 'committed' } } }));
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-header' }))).toBe('已保存patched.txt');
    expect(renderer.root.findByProps({ 'data-tool-icon': 'edit' })).toBeDefined();
  });

  it('replaces a pending approval with its real business step without an approval receipt row', () => {
    const onResolveApproval = vi.fn();
    const pending = shellActivity({ call: { id: 'write-call', name: 'file.write', input: {} }, preparation: undefined,
      permissionBehavior: 'ask', status: 'awaiting_approval', result: undefined,
      approval: { approvalId: 'write-approval', status: 'pending',
        preview: { title: 'approval preview sentinel', description: 'approval description sentinel', risk: 'write' } } });
    const props = { activity: pending, approvalBusy: true, interactionBusy: false, libraryId: 3,
      ownerScope: OWNER_SCOPE, onResolveApproval };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentToolActivityCard {...props} />); });
    renderers.push(renderer);
    const confirmation = renderer.root.findByType(AgentConfirmationCard);
    expect(confirmation.props.busy).toBe(true);
    act(() => confirmation.props.onResolve(true));
    expect(onResolveApproval).toHaveBeenCalledWith(expect.objectContaining({ approvalId: 'write-approval', call: pending.call }), true, undefined);

    const approved = { ...pending, approval: { ...pending.approval!, status: 'approved' as const } };
    act(() => renderer.update(<AgentToolActivityCard {...props} activity={{ ...approved, status: 'running' }} />));
    expect(renderer.root.findAllByType(AgentConfirmationCard)).toHaveLength(0);
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-header' }))).toBe('正在保存文件');
    act(() => renderer.update(<AgentToolActivityCard {...props} activity={{ ...approved, status: 'completed',
      result: { ok: true, data: { fileName: 'result.txt' } } }} />));
    expect(textContent(renderer.root)).toBe('已保存result.txt');
    expect(renderer.root.findAllByProps({ className: 'agent-activity-header' })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('approval preview sentinel');
    expect(textContent(renderer.root)).not.toMatch(/用户同意|已批准/);
  });

  it('keeps a denied cancellation visible and preserves a pending interaction as an actionable body', () => {
    const denied = shellActivity({ call: { id: 'write-call', name: 'file.write', input: {} }, preparation: undefined,
      permissionBehavior: 'ask', status: 'cancelled', result: { ok: false, message: '用户拒绝了这次保存' },
      approval: { approvalId: 'write-approval', status: 'denied', preview: { title: '保存', description: '', risk: 'write' } } });
    const renderer = renderCard(denied);
    expect(renderer.root.findAllByType(AgentConfirmationCard)).toHaveLength(0);
    expect(textContent(renderer.root)).toContain('已取消');
    expect(textContent(renderer.root)).toContain('用户拒绝了这次保存');
    expect(renderer.root.findByProps({ className: 'agent-activity-collapse' }).props['aria-hidden']).toBe(false);

    const onAction = vi.fn();
    const waiting = shellActivity({ call: { id: 'choice-call', name: 'interaction.request', input: {} },
      preparation: undefined, result: undefined, status: 'awaiting_interaction',
      interaction: { interactionId: 'choice', status: 'pending',
        request: { kind: 'choice', prompt: '选择保存位置', options: [{ id: 'library', label: '当前资料库' }] } } });
    act(() => renderer.update(<AgentToolActivityCard activity={waiting} approvalBusy={false} interactionBusy
      libraryId={3} ownerScope={OWNER_SCOPE} onResolveApproval={vi.fn()} onAction={onAction} />));
    expect(renderer.root.findByProps({ className: 'agent-activity-collapse' }).props['aria-hidden']).toBe(false);
    expect(renderer.root.findByType(AgentInteractionBlock).props).toMatchObject({ busy: true, onAction,
      block: { interactionId: 'choice', status: 'pending', prompt: '选择保存位置' } });
  });

  it('renders approved read, write, Shell, plugin and observation steps once in their supplied order', () => {
    const approval = { approvalId: 'approved', status: 'approved' as const,
      preview: { title: 'approval-only sentinel', description: '', risk: 'write' as const } };
    const activities = [
      shellActivity({ call: { id: 'read', name: 'file.read', input: {} }, preparation: undefined,
        result: { ok: true, data: { fileName: 'source.txt' } } }),
      shellActivity({ call: { id: 'write', name: 'file.write', input: {} }, preparation: undefined, permissionBehavior: 'ask', approval,
        result: { ok: true, data: { fileName: 'output.txt' } } }),
      shellActivity({ permissionBehavior: 'ask', approval }),
      shellActivity({ call: { id: 'plugin', name: 'example.inspect', input: {} }, preparation: undefined, approval,
        pluginSource: { pluginId: 'example', pluginVersion: '1', packageFingerprint: 'a', toolId: 'inspect', registrationId: 'plugin:inspect' },
        result: { ok: true, message: '插件读取完成' } }),
      observationActivity(),
    ].map((source, index) => ({ ...source, id: `mixed-${index}`, ordinal: index + 1,
      call: { ...source.call, id: `mixed-call-${index}` } }));
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentToolActivityGroup activities={activities}
      approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={3}
      onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />); });
    renderers.push(renderer);
    expect(renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props['aria-expanded']).toBe(false);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(renderer.root.findAllByType(AgentToolActivityCard).map(card => card.props.activity.id)).toEqual(activities.map(value => value.id));
    expect(renderer.root.findAllByType(AgentConfirmationCard)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'agent-shell-summary' })).toHaveLength(1);
    const text = textContent(renderer.root.findByProps({ className: 'agent-activity-group-items' }));
    expect(text).toContain('已读取source.txt');
    expect(text).toContain('已保存output.txt');
    expect(text).toContain('pwd\\nprintf "done"');
    expect(text).toContain('插件example版本1工具inspect包指纹a');
    expect(text).toContain('已查看屏幕');
    expect(text).not.toContain('approval-only sentinel');
    expect(text).not.toMatch(/用户同意|已批准/);
    expect(readShellLogPageMock).not.toHaveBeenCalled();
  });
});

describe('AgentToolActivityCard Shell presentation', () => {
  it('animates only the active loading glyph and provides reduced-motion fallback', () => {
    const activity: AgentToolActivitySnapshot = { id: 'write', runId: 'r', sessionId: 's', revision: 1,
      ordinal: 1, createdAt: '2026-09-10T00:00:00Z', status: 'running', permissionBehavior: 'allow',
      call: { id: 'c', name: 'file.write', input: {} } };
    const sheet = new ServerStyleSheet();
    try {
      const html = renderToStaticMarkup(sheet.collectStyles(cardElement(activity)));
      expect(html).toContain('agent-activity-spinner');
      expect(html).toContain('stroke-width="1.25"');
      expect(html).toContain('lucide-loader-circle');
      const css = sheet.getStyleTags();
      expect(css).toContain('animation:agent-activity-spin 900ms linear infinite');
      expect(css).toContain('prefers-reduced-motion');
      expect(css).toContain('animation:none');
      expect(renderToStaticMarkup(cardElement({ ...activity, status: 'completed' }))).not.toContain('agent-activity-spinner');
      expect(renderToStaticMarkup(cardElement({ ...activity, call: { ...activity.call, name: 'file.read' } }))).not.toContain('agent-activity-spinner');
    } finally { sheet.seal(); }
  });
  it('shows an active filename with shimmer, no extra status or body, and stops on completion', () => {
    const activity: AgentToolActivitySnapshot = {
      ...shellActivity(), preparation: undefined, result: undefined, status: 'running',
      call: { id: 'read', name: 'file.read', input: { path: '/private/folder/正在审阅的长文件名.txt' } },
    };
    const renderer = renderCard(activity);
    expect(textContent(renderer.root)).toBe('正在读取 正在审阅的长文件名.txt');
    expect(renderer.root.findByType(AgentActivityText).props.$active).toBe(true);
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'agent-activity-state' })).toHaveLength(0);
    act(() => renderer.update(cardElement({ ...activity, status: 'completed', result: { ok: true } })));
    expect(renderer.root.findAllByType(AgentActivityText)).toHaveLength(0);
    expect(textContent(renderer.root)).toBe('已读取正在审阅的长文件名.txt');
  });
  it.each([true, false])('shows only the filename for a successful text read, hasMore=%s', (hasMore) => {
    const activity: AgentToolActivitySnapshot = {
      call: { id: 'body-read', name: 'file.read', input: { path: '/private/folder/report.txt' } },
      id: 'body-tool', ordinal: 1, createdAt: '2026-09-08T00:00:00Z', permissionBehavior: 'allow',
      revision: 1, runId: 'run', sessionId: 'session', status: 'completed',
      toolMetadata: { kind: 'business', risk: 'read', groupKind: 'resource-read', operationKind: 'stat' },
      result: { ok: true, data: { path: '/private/folder/report.txt', hasMore, content: 'body must stay hidden' } },
    };
    const onExpand = vi.fn();
    const renderer = renderCard(activity, OWNER_SCOPE, onExpand);
    expect(textContent(renderer.root)).toBe('已读取report.txt');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'agent-activity-collapse' })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick).toBeUndefined();
    expect(onExpand).not.toHaveBeenCalled();
  });
  it('renders a file read as one row with controlled node navigation and opt-in details', () => {
    const onAction = vi.fn();
    const onExpand = vi.fn();
    const activity: AgentToolActivitySnapshot = {
      call: { id: 'read-call', input: {}, name: 'file.stat' }, id: 'read-tool', ordinal: 1,
      createdAt: '2026-09-07T00:00:00Z',
      permissionBehavior: 'allow', revision: 1, runId: 'read-run', sessionId: 'read-session', status: 'completed',
      toolMetadata: { kind: 'business', risk: 'read', groupKind: 'resource-read', operationKind: 'stat' },
      result: { ok: true, message: 'private-to-details summary', data: { id: 8, name: 'agent-orchestrator', ext: 'ts', type: 'file' } },
    };
    const renderer = TestRenderer.create(<AgentToolActivityCard activity={activity} approvalBusy={false} interactionBusy={false}
      libraryId={3} onAction={onAction} onExpand={onExpand} onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />);
    renderers.push(renderer);
    expect(textContent(renderer.root)).toContain('已读取agent-orchestrator.ts');
    expect(renderer.root.findByProps({ className: 'agent-activity-collapse' }).props['aria-hidden'])
      .toBe(true);
    act(() => renderer.root.findByProps({ className: 'agent-activity-subject' }).props.onClick());
    expect(onAction).toHaveBeenCalledWith({ action: 'tree.revealNode', label: 'agent-orchestrator.ts', libraryId: 3, nodeId: 8 });
    act(() => renderer.root.findByProps({ className: 'agent-activity-header' }).props.onClick());
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(textContent(renderer.root)).toContain('private-to-details summary');
    expect(renderer.root.findByProps({ className: 'agent-activity-collapse' }).props['aria-hidden'])
      .toBe(false);
    expect(renderer.root.findByProps({ className: 'agent-activity-body' }).props['data-scrollable'])
      .toBe(true);
    act(() => renderer.root.findByProps({ 'aria-label': '收起工具详情' }).props.onClick());
    expect(onExpand).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({ className: 'agent-activity-collapse' }).props['aria-hidden'])
      .toBe(true);
  });

  it('keeps failed tool details collapsed until explicitly opened', () => {
    const onExpand = vi.fn();
    const running = shellActivity({
      call: { id: 'delete-call', input: { nodeId: 8 }, name: 'file.delete' },
      preparation: undefined,
      result: undefined,
      status: 'running',
    });
    const renderer = renderCard(running, OWNER_SCOPE, onExpand);
    const failed = { ...running, status: 'failed' as const, result: { ok: false, message: '目标节点不存在' } };

    act(() => renderer.update(cardElement(failed, OWNER_SCOPE, 3, onExpand)));

    const detail = renderer.root.findByProps({ className: 'agent-activity-collapse' });
    expect(detail.props['aria-hidden']).toBe(true);
    expect(onExpand).not.toHaveBeenCalled();
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-header' })))
      .not.toContain('目标节点不存在');

    act(() => renderer.root.findByProps({ 'aria-label': '展开工具详情' }).props.onClick());
    expect(detail.props['aria-hidden']).toBe(false);
    expect(textContent(detail)).toContain('目标节点不存在');
    expect(onExpand).toHaveBeenCalledOnce();

    act(() => renderer.root.findByProps({ 'aria-label': '收起工具详情' }).props.onClick());
    act(() => renderer.update(cardElement({ ...failed, revision: failed.revision + 1 }, OWNER_SCOPE, 3, onExpand)));
    expect(detail.props['aria-hidden']).toBe(true);
  });

  it('renders a borderless single-line summary without result metadata by default', () => {
    const renderer = renderCard(shellActivity());
    const summary = renderer.root.findByProps({ className: 'agent-shell-summary' });
    const text = textContent(renderer.root);

    expect(summary.type).toBe('button');
    expect(summary.props['aria-expanded']).toBe(false);
    expect(text).toContain('执行了');
    expect(text).toContain('pwd\\nprintf "done"');
    expect(text).not.toContain('耗时');
    expect(text).not.toContain('退出码');
    expect(text).not.toContain('输出截断');
    expect(text).not.toContain('must stay hidden');
    expect(renderer.root.findAllByProps({ className: 'agent-shell-summary-chevron' }))
      .toHaveLength(1);
    expect(renderer.root.findAllByType('article')).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'agent-shell-collapse' }).props['aria-hidden'])
      .toBe(true);
    expect(renderer.root.findAllByProps({ role: 'region' })).toHaveLength(1);
  });

  it('uses one safe whitespace-preserving command projection everywhere it exposes the command', async () => {
    const unsafeCommand = "  printf 'a  b'\tline\nnext\u001b\u202e  ";
    const expectedCommand = "  printf 'a  b'\\tline\\nnext\\u001b\\u202e  ";
    readShellLogPageMock.mockResolvedValueOnce(logPage());
    const renderer = renderCard(shellActivity({
      preparation: {
        action: shellAction(unsafeCommand),
        preparedActionId: 'prepared-1',
        snapshotHash: 'c'.repeat(64),
      },
    }));
    const summaryButton = renderer.root.findByProps({ className: 'agent-shell-summary' });
    const summaryCommand = renderer.root.findByProps({ className: 'agent-shell-summary-command' });

    expect(textContent(summaryCommand)).toBe(expectedCommand);
    expect(summaryCommand.props.title).toBe(expectedCommand);
    expect(summaryButton.props['aria-label']).toBe(`执行了 ${expectedCommand}`);
    expect(textContent(summaryCommand)).not.toContain("'a b'");

    await act(async () => {
      summaryButton.props.onClick();
    });
    expect(textContent(renderer.root.findByProps({ className: 'agent-shell-terminal-command' })))
      .toBe(`$ ${expectedCommand}`);
  });

  it('loads owner-bound log pages only after expansion and appends the next page', async () => {
    const onExpand = vi.fn();
    readShellLogPageMock
      .mockResolvedValueOnce(logPage({ nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(logPage({
        availableRanges: [{ firstSequence: 1, lastSequence: 2 }],
        frames: [{
          executionId: 'execution-1',
          observedAt: '2026-09-02T00:00:00.200Z',
          sequence: 2,
          stream: 'stderr',
          text: 'second page\n',
        }],
        pageFirstSequence: 2,
        pageLastSequence: 2,
        requestedAfter: 1,
      }));
    const renderer = renderCard(shellActivity(), OWNER_SCOPE, onExpand);
    const summary = renderer.root.findByProps({ className: 'agent-shell-summary' });

    expect(readShellLogPageMock).not.toHaveBeenCalled();
    await act(async () => {
      summary.props.onClick();
    });

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(readShellLogPageMock).toHaveBeenNthCalledWith(1, {
      libraryId: 3,
      maxBytes: 128 * 1024,
      maxFrames: 128,
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
      toolRunId: 'tool-run-1',
      version: 1,
    });
    const terminal = renderer.root.findByProps({
      'aria-label': 'Shell 输出',
      className: 'agent-shell-terminal',
      role: 'region',
    });
    expect(textContent(terminal)).toContain('first page');
    const more = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '继续读取');

    await act(async () => {
      more?.props.onClick();
    });

    expect(readShellLogPageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: 'cursor-2',
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
      toolRunId: 'tool-run-1',
    }));
    expect(textContent(renderer.root.findByProps({ role: 'region' }))).toContain('first page');
    expect(textContent(renderer.root.findByProps({ role: 'region' }))).toContain('second page');

    act(() => summary.props.onClick());
    expect(onExpand).toHaveBeenCalledTimes(2);
  });

  it('ignores an old log response after the rendered Tool activity changes', async () => {
    let resolveOldPage!: (page: AgentShellLogPageV1) => void;
    readShellLogPageMock
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldPage = resolve; }))
      .mockResolvedValueOnce(logPage({
        executionId: 'execution-2',
        frames: [{
          executionId: 'execution-2',
          observedAt: '2026-09-02T00:00:02.000Z',
          sequence: 2,
          stream: 'stdout',
          text: 'new activity output\n',
        }],
        pageFirstSequence: 2,
        pageLastSequence: 2,
      }));
    const renderer = renderCard(shellActivity());
    await act(async () => {
      renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick();
      await Promise.resolve();
    });

    const nextActivity = shellActivity({
      id: 'tool-run-2',
      runId: 'run-2',
      sessionId: 'session-2',
    });
    act(() => renderer.update(cardElement(nextActivity)));
    await act(async () => {
      renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick();
    });
    expect(textContent(renderer.root.findByProps({ role: 'region' })))
      .toContain('new activity output');

    await act(async () => {
      resolveOldPage(logPage({
        frames: [{
          executionId: 'execution-1',
          observedAt: '2026-09-02T00:00:00.100Z',
          sequence: 1,
          stream: 'stdout',
          text: 'stale private output\n',
        }],
      }));
      await Promise.resolve();
    });

    expect(textContent(renderer.root)).not.toContain('stale private output');
    expect(textContent(renderer.root)).toContain('new activity output');
  });

  it('releases grouped Shell details on collapse or workspace hiding and ignores their late responses', async () => {
    let resolveHiddenPage!: (page: AgentShellLogPageV1) => void;
    readShellLogPageMock
      .mockImplementationOnce(() => new Promise(resolve => { resolveHiddenPage = resolve; }))
      .mockResolvedValueOnce(logPage({ frames: [{ executionId: 'execution-1', observedAt: '',
        sequence: 1, stream: 'stdout', text: 'fresh group output' }] }));
    const source = shellActivity();
    const group = (detailsVisible = true) => <AgentToolActivityGroup activities={[source]}
      detailsVisible={detailsVisible} approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={3}
      onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(group()); });
    renderers.push(renderer);
    expect(readShellLogPageMock).not.toHaveBeenCalled();
    const toggleGroup = () => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick();
    act(toggleGroup);
    await act(async () => { renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick(); });
    expect(readShellLogPageMock).toHaveBeenCalledTimes(1);
    act(toggleGroup);
    expect(renderer.root.findByProps({ className: 'agent-shell-summary' }).props['aria-expanded']).toBe(false);
    await act(async () => { resolveHiddenPage(logPage({ frames: [{ executionId: 'execution-1', observedAt: '',
      sequence: 1, stream: 'stdout', text: 'late hidden output' }] })); });
    expect(textContent(renderer.root)).not.toContain('late hidden output');
    act(toggleGroup);
    expect(readShellLogPageMock).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick(); });
    expect(readShellLogPageMock).toHaveBeenCalledTimes(2);
    expect(textContent(renderer.root)).toContain('fresh group output');

    act(() => renderer.update(group(false)));
    expect(textContent(renderer.root)).not.toContain('fresh group output');
    act(() => renderer.update(group(true)));
    expect(renderer.root.findByProps({ className: 'agent-shell-summary' }).props['aria-expanded']).toBe(false);
    expect(readShellLogPageMock).toHaveBeenCalledTimes(2);
  });

  it('shows a stable error instead of rendering raw IPC failure details', async () => {
    readShellLogPageMock.mockRejectedValueOnce(
      new Error('ENOENT: /Users/private/Library/Application Support/OmniFlow/shell.log'),
    );
    const renderer = renderCard(shellActivity());

    await act(async () => {
      renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick();
    });
    const text = textContent(renderer.root);

    expect(text).toContain('详细输出读取失败');
    expect(text).not.toContain('/Users/private');
    expect(text).not.toContain('ENOENT');
  });

  it('keeps a failed Shell execution visible without exposing result internals', () => {
    const activity = shellActivity({
      result: {
        data: { exitCode: 127, stderrTail: 'private stderr' },
        message: 'command failed',
        ok: false,
      },
      status: 'failed',
    });
    const renderer = renderCard(activity);
    const text = textContent(renderer.root);

    expect(text).toContain('执行失败');
    expect(text).toContain('pwd\\nprintf "done"');
    expect(text).not.toContain('command failed');
    expect(text).not.toContain('private stderr');
    expect(text).not.toContain('127');
  });

  it.each([
    ['missing owner scope', shellActivity(), null],
    ['missing result', shellActivity({ result: undefined, status: 'running' }), OWNER_SCOPE],
  ])('does not offer a false expansion when %s', (_label, activity, ownerScope) => {
    const renderer = renderCard(activity, ownerScope);

    expect(renderer.root.findAllByProps({ className: 'agent-shell-summary' })[0]?.type).toBe('div');
    expect(renderer.root.findAllByProps({ role: 'region' })).toHaveLength(0);
    expect(readShellLogPageMock).not.toHaveBeenCalled();
  });

  it('never falls back to untrusted call input when the prepared action is unavailable', () => {
    const activity = shellActivity({
      call: {
        id: 'call-1',
        input: { command: 'cat /private/secret-from-call-input' },
        name: 'shell.run',
      },
      preparation: undefined,
    });
    const renderer = renderCard(activity);
    const text = textContent(renderer.root);

    expect(text).toContain('Shell 命令');
    expect(text).not.toContain('/private/secret-from-call-input');
  });

  it('keeps a pending Shell approval on the confirmation-card path', () => {
    const activity = shellActivity({
      approval: {
        approvalId: 'approval-1',
        preview: {
          description: '运行准备好的命令',
          details: [],
          risk: 'read',
          title: '运行 Shell 命令',
        },
        status: 'pending',
      },
      result: undefined,
      status: 'awaiting_approval',
    });
    const renderer = renderCard(activity);

    expect(renderer.root.findAllByProps({ 'data-testid': 'confirmation-card' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ className: 'agent-shell-summary' })).toHaveLength(0);
  });
});
