import type React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CompactModal } from '@/components/ui/compact-modal';
import type { AgentSessionGroup } from '@/shared/agent/agent-session-management';
import AgentSessionGroupEditor from './AgentSessionGroupEditor';

vi.mock('@/components/ui/compact-modal', () => ({
  CompactModal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/outline-icon', () => ({ default: () => null }));

describe('Agent session group name editor', () => {
  it('changes only the name and preserves legacy directory metadata', async () => {
    const group: AgentSessionGroup = {
      id: 'group-a', libraryId: 3, name: '旧组名',
      directories: [{ nodeId: 42, name: '/历史目录' }], access: 'read-write',
      revision: 7, policyRevision: 3, sessionCount: 1,
      createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z',
    };
    const onSave = vi.fn(async () => {});
    const onDelete = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(
      <AgentSessionGroupEditor group={group} onSave={onSave} onDelete={onDelete} onCancel={vi.fn()} />,
    ); });
    expect(renderer.root.findAllByType('input')).toHaveLength(1);
    expect(renderer.root.findAllByType('select')).toHaveLength(0);
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '新组名' } }));
    await act(async () => { await renderer.root.findByType(CompactModal).props.onOk(); });
    expect(onSave.mock.calls).toEqual([[{
      id: group.id, revision: group.revision, name: '新组名',
      directories: group.directories, access: group.access,
    }]]);
    expect(group.name).toBe('旧组名');
    act(() => renderer.root.findByType('button').props.onClick());
    expect(onDelete).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });

  it('creates a name-only group with empty legacy access metadata', async () => {
    const onSave = vi.fn(async () => {});
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(
      <AgentSessionGroupEditor onSave={onSave} onCancel={vi.fn()} />,
    ); });
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '新组' } }));
    await act(async () => { await renderer.root.findByType(CompactModal).props.onOk(); });
    expect(onSave.mock.calls).toEqual([[{ name: '新组', directories: [], access: 'read' }]]);
    act(() => renderer.unmount());
  });
});
