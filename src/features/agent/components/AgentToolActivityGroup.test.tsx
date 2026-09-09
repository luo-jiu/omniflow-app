import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import AgentToolActivityGroup from './AgentToolActivityGroup';

vi.mock('@douyinfe/semi-icons', () => ({
  IconChevronRightStroked: () => null,
  IconSearch: () => null,
}));

vi.mock('./AgentToolActivityCard', () => ({
  default: ({ activity }: { activity: AgentToolActivitySnapshot }) => (
    <div data-activity-id={activity.id}>{activity.call.name}</div>
  ),
}));

const renderers: TestRenderer.ReactTestRenderer[] = [];

function activity(
  id: string,
  ordinal: number,
  operationKind: NonNullable<AgentToolActivitySnapshot['toolMetadata']>['operationKind'],
): AgentToolActivitySnapshot {
  return {
    call: { id: `call-${id}`, input: {}, name: operationKind === 'search' ? 'file.search' : 'file.read' },
    createdAt: `2026-09-08T00:00:0${ordinal}.000Z`,
    id,
    ordinal,
    permissionBehavior: 'allow',
    result: { message: `${id} completed`, ok: true },
    revision: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
    toolMetadata: {
      groupKind: 'resource-read',
      kind: 'business',
      operationKind,
      risk: 'read',
    },
  };
}

function textContent(instance: TestRenderer.ReactTestInstance): string {
  return instance.children.map(child => (
    typeof child === 'string' ? child : textContent(child)
  )).join('');
}

afterEach(() => {
  renderers.splice(0).forEach(renderer => act(() => renderer.unmount()));
});

describe('AgentToolActivityGroup', () => {
  it('uses one muted read summary and reveals the ordered activities on demand', () => {
    const onExpand = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AgentToolActivityGroup
          activities={[
            activity('read-1', 1, 'read'),
            activity('search-2', 2, 'search'),
          ]}
          approvalBusyIds={new Set()}
          interactionBusyIds={new Set()}
          libraryId={3}
          onExpand={onExpand}
          onResolveApproval={vi.fn()}
          ownerScope={null}
        />,
      );
    });
    renderers.push(renderer);

    const toggle = renderer.root.findByProps({ className: 'agent-activity-group-toggle' });
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(textContent(toggle)).toBe('读取了 2 项');
    expect(textContent(renderer.root)).not.toContain('搜索 1');
    expect(renderer.root.findByProps({ className: 'agent-activity-group-collapse' }).props['aria-hidden'])
      .toBe(true);

    act(() => toggle.props.onClick());

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props['aria-expanded'])
      .toBe(true);
    expect(renderer.root.findByProps({ className: 'agent-activity-group-collapse' }).props['aria-hidden'])
      .toBe(false);
    expect(renderer.root.findAllByProps({ 'data-activity-id': 'read-1' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-activity-id': 'search-2' })).toHaveLength(1);
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-group-items' })))
      .toBe('file.readfile.search');

    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
