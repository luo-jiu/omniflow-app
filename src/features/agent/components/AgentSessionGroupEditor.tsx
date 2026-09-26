import React from 'react';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import styled from 'styled-components';
import { CompactModal } from '@/components/ui/compact-modal';
import OutlineIcon from '@/components/ui/outline-icon';
import { LibraryNodePickerModal } from '@/features/file-explorer';
import type { AgentSessionGroup, AgentSessionGroupInput } from '@/shared/agent/agent-session-management';

const Fields = styled.div`
  display:flex; flex-direction:column; gap:14px; font-size:13px; color:var(--app-text);
  label { display:flex; flex-direction:column; gap:6px; }
  input, select { height:30px; width:100%; padding:0 8px; border:1px solid var(--app-border); border-radius:5px; background:var(--app-bg); color:var(--app-text); font-size:13px; }
  .group-roots { display:flex; flex-direction:column; gap:5px; }
  .group-root { display:flex; align-items:center; gap:8px; min-height:30px; }
  .group-root span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:28px; padding:0 6px; border:0; border-radius:5px; background:transparent; color:var(--app-text-secondary); cursor:pointer; }
  button:hover { background:var(--app-hover-bg); }
  .group-add { align-self:flex-start; }
  .group-note { color:var(--app-text-muted); font-size:12px; }
  [role='alert'] { color:var(--semi-color-danger); }
`;

export default function AgentSessionGroupEditor({ group, libraryId, onSave, onDelete, onCancel }: {
  group?: AgentSessionGroup; libraryId: number;
  onSave: (input: AgentSessionGroupInput) => Promise<void>;
  onDelete?: () => void; onCancel: () => void;
}) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [name, setName] = React.useState(group?.name || '');
  const [directories, setDirectories] = React.useState(group?.directories || []);
  const [access, setAccess] = React.useState<'read' | 'read-write'>(group?.access || 'read-write');
  const [picking, setPicking] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [visible, setVisible] = React.useState(false);
  // Open after StrictMode's mount replay so Semi can retain its portal.
  React.useEffect(() => { setVisible(true); }, []);
  return <>
    <CompactModal visible={workspaceActive && visible} title={group ? '会话组设置' : '新建会话组'} width={420} onCancel={onCancel}
      okText="保存" confirmLoading={saving} okButtonProps={{ disabled: !name.trim() || saving }} onOk={async () => {
        setSaving(true); setError('');
        try { await onSave({ ...(group ? { id: group.id, revision: group.revision } : {}), name, directories, access }); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
        finally { setSaving(false); }
      }}>
      <Fields>
        <label>组名<input autoFocus maxLength={48} value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
        <label>目录权限<select value={access} disabled={saving} onChange={event => setAccess(event.target.value as 'read' | 'read-write')}>
          <option value="read-write">读取和编辑</option><option value="read">只读</option>
        </select></label>
        <div className="group-roots">
          <span>自动授权目录</span>
          {directories.map(directory => <div className="group-root" key={directory.nodeId}>
            <OutlineIcon name="folder" /><span title={directory.name}>{directory.name}</span>
            <button type="button" title="移除目录授权" aria-label={`移除 ${directory.name}`} disabled={saving}
              onClick={() => setDirectories(current => current.filter(item => item.nodeId !== directory.nodeId))}><OutlineIcon name="trash" /></button>
          </div>)}
          <button className="group-add" type="button" disabled={saving || directories.length >= 32} onClick={() => setPicking(true)}><OutlineIcon name="plus" />添加目录</button>
          <span className="group-note">包含子目录；范围外访问需要确认。{directories.length === 0 ? '未设置目录时不会自动授权。' : ''}</span>
        </div>
        {error ? <div role="alert">{error}</div> : null}
        {group && onDelete ? <button className="group-add" type="button" disabled={saving} onClick={onDelete}><OutlineIcon name="trash" />删除会话组</button> : null}
      </Fields>
    </CompactModal>
    <LibraryNodePickerModal visible={workspaceActive && picking} displayMode="folders" libraryId={libraryId} title="选择自动授权目录" confirmText="添加目录"
      onCancel={() => setPicking(false)} onConfirm={({ node, pathLabel }) => {
        setDirectories(current => current.some(item => item.nodeId === node.id) ? current : [...current, { nodeId: node.id, name: pathLabel || node.name }]);
        setPicking(false);
      }} />
  </>;
}
