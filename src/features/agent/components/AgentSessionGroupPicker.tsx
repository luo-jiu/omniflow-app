import React from 'react';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { CompactModal } from '@/components/ui/compact-modal';
import type { AgentSessionGroup } from '@/shared/agent/agent-session-management';

export default function AgentSessionGroupPicker({ title, groups, initialGroupId, onChoose, onCancel }: {
  title: string; groups: AgentSessionGroup[]; initialGroupId: string | null;
  onChoose: (id: string | null) => Promise<void> | void; onCancel: () => void;
}) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [groupId, setGroupId] = React.useState(initialGroupId || '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [visible, setVisible] = React.useState(false);
  // Open after StrictMode's mount replay so Semi can retain its portal.
  React.useEffect(() => { setVisible(true); }, []);
  return <CompactModal visible={workspaceActive && visible} title={title} width={360} onCancel={onCancel} confirmLoading={busy} okText="确定" onOk={async () => {
    setBusy(true); setError('');
    try { await onChoose(groupId || null); } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { setBusy(false); }
  }}>
    <label style={{ display: 'grid', gap: 8, fontSize: 13 }}>所属会话组
      <select aria-label="所属会话组" value={groupId} disabled={busy} onChange={event => setGroupId(event.target.value)}
        style={{ width: '100%', height: 32, padding: '0 8px', border: '1px solid var(--app-border)', borderRadius: 5, background: 'var(--app-bg)', color: 'var(--app-text)', fontSize: 13 }}>
        <option value="">未分组</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
    </label>
    {error ? <div role="alert" style={{ color: 'var(--semi-color-danger)', marginTop: 8 }}>{error}</div> : null}
  </CompactModal>;
}
