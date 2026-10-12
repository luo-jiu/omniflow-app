import React from 'react';
import styled from 'styled-components';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import type { AgentOwnerScope } from '@/shared/agent/agent.types';
import { AGENT_ATTACHMENT_MAX_BYTES } from '@/shared/agent/agent-attachments';
import { previewAgentAttachment } from '../services/agent.api';
import AgentAttachmentPreview from './AgentAttachmentPreview';

const ObservationPreview = styled.div`
  min-width: 0;
  button {
    display: block;
    max-width: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--app-radius-small);
    background: transparent;
    cursor: zoom-in;
  }
  button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
  img {
    display: block;
    max-width: min(280px, 100%);
    max-height: 136px;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: var(--app-radius-small);
  }
  p {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 18px;
  }
`;

const IMAGE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;

interface AgentToolObservationPreviewProps {
  alt: string;
  attachmentId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope | null;
  sessionId: string;
  toolRunId: string;
}

export default function AgentToolObservationPreview({ alt, attachmentId, libraryId, ownerScope, sessionId, toolRunId }: AgentToolObservationPreviewProps) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const accountScope = ownerScope?.accountScope;
  const backendScope = ownerScope?.backendScope;
  const request = React.useMemo(() => (
    accountScope && backendScope && Number.isSafeInteger(libraryId) && libraryId > 0
      && sessionId.trim() && toolRunId.trim() && IMAGE_ID.test(attachmentId)
      ? { id: attachmentId, libraryId, ownerScope: { accountScope, backendScope }, sessionId }
      : null
  ), [accountScope, attachmentId, backendScope, libraryId, sessionId, toolRunId]);
  const requestKey = JSON.stringify([accountScope, backendScope, libraryId, sessionId, toolRunId, attachmentId, workspaceActive]);
  const [image, setImage] = React.useState<{ key: string; src?: string; failed?: boolean }>({ key: '' });
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setImage({ key: requestKey });
    setPreviewKey(null);
    if (request && workspaceActive) {
      void (async () => {
        try {
          const src = await previewAgentAttachment(request);
          if (src.length > Math.ceil(AGENT_ATTACHMENT_MAX_BYTES / 3) * 4 + 64 || !PNG_DATA_URL.test(src)) {
            throw new Error('Invalid managed screenshot');
          }
          if (active) setImage({ key: requestKey, src });
        } catch {
          if (active) setImage({ key: requestKey, failed: true });
        }
      })();
    }
    return () => { active = false; };
  }, [request, requestKey, workspaceActive]);

  if (!workspaceActive) return null;
  const currentImage = image.key === requestKey ? image : undefined;
  return (
    <><ObservationPreview>
      {currentImage?.src ? (
        <button type="button" aria-label={`预览 ${alt}`} onClick={() => setPreviewKey(requestKey)}>
          <img alt={alt} src={currentImage.src} onError={() => {
            setImage({ key: requestKey, failed: true });
            setPreviewKey(null);
          }} />
        </button>
      ) : !request || currentImage?.failed ? (
        <p>截图暂不可用</p>
      ) : (
        <p role="status">正在读取截图…</p>
      )}
    </ObservationPreview>{previewKey === requestKey && request && currentImage?.src ? (
      <AgentAttachmentPreview key={requestKey}
        attachment={{ id: attachmentId, name: alt, kind: 'image', mimeType: 'image/png',
          sizeBytes: (currentImage.src.length - 'data:image/png;base64,'.length) * 3 / 4
            - (currentImage.src.endsWith('==') ? 2 : currentImage.src.endsWith('=') ? 1 : 0),
          thumbnail: currentImage.src }}
        scope={{ libraryId: request.libraryId, ownerScope: request.ownerScope }} sessionId={request.sessionId}
        onClose={() => setPreviewKey(null)} />
    ) : null}</>
  );
}
