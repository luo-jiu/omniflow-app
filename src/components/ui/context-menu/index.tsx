import React from 'react';
import { Divider, Popover } from '@douyinfe/semi-ui';
import MenuContent from '../menu-content';

export type ContextMenuPosition =
  | 'leftTop'
  | 'leftBottom'
  | 'rightTop'
  | 'rightBottom'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

export type OverlayBoundaryRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

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

type OverlayPlacementOptions = {
  popupHeight?: number;
  popupWidth?: number;
  preferredHorizontal?: 'left' | 'right';
  preferredVertical?: 'bottom' | 'top';
  boundaryRect?: OverlayBoundaryRect | null;
};

const DEFAULT_POPUP_WIDTH = 280;
const DEFAULT_POPUP_HEIGHT = 320;
const VIEWPORT_MARGIN = 12;

export function resolveOverlayPlacement(
  triggerRect: DOMRect,
  options?: OverlayPlacementOptions,
): ContextMenuPosition {
  const popupWidth = options?.popupWidth ?? DEFAULT_POPUP_WIDTH;
  const popupHeight = options?.popupHeight ?? DEFAULT_POPUP_HEIGHT;
  const preferredHorizontal = options?.preferredHorizontal ?? 'right';
  const preferredVertical = options?.preferredVertical ?? 'top';
  const boundaryRect = options?.boundaryRect;

  const boundaryLeft = boundaryRect?.left ?? 0;
  const boundaryRight = boundaryRect?.right ?? window.innerWidth;
  const boundaryTop = boundaryRect?.top ?? 0;
  const boundaryBottom = boundaryRect?.bottom ?? window.innerHeight;

  const spaceLeft = triggerRect.left - boundaryLeft - VIEWPORT_MARGIN;
  const spaceRight = boundaryRight - triggerRect.right - VIEWPORT_MARGIN;
  const spaceTop = triggerRect.top - boundaryTop - VIEWPORT_MARGIN;
  const spaceBottom = boundaryBottom - triggerRect.bottom - VIEWPORT_MARGIN;

  const horizontal = preferredHorizontal === 'right'
    ? (spaceRight >= popupWidth ? 'right' : 'left')
    : (spaceLeft >= popupWidth ? 'left' : 'right');

  const vertical = preferredVertical === 'bottom'
    ? (spaceBottom >= popupHeight ? 'Bottom' : 'Top')
    : (spaceTop >= popupHeight ? 'Top' : 'Bottom');

  return `${horizontal}${vertical}` as ContextMenuPosition;
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
      getPopupContainer={() => document.body}
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

        if (item.render) {
          return <React.Fragment key={item.key || `item-${index}`}>{item.render(content)}</React.Fragment>;
        }

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
              content={content}
            />
          );
        }

        return content;
      })}
    </MenuContent>
  );
};

export default ContextMenu;
