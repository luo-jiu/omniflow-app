import React from 'react';
import { IconShieldStroked, IconTick } from '@douyinfe/semi-icons';
import { Popover } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import { getAppPopupContainer } from '@/utils/popup-container';
import type { AgentSessionPermissionMode } from '@/shared/agent/agent-session-management';

const LABELS: Record<AgentSessionPermissionMode, string> = {
  ask: '询问访问', group: '组内自动', 'full-access': '完全访问',
};

const Trigger = styled.button`
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 0 8px;
  border: 0;
  border-radius: var(--app-radius-large);
  background: transparent;
  color: var(--app-text-muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  .semi-icon { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 20px; }
  svg { display: block; width: 14px; height: 14px; }
  &:hover:not(:disabled), &:focus-visible { color: var(--app-text); background: var(--semi-color-fill-0); }
  &:focus-visible { outline: 2px solid var(--semi-color-primary-light-active); }
  &:disabled { opacity: 0.45; cursor: default; }
`;

const Menu = styled.div`
  width: 160px;
  padding: 4px;
  border: 1px solid var(--app-border-strong);
  border-radius: 8px;
  background: var(--app-bg-elevated);
  box-shadow: var(--app-shadow);
  display: flex;
  flex-direction: column;
  gap: 2px;
  button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--app-radius-small);
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
    line-height: 20px;
    text-align: left;
    cursor: pointer;
  }
  button:hover, button:focus-visible, button[aria-checked='true'] { background: var(--semi-color-fill-1); }
  button[aria-checked='true'] { color: var(--semi-color-primary); font-weight: 700; }
  button:focus-visible { outline: 2px solid var(--semi-color-primary-light-active); outline-offset: -2px; }
  .semi-icon { display: inline-flex; align-items: center; width: 14px; height: 20px; }
  svg { display: block; width: 14px; height: 14px; }
`;

export default function AgentPermissionControl({ value, disabled, onChange, grouped = false }: {
  value: AgentSessionPermissionMode;
  grouped?: boolean;
  disabled: boolean;
  onChange: (value: AgentSessionPermissionMode) => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const focusMenuOnOpen = React.useRef(false);
  return <Popover trigger="click" position="topRight" showArrow={false} motion={false}
    visible={!disabled && visible} onVisibleChange={setVisible} getPopupContainer={getAppPopupContainer}
    style={{ backgroundColor: 'transparent', boxShadow: 'none' }}
    content={<Menu role="menu" aria-label="Agent 权限模式" ref={node => {
      menuRef.current = node;
      if (node && focusMenuOnOpen.current) {
        node.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
        focusMenuOnOpen.current = false;
      }
    }} onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setVisible(false); triggerRef.current?.focus();
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const options = Array.from(event.currentTarget.querySelectorAll('button'));
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      options[(current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
    }}>
      {(Object.keys(LABELS) as AgentSessionPermissionMode[]).filter(mode => mode !== 'group' || grouped).map(mode => (
        <button key={mode} type="button" role="menuitemradio" aria-checked={mode === value}
          onClick={() => { setVisible(false); triggerRef.current?.focus(); onChange(mode); }}>
          <span>{LABELS[mode]}</span>{mode === value ? <IconTick aria-hidden="true" /> : null}
        </button>
      ))}
    </Menu>}>
    <Trigger ref={triggerRef} disabled={disabled} type="button" aria-haspopup="menu" aria-expanded={!disabled && visible}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setVisible(false); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (visible) menuRef.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
          else { focusMenuOnOpen.current = true; setVisible(true); }
        }
      }}
      aria-label={`Agent 权限模式：${LABELS[value]}`} title="当前会话的访问权限">
      <IconShieldStroked aria-hidden="true" /><span>{LABELS[value]}</span>
    </Trigger>
  </Popover>;
}
