import React from 'react';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import styled from 'styled-components';
import { CompactModal } from '@/components/ui/compact-modal';
import { buttonStyles, inputStyles } from '@/components/ui/theme-foundation-styles';
import OutlineIcon from '@/components/ui/outline-icon';
import type { AgentSessionGroup, AgentSessionGroupInput } from '@/shared/agent/agent-session-management';

const Fields = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--app-text);

  label { display: flex; flex-direction: column; gap: 6px; }
  input { ${inputStyles} height: 30px; width: 100%; border-radius: 5px; }
  button {
    ${buttonStyles('quiet')}
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    cursor: pointer;
  }
  .group-delete { align-self: flex-start; }
  [role='alert'] { color: var(--app-danger-text); }
`;

export default function AgentSessionGroupEditor({ group, onSave, onDelete, onCancel }: {
  group?: AgentSessionGroup;
  onSave: (input: AgentSessionGroupInput) => Promise<void>;
  onDelete?: () => void; onCancel: () => void;
}) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [name, setName] = React.useState(group?.name || '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [visible, setVisible] = React.useState(false);
  // Open after StrictMode's mount replay so Semi can retain its portal.
  React.useEffect(() => { setVisible(true); }, []);
  return <CompactModal visible={workspaceActive && visible} title={group ? '会话组设置' : '新建会话组'} width={420} onCancel={onCancel}
    okText="保存" confirmLoading={saving} okButtonProps={{ disabled: !name.trim() || saving }} onOk={async () => {
      setSaving(true); setError('');
      try {
        await onSave({
          ...(group ? { id: group.id, revision: group.revision } : {}),
          name, directories: group?.directories || [], access: group?.access || 'read',
        });
      }
      catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
      finally { setSaving(false); }
    }}>
    <Fields>
      <label>组名<input autoFocus maxLength={48} value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
      {error ? <div role="alert">{error}</div> : null}
      {group && onDelete ? <button className="group-delete" type="button" disabled={saving} onClick={onDelete}><OutlineIcon name="trash" />删除会话组</button> : null}
    </Fields>
  </CompactModal>;
}
