import React from 'react';
import { ImagePreview } from '@douyinfe/semi-ui';
import { Minus, Plus } from 'lucide-react';
import styled from 'styled-components';
import { getAppPopupContainer } from '@/utils/popup-container';
import type { AgentAttachment, AgentAttachmentScope } from '@/shared/agent/agent-attachments';
import { previewAgentAttachment } from '../services/agent.api';

const ZoomControls = styled.div`
  display: flex; align-items: center; gap: 12px; padding: 8px;
  border-radius: 999px; background: var(--app-bg-elevated); color: var(--app-text);
  button { width: 32px; height: 32px; padding: 0; display: grid; place-items: center;
    border: 0; border-radius: 50%; background: var(--app-hover-bg, var(--semi-color-fill-1)); color: inherit; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  button svg, button svg * { color: inherit; }
  span { min-width: 48px; text-align: center; color: inherit; font-size: 12px; font-variant-numeric: tabular-nums; }
`;

export default function AgentAttachmentPreview({ attachment, scope, sessionId, onClose }: {
  attachment: AgentAttachment;
  scope: AgentAttachmentScope;
  sessionId?: string;
  onClose: () => void;
}) {
  const [src, setSrc] = React.useState(attachment.thumbnail || '');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const { libraryId, ownerScope } = scope;
  React.useEffect(() => {
    let active = true;
    setSrc(attachment.thumbnail || ''); setError(''); setLoading(true);
    void previewAgentAttachment({ id: attachment.id, libraryId, ownerScope, sessionId }).then(url => {
      if (active) setSrc(url);
    }).catch(() => { if (active) setError('清晰图片暂不可用，仅显示缩略图'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attachment.id, attachment.thumbnail, libraryId, ownerScope, sessionId]);
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <ImagePreview visible src={src ? [src] : []} disableDownload closeOnEsc maskClosable
    previewStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
    getPopupContainer={getAppPopupContainer} onClose={onClose}
    onVisibleChange={visible => { if (!visible) onClose(); }}
    previewTitle={error || (loading ? '正在读取清晰图片…' : attachment.name)}
    renderPreviewMenu={({ zoom = 100, min, max, onZoomIn, onZoomOut }) => <ZoomControls>
      <button type="button" aria-label="缩小图片" title="缩小" disabled={zoom === min} onClick={onZoomOut}><Minus size={16} strokeWidth={1.25} /></button>
      <span>{Math.round(zoom)}%</span>
      <button type="button" aria-label="放大图片" title="放大" disabled={zoom === max} onClick={onZoomIn}><Plus size={16} strokeWidth={1.25} /></button>
    </ZoomControls>} />;
}
