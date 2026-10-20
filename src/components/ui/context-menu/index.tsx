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
  'aria-label'?: string;
  'aria-labelledby'?: string;
  data?: any;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  onItemClick?: () => void;
  submenuPosition?: ContextMenuPosition | 'auto';
  submenuPreferredHorizontal?: 'left' | 'right';
  boundaryRect?: OverlayBoundaryRect | null;
  getPopupContainer?: () => HTMLElement;
}

const ContextMenuSubmenuItem: React.FC<{
  childrenItems: ContextMenuItem[];
  className?: string;
  content: (state: { expanded: boolean; triggerId: string; menuId: string }) => React.ReactNode;
  data?: any;
  onItemClick?: () => void;
  submenuPosition: ContextMenuPosition | 'auto';
  submenuPreferredHorizontal: 'left' | 'right';
  boundaryRect?: OverlayBoundaryRect | null;
  getPopupContainer?: () => HTMLElement;
}> = ({ childrenItems, className, content, data, onItemClick, submenuPosition, submenuPreferredHorizontal, boundaryRect, getPopupContainer: getPopupContainerProp }) => {
  const triggerRef = React.useRef<HTMLDivElement | null>(null);
  const resolveFrameRef = React.useRef<number | null>(null);
  const triggerId = React.useId();
  const menuId = React.useId();
  // Popover retains visibility ownership; this state only projects its actual visibility to AX.
  const [expanded, setExpanded] = React.useState(false);
  const [resolvedPosition, setResolvedPosition] = React.useState<ContextMenuPosition>(
    submenuPreferredHorizontal === 'left' ? 'leftTop' : 'rightTop',
  );

  const resolvePreferredPosition = React.useCallback(() => {
    if (submenuPosition !== 'auto' || !triggerRef.current) {
      return;
    }
    const nextPosition = resolveOverlayPlacement(triggerRef.current.getBoundingClientRect(), {
      preferredHorizontal: submenuPreferredHorizontal,
      preferredVertical: 'top',
      boundaryRect,
    });
    setResolvedPosition((currentPosition) => (
      currentPosition === nextPosition ? currentPosition : nextPosition
    ));
  }, [boundaryRect, submenuPosition, submenuPreferredHorizontal]);

  const scheduleResolvePreferredPosition = React.useCallback(() => {
    if (resolveFrameRef.current != null) {
      window.cancelAnimationFrame(resolveFrameRef.current);
    }
    resolveFrameRef.current = window.requestAnimationFrame(() => {
      resolveFrameRef.current = null;
      resolvePreferredPosition();
    });
  }, [resolvePreferredPosition]);

  const handleVisibleChange = React.useCallback((visible: boolean) => {
    setExpanded(visible);
    if (!visible) {
      return;
    }
    scheduleResolvePreferredPosition();
  }, [scheduleResolvePreferredPosition]);

  React.useEffect(() => () => {
    if (resolveFrameRef.current != null) {
      window.cancelAnimationFrame(resolveFrameRef.current);
      resolveFrameRef.current = null;
    }
  }, []);

  return (
    <Popover
      trigger="hover"
      showArrow={false}
      position={submenuPosition === 'auto' ? resolvedPosition : submenuPosition}
      spacing={4}
      getPopupContainer={getPopupContainerProp ?? getAppPopupContainer}
      onVisibleChange={handleVisibleChange}
      content={
        <ContextMenu
          id={menuId}
          aria-labelledby={triggerId}
          items={childrenItems}
          data={data}
          className={className}
          onItemClick={onItemClick}
          submenuPosition={submenuPosition}
          submenuPreferredHorizontal={submenuPreferredHorizontal}
          boundaryRect={boundaryRect}
          getPopupContainer={getPopupContainerProp}
        />
      }
    >
      <div
        ref={triggerRef}
        onMouseEnter={scheduleResolvePreferredPosition}
        onMouseMove={scheduleResolvePreferredPosition}
      >
        {content({ expanded, triggerId, menuId })}
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
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  data,
  style,
  className,
  id,
  onItemClick,
  submenuPosition = 'auto',
  submenuPreferredHorizontal = 'right',
  boundaryRect = null,
  getPopupContainer: getPopupContainerProp,
}) => {
  return (
    <MenuContent
      style={style}
      className={className}
      id={id}
      role="menu"
      aria-label={ariaLabelledBy ? undefined : ariaLabel ?? title ?? '上下文菜单'}
      aria-labelledby={ariaLabelledBy}
      aria-orientation="vertical"
    >
      {title && <div className="menu-title">{title}</div>}
      {items.map((item, index) => {
        if (item.type === 'divider') {
          return <div key={`divider-${index}`} role="separator"><Divider style={{ margin: '4px 0' }} /></div>;
        }

        if (item.type === 'title') {
          return (
            <div key={`title-${index}`} className="menu-title">
              {item.label}
            </div>
          );
        }

        const itemKey = item.key || `item-${index}`;
        const renderContent = (submenu?: { expanded: boolean; triggerId: string; menuId: string }) => {
          const content = (
            <div
              id={submenu?.triggerId}
              className={`menu-item ${item.children?.length ? 'has-submenu' : ''} ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              aria-haspopup={item.children?.length ? 'menu' : undefined}
              aria-expanded={item.children?.length ? submenu?.expanded ?? false : undefined}
              aria-controls={submenu?.expanded ? submenu.menuId : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                if (item.render) return; // 如果有自定义 render，由 render 内部处理点击
                if (item.children?.length) return; // 二级菜单由 hover 交互处理
                item.onClick?.(data);
                onItemClick?.(); // 点击后触发通知
              }}
            >
              {item.icon && <span className="menu-item-icon" aria-hidden="true">{item.icon}</span>}
              <span className="menu-item-label">{item.label}</span>
              {item.children?.length ? (
                <svg className="menu-item-submenu-arrow" width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true">
                  <path d="M3 2 L7 6 L3 10" stroke="currentColor" strokeWidth="1" />
                </svg>
              ) : null}
            </div>
          );
          return item.render ? item.render(content) : content;
        };

        if (item.children?.length && !item.disabled) {
          return (
            <ContextMenuSubmenuItem
              key={itemKey}
              childrenItems={item.children}
              data={data}
              className={className}
              onItemClick={onItemClick}
              submenuPosition={submenuPosition}
              submenuPreferredHorizontal={submenuPreferredHorizontal}
              boundaryRect={boundaryRect}
              getPopupContainer={getPopupContainerProp}
              content={renderContent}
            />
          );
        }

        return <React.Fragment key={itemKey}>{renderContent()}</React.Fragment>;
      })}
    </MenuContent>
  );
};

export default ContextMenu;
