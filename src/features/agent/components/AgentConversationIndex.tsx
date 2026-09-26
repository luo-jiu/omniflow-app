import React from 'react';
import OutlineIcon from '@/components/ui/outline-icon';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import styled from 'styled-components';
import type { AgentMessage, AgentRunSnapshot } from '@/shared/agent/agent.types';
import { buildConversationIndex, indexMilestone, parseIndexMarks, resolveIndexPreviewTop } from '../agent-conversation-index';
import { INDEX_BASE_WIDTH, INDEX_PEAK_WIDTH, INDEX_TICK_HEIGHT as TICK_HEIGHT, indexWaveColors, indexWaveStrength } from '../agent-index-wave';
import { useAgentIndexWave } from '../hooks/useAgentIndexWave';

const INDEX_THRESHOLD = 5;

const Dial = styled.aside`
  position: absolute;
  z-index: 3;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: var(--dial-height);
  max-height: calc(100% - 100px);
  --dial-muted: #a0a0a0;
  --dial-green: #9fcab4;
  --dial-yellow: #dbbb77;
  --dial-red: #df8585;
  --dial-violet: var(--workspace-nav-accent, #bd9af2);
  --dial-rose-light: #e8a7bc;
  body[theme-mode='light'] & {
    --dial-muted: #707070;
    --dial-green: #2f865d; --dial-yellow: #9b6b00; --dial-red: #bd3f3f;
    --dial-violet: var(--workspace-nav-accent, #7040a8); --dial-rose-light: #a94f70;
  }
  .dial-scroll {
    height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
    ${workspaceScrollbarStyles}
  }
  .dial-tick {
    position: relative; width: 100%; height: ${TICK_HEIGHT}px;
    padding: 0 0 0 14px; border: 0; display: flex;
    align-items: center; justify-content: flex-start; background: transparent; cursor: pointer;
    color: var(--tick-color, var(--app-text-muted));
  }
  .dial-tick[data-marked='true']::before { content: ''; position: absolute; left: 6px; width: 3px; height: 3px; background: var(--dial-violet); border-radius: 1px; }
  .dial-stroke {
    display: block; height: 2px; width: var(--tick-width);
    background: var(--tick-color, var(--app-text-muted));
    opacity: var(--tick-opacity, 0.72);
    transition: width 100ms linear, opacity 100ms linear, background-color 100ms linear;
  }
  .dial-tick[aria-current='true'] .dial-stroke, .dial-tick:focus-visible .dial-stroke,
  .dial-tick[data-hovered='true'] .dial-stroke { opacity: 1; }
  .dial-tick:focus-visible { outline: 1px solid var(--semi-color-primary); outline-offset: -1px; }
  .dial-preview {
    ${workspaceScrollbarStyles}
    position: absolute; left: 44px; top: var(--preview-top); width: min(310px, calc(100vw - 96px));
    padding: 12px; border: 1px solid var(--app-border); border-radius: 8px;
    background: var(--app-bg-elevated); color: var(--app-text); box-shadow: var(--app-shadow);
    font-size: 12px; line-height: 1.5; animation: dial-preview-in 150ms ease-out;
    transition: top 100ms ease-out;
    max-height: var(--preview-max-height, calc(100vh - 32px)); overflow-y: auto;
  }
  @keyframes dial-preview-in { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: translateX(0); } }
  .dial-preview-title, .dial-preview-summary { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .dial-preview-title { -webkit-line-clamp: 2; font-weight: 600; }
  .dial-preview-summary { -webkit-line-clamp: 3; color: var(--app-text-muted); margin-top: 6px; white-space: pre-wrap; }
  .dial-preview-footer { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .dial-preview-footer > span { color: var(--app-text-muted); font-variant-numeric: tabular-nums; }
  .dial-preview-footer button { margin-left: auto; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--app-radius-medium); background: transparent; color: var(--app-text-secondary); cursor: pointer; }
  .dial-preview-footer button:hover { color: var(--app-text); }
  .dial-preview-footer button[aria-pressed='true'] { color: var(--dial-violet); }
  .dial-preview-footer button .app-outline-icon { color: inherit; }
  @media (prefers-reduced-motion: reduce) {
    .dial-stroke { transition: none; }
    .dial-preview { animation: none; transition: none; }
  }
`;

export default function AgentConversationIndex({ messages, runs, scrollRef, storageKey, onNavigate }: {
  messages: AgentMessage[];
  runs: AgentRunSnapshot[];
  scrollRef: React.RefObject<HTMLDivElement>;
  storageKey: string;
  onNavigate: () => void;
}) {
  const entries = React.useMemo(() => buildConversationIndex(messages, runs), [messages, runs]);
  const showIndex = entries.length >= INDEX_THRESHOLD;
  const idsKey = JSON.stringify(entries.map(entry => entry.id));
  const [current, setCurrent] = React.useState(0);
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [railScroll, setRailScroll] = React.useState(0);
  const [marks, setMarks] = React.useState<Record<string, string>>(() => {
    try { return parseIndexMarks(localStorage.getItem(storageKey)); } catch { return {}; }
  });
  const railRef = React.useRef<HTMLDivElement>(null);
  const dialRef = React.useRef<HTMLElement>(null);
  const previewRef = React.useRef<HTMLDivElement>(null);
  const [previewBounds, setPreviewBounds] = React.useState({ min: -10000, max: 10000, height: 10000 });
  const previewVisible = hovered !== null;
  React.useLayoutEffect(() => {
    const dial = dialRef.current;
    const preview = previewRef.current;
    const workspace = dial?.parentElement;
    if (!dial || !preview || !workspace) return;
    const measure = () => {
      const dialRect = dial.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      const height = Math.max(0, workspaceRect.height - 16);
      const min = workspaceRect.top + 8 - dialRect.top;
      const max = workspaceRect.bottom - 8 - dialRect.top - preview.getBoundingClientRect().height;
      setPreviewBounds(old => old.min === min && old.max === max && old.height === height ? old : { min, max, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dial); observer.observe(preview); observer.observe(workspace);
    return () => observer.disconnect();
  }, [previewVisible, showIndex]);
  const pointerYRef = React.useRef<number | null>(null);
  const anchorsRef = React.useRef<HTMLElement[]>([]);
  React.useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !showIndex) return;
    anchorsRef.current = Array.from(scroll.querySelectorAll<HTMLElement>('[data-agent-question]'));
    let frame = 0;
    const update = () => {
      frame = 0;
      if (anchorsRef.current[0]?.isConnected === false) {
        anchorsRef.current = Array.from(scroll.querySelectorAll<HTMLElement>('[data-agent-question]'));
      }
      const anchors = anchorsRef.current;
      if (anchors.length && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 2) {
        setCurrent(anchors.length - 1);
        return;
      }
      const top = scroll.getBoundingClientRect().top + 64;
      let low = 0; let high = anchors.length;
      // Binary search avoids scanning the transcript on every scroll event.
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (anchors[mid].getBoundingClientRect().top <= top) low = mid + 1;
        else high = mid;
      }
      setCurrent(Math.max(0, low - 1));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule();
    scroll.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    return () => { scroll.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [idsKey, scrollRef, showIndex]);

  React.useEffect(() => {
    if (hovered !== null) return;
    const rail = railRef.current;
    if (!rail) return;
    const y = current * TICK_HEIGHT;
    if (y < rail.scrollTop || y + TICK_HEIGHT > rail.scrollTop + rail.clientHeight) rail.scrollTop = Math.max(0, y - rail.clientHeight / 2);
  }, [current, hovered, idsKey]);

  const saveMark = (id: string, label: string | null) => {
    setMarks(previous => {
      const next = { ...previous };
      if (label === null) delete next[id]; else next[id] = label.slice(0, 32);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep local marks usable if storage is unavailable. */ }
      return next;
    });
  };
  const navigate = (index: number) => {
    const scroll = scrollRef.current;
    const entry = entries[index];
    if (!scroll || !entry) return;
    // A transcript refresh can replace elements without changing message IDs.
    anchorsRef.current = Array.from(scroll.querySelectorAll<HTMLElement>('[data-agent-question]'));
    const anchor = anchorsRef.current.find(element => element.dataset.agentQuestion === entry.id);
    if (!anchor) return;
    onNavigate();
    setCurrent(index);
    scroll.scrollTo({ top: scroll.scrollTop + anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  let activeIndex = -1;
  entries.forEach((entry, index) => { if (entry.active) activeIndex = index; });
  const waveCenter = useAgentIndexWave(entries.length >= 10 ? activeIndex : -1);
  const baseColors = entries.map((entry, index) => {
    if (entry.tone === 'error') return 'var(--dial-red)';
    if (entry.tone === 'paused') return 'var(--dial-yellow)';
    if (current === index) return 'var(--dial-green)';
    if (entry.tone === 'waiting') return 'var(--dial-yellow)';
    if (entry.active) return 'var(--dial-green)';
    const milestone = indexMilestone(entry.ordinal);
    if (milestone === 'major') return 'var(--dial-violet)';
    if (milestone === 'minor') return 'var(--dial-rose-light)';
    if (Object.prototype.hasOwnProperty.call(marks, entry.id)) return 'var(--dial-violet)';
    return null;
  });
  const colors = indexWaveColors(baseColors, waveCenter);
  const preview = hovered === null ? undefined : entries[hovered];
  const marked = preview ? Object.prototype.hasOwnProperty.call(marks, preview.id) : false;
  if (!showIndex) return null;
  return <Dial ref={dialRef} aria-label="聊天索引" style={{ '--dial-height': `${Math.min(70, entries.length) * TICK_HEIGHT}px`,
    '--preview-max-height': `${previewBounds.height}px`,
    '--preview-top': `${resolveIndexPreviewTop((hovered || 0) * TICK_HEIGHT + TICK_HEIGHT / 2 - railScroll, previewBounds)}px` } as React.CSSProperties}
    onMouseLeave={() => setHovered(null)} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(null);
    }} onKeyDown={event => { if (event.key === 'Escape') setHovered(null); }}>
    <div className="dial-scroll" ref={railRef} onScroll={event => {
      setRailScroll(event.currentTarget.scrollTop);
      if (pointerYRef.current !== null) setHovered(Math.max(0, Math.min(entries.length - 1,
        Math.floor((pointerYRef.current + event.currentTarget.scrollTop) / TICK_HEIGHT))));
    }} onPointerLeave={() => { pointerYRef.current = null; }}
      onWheel={event => event.stopPropagation()} onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointerYRef.current = event.clientY - rect.top;
        setHovered(Math.max(0, Math.min(entries.length - 1, Math.floor((event.clientY - rect.top + event.currentTarget.scrollTop) / TICK_HEIGHT))));
      }}>
      {entries.map((entry, index) => {
        const waveStrength = indexWaveStrength(index, waveCenter);
        const strength = Math.max(indexWaveStrength(index, hovered), waveStrength);
        return <button key={entry.id} className="dial-tick" type="button" aria-label={`第 ${entry.ordinal} 轮：${marks[entry.id] || entry.title}`}
          tabIndex={current === index ? 0 : -1}
          aria-current={current === index ? 'true' : undefined} data-active={entry.active} data-tone={entry.tone}
          data-milestone={indexMilestone(entry.ordinal)} data-marked={Object.prototype.hasOwnProperty.call(marks, entry.id)}
          data-hovered={hovered === index} data-wave={waveStrength > 0}
          style={{ '--tick-width': `${INDEX_BASE_WIDTH + strength * (INDEX_PEAK_WIDTH - INDEX_BASE_WIDTH)}px`,
            '--tick-color': colors[index], '--tick-opacity': baseColors[index] ? 1 : 0.72 + strength * 0.28 } as React.CSSProperties}
          onClick={() => navigate(index)} onFocus={() => setHovered(index)} onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const next = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
            (next as HTMLElement | null)?.focus();
          }}><span className="dial-stroke" /></button>;
      })}
    </div>
    {preview ? <div className="dial-preview" ref={previewRef}>
      <div className="dial-preview-title">{preview.title}</div>
      {preview.summary ? <div className="dial-preview-summary">{preview.summary}</div> : null}
      <div className="dial-preview-footer"><span>#{preview.ordinal} · {preview.tone === 'error' ? '已中断 / 失败' : preview.tone === 'waiting' ? '重连 / 等待' : preview.active ? '进行中' : '对话'}</span>
        <button type="button" aria-label={marked ? '取消标记' : '标记此轮对话'} title={marked ? '取消标记' : '标记此轮对话'} aria-pressed={marked}
          onClick={() => saveMark(preview.id, marked ? null : '')}><OutlineIcon name="bookmark" /></button>
      </div>
    </div> : null}
  </Dial>;
}
