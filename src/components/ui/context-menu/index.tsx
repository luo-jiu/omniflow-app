import React from 'react';
import { Divider } from '@douyinfe/semi-ui';
import MenuContent from '../menu-content';

interface BaseMenuItem {
  key: string;
}

export interface MenuItem extends BaseMenuItem {
  type?: 'item'; // 默认 item
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: (data?: any) => void;
  danger?: boolean;
  disabled?: boolean;
  render?: (content: React.ReactNode) => React.ReactNode;
}

export interface MenuDivider extends BaseMenuItem {
  type: 'divider';
}

export interface MenuTitle extends BaseMenuItem {
  type: 'title';
  label: React.ReactNode;
}

export type ContextMenuItem =
  | MenuItem
  | MenuDivider
  | MenuTitle;

interface ContextMenuProps {
  items: ContextMenuItem[];
  title?: string;
  data?: any;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  onItemClick?: () => void;
}

/**
 * 通用右键菜单/下拉菜单组件
 * 支持标题、图标、分割线、危险状态、禁用状态、自定义包装
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({ items, title, data, style, className, id, onItemClick }) => {
  return (
    <MenuContent style={style} className={className} id={id}>
      {title && <div className="menu-title">{title}</div>}
      {items.map((item, index) => {
        if (item.type === 'divider') {
          return <Divider key={`divider-${index}`} style={{ margin: '4px 0' }} />;
        }
        
        if (item.type === 'title') {
          return (
            <div key={`title-${index}`} className="menu-title">
              {item.label}
            </div>
          );
        }

        const content = (
          <div
            key={item.key || `item-${index}`}
            className={`menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
            onClick={(e) => {
              if (item.render) return; // 如果有自定义 render，由 render 内部处理点击
              e.stopPropagation();
              if (!item.disabled && item.onClick) {
                item.onClick(data);
              }
              onItemClick?.(); // 点击后触发通知
            }}
          >
            {item.icon && <span className="menu-item-icon">{item.icon}</span>}
            <span className="menu-item-label">{item.label}</span>
          </div>
        );

        return item.render ? <React.Fragment key={item.key || `item-${index}`}>{item.render(content)}</React.Fragment> : content;
      })}
    </MenuContent>
  );
};

export default ContextMenu;

