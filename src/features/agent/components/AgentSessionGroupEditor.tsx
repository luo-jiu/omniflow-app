import React from 'react';
import { Tooltip } from '@douyinfe/semi-ui';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import styled from 'styled-components';
import { CompactModal } from '@/components/ui/compact-modal';
import { buttonStyles, inputStyles } from '@/components/ui/theme-foundation-styles';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import OutlineIcon from '@/components/ui/outline-icon';
import { LibraryNodePickerModal } from '@/features/file-explorer';
import type { AgentSessionGroup, AgentSessionGroupInput } from '@/shared/agent/agent-session-management';

const HELP_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--app-bg-popover)',
  border: '1px solid var(--app-border-strong)',
  boxShadow: 'var(--app-shadow)',
  color: 'var(--app-text)',
  maxWidth: 280,
  padding: '8px 10px',
  fontSize: 12,
  lineHeight: 1.6,
};

const Fields = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--app-text);

  label { display: flex; flex-direction: column; gap: 6px; }
  .group-access { display: flex; flex-direction: column; gap: 6px; }
  input, select { ${inputStyles} height: 30px; width: 100%; border-radius: 5px; }
  .group-roots { display: flex; flex-direction: column; gap: 8px; }
  .group-field-heading { display: flex; align-items: center; gap: 4px; }
  .group-root-list {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 192px;
    overflow-y: auto;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    ${workspaceScrollbarStyles}
  }
  .group-root { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 4px 10px; box-sizing: border-box; }
  .group-root + .group-root { border-top: 1px solid var(--app-border); }
  .group-root-path { min-width: 0; flex: 1; text-align: left; overflow-wrap: anywhere; }
  .group-empty { padding: 12px; border: 1px dashed var(--app-border); border-radius: 6px; }
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
  .group-remove { flex: none; width: 28px; padding: 0; }
  .group-help { flex: none; width: 24px; min-height: 24px; padding: 0; border-radius: 50%; }
  .group-add { align-self: flex-start; }
  [role='alert'] { color: var(--app-danger-text); }
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
  const accessId = React.useId();
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
        <div className="group-roots">
          <div className="group-field-heading">
            <span>资料库访问范围</span>
            <Tooltip position="topLeft" showArrow={false} closeOnEsc motion={false} style={HELP_TOOLTIP_STYLE}
              trigger={workspaceActive && !picking ? 'hover' : 'custom'} visible={workspaceActive && !picking ? undefined : false}
              content="可添加多个目录，包含子目录。「组内自动」按所选权限访问，范围外仍询问。不选目录时不会自动授权；/ 表示整个资料库。">
              <button className="group-help" type="button" aria-label="资料库访问范围说明"><OutlineIcon name="help" /></button>
            </Tooltip>
          </div>
          {directories.length ? <ul className="group-root-list" aria-label="已选资料库目录">
            {directories.map(directory => <li className="group-root" key={directory.nodeId}>
              <OutlineIcon name="folder" />
              <span className="group-root-path" title={directory.name}>{directory.name}</span>
              <button className="group-remove" type="button" title="移除访问范围" aria-label={`移除 ${directory.name}`} disabled={saving}
                onClick={() => setDirectories(current => current.filter(item => item.nodeId !== directory.nodeId))}><OutlineIcon name="trash" /></button>
            </li>)}
          </ul> : <div className="group-empty">尚未选择目录</div>}
          <button className="group-add" type="button" disabled={saving || directories.length >= 32} onClick={() => setPicking(true)}>
            <OutlineIcon name="plus" />{directories.length >= 32 ? '已达 32 个目录上限' : directories.length ? '添加目录' : '选择目录'}
          </button>
        </div>
        <div className="group-access">
          <div className="group-field-heading">
            <label htmlFor={accessId}>目录内自动允许</label>
            <Tooltip position="topLeft" showArrow={false} closeOnEsc motion={false} style={HELP_TOOLTIP_STYLE}
              trigger={workspaceActive && !picking ? 'hover' : 'custom'} visible={workspaceActive && !picking ? undefined : false}
              content={access === 'read' ? '仅自动允许读取，编辑前仍会询问。部分操作仍需单独确认。' : '自动允许读取和编辑所选目录中的内容。部分操作仍需单独确认。'}>
              <button className="group-help" type="button" aria-label="目录内自动允许说明"><OutlineIcon name="help" /></button>
            </Tooltip>
          </div>
          <select id={accessId} value={access} disabled={saving} onChange={event => setAccess(event.target.value as 'read' | 'read-write')}>
            <option value="read-write">读取和编辑</option><option value="read">仅读取</option>
          </select>
        </div>
        {error ? <div role="alert">{error}</div> : null}
        {group && onDelete ? <button className="group-add" type="button" disabled={saving} onClick={onDelete}><OutlineIcon name="trash" />删除会话组</button> : null}
      </Fields>
    </CompactModal>
    <LibraryNodePickerModal visible={workspaceActive && picking} displayMode="folders" libraryId={libraryId} title="选择资料库访问目录" confirmText="添加目录"
      onCancel={() => setPicking(false)} onConfirm={({ node, pathLabel }) => {
        setDirectories(current => current.some(item => item.nodeId === node.id) ? current : [...current, { nodeId: node.id, name: pathLabel || node.name }]);
        setPicking(false);
      }} />
  </>;
}
