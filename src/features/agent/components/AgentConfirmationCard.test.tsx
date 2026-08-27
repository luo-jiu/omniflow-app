import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentMediaExtractAudioPreparedActionPublicV1,
  AgentPreparedActionPublic,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import AgentConfirmationCard from './AgentConfirmationCard';

vi.mock('@douyinfe/semi-icons', () => ({
  IconFolder: () => null,
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
