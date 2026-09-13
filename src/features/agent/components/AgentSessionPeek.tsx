import React from 'react';
import styled, { keyframes } from 'styled-components';
import OutlineIcon from '@/components/ui/outline-icon';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import type { AgentSessionSummary } from '@/shared/agent/agent.types';
import type { AgentSessionDirectorySummary, AgentSessionGroup } from '@/shared/agent/agent-session-management';
import { agentGroupPageKey, type AgentGroupPage } from '../hooks/useAgentSessionGroups';
import {
  AGENT_DIRECTORY_BREAKPOINT,
  AGENT_DIRECTORY_BUBBLE_SIZE,
  AGENT_DIRECTORY_BUBBLE_WIDTH,
  AGENT_DIRECTORY_MAX_HEIGHT,
  AGENT_DIRECTORY_MARGIN,
  AGENT_DIRECTORY_MIN_HEIGHT,
  AGENT_DIRECTORY_SLIDE_MS,
  AGENT_DIRECTORY_SNAP_MS,
  AGENT_DIRECTORY_WIDTH,
  clampAgentDirectoryBubbleTop,
  clampAgentDirectoryPanelPosition,
} from '../agent-session-directory-layout';

const revealSessionRow = keyframes`
  from { grid-template-rows: 0fr; opacity: 0; }
  to { grid-template-rows: 1fr; opacity: 1; }
`;

const Layer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
`;

const Bubble = styled.button`
  position: absolute;
  right: ${AGENT_DIRECTORY_MARGIN}px;
  width: ${AGENT_DIRECTORY_BUBBLE_WIDTH}px;
  height: ${AGENT_DIRECTORY_BUBBLE_SIZE}px;
  display: flex;
  align-items: center;
  padding: 0 0 0 7px;
  border: 1px solid var(--app-border-strong);
  border-radius: 16px 4px 4px 16px;
  background: var(--app-bg-elevated);
  color: var(--app-text-secondary);
  box-shadow: var(--app-shadow);
  pointer-events: none;
  touch-action: none;
  user-select: none;
  cursor: grab;

  opacity: 0;
  visibility: hidden;
  transform: translateX(${AGENT_DIRECTORY_BUBBLE_WIDTH + AGENT_DIRECTORY_MARGIN}px);
  && { transition: transform 306ms ease, opacity 255ms ease, visibility 0s linear 306ms; }
  &[data-visible='true'] {
    opacity: 1;
    visibility: visible;
    transform: translateX(0);
    pointer-events: auto;
    transition-delay: ${AGENT_DIRECTORY_SLIDE_MS}ms;
  }
  &:active { cursor: grabbing; }
  &:focus-visible { outline: 2px solid var(--semi-color-focus-border); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { && { transition: none; } }
`;

const Card = styled.aside`
  position: absolute;
  right: ${AGENT_DIRECTORY_MARGIN}px;
  width: ${AGENT_DIRECTORY_WIDTH}px;
  height: ${AGENT_DIRECTORY_MAX_HEIGHT}px;
  max-height: min(${AGENT_DIRECTORY_MAX_HEIGHT}px, var(--agent-directory-available-height, calc(100% - 24px)));
  min-height: min(${AGENT_DIRECTORY_MIN_HEIGHT}px, var(--agent-directory-available-height, calc(100% - 24px)));
  min-width: 0;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  resize: none;
  overflow: hidden;
  padding: 8px;
  border: 1px solid var(--app-border-strong);
  border-radius: 20px; background: var(--app-bg-elevated); box-shadow: var(--app-shadow);
  .peek-head { flex:none; display:flex; align-items:center; gap:7px; padding:5px 7px 8px; color:var(--app-text); font-size:13px; line-height:20px; font-weight:600; cursor:grab; touch-action:none; user-select:none; }
  .peek-head:active { cursor:grabbing; }
  .peek-drag-label { display:inline-flex; align-items:center; gap:7px; color:inherit; }
  .peek-drag-label:focus-visible { outline:2px solid var(--semi-color-focus-border); outline-offset:2px; }
  .peek-close { flex:none; display:grid; place-items:center; width:24px; height:24px; border:0; padding:0; background:transparent; color:var(--app-text-muted); cursor:pointer; }
  .peek-count { margin-left:auto; color:var(--app-text-muted); font-size:12px; font-weight:400; white-space:nowrap; }
  .peek-list {
    ${workspaceScrollbarStyles}
    flex:1; min-height:0; overflow-x:hidden; overflow-y:auto;
    display:flex; flex-direction:column; gap:2px; overscroll-behavior:contain;
  }
  .peek-row { display:flex; align-items:center; gap:3px; flex:none; width:100%; min-width:0; min-height:30px; padding:0 3px 0 8px; border:0; border-radius:5px; background:transparent; color:var(--app-text); text-align:left; }
  .peek-open { min-width:0; flex:1; min-height:30px; border:0; padding:5px 0; text-align:left; background:transparent; color:inherit; cursor:pointer; }
  .peek-inline { width:26px; height:26px; flex:none; display:inline-flex; align-items:center; justify-content:center; border:0; padding:0; border-radius:5px; background:transparent; color:var(--app-text-muted); cursor:pointer; }
  .peek-inline:hover { background:var(--app-hover-bg); }
  .peek-archive { opacity:0; pointer-events:none; }
  .peek-row:hover .peek-archive, .peek-row:focus-within .peek-archive { opacity:1; pointer-events:auto; }
  @media (hover: none) { .peek-archive { opacity:1; pointer-events:auto; } }
  .peek-group-head { display:flex; align-items:center; gap:3px; min-height:32px; }
  .peek-group-toggle { min-width:0; flex:1; display:flex; align-items:center; gap:6px; min-height:30px; border:0; padding:0 4px; background:transparent; color:var(--app-text-secondary); cursor:pointer; font:inherit; font-size:12px; }
  .peek-group-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
  .peek-group-count { margin-left:auto; color:var(--app-text-muted); font-size:12px; }
  .peek-group-body { display:grid; grid-template-rows:0fr; visibility:hidden; transition:grid-template-rows 220ms ease, visibility 0s linear 220ms; }
  .peek-group-body[data-open='true'] { grid-template-rows:1fr; visibility:visible; transition-delay:0s; }
  .peek-group-inner { min-height:0; overflow:hidden; padding-left:12px; }
  .peek-row-reveal { display:grid; grid-template-rows:1fr; animation:${revealSessionRow} 220ms ease both; }
  .peek-row-clip { min-height:0; overflow:hidden; }
  .peek-group { flex:none; }
  .peek-more { display:block; margin:3px 0; border:0; padding:4px 8px; background:transparent; color:var(--app-text-muted); font-size:12px; cursor:pointer; }
  .peek-row:not(:disabled):hover, .peek-row[aria-current='true'] { background:var(--semi-color-fill-1); }
  .peek-row[aria-current='true'] { color:var(--workspace-nav-accent, var(--app-accent)); }
  .peek-title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:inherit; font-size:12px; line-height:18px; }
  .peek-meta { display:block; margin-top:2px; color:var(--app-text-muted); font-size:12px; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .peek-empty { padding:8px; }
  .peek-foot { flex:none; display:flex; gap:6px; padding-top:7px; margin-top:6px; border-top:1px solid var(--app-border); }
  .peek-action { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 7px; border:0; border-radius:999px; background:transparent; color:var(--app-text-muted); font-size:12px; cursor:pointer; }
  .peek-action:not(:disabled):hover { background:var(--semi-color-fill-1); color:var(--app-text); }
  .peek-memory { margin-left:auto; width:28px; padding:0; justify-content:center; }
  button:disabled { cursor:default; }
  button:focus-visible { outline:2px solid var(--semi-color-focus-border); outline-offset:-2px; }

  opacity: 0;
  visibility: hidden;
  transform: translateX(${AGENT_DIRECTORY_WIDTH + AGENT_DIRECTORY_MARGIN}px);
  transition:
    transform ${AGENT_DIRECTORY_SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity ${AGENT_DIRECTORY_SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear ${AGENT_DIRECTORY_SLIDE_MS}ms;
  &[data-visible='true'] {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateX(var(--agent-directory-drag-x, 0px));
    transition-delay: 0s;
  }
  &[data-visible='true'][data-snapping='true'] {
    transition-duration: ${AGENT_DIRECTORY_SNAP_MS}ms, ${AGENT_DIRECTORY_SLIDE_MS}ms, 0s;
  }
  &[data-dragging='true'] { transition: none; }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
    .peek-group-body { transition:none; }
    .peek-row-reveal { animation:none; }
  }
`;

type DirectoryDrag = {
  kind: 'bubble' | 'panel';
  pointerId: number;
  startX: number;
  startY: number;
  startTop: number;
  startLeft: number;
  panelHeight: number;
  position: { left: number; top: number };
  moved: boolean;
};

const SESSION_REVEAL_STEP = 5;

export default function AgentSessionPeek({ sessions, total, activeSessionId, loading, busy = false, onOpen, onManage, onNew, onMemories,
  directory, pages = {}, currentGroupId = null, revealGroupId, storageKey, error,
  onLoadGroup, onCreateGroup, onEditGroup, onNewInGroup, onArchive, onArchives, onRetry,
}: {
  sessions: AgentSessionSummary[]; total: number; activeSessionId: string | null; loading: boolean;
  busy?: boolean;
  onOpen: (session: AgentSessionSummary) => void; onManage: () => void; onNew: () => void;
  onMemories: () => void;
  directory?: AgentSessionDirectorySummary; pages?: Record<string, AgentGroupPage>; currentGroupId?: string | null;
  revealGroupId?: string | null; storageKey?: string; error?: string;
  onLoadGroup?: (id: string | null, more?: boolean) => void; onCreateGroup?: () => void;
  onEditGroup?: (group: AgentSessionGroup) => void; onNewInGroup?: (id: string | null) => void;
  onArchive?: (session: AgentSessionSummary) => void; onArchives?: () => void; onRetry?: () => void;
}) {
  const [closedGroups, setClosedGroups] = React.useState<Record<string, boolean>>(() => {
    try {
      const value: unknown = storageKey ? JSON.parse(localStorage.getItem(storageKey) || '{}') : {};
      return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([key, closed]) => key.length < 220 && typeof closed === 'boolean').slice(0, 101)) : {};
    } catch { return {}; }
  });
  const [visibleCounts, setVisibleCounts] = React.useState<Record<string, number>>({});
  const sections = directory ? [{ id: null, name: '未分组', count: directory.ungroupedCount },
    ...directory.groups.map(group => ({ id: group.id, name: group.name, count: group.sessionCount }))] : [];
  const groupOpen = (id: string | null) => !(closedGroups[agentGroupPageKey(id)] ?? Boolean(id && id !== currentGroupId));
  React.useEffect(() => {
    if (!directory) return;
    for (const section of sections) if (groupOpen(section.id) && !pages[agentGroupPageKey(section.id)]) onLoadGroup?.(section.id);
  });
  React.useEffect(() => {
    if (revealGroupId) setClosedGroups(current => ({ ...current, [revealGroupId]: false }));
  }, [revealGroupId]);
  React.useEffect(() => { setClosedGroups(current => ({ ...current, [agentGroupPageKey(currentGroupId)]: false })); }, [currentGroupId]);
  const toggleGroup = (id: string | null) => {
    if (!groupOpen(id)) setVisibleCounts(current => ({ ...current, [agentGroupPageKey(id)]: SESSION_REVEAL_STEP }));
    const next = { ...closedGroups, [agentGroupPageKey(id)]: groupOpen(id) };
    setClosedGroups(next);
    if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Display preference only. */ } }
  };
  const layerRef = React.useRef<HTMLDivElement>(null);
  const bubbleRef = React.useRef<HTMLButtonElement>(null);
  const cardRef = React.useRef<HTMLElement>(null);
  const cardId = React.useId();
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [open, setOpen] = React.useState(false);
  const [preferredTop, setPreferredTop] = React.useState(AGENT_DIRECTORY_MARGIN);
  const [panelDrag, setPanelDrag] = React.useState<{ offsetX: number; top: number } | null>(null);
  const [snapping, setSnapping] = React.useState(false);
  const drag = React.useRef<DirectoryDrag | null>(null);
  const suppressClick = React.useRef(false);
  const compact = viewport.width > 0 && viewport.width <= AGENT_DIRECTORY_BREAKPOINT;
  const bubbleTop = clampAgentDirectoryBubbleTop(preferredTop, viewport.height);
  const cardTop = panelDrag?.top ?? clampAgentDirectoryPanelPosition(0, preferredTop, viewport.width, viewport.height).top;
  const lastCardTop = React.useRef(cardTop);
  lastCardTop.current = cardTop;
  const visible = !compact || open;
  const close = React.useCallback(() => {
    setPreferredTop(lastCardTop.current);
    setSnapping(false);
    setOpen(false);
  }, []);

  React.useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const measure = () => {
      const { width, height } = layer.getBoundingClientRect();
      setViewport(current => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    setOpen(false);
    setPreferredTop(lastCardTop.current);
    setPanelDrag(null);
    setSnapping(false);
    drag.current = null;
  }, [compact]);

  React.useEffect(() => {
    const layer = layerRef.current;
    if (!compact || !open || !layer) return;
    const ownerDocument = layer.ownerDocument;
    const dismiss = (event: PointerEvent) => {
      if (!layer.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      bubbleRef.current?.focus();
    };
    ownerDocument.addEventListener('pointerdown', dismiss);
    ownerDocument.addEventListener('keydown', onKeyDown);
    return () => {
      ownerDocument.removeEventListener('pointerdown', dismiss);
      ownerDocument.removeEventListener('keydown', onKeyDown);
    };
  }, [close, compact, open]);

  const settleDrag = () => {
    const current = drag.current;
    if (!current) return;
    if (current.kind === 'panel' && current.moved) {
      setPreferredTop(current.position.top);
      setSnapping(true);
      setPanelDrag(null);
    }
    if (current.kind === 'bubble') suppressClick.current = current.moved;
    drag.current = null;
  };

  const finishDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    settleDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return <Layer ref={layerRef} data-agent-session-directory data-compact={compact}>
    <Bubble
      ref={bubbleRef}
      data-visible={compact && !open}
      aria-hidden={!compact || open}
      tabIndex={compact && !open ? 0 : -1}
      type="button"
      aria-label="会话目录"
      aria-controls={cardId}
      aria-expanded={compact && open}
      aria-haspopup="dialog"
      title="会话目录（可上下拖动）"
      style={{ top: bubbleTop }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        suppressClick.current = false;
        drag.current = { kind: 'bubble', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          startTop: bubbleTop, startLeft: 0, panelHeight: 0, position: { left: 0, top: bubbleTop }, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const delta = event.clientY - current.startY;
        if (Math.abs(delta) > 4 || Math.abs(event.clientX - current.startX) > 4) current.moved = true;
        if (current.moved) setPreferredTop(clampAgentDirectoryBubbleTop(current.startTop + delta, viewport.height));
      }}
      onPointerUp={finishDrag}
      onPointerCancel={event => {
        finishDrag(event);
        suppressClick.current = true;
      }}
      onLostPointerCapture={settleDrag}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        if (open) close();
        else { setPreferredTop(cardTop); setOpen(true); }
      }}
      onKeyDown={event => {
        const next = event.key === 'ArrowUp' ? bubbleTop - 20
          : event.key === 'ArrowDown' ? bubbleTop + 20
            : event.key === 'Home' ? AGENT_DIRECTORY_MARGIN
              : event.key === 'End' ? viewport.height : null;
        if (next === null) return;
        event.preventDefault();
        setPreferredTop(clampAgentDirectoryBubbleTop(next, viewport.height));
      }}
    ><OutlineIcon name="history" selected={compact && open} /></Bubble>
    <Card
      ref={cardRef}
      id={cardId}
      data-visible={visible}
      aria-hidden={!visible}
      {...(visible ? {} : { inert: '' })}
      role={compact ? 'dialog' : undefined}
      aria-label="会话目录"
      aria-busy={loading}
      data-floating={compact}
      data-dragging={Boolean(panelDrag)}
      data-snapping={snapping}
      onTransitionEnd={event => {
        if (event.target === event.currentTarget && event.propertyName === 'transform') setSnapping(false);
      }}
      style={{
        top: cardTop,
        '--agent-directory-available-height': viewport.height > 0
          ? `${Math.max(0, viewport.height - cardTop - AGENT_DIRECTORY_MARGIN)}px`
          : 'calc(100% - 24px)',
        '--agent-directory-drag-x': `${panelDrag?.offsetX ?? 0}px`,
      } as React.CSSProperties}
    >
      <div className="peek-head"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return;
          const layer = layerRef.current;
          const card = cardRef.current;
          if (!layer || !card) return;
          const bounds = layer.getBoundingClientRect();
          const rect = card.getBoundingClientRect();
          const position = { left: rect.left - bounds.left, top: rect.top - bounds.top };
          drag.current = { kind: 'panel', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            startTop: position.top, startLeft: position.left, panelHeight: rect.height, position, moved: false };
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const current = drag.current;
          if (!current || current.kind !== 'panel' || current.pointerId !== event.pointerId) return;
          const dx = event.clientX - current.startX;
          const dy = event.clientY - current.startY;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) current.moved = true;
          if (!current.moved) return;
          current.position = clampAgentDirectoryPanelPosition(current.startLeft + dx, current.startTop + dy,
            viewport.width, viewport.height, current.panelHeight);
          setSnapping(false);
          setPanelDrag({ offsetX: current.position.left - (viewport.width - AGENT_DIRECTORY_WIDTH - AGENT_DIRECTORY_MARGIN), top: current.position.top });
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={settleDrag}
      >
        <span className="peek-drag-label" role="button" tabIndex={0} aria-label="移动会话目录" title="拖动会话目录"
          onKeyDown={event => {
            const top = event.key === 'ArrowUp' ? cardTop - 20 : event.key === 'ArrowDown' ? cardTop + 20
              : event.key === 'Home' ? AGENT_DIRECTORY_MARGIN : event.key === 'End' ? viewport.height : null;
            if (top === null) return;
            event.preventDefault();
            setPreferredTop(clampAgentDirectoryPanelPosition(0, top, viewport.width, viewport.height,
              cardRef.current?.getBoundingClientRect().height).top);
          }}>会话目录</span>
        <span className="peek-count">{total} 个会话</span>
        {onCreateGroup ? <button className="peek-inline" type="button" title="新建会话组" aria-label="新建会话组" onClick={onCreateGroup}><OutlineIcon name="folder-plus" /></button> : null}
        {compact ? <button className="peek-close" type="button" aria-label="收起会话目录" title="收起会话目录" onClick={close}><OutlineIcon name="forward" /></button> : null}
      </div>
      <div className="peek-list" role="region" tabIndex={0} aria-label="最近会话">
        {error ? <button className="peek-more" onClick={onRetry} type="button">{error} · 重试</button> : null}
        {directory ? sections.map(section => {
          const key = agentGroupPageKey(section.id);
          const page = pages[key];
          const visibleCount = visibleCounts[key] || SESSION_REVEAL_STEP;
          const entries = page?.sessions || [];
          const expanded = groupOpen(section.id);
          return <section className="peek-group" key={agentGroupPageKey(section.id)}>
            <div className="peek-group-head">
              <button className="peek-group-toggle" type="button" aria-expanded={expanded} onClick={() => toggleGroup(section.id)}>
                <OutlineIcon name={expanded ? 'folder-open' : 'folder'} /><span className="peek-group-name" title={section.name}>{section.name}</span><span className="peek-group-count">{section.count}</span>
              </button>
              <button className="peek-inline" type="button" disabled={busy} aria-label={`在${section.name}新建会话`} title="新建会话" onClick={() => onNewInGroup?.(section.id)}><OutlineIcon name="plus" /></button>
              {section.id ? <button className="peek-inline" type="button" aria-label={`${section.name}设置`} title="会话组设置" onClick={() => {
                const group = directory.groups.find(item => item.id === section.id); if (group) onEditGroup?.(group);
              }}><OutlineIcon name="settings" /></button> : null}
            </div>
            <div className="peek-group-body" data-open={expanded} aria-hidden={!expanded} {...(expanded ? {} : { inert: '' })}>
              <div className="peek-group-inner">
                {entries.slice(0, visibleCount).map(session => <div className="peek-row-reveal" key={session.id}>
                  <div className="peek-row-clip"><div className="peek-row" aria-current={session.id === activeSessionId || undefined}>
                  <button className="peek-open" type="button" disabled={busy} onClick={() => { close(); onOpen(session); }}><span className="peek-title" title={session.title}>{session.title}</span></button>
                  <button className="peek-inline peek-archive" type="button" title="归档" aria-label={`归档 ${session.title}`}
                    disabled={['running', 'preparing', 'awaiting_approval', 'awaiting_interaction'].includes(session.lastRunStatus || '') || (busy && session.id === activeSessionId)}
                    onClick={() => onArchive?.(session)}><OutlineIcon name="archive" /></button>
                  </div></div>
                </div>)}
                {!page || page.loading ? <span className="peek-meta">正在加载…</span> : null}
                {page?.error ? <button className="peek-more" type="button" onClick={() => onLoadGroup?.(section.id, Boolean(page.nextCursor))}>{page.error} · 重试</button> : null}
                {entries.length > visibleCount || page?.nextCursor ? <button className="peek-more" type="button" disabled={page?.loading}
                  onClick={() => {
                    const nextCount = Math.min(visibleCount, entries.length) + SESSION_REVEAL_STEP;
                    setVisibleCounts(current => ({ ...current, [key]: nextCount }));
                    if (nextCount > entries.length && page?.nextCursor) onLoadGroup?.(section.id, true);
                  }}>展开更多</button> : null}
              </div>
            </div>
          </section>;
        }) : sessions.length === 0 ? <div className="peek-meta peek-empty">{loading ? '正在加载…' : '暂无会话'}</div> : sessions.map(session => (
          <div className="peek-row" key={session.id} aria-current={session.id === activeSessionId || undefined}>
            <button className="peek-open" type="button" disabled={busy} onClick={() => { close(); onOpen(session); }}><span className="peek-title" title={session.title}>{session.title}</span></button>
          </div>
        ))}
      </div>
      <div className="peek-foot">
        <button className="peek-action" type="button" onClick={onManage}><OutlineIcon name="history" />会话管理</button>
        <button className="peek-action" type="button" disabled={busy} onClick={() => { close(); onNew(); }}><OutlineIcon name="plus" />新建会话</button>
        {onArchives ? <button className="peek-action" type="button" onClick={onArchives}><OutlineIcon name="archive" />归档</button> : null}
        <button className="peek-action peek-memory" type="button" disabled={busy} onClick={onMemories}
          aria-label="长期记忆" title="长期记忆"><OutlineIcon name="bookmark" /></button>
      </div>
    </Card>
  </Layer>;
}
