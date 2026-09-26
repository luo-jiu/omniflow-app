import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { CompactModal } from '@/components/ui/compact-modal';
import { ThemeButton } from '@/components/ui/theme-foundation';
import { inputAppearanceStyles } from '@/components/ui/theme-foundation-styles';

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 12px;
  color: var(--app-text);
  label { display: flex; flex-direction: column; gap: 6px; }
  select { ${inputAppearanceStyles} width: 100%; min-height: 30px; padding: 4px 8px; border-style: solid; border-width: 1px; border-radius: 6px; }
  p { margin: 0; line-height: 1.6; color: var(--app-text-secondary); }
  .viewer-options-warning { color: var(--app-warning-text); }
  .viewer-options-error { color: var(--app-danger-text); }
  .viewer-options-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
`;

export default function ViewerOptionsDialog({ visible, currentId, candidates, unavailable, failed, error, onChoose, onRetry, onClose }: {
  visible: boolean;
  currentId: string;
  candidates: readonly { id: string; title: string }[];
  unavailable: boolean;
  failed: boolean;
  error: string;
  onChoose: (id: string, remember: boolean) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [draftId, setDraftId] = useState(currentId);
  useEffect(() => { if (visible) setDraftId(currentId); }, [visible, currentId]);
  const valid = candidates.some(candidate => candidate.id === draftId);
  return (
    <CompactModal title="查看器设置" visible={visible}
      width="min(380px, calc(100vw - 32px))" footer={null} onCancel={onClose} maskClosable>
      <Body>
        {unavailable && <p role="status" className="viewer-options-warning">所选查看器不可用，已回退到内置查看器；原选择与恢复状态保留。</p>}
        <label>打开方式
          <select aria-label="查看器打开方式" value={draftId} onChange={event => setDraftId(event.target.value)}>
            {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
          </select>
        </label>
        <p>设为默认后，本机当前账号在此资料库打开同类漫画目录时会使用该查看器。</p>
        {error && <p role="alert" className="viewer-options-error">{error}</p>}
        <div className="viewer-options-actions">
          {failed && <ThemeButton onClick={onRetry}>重试查看器</ThemeButton>}
          <ThemeButton disabled={!valid} onClick={() => onChoose(draftId, true)}>设为此类文件默认</ThemeButton>
          <ThemeButton $variant="primary" disabled={!valid} onClick={() => onChoose(draftId, false)}>应用</ThemeButton>
        </div>
      </Body>
    </CompactModal>
  );
}
