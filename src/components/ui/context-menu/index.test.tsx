import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@douyinfe/semi-ui', () => ({
  Divider: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  Popover: ({ children, content, onVisibleChange }: {
    children: React.ReactNode;
    content: React.ReactNode;
    onVisibleChange?: (visible: boolean) => void;
  }) => {
    const [visible, setVisible] = React.useState(false);
    const change = (next: boolean) => { setVisible(next); onVisibleChange?.(next); };
    return <div data-popover onMouseEnter={() => change(true)} onMouseLeave={() => change(false)}>
      {children}{visible ? content : null}
    </div>;
  },
}));

import ContextMenu, { type ContextMenuItem } from './index';

describe('ContextMenu accessibility and existing activation', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal('window', { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  function render(items: ContextMenuItem[], props: Partial<React.ComponentProps<typeof ContextMenu>> = {}) {
    act(() => { renderer = TestRenderer.create(<ContextMenu items={items} {...props} />); });
    return renderer!;
  }

  function role(name: string) {
    return renderer!.root.findAll(node => typeof node.type === 'string' && node.props.role === name);
  }

  function click(node: TestRenderer.ReactTestInstance) {
    const stopPropagation = vi.fn();
    act(() => node.props.onClick({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce();
  }

  it('exposes the named menu, items and separator without decorative icon names', () => {
    render([
      { key: 'heading', type: 'title', label: '文件操作' },
      { key: 'open', label: '打开', icon: <img alt="folder-icon" /> },
      { key: 'separator', type: 'divider' },
      { key: 'delete', label: '删除', danger: true },
    ], { title: '文件菜单' });
    expect(role('menu')).toHaveLength(1);
    expect(role('menu')[0].props['aria-label']).toBe('文件菜单');
    expect(role('menuitem')).toHaveLength(2);
    expect(role('separator')).toHaveLength(1);
    expect(renderer!.root.findByProps({ className: 'menu-item-icon' }).props['aria-hidden']).toBe('true');
    expect(role('menuitem')[0].props['aria-haspopup']).toBeUndefined();
    expect(role('menuitem')[0].props['aria-expanded']).toBeUndefined();
  });

  it('keeps leaf activation and completion with the original data owner', () => {
    const data = { nodeId: 12 };
    const events: unknown[] = [];
    render([{ key: 'delete', label: '删除', onClick: value => events.push(value) }], {
      data, onItemClick: () => events.push('closed'),
    });
    click(role('menuitem')[0]);
    expect(events).toEqual([data, 'closed']);
  });

  it('projects disabled state and neither activates nor closes a disabled choice', () => {
    const onClick = vi.fn();
    const onItemClick = vi.fn();
    render([{ key: 'disabled', label: '不可用', disabled: true, onClick,
      children: [{ key: 'child', label: '子项' }] }], { onItemClick });
    const item = role('menuitem')[0];
    expect(item.props['aria-disabled']).toBe(true);
    expect(item.props['aria-expanded']).toBe(false);
    expect(renderer!.root.findAllByProps({ 'data-popover': true })).toHaveLength(0);
    click(item);
    expect(onClick).not.toHaveBeenCalled();
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('mirrors actual hover visibility and associates each submenu with its trigger', () => {
    const parentClick = vi.fn();
    const childClick = vi.fn();
    const onItemClick = vi.fn();
    render([{ key: 'more', label: '更多', onClick: parentClick,
      children: [{ key: 'properties', label: '属性', onClick: childClick }] }], { onItemClick });
    let trigger = role('menuitem')[0];
    expect(trigger.props['aria-haspopup']).toBe('menu');
    expect(trigger.props['aria-expanded']).toBe(false);
    expect(trigger.props['aria-controls']).toBeUndefined();
    // Hover remains owned by Popover; no new shortcut or keyboard activation is advertised.
    expect(trigger.props.onKeyDown).toBeUndefined();
    expect(trigger.props['aria-keyshortcuts']).toBeUndefined();
    click(trigger);
    expect(parentClick).not.toHaveBeenCalled();
    expect(onItemClick).not.toHaveBeenCalled();

    const popover = renderer!.root.findByProps({ 'data-popover': true });
    act(() => popover.props.onMouseEnter());
    trigger = role('menuitem')[0];
    expect(trigger.props['aria-expanded']).toBe(true);
    const submenu = role('menu')[1];
    expect(trigger.props['aria-controls']).toBe(submenu.props.id);
    expect(submenu.props['aria-labelledby']).toBe(trigger.props.id);
    expect(submenu.props['aria-label']).toBeUndefined();
    click(role('menuitem')[1]);
    expect(childClick).toHaveBeenCalledOnce();
    expect(onItemClick).toHaveBeenCalledOnce();

    act(() => popover.props.onMouseLeave());
    expect(role('menu')).toHaveLength(1);
    expect(role('menuitem')[0].props['aria-expanded']).toBe(false);
    expect(role('menuitem')[0].props['aria-controls']).toBeUndefined();
  });

  it('preserves a custom render wrapper as the activation owner', () => {
    const directClick = vi.fn();
    const wrapperClick = vi.fn();
    const onItemClick = vi.fn();
    render([{ key: 'custom', label: '书签', onClick: directClick,
      render: content => <span data-custom-item onClick={wrapperClick}>{content}</span> }], { onItemClick });
    click(role('menuitem')[0]);
    expect(directClick).not.toHaveBeenCalled();
    expect(onItemClick).not.toHaveBeenCalled();
    act(() => renderer!.root.findByProps({ 'data-custom-item': true }).props.onClick());
    expect(wrapperClick).toHaveBeenCalledOnce();
  });
});
