import React from 'react';
import { Divider, Popover } from '@douyinfe/semi-ui';
import MenuContent from '../menu-content';
import { getAppPopupContainer } from '@/utils/popup-container';
import {
  resolveOverlayPlacement,
  type ContextMenuPosition,
  type OverlayBoundaryRect,
} from './overlay';

export type { ContextMenuPosition, OverlayBoundaryRect } from './overlay';

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
  children?: ContextMenuItem[];
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
  submenuPosition?: ContextMenuPosition | 'auto';
  submenuPreferredHorizontal?: 'left' | 'right';
  boundaryRect?: OverlayBoundaryRect | null;
}

const ContextMenuSubmenuItem: React.FC<{
  childrenItems: ContextMenuItem[];
  className?: string;
  content: React.ReactNode;
  data?: any;
  onItemClick?: () => void;
  submenuPosition: ContextMenuPosition | 'auto';
  submenuPreferredHorizontal: 'left' | 'right';
  boundaryRect?: OverlayBoundaryRect | null;
}> = ({ childrenItems, className, content, data, onItemClick, submenuPosition, submenuPreferredHorizontal, boundaryRect }) => {
  const triggerRef = React.useRef<HTMLDivElement | null>(null);
  const [resolvedPosition, setResolvedPosition] = React.useState<ContextMenuPosition>(
    submenuPreferredHorizontal === 'left' ? 'leftTop' : 'rightTop',
  );

  const resolvePreferredPosition = React.useCallback(() => {
    if (submenuPosition !== 'auto' || !triggerRef.current) {
      return;
    }
    setResolvedPosition(resolveOverlayPlacement(triggerRef.current.getBoundingClientRect(), {
      preferredHorizontal: submenuPreferredHorizontal,
      preferredVertical: 'top',
      boundaryRect,
    }));
  }, [boundaryRect, submenuPosition, submenuPreferredHorizontal]);

  const handleVisibleChange = React.useCallback((visible: boolean) => {
    if (!visible) {
      return;
    }
    resolvePreferredPosition();
  }, [resolvePreferredPosition]);

  return (
    <Popover
      trigger="hover"
      showArrow={false}
      position={submenuPosition === 'auto' ? resolvedPosition : submenuPosition}
      spacing={4}
      getPopupContainer={getAppPopupContainer}
      onVisibleChange={handleVisibleChange}
      content={
        <ContextMenu
          items={childrenItems}
          data={data}
          className={className}
          onItemClick={onItemClick}
          submenuPosition={submenuPosition}
          submenuPreferredHorizontal={submenuPreferredHorizontal}
          boundaryRect={boundaryRect}
        />
      }
    >
      <div
        ref={triggerRef}
        onMouseEnter={resolvePreferredPosition}
        onMouseMove={resolvePreferredPosition}
      >
        {content}
      </div>
    </Popover>
  );
};

/**
 * 通用右键菜单/下拉菜单组件
 * 支持标题、图标、分割线、危险状态、禁用状态、自定义包装
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  items,
  title,
  data,
  style,
  className,
  id,
  onItemClick,
  submenuPosition = 'auto',
  submenuPreferredHorizontal = 'right',
  boundaryRect = null,
}) => {
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
            className={`menu-item ${item.children?.length ? 'has-submenu' : ''} ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (item.render) return; // 如果有自定义 render，由 render 内部处理点击
              if (item.children?.length) return; // 二级菜单由 hover 交互处理
              if (!item.disabled && item.onClick) {
                item.onClick(data);
              }
              onItemClick?.(); // 点击后触发通知
            }}
          >
            {item.icon && <span className="menu-item-icon">{item.icon}</span>}
            <span className="menu-item-label">{item.label}</span>
            {item.children?.length ? <span className="menu-item-submenu-arrow">›</span> : null}
          </div>
        );

        const renderedContent = item.render ? item.render(content) : content;

        if (item.children?.length) {
          return (
            <ContextMenuSubmenuItem
              key={item.key || `item-${index}`}
              childrenItems={item.children}
              data={data}
              className={className}
              onItemClick={onItemClick}
              submenuPosition={submenuPosition}
              submenuPreferredHorizontal={submenuPreferredHorizontal}
              boundaryRect={boundaryRect}
              content={renderedContent}
            />
          );
        }

        return renderedContent;
      })}
    </MenuContent>
  );
};

export default ContextMenu;
