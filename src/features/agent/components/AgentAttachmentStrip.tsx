import React from 'react';
import { FileText, LoaderCircle, X } from 'lucide-react';
import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import type { AgentAttachment, AgentAttachmentScope } from '@/shared/agent/agent-attachments';
import AgentAttachmentPreview from './AgentAttachmentPreview';
import type { AgentAttachmentDraft } from '../hooks/useAgentAttachments';

const Strip = styled.div<{ $composer: boolean }>`
  ${workspaceScrollbarStyles}
  display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 10px;
  padding: ${({ $composer }) => $composer ? '10px 10px 0' : '8px 0'};
  min-width: 0; max-width: 100%; overflow-x: auto; overflow-y: hidden;
  .attachment { position: relative; width: 164px; flex: 0 0 164px; min-width: 0; }
  .attachment[data-kind='image'] { width: 82px; flex-basis: 82px; }
  .attachment-visual { width: 100%; height: 72px; border: 1px solid var(--app-border);
    border-radius: 8px; display: flex; align-items: center; gap: 8px;
    padding: 10px; overflow: hidden; background: var(--app-bg-elevated); color: var(--app-text-secondary); }
  .attachment[data-removable='true'][data-kind='file'] .attachment-visual { padding-right: 30px; }
  .attachment[data-kind='image'] .attachment-visual { padding: 0; justify-content: center; }
  .attachment-visual > svg { flex: none; color: var(--app-text-secondary); }
  .attachment-visual > svg * { color: inherit; }
  img { width: 100%; height: 100%; object-fit: contain; }
  .attachment-name { display: block; min-width: 0; flex: 1; font-size: 12px; line-height: 18px;
    color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-remove { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0; border-radius: 50%;
    border: 1px solid var(--app-border); background: var(--app-bg-elevated); color: var(--app-text);
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .attachment-remove svg { display: block; width: 10px; height: 10px; flex: none; }
  .attachment-remove svg, .attachment-remove svg * { color: inherit; }
  .attachment-preview-trigger { cursor: zoom-in; }
  .attachment-preview-trigger:focus-visible { outline: 2px solid var(--app-accent); outline-offset: -2px; }
  .attachment-error { color: var(--app-danger, #c64848); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
`;

export function AgentAttachmentStrip({ entries, onRemove, scope, sessionId }: {
  entries: AgentAttachmentDraft[]; onRemove?: (key: string) => void;
  scope?: AgentAttachmentScope | null; sessionId?: string;
}) {
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  const preview = entries.find(entry => entry.key === previewKey)?.attachment;
  if (!entries.length) return null;
  return <><Strip $composer={Boolean(onRemove)} aria-label="消息附件" tabIndex={0}>{entries.map((entry, index) => {
    const isImage = entry.attachment ? entry.attachment.kind === 'image' : entry.previewKind === 'image';
    const canPreview = Boolean(isImage && entry.attachment && scope && !entry.error);
    const Visual = canPreview ? 'button' : 'div';
    return <div className="attachment" data-kind={isImage ? 'image' : 'file'} data-removable={Boolean(onRemove)} key={entry.key} title={entry.name}>
      <Visual className={`attachment-visual${canPreview ? ' attachment-preview-trigger' : ''}`}
        type={canPreview ? 'button' : undefined}
        aria-label={canPreview ? `预览 ${entry.name}` : undefined}
        onClick={canPreview ? () => setPreviewKey(entry.key) : undefined}
      >{isImage && entry.attachment?.thumbnail
        ? <img src={entry.attachment.thumbnail} alt={`图片 ${index + 1}：${entry.name}`} />
        : entry.attachment || entry.error ? <FileText size={20} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" />
          : <LoaderCircle size={20} strokeWidth={1.25} absoluteStrokeWidth aria-label="正在准备附件" />}
        {!isImage && <span className="attachment-name">{entry.name}</span>}
      </Visual>
      {onRemove && <button className="attachment-remove" type="button" aria-label={`移除 ${entry.name}`} title="移除附件" onClick={() => onRemove(entry.key)}><X size={10} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" /></button>}
      {entry.error && <span role="alert" className="attachment-error">{entry.error}</span>}
    </div>;
  })}</Strip>{preview && scope ? <AgentAttachmentPreview key={`${preview.id}:${sessionId || ''}:${scope.libraryId}:${scope.ownerScope.accountScope}:${scope.ownerScope.backendScope}`}
    attachment={preview} scope={scope} sessionId={sessionId} onClose={() => setPreviewKey(null)} /> : null}</>;
}

export function AgentMessageAttachments({ attachments, scope, sessionId }: { attachments?: AgentAttachment[]; scope?: AgentAttachmentScope | null; sessionId?: string }) {
  return <AgentAttachmentStrip scope={scope} sessionId={sessionId} entries={(attachments || []).map(attachment => ({ key: attachment.id, name: attachment.name, size: attachment.sizeBytes, attachment }))} />;
}
