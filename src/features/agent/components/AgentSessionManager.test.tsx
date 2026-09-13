import React from 'react';
import { renderToString } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import { ServerStyleSheet } from 'styled-components';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionSummary } from '@/shared/agent/agent.types';
import AgentSessionManager, { type AgentSessionManagerProps } from './AgentSessionManager';

vi.mock('@douyinfe/semi-icons', () => ({
  IconChevronLeft: () => null,
  IconDelete: () => null,
  IconEdit: () => null,
  IconPlus: () => null,
  IconSearch: () => null,
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Spin: () => React.createElement('span', { 'data-testid': 'spin' }),
}));

const renderers: TestRenderer.ReactTestRenderer[] = [];

function session(overrides: Partial<AgentSessionSummary> = {}): AgentSessionSummary {
  return {
    createdAt: '2026-09-08T00:00:00.000Z',
    id: 'session-1',
    lastMessagePreview: '最近一条会话内容',
    libraryId: 2,
    messageCount: 4,
    title: '会话标题',
    updatedAt: '2026-09-08T00:01:00.000Z',
    ...overrides,
  };
}

function managerProps(overrides: Partial<AgentSessionManagerProps> = {}): AgentSessionManagerProps {
  return {
    activeSessionId: null,
    hasMore: false,
    loading: false,
    loadingMore: false,
    onBack: vi.fn(),
    onDelete: vi.fn(),
    onLoadMore: vi.fn(),
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onQueryChange: vi.fn(),
    onRename: vi.fn().mockResolvedValue(true),
    query: '',
    sessions: [],
    total: 0,
    ...overrides,
  };
}

function renderManager(overrides: Partial<AgentSessionManagerProps> = {}) {
  const props = managerProps(overrides);
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(AgentSessionManager, props));
  });
  renderers.push(renderer);
  return { props, renderer };
}

afterEach(() => {
  renderers.splice(0).forEach((renderer) => {
    act(() => renderer.unmount());
  });
});

describe('AgentSessionManager', () => {
  it('shows restore and permanent deletion only in the archive view, with group filtering', () => {
    const item = session({ archivedAt: '2026-09-13T00:00:00Z' });
    const onRestore = vi.fn(); const onDelete = vi.fn(); const onGroupFilterChange = vi.fn();
    const { renderer } = renderManager({ archived: true, sessions: [item], total: 1, onRestore, onDelete,
      groupFilter: 'all', onGroupFilterChange, groups: [] });
    expect(renderer.root.findAllByProps({ 'aria-label': `重命名 ${item.title}` })).toHaveLength(0);
    act(() => renderer.root.findByProps({ 'aria-label': `恢复 ${item.title}` }).props.onClick());
    expect(onRestore).toHaveBeenCalledWith(item);
    act(() => renderer.root.findByProps({ 'aria-label': `永久删除 ${item.title}` }).props.onClick());
    expect(onDelete).toHaveBeenCalledWith(item);
    act(() => renderer.root.findByType('select').props.onChange({ target: { value: '__ungrouped' } }));
    expect(onGroupFilterChange).toHaveBeenCalledWith('__ungrouped');
  });

  it('uses the wider manager surface and bounds long session text', () => {
    const sheet = new ServerStyleSheet();
    try {
      renderToString(sheet.collectStyles(
        React.createElement(AgentSessionManager, managerProps()),
      ));
      const styles = sheet.getStyleTags();

      expect(styles).toContain('width:min(1120px, 100%)');
      expect(styles).toContain('overflow-wrap:anywhere');
      expect(styles).toContain('-webkit-line-clamp:2');
    } finally {
      sheet.seal();
    }
  });

  it('keeps long titles and previews inside the row while retaining their full text', () => {
    const longTitle = '无空格超长标题'.repeat(20);
    const longPreview = '/Users/loyce/Downloads/no-break-path/'.repeat(20);
    const item = session({ lastMessagePreview: longPreview, title: longTitle });
    const { renderer } = renderManager({ sessions: [item], total: 1 });

    expect(renderer.root.findByProps({ className: 'agent-session-row-title' }).props.title)
      .toBe(longTitle);
    expect(renderer.root.findByProps({ className: 'agent-session-preview' }).props.title)
      .toBe(longPreview);
    expect(renderer.root.findByProps({ 'aria-label': `重命名 ${longTitle}` })).toBeDefined();
    expect(renderer.root.findByProps({ 'aria-label': `归档 ${longTitle}` })).toBeDefined();
  });

  it('delegates search and session opening without changing manager behavior', () => {
    const onOpen = vi.fn();
    const onQueryChange = vi.fn();
    const item = session();
    const { renderer } = renderManager({
      onOpen,
      onQueryChange,
      sessions: [item],
      total: 1,
    });

    act(() => {
      renderer.root.findByProps({ 'aria-label': '搜索 Agent 会话' }).props.onChange({
        target: { value: '测试' },
      });
    });
    act(() => {
      renderer.root.findByProps({ className: 'agent-session-open' }).props.onClick();
    });

    expect(onQueryChange).toHaveBeenCalledWith('测试');
    expect(onOpen).toHaveBeenCalledWith(item);
  });
});
