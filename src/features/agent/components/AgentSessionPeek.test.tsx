import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import AgentSessionPeek from './AgentSessionPeek';

vi.mock('@douyinfe/semi-ui', () => ({ Popover: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => <>{children}{content}</> }));
vi.mock('@douyinfe/semi-icons', () => ({ IconHistory: () => null, IconPlus: () => null, IconSearch: () => null }));

describe('Agent session peek', () => {
  it('shows recent sessions, highlights current one, and exposes manage/new actions', () => {
    const onOpen = vi.fn(); const onManage = vi.fn(); const onNew = vi.fn();
    const sessions = [{ id: 's1', title: '当前聊天', messageCount: 4, updatedAt: '2026-09-11T00:00:00Z' }, { id: 's2', title: '另一个聊天', messageCount: 2, updatedAt: '2026-09-10T00:00:00Z' }] as never[];
    const renderer = TestRenderer.create(<AgentSessionPeek sessions={sessions} total={2} activeSessionId="s1" loading={false} onOpen={onOpen} onManage={onManage} onNew={onNew} />);
    expect(renderer.root.findByProps({ 'aria-label': '最近会话' })).toBeTruthy();
    expect(renderer.root.findByProps({ 'aria-current': true })).toBeTruthy();
    const buttonWithText = (text: string) => renderer.root.findAllByType('button').find(button => button.findAllByType('span').some(span => String(span.props.children).includes(text)) || String(button.props.children).includes(text))!;
    act(() => buttonWithText('另一个聊天').props.onClick());
    expect(onOpen).toHaveBeenCalledWith(sessions[1]);
    act(() => buttonWithText('全部会话').props.onClick());
    act(() => buttonWithText('新建').props.onClick());
    expect(onManage).toHaveBeenCalledOnce(); expect(onNew).toHaveBeenCalledOnce();
    renderer.unmount();
  });
});
