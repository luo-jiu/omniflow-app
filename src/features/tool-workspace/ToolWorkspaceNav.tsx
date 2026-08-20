import React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tooltip } from '@douyinfe/semi-ui';

import claudeIconUrl from '@/assets/icons/ai-providers/claude.svg';
import subtitleIconUrl from '@/assets/icons/material/subtitles.svg';
import resourceGrabIconUrl from '@/assets/icons/material/resource-grab.svg';
import videoIconUrl from '@/assets/icons/material/video.svg';
import type { ToolWorkspaceToolId } from './types';
import { ToolNav } from './styles';

type ToolWorkspaceNavProps = {
  activeToolId: ToolWorkspaceToolId;
  collapsed: boolean;
  onOrderChange: (order: ToolWorkspaceToolId[]) => void;
  onSelectTool: (toolId: ToolWorkspaceToolId) => void;
  order: ToolWorkspaceToolId[];
};

const COLLAPSED_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--app-bg-elevated)',
  border: '1px solid var(--app-border-strong)',
  boxShadow: 'var(--app-shadow)',
  color: 'var(--app-text)',
  fontSize: 11,
  padding: '6px 8px',
};

const TOOL_ITEMS: Array<{ icon: React.ReactNode; id: ToolWorkspaceToolId; title: string }> = [
  {
    icon: <img className="tool-static-icon" src={claudeIconUrl} alt="" draggable={false} />,
    id: 'ai-services',
    title: 'AI 服务配置',
  },
  {
    icon: <img className="tool-static-icon" src={subtitleIconUrl} alt="" draggable={false} />,
    id: 'subtitle-translation',
    title: 'AI 字幕翻译',
  },
  {
    icon: <img className="tool-static-icon" src={videoIconUrl} alt="" draggable={false} />,
    id: 'media-file-processing',
    title: '媒体文件处理',
  },
  {
    icon: <img className="tool-static-icon" src={resourceGrabIconUrl} alt="" draggable={false} />,
    id: 'media-processing',
    title: '资源捕获处理',
  },
];

const TOOL_ITEM_BY_ID = new Map(TOOL_ITEMS.map((item) => [item.id, item]));

type SortableToolItemProps = {
  active: boolean;
  collapsed: boolean;
  item: (typeof TOOL_ITEMS)[number];
  onSelect: () => void;
};

const SortableToolItem: React.FC<SortableToolItemProps> = ({
  active,
  collapsed,
  item,
  onSelect,
}) => {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      className={`tool-card ${active ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <button
        type="button"
        aria-label={item.title}
        className="tool-card-action"
        onClick={onSelect}
      >
        <span className="tool-card-title">
          <Tooltip
            content={item.title}
            position="right"
            showArrow={false}
            style={COLLAPSED_TOOLTIP_STYLE}
            trigger={collapsed ? 'hover' : 'custom'}
            visible={collapsed ? undefined : false}
          >
            <span className="tool-card-icon" aria-hidden="true">{item.icon}</span>
          </Tooltip>
          <span className="tool-card-label">{item.title}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`调整${item.title}顺序`}
        className="tool-card-handle"
        title={`拖动调整${item.title}顺序`}
        {...attributes}
        {...listeners}
      >
        <span className="tool-card-handle-dots" aria-hidden="true" />
      </button>
    </div>
  );
};

const ToolWorkspaceNav: React.FC<ToolWorkspaceNavProps> = ({
  activeToolId,
  collapsed,
  onOrderChange,
  onSelectTool,
  order,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const orderedItems = order
    .map((toolId) => TOOL_ITEM_BY_ID.get(toolId))
    .filter((item): item is (typeof TOOL_ITEMS)[number] => Boolean(item));

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const activeId = event.active.id as ToolWorkspaceToolId;
    const overId = event.over?.id as ToolWorkspaceToolId | undefined;
    if (!overId || activeId === overId) return;
    const fromIndex = order.indexOf(activeId);
    const toIndex = order.indexOf(overId);
    if (fromIndex < 0 || toIndex < 0) return;
    onOrderChange(arrayMove(order, fromIndex, toIndex));
  }, [onOrderChange, order]);

  return (
    <ToolNav className={collapsed ? 'is-collapsed' : undefined}>
      <div className="title">工具区</div>
      <DndContext
        collisionDetection={closestCenter}
        sensors={sensors}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="tool-list">
            {orderedItems.map((item) => (
              <SortableToolItem
                key={item.id}
                active={activeToolId === item.id}
                collapsed={collapsed}
                item={item}
                onSelect={() => onSelectTool(item.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </ToolNav>
  );
};

export default ToolWorkspaceNav;
