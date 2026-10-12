import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentPluginFileOutputPreparedActionPublicV1,
  AgentFilePublishPreparedActionPublicV1,
  AgentFileStagePreparedActionPublicV1,
  AgentFileUploadPreparedActionPublicV1,
  AgentMediaExtractAudioPreparedActionPublicV1,
  AgentPreparedActionPublic,
  AgentPluginRenamePreparedActionPublicV1,
  AgentShellPreparedActionPublicV1,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import AgentConfirmationCard from './AgentConfirmationCard';
import { COMPUTER_ELEMENT_OPERATIONS } from '@/shared/computer-use/computer-use-contract';
import { WINDOW_INPUT_OPERATIONS } from '@/shared/computer-use/window-input-contract';

vi.mock('@douyinfe/semi-icons', () => ({
  IconFolder: () => null,
  IconTerminal: () => null,
}));

vi.mock('@/features/file-explorer', () => ({
  LibraryNodePickerModal: (props: { visible: boolean }) => (
    React.createElement('div', {
      'data-testid': 'library-node-picker',
      'data-visible': String(props.visible),
    })
  ),
}));

const renderers: TestRenderer.ReactTestRenderer[] = [];

describe('plugin file-output confirmation', () => {
  it('shows the immutable destination and content digest and passes the same action to approval', () => {
    const action: AgentPluginFileOutputPreparedActionPublicV1 = { kind: 'plugin.file-output', version: 1, libraryId: 3,
      operationId: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', pluginId: 'example.csv-export', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64),
      sourceNodeId: 8, parentId: 10, fileName: 'export.json', mediaType: 'application/json', providerId: 'local-minio', sizeBytes: 123, sha256: 'b'.repeat(64) };
    const input = approval(action); input.call.name = 'example.csv-export.export';
    input.preview.details = [{ label: '来源文件', value: '原始数据.csv' }, { label: '目标目录', value: '导出结果' }];
    const { renderer, onResolve } = renderCard(input);
    const content = textContent(renderer.root);
    for (const expected of ['原始数据.csv', 'export.json', '导出结果', 'local-minio', '123 字节', action.sha256, '不覆盖现有文件']) expect(content).toContain(expected);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false); act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });
});

function mediaAction(
  overrides: Partial<AgentMediaExtractAudioPreparedActionPublicV1> = {},
): AgentMediaExtractAudioPreparedActionPublicV1 {
  return {
    conflictPolicy: 'auto_rename',
    destination: 'library',
    fallbackPolicy: 'prompt_local',
    kind: 'media.extractAudio',
    libraryId: 3,
    outputFileName: 'movie-audio.m4a',
    outputFormat: 'm4a',
    parentId: 10,
    sourceNodeId: 8,
    targetLabel: '视频',
    version: 1,
    ...overrides,
  };
}

function approval(action?: unknown): AgentToolApprovalSnapshot {
  return {
    approvalId: 'approval-1',
    call: { id: 'call-1', input: {}, name: 'media.extractAudio' },
    ...(action === undefined
      ? {}
      : {
          preparation: {
            action: action as AgentPreparedActionPublic,
            preparedActionId: 'prepared-1',
            snapshotHash: 'a'.repeat(64),
          },
        }),
    preview: {
      description: '从当前视频提取音频',
      details: [{ label: '源文件', value: 'movie.mp4' }],
      risk: 'write',
      title: '提取音频',
    },
    runId: 'run-1',
    sessionId: 'session-1',
  };
}

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
      persistentRuleEligible: true,
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

function fileStageAction(
  sourceKind: 'local-path' | 'local-picker' = 'local-picker',
): AgentFileStagePreparedActionPublicV1 {
  if (sourceKind === 'local-path') {
    return {
      kind: 'file.stage',
      sourceDisplayName: 'frontend-separation-playbook.md',
      sourceIdentity: `sha256:${'d'.repeat(64)}`,
      sourceKind,
      sourcePath: '~/Downloads/frontend-separation-playbook.md',
      sourceSizeBytes: 1024,
      targetLabel: '当前任务 input 目录',
      version: 1,
    };
  }
  return {
    kind: 'file.stage',
    sourceKind,
    targetLabel: '当前任务 input 目录',
    version: 1,
  };
}

function fileUploadAction(): AgentFileUploadPreparedActionPublicV1 {
  return {
    conflictPolicy: 'rename',
    kind: 'file.upload',
    libraryId: 3,
    outputFileName: 'frontend-separation-playbook.md',
    parentId: 10,
    providerId: 'local-minio',
    sourceDisplayName: 'frontend-separation-playbook.md',
    sourceIdentity: `sha256:${'e'.repeat(64)}`,
    sourceKind: 'local-path',
    sourcePath: '~/Downloads/frontend-separation-playbook.md',
    sourceSizeBytes: 1024,
    targetLabel: '资料库路径“/文档/提示词” / 本机 MinIO',
    version: 1,
  };
}

function filePublishAction(): AgentFilePublishPreparedActionPublicV1 {
  return {
    contentHash: `sha256:${'c'.repeat(64)}`,
    destinationKind: 'local-save-as',
    displayName: 'result.txt',
    kind: 'file.publish',
    sizeBytes: 8,
    sourcePath: 'output/result.txt',
    suggestedFileName: 'result.txt',
    targetLabel: '本机（执行时选择位置）',
    version: 1,
  };
}

function renameAction(count = 2): AgentPluginRenamePreparedActionPublicV1 {
  return { kind: 'plugin.rename', version: 1, libraryId: 3, operationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
    pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'c'.repeat(64),
    items: Array.from({ length: count }, (_, i) => ({ nodeId: i + 8, parentId: 2, oldName: `old-${i + 1}.jpg`, newName: `new-${i + 1}.jpg` })) };
}
function renameApproval(action: unknown = renameAction()): AgentToolApprovalSnapshot {
  const result = approval(action);
  result.call.name = 'example.rename.prefix';
  result.call.input = { forgedPreview: [{ oldName: 'forged', newName: 'fake' }] };
  result.preview = { title: '重命名文件', description: '批准选定文件的重命名', risk: 'write', details: [{ label: '摘要', value: 'incomplete preview' }] };
  return result;
}

function renderCard(input: AgentToolApprovalSnapshot, onResolve = vi.fn()) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(AgentConfirmationCard, {
      approval: input,
      busy: false,
      libraryId: 3,
      onResolve,
    }));
  });
  renderers.push(renderer);
  return { onResolve, renderer };
}

function textContent(instance: TestRenderer.ReactTestInstance): string {
  return instance.children.map(child => (
    typeof child === 'string' ? child : textContent(child)
  )).join('');
}

afterEach(() => {
  renderers.splice(0).forEach((renderer) => {
    act(() => renderer.unmount());
  });
});

describe('AgentConfirmationCard', () => {
  it('separately displays and preserves the explicit directed input grant without trusting Tool input', () => {
    const action = { kind: 'computer.observe' as const, version: 2 as const, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口',
      operations: ['press' as const], inputOperations: [...WINDOW_INPUT_OPERATIONS] };
    const input = approval(action); input.call.name = 'computer.observe'; input.call.input = { inputOperations: ['globalClick'] };
    const { renderer, onResolve } = renderCard(input);
    expect(renderer.root.findAllByType('dd').map(textContent)).toEqual(['OmniFlow', '测试窗口', '点击、快捷键、右键、双击、拖拽']);
    expect(textContent(renderer.root)).toContain('后台定向输入发送后需重新查看确认实际结果');
    expect(textContent(renderer.root)).not.toContain('globalClick');
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    act(() => allow.props.onClick()); expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it.each(['shortcut', 'rightClick', 'doubleClick', 'drag'] as const)('approves only immutable directed %s fields on the named window', operation => {
    const fields = operation === 'shortcut' ? { operation, shortcut: { key: 'a' as const, modifiers: ['command' as const] } }
      : operation === 'drag' ? { operation, point: { x: 10, y: 20 }, endPoint: { x: 30, y: 40 }, durationMs: 100 }
        : { operation, point: { x: 10, y: 20 } };
    const action = { kind: 'computer.input' as const, version: 1 as const, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口',
      observationId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', ...fields };
    const input = approval(action); input.call.name = 'computer.input';
    input.call.input = { point: { x: 999, y: 888 }, shortcut: { key: 'z', modifiers: ['control'] } };
    input.preview.description = 'forged'; input.preview.details = [{ label: '应用', value: 'forged' }];
    const { renderer, onResolve } = renderCard(input);
    expect(textContent(renderer.root)).toContain('发送后必须重新查看确认结果');
    expect(textContent(renderer.root)).not.toContain('forged');
    expect(textContent(renderer.root)).not.toContain('999');
    expect(textContent(renderer.root)).not.toContain('888');
    expect(textContent(renderer.root)).toContain(operation === 'shortcut' ? 'Command + A' : '(10, 20)');
    if (operation === 'drag') expect(textContent(renderer.root)).toContain('(30, 40)');
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false); act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
    input.call.name = 'computer.click';
    act(() => renderer.update(React.createElement(AgentConfirmationCard, { approval: input, busy: false, libraryId: 3, onResolve })));
    expect(renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!.props.disabled).toBe(true);
  });

  it.each([{ modifiers: [] }, { modifiers: ['shift'] }, { modifiers: ['option'] }, { modifiers: ['shift', 'option'] }])(
    'refuses a printable shortcut action with modifiers=$modifiers', ({ modifiers }) => {
    const input = approval({ kind: 'computer.input', version: 1, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口',
      observationId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', operation: 'shortcut', shortcut: { key: 'a', modifiers } });
    input.call.name = 'computer.input';
    const { renderer, onResolve } = renderCard(input);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(true);
    expect(onResolve).not.toHaveBeenCalled();
    },
  );
  it('approves a semantic V3 click using its window identity without image coordinates', () => {
    const action = { kind: 'computer.click' as const, version: 3 as const, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口',
      observationId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', elementId: 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba',
      button: 'left' as const, clickCount: 1 as const };
    const input = approval(action); input.call.name = 'computer.click';
    input.call.input = { x: 500, y: 600, windowLabel: 'forged window' };
    const { renderer, onResolve } = renderCard(input);
    expect(renderer.root.findAllByType('dd').map(textContent)).toEqual(['OmniFlow', '测试窗口']);
    expect(textContent(renderer.root)).not.toContain('forged');
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false); act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it.each(['ax', 'screenshot', 'both'] as const)('retains the immutable observation mode %s when approving window sharing', mode => {
    const action = { kind: 'computer.observe' as const, version: 2 as const, libraryId: 3, mode,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口' };
    const input = approval(action); input.call.name = 'computer.observe';
    const { renderer, onResolve } = renderCard(input);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false); act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it('explains the explicit click, text and scroll grant on the same immutable window', () => {
    const action = { kind: 'computer.observe' as const, version: 2 as const, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口',
      operations: [...COMPUTER_ELEMENT_OPERATIONS] };
    const input = approval(action); input.call.name = 'computer.observe';
    input.call.input = { operations: ['rightClick'], text: 'private body' };
    const { renderer, onResolve } = renderCard(input);
    expect(textContent(renderer.root.findByType('h3'))).toBe('共享应用窗口并允许操作');
    expect(textContent(renderer.root)).toContain('在该窗口中点击、文本输入、滚动');
    expect(renderer.root.findAllByType('dt').map(textContent)).toEqual(['应用', '窗口', '允许操作']);
    expect(renderer.root.findAllByType('dd').map(textContent)).toEqual(['OmniFlow', '测试窗口', '点击、文本输入、滚动']);
    expect(textContent(renderer.root)).not.toContain('private body');
    expect(textContent(renderer.root)).not.toContain('rightClick');
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    act(() => allow.props.onClick()); expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it.each([
    { operations: ['press'], label: '点击', heading: '共享应用窗口并允许点击' },
    { operations: ['replaceText', 'insertText'], label: '文本输入', heading: '共享应用窗口并允许操作' },
    { operations: ['scrollDownPage'], label: '滚动', heading: '共享应用窗口并允许操作' },
  ])('describes only the exact window grant $label', ({ operations, label, heading }) => {
    const input = approval({ kind: 'computer.observe', version: 2, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口', operations });
    input.call.name = 'computer.observe'; const { renderer } = renderCard(input);
    expect(textContent(renderer.root.findByType('h3'))).toBe(heading);
    expect(renderer.root.findAllByType('dd').map(textContent)).toEqual(['OmniFlow', '测试窗口', label]);
  });

  it.each([[], ['press', 'press'], ['rightClick'], 'press', null])('refuses invalid window operations: %j', operations => {
    const input = approval({ kind: 'computer.observe', version: 2, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口', operations });
    input.call.name = 'computer.observe'; const { renderer } = renderCard(input);
    expect(renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!.props.disabled).toBe(true);
  });

  it.each(['setText', 'scroll'] as const)('uses the %s window action instead of treating V1 as legacy screen sharing', operation => {
    const identity = { libraryId: 3, targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
      applicationLabel: 'OmniFlow', windowLabel: '测试窗口', observationId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
      elementId: 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba', version: 1 };
    const action = operation === 'setText' ? { ...identity, kind: 'computer.setText', mode: 'insert', textLength: 2, textBytes: 6 }
      : { ...identity, kind: 'computer.scroll', direction: 'left', unit: 'step' };
    const input = approval(action); input.call.name = `computer.${operation}`;
    input.call.input = { text: 'private input body', direction: 'down' };
    input.preview.description = 'forged description'; input.preview.details = [{ label: '正文', value: 'private body' }];
    const { renderer, onResolve } = renderCard(input); const content = textContent(renderer.root);
    expect(content).toContain(operation === 'setText' ? '允许在应用窗口输入文本' : '允许在应用窗口滚动');
    expect(content).toContain(operation === 'setText' ? '在当前选区插入文本' : '向左');
    expect(content).toContain(operation === 'setText' ? '2 字符 · 6 字节' : '一步');
    expect(content).not.toContain('共享此屏幕'); expect(content).not.toContain('private'); expect(content).not.toContain('forged');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false); act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
    input.call.name = operation === 'setText' ? 'computer.scroll' : 'computer.setText';
    act(() => renderer.update(React.createElement(AgentConfirmationCard, { approval: input, busy: false, libraryId: 3, onResolve })));
    expect(renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!.props.disabled).toBe(true);
  });

  it('describes an approved fractional scroll without taking its magnitude from tool input', () => {
    const action = { kind: 'computer.scroll', version: 1, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口',
      observationId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
      elementId: 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba', direction: 'down', unit: 'fraction' };
    const input = approval(action); input.call.name = 'computer.scroll';
    input.call.input = { unit: 'page', amount: 999, value: 'private position' };
    const { renderer, onResolve } = renderCard(input);
    expect(renderer.root.findAllByType('dd').map(textContent)).toEqual(['OmniFlow', '测试窗口', '向下', '滚动范围的 10%']);
    expect(textContent(renderer.root)).not.toContain('一页');
    expect(textContent(renderer.root)).not.toContain('一步');
    expect(textContent(renderer.root)).not.toContain('private position');
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false);
    act(() => allow.props.onClick()); expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it('authorizes only the immutable V2 application window and explains AI storage and window changes', () => {
    const action = { kind: 'computer.observe' as const, version: 2 as const, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试资料库窗口' };
    const input = approval(action);
    input.call.name = 'computer.observe';
    input.call.input = { applicationLabel: 'forged app', windowLabel: 'forged window', pid: 500, nativeHandle: 'private-handle' };
    input.preview.title = 'forged heading';
    input.preview.description = 'forged description';
    input.preview.details = [{ label: '窗口', value: 'forged detail' }];
    const { renderer, onResolve } = renderCard(input);
    const content = textContent(renderer.root);
    expect(renderer.root.findByType('h3').children).toEqual(['共享应用窗口并允许点击']);
    expect(content).toContain('仅将这个应用窗口的图像和界面控件信息发送给当前 AI 服务');
    expect(content).toContain('保存在本机会话');
    expect(content).toContain('切换到另一个窗口需重新批准');
    expect(content).toContain('停止或任务结束后授权失效');
    expect(content).toContain('屏幕录制和辅助功能权限');
    expect(renderer.root.findAllByType('dt').map(textContent)).toEqual(['应用', '窗口']);
    expect(renderer.root.findAllByType('dd').map(textContent)).toEqual(['OmniFlow', '测试资料库窗口']);
    expect(content).not.toContain(action.targetId);
    expect(content).not.toContain('forged');
    expect(content).not.toContain('private-handle');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findAllByType('select')).toHaveLength(0);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false);
    act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it.each([
    { libraryId: 4 }, { version: 3 }, { targetId: '500' }, { applicationLabel: '\ud800' },
    { windowLabel: '窗口\u202e' }, { nativeHandle: 500 }, { displayId: '1' },
  ])('refuses malformed or foreign V2 window approvals: %j', overrides => {
    const input = approval({ kind: 'computer.observe', version: 2, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: '测试窗口', ...overrides });
    input.call.name = 'computer.observe';
    const { renderer } = renderCard(input);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(true);
    expect(textContent(renderer.root)).toContain('当前版本无法识别此准备动作');
  });

  it('authorizes the immutable screen for this task without displaying Tool input or editing targets', () => {
    const action = { kind: 'computer.observe' as const, version: 1 as const, libraryId: 3,
      displayId: '1', displayLabel: '内置屏幕' };
    const input = approval(action);
    input.call.name = 'computer.observe';
    input.call.input = { displayLabel: 'forged screen', path: '/private/path' };
    input.preview.details = [{ label: '内部数据', value: 'private-handle' }];
    const { renderer, onResolve } = renderCard(input);
    const content = textContent(renderer.root);
    expect(content).toContain('允许本次任务共享此屏幕并点击');
    expect(content).toContain('此屏幕截图发送给当前模型');
    expect(content).toContain('保存在本机会话');
    expect(content).toContain('屏幕录制和辅助功能权限');
    expect(content).toContain('任务结束后授权失效');
    expect(content).toContain('内置屏幕');
    expect(content).not.toContain('forged screen');
    expect(content).not.toContain('/private/path');
    expect(content).not.toContain('private-handle');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false);
    act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it.each([
    { libraryId: 4, kind: 'computer.observe' },
    { libraryId: 3, kind: 'computer.click' },
    { libraryId: 3, kind: 'computer.observe', displayLabel: 'screen\nother' },
  ])('refuses a malformed or mismatched screen approval: %j', overrides => {
    const input = approval(Object.assign({ kind: 'computer.observe', version: 1, libraryId: 3,
      displayId: '1', displayLabel: '内置屏幕' }, overrides));
    input.call.name = 'computer.observe';
    const { renderer } = renderCard(input);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(true);
    expect(textContent(renderer.root)).toContain('当前版本无法识别此准备动作');
  });

  it.each([undefined, shellAction()])('requires a matching screen action even if another prepared kind is valid', action => {
    const input = approval(action);
    input.call.name = 'computer.observe';
    const { renderer } = renderCard(input);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(true);
  });

  it('renders all 50 immutable renames from the normalized action without truncating to preview details', () => {
    const action = renameAction(50); const { renderer, onResolve } = renderCard(renameApproval(action));
    const region = renderer.root.findByProps({ role: 'region', 'aria-label': '完整重命名预览' });
    expect(region.props.tabIndex).toBe(0);
    const rows = region.findAllByType('dd'); expect(rows).toHaveLength(50);
    expect(textContent(rows[0])).toBe('old-1.jpg → new-1.jpg');
    expect(textContent(rows[49])).toBe('old-50.jpg → new-50.jpg');
    expect(textContent(renderer.root)).toContain('example.rename@0.1.0');
    expect(textContent(renderer.root)).toContain('c'.repeat(64));
    expect(textContent(renderer.root)).not.toContain('forged');
    expect(textContent(renderer.root)).not.toContain('incomplete preview');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findAllByType('select')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-testid': 'library-node-picker' })).toHaveLength(0);
    const allow = renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!;
    expect(allow.props.disabled).toBe(false); act(() => allow.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, action);
  });

  it('replaces the readonly fingerprint and complete item list when a new preparation arrives', () => {
    const { renderer, onResolve } = renderCard(renameApproval());
    const changed = { ...renameAction(1), packageFingerprint: 'd'.repeat(64), pluginVersion: '0.2.0' };
    const updated = renameApproval(changed); updated.preparation!.preparedActionId = 'prepared-2';
    act(() => renderer.update(React.createElement(AgentConfirmationCard, { approval: updated, busy: false, libraryId: 3, onResolve })));
    expect(textContent(renderer.root)).toContain('d'.repeat(64));
    expect(textContent(renderer.root)).not.toContain('c'.repeat(64));
    expect(textContent(renderer.root)).not.toContain('old-2.jpg');
    act(() => renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, changed);
  });

  it.each([
    { action: { ...renameAction(), pluginId: '../malicious' } },
    { action: { ...renameAction(), pluginId: 'other.rename' } },
    { action: { ...renameAction(), packageFingerprint: 'fake' } },
    { action: { ...renameAction(), libraryId: 4 } },
    { action: { ...renameAction(), kind: 'plugin.write' } },
    { action: renameAction(), toolName: 'file.rename' },
  ])('rejects an invalid or inconsistent rename preparation %j', testCase => {
    const input = renameApproval(testCase.action);
    if (testCase.toolName) input.call.name = testCase.toolName;
    const { renderer, onResolve } = renderCard(input);
    expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined();
    expect(renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!.props.disabled).toBe(true);
    const cancel = renderer.root.findAllByType('button').find(button => textContent(button) === '取消')!;
    expect(cancel.props.disabled).toBe(false); act(() => cancel.props.onClick()); expect(onResolve).toHaveBeenCalledWith(false);
  });
  it('allows changing a local default to a library target without guessing a parent node', () => {
    const action = mediaAction({ destination: 'local', fallbackPolicy: 'none', targetLabel: '本机' });
    delete action.parentId;
    const { renderer } = renderCard(approval(action));
    const library = renderer.root.findAllByType('button').find(button => textContent(button) === '资料库')!;
    expect(library.props.disabled).toBe(false);
    act(() => library.props.onClick());
    expect(textContent(renderer.root)).toContain('选择资料库目录');
    expect(renderer.root.findAllByType('button').find(button => textContent(button) === '允许')!.props.disabled).toBe(true);
  });
  it('shows the complete immutable Shell action and allows approval without an editable draft', () => {
    const input = approval(shellAction());
    input.call = { id: 'call-shell', input: { command: 'pwd' }, name: 'shell.run' };
    input.preview.title = '运行 Shell 命令';
    const { onResolve, renderer } = renderCard(input);
    const command = renderer.root.findByProps({ className: 'agent-confirmation-shell-command' });
    const allow = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '允许');

    expect(textContent(command)).toContain('pwd\\nprintf');
    expect(allow?.props.disabled).toBe(false);
    act(() => allow?.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });

  it('uses the safe Shell display projection for control and bidi characters', () => {
    const input = approval(shellAction("printf 'a  b'\tline\nnext\u001b\u202e"));
    input.call = { id: 'call-shell', input: {}, name: 'shell.run' };
    const { renderer } = renderCard(input);
    const command = renderer.root.findByProps({ className: 'agent-confirmation-shell-command' });

    expect(textContent(command)).toBe("printf 'a  b'\\tline\\nnext\\u001b\\u202e");
  });

  it.each([
    ['file.stage', fileStageAction()],
    ['file.stage local path', fileStageAction('local-path')],
    ['file.publish', filePublishAction()],
    ['file.upload', fileUploadAction()],
  ])('supports the immutable %s prepared action on the generic preview path', (label, action) => {
    const input = approval(action);
    input.call = { id: `call-${label}`, input: {}, name: action.kind };
    input.preview.title = action.kind === 'file.upload'
      ? '上传本机文件到资料库'
      : action.kind === 'file.publish'
        ? '保存 Agent 输出'
        : action.sourceKind === 'local-picker'
          ? '选择并暂存文件'
          : '暂存本机文件';
    input.preview.details = [
      ...('sourcePath' in action ? [{ label: '来源', value: action.sourcePath }] : []),
      { label: '位置', value: action.targetLabel },
    ];
    const { onResolve, renderer } = renderCard(input);
    const allow = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '允许');

    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(textContent(renderer.root)).toContain(input.preview.title);
    expect(textContent(renderer.root)).toContain(action.targetLabel);
    if ('sourcePath' in action) {
      expect(textContent(renderer.root)).toContain(action.sourcePath);
    }
    expect(renderer.root.findAllByProps({ 'data-testid': 'library-node-picker' })).toHaveLength(0);
    expect(allow?.props.disabled).toBe(false);
    act(() => allow?.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });

  it('preserves the media action discriminator while editing the public draft', () => {
    const { onResolve, renderer } = renderCard(approval(mediaAction()));
    const fileNameInput = renderer.root.findAllByType('input')
      .find(input => input.props.type !== 'checkbox');
    const formatSelect = renderer.root.findByType('select');

    act(() => fileNameInput?.props.onChange({ target: { value: 'renamed.m4a' } }));
    act(() => formatSelect.props.onChange({ target: { value: 'mp3' } }));
    const allow = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '允许');
    act(() => allow?.props.onClick());

    expect(onResolve).toHaveBeenCalledWith(true, {
      conflictPolicy: 'auto_rename',
      destination: 'library',
      fallbackPolicy: 'prompt_local',
      kind: 'media.extractAudio',
      libraryId: 3,
      outputFileName: 'renamed.mp3',
      outputFormat: 'mp3',
      parentId: 10,
      sourceNodeId: 8,
      targetLabel: '视频',
      version: 1,
    });
  });

  it.each([
    ['unknown kind', { ...mediaAction(), kind: 'shell.run' }],
    ['unknown version', { ...mediaAction(), version: 2 }],
    ['extra field', { ...mediaAction(), untrusted: true }],
    ['missing action', null],
  ])('fails closed for a %s preparation while keeping cancellation available', (_label, action) => {
    const { onResolve, renderer } = renderCard(approval(action));
    const buttons = renderer.root.findAllByType('button');
    const allow = buttons.find(button => textContent(button) === '允许');
    const cancel = buttons.find(button => textContent(button) === '取消');

    expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined();
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findAllByType('select')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-testid': 'library-node-picker' })).toHaveLength(0);
    expect(allow?.props.disabled).toBe(true);
    expect(cancel?.props.disabled).toBe(false);

    act(() => cancel?.props.onClick());
    expect(onResolve).toHaveBeenCalledOnce();
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  it('keeps approvals without a prepared action on the generic confirmation path', () => {
    const { onResolve, renderer } = renderCard(approval());
    const allow = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '允许');

    expect(textContent(renderer.root)).toContain('movie.mp4');
    expect(allow?.props.disabled).toBe(false);
    act(() => allow?.props.onClick());
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });
});
