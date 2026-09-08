import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentFilePublishPreparedActionPublicV1,
  AgentFileStagePreparedActionPublicV1,
  AgentFileUploadPreparedActionPublicV1,
  AgentMediaExtractAudioPreparedActionPublicV1,
  AgentPreparedActionPublic,
  AgentShellPreparedActionPublicV1,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import AgentConfirmationCard from './AgentConfirmationCard';

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
