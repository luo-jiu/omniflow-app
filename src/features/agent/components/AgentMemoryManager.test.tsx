import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentMemoryItem } from '@/shared/agent/agent.types';
import AgentMemoryManager, { type AgentMemoryManagerProps } from './AgentMemoryManager';

vi.mock('@douyinfe/semi-icons', () => ({
  IconChevronLeft: () => null,
  IconClose: () => null,
  IconDelete: () => null,
  IconEdit: () => null,
  IconSave: () => null,
  IconSearch: () => null,
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Spin: () => React.createElement('span', { 'data-testid': 'spin' }),
}));

const renderers: TestRenderer.ReactTestRenderer[] = [];

function memory(id = 'memory-1'): AgentMemoryItem {
  return {
    application: '处理当前资料库时',
    content: '保持简洁回答',
    createdAt: '2026-08-24T00:00:00.000Z',
    id,
    kind: 'preference',
    reason: '用户明确要求记住',
    revision: 2,
    scope: 'global',
    title: '回答风格',
    updatedAt: '2026-08-24T00:01:00.000Z',
  };
}

function renderManager(overrides: Partial<AgentMemoryManagerProps> = {}) {
  const props: AgentMemoryManagerProps = {
    error: null,
    hasMore: false,
    loadMoreError: null,
    loading: false,
    loadingMore: false,
    memories: [],
    onBack: vi.fn(),
    onDelete: vi.fn(),
    onLoadMore: vi.fn(),
    onQueryChange: vi.fn(),
    onRetry: vi.fn(),
    onSave: vi.fn().mockResolvedValue(true),
    query: '',
    total: 0,
    ...overrides,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(AgentMemoryManager, props));
  });
  renderers.push(renderer);
  return { props, renderer };
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

describe('AgentMemoryManager', () => {
  it('shows an initial load error and delegates retry', () => {
    const onRetry = vi.fn();
    const { renderer } = renderManager({ error: '读取失败', onRetry });
    const retry = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '重试');

    expect(retry).toBeDefined();
    expect(textContent(renderer.root)).toContain('读取失败');
    act(() => retry?.props.onClick());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps existing rows visible when loading more fails', () => {
    const onLoadMore = vi.fn();
    const item = memory();
    const { renderer } = renderManager({
      hasMore: true,
      loadMoreError: '下一页失败',
      memories: [item],
      onLoadMore,
      total: 2,
    });
    const retry = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '重试');

    expect(textContent(renderer.root)).toContain(item.title);
    expect(textContent(renderer.root)).toContain('下一页失败');
    act(() => retry?.props.onClick());
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('delegates deletion so the workspace owns confirmation', () => {
    const onDelete = vi.fn();
    const item = memory();
    const { renderer } = renderManager({ memories: [item], onDelete, total: 1 });
    const deleteButton = renderer.root.findByProps({
      'aria-label': `删除 ${item.title}`,
    });

    act(() => deleteButton.props.onClick());
    expect(onDelete).toHaveBeenCalledWith({
      id: item.id,
      revision: item.revision,
      title: item.title,
    });
  });

  it('locks search while an edit draft is active', () => {
    const item = memory();
    const { renderer } = renderManager({ memories: [item], total: 1 });
    const search = renderer.root.findByProps({ 'aria-label': '搜索长期记忆' });
    const editButton = renderer.root.findByProps({
      'aria-label': `编辑 ${item.title}`,
    });

    expect(search.props.disabled).toBe(false);
    act(() => editButton.props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': '搜索长期记忆' }).props.disabled).toBe(true);
  });
});
