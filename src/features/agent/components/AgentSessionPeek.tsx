import { IconHistory, IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { Popover } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import type { AgentSessionSummary } from '@/shared/agent/agent.types';
import { getAppPopupContainer } from '@/utils/popup-container';

const Card = styled.div`
  width: min(320px, calc(100vw - 32px)); padding: 8px; border: 1px solid var(--app-border-strong);
  border-radius: 8px; background: var(--app-bg-elevated); box-shadow: var(--app-shadow);
  .peek-head { display:flex; align-items:center; gap:7px; padding:5px 7px 8px; color:var(--app-text); font-size:12px; font-weight:600; }
  .peek-count { margin-left:auto; color:var(--app-text-muted); font-size:11px; font-weight:400; }
  .peek-list { max-height:260px; overflow:auto; display:flex; flex-direction:column; gap:2px; }
  .peek-row { width:100%; min-height:38px; padding:6px 8px; border:0; border-radius:5px; background:transparent; color:var(--app-text); text-align:left; cursor:pointer; }
  .peek-row:hover, .peek-row[aria-current='true'] { background:var(--semi-color-fill-1); }
  .peek-row[aria-current='true'] { color:var(--app-accent); }
  .peek-title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  .peek-meta { display:block; margin-top:2px; color:var(--app-text-muted); font-size:10px; }
  .peek-foot { display:flex; gap:6px; padding-top:7px; margin-top:6px; border-top:1px solid var(--app-border); }
  .peek-action { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 7px; border:0; border-radius:5px; background:transparent; color:var(--app-text-muted); font-size:11px; cursor:pointer; }
  .peek-action:hover { background:var(--semi-color-fill-1); color:var(--app-text); }
`;

export default function AgentSessionPeek({ sessions, total, activeSessionId, loading, onOpen, onManage, onNew }: {
  sessions: AgentSessionSummary[]; total: number; activeSessionId: string | null; loading: boolean;
  onOpen: (session: AgentSessionSummary) => void; onManage: () => void; onNew: () => void;
}) {
  return <Popover trigger="click" position="bottomRight" showArrow={false} motion={false}
    getPopupContainer={getAppPopupContainer} content={<Card role="dialog" aria-label="最近会话">
      <div className="peek-head"><IconHistory aria-hidden="true" /> 会话目录 <span className="peek-count">{total} 个会话</span></div>
      <div className="peek-list">
        {loading ? <div className="peek-meta">正在加载…</div> : sessions.slice(0, 8).map(session => (
          <button className="peek-row" key={session.id} type="button" aria-current={session.id === activeSessionId || undefined} onClick={() => onOpen(session)}>
            <span className="peek-title">{session.title}</span><span className="peek-meta">{session.messageCount} 条消息 · {new Date(session.updatedAt).toLocaleString()}</span>
          </button>
        ))}
      </div>
      <div className="peek-foot"><button className="peek-action" type="button" onClick={onManage}><IconSearch /> 全部会话</button><button className="peek-action" type="button" onClick={onNew}><IconPlus /> 新建</button></div>
    </Card>}>
    <button aria-label="会话目录" className="toolbar-action-btn" title="会话目录" type="button"><IconHistory /></button>
  </Popover>;
}
