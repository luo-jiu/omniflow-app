import styled from 'styled-components';

import OutlineIcon, { type OutlineIconName } from '@/components/ui/outline-icon';
import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';

const OPERATION_ICONS: Record<string, OutlineIconName> = {
  'file.read': 'book',
  'attachment.read': 'book',
  'file.list': 'book',
  'file.stat': 'file',
  'attachment.inspect': 'file',
  'attachment.view': 'book',
  'file.search': 'search',
  'file.resolve': 'search',
  'file.grep': 'search',
  'attachment.query': 'search',
  'recycle.list': 'search',
  'tag.list': 'search',
  'file.write': 'edit',
  'file.rename': 'edit',
  'tag.update': 'tags',
  'file.move': 'move',
  'recycle.restore': 'move',
  'file.copy': 'copy',
  'file.delete': 'trash',
  'directory.create': 'folder-plus',
  'library.batch': 'folder',
  'file.upload': 'upload',
  'file.publish': 'upload',
  'file.stage': 'file',
  'shell.run': 'terminal',
  'operation.verify': 'check',
  'media.inspect': 'file',
};

const IconSlot = styled.span`
  width: 20px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  color: var(--agent-tool-record-color, var(--app-text-muted));

  &[data-status='failed'] {
    color: var(--semi-color-danger);
  }

  &[data-status='cancelled'],
  &[data-status='interrupted'] {
    color: var(--semi-color-warning);
  }

  && .app-outline-icon,
  && .app-outline-icon svg,
  && .app-outline-icon svg * {
    color: inherit;
  }

  &[data-spinning='true'] svg {
    transform-origin: center;
    animation: agent-activity-spin 900ms linear infinite;
  }

  @keyframes agent-activity-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    &[data-spinning='true'] svg { animation: none; }
  }
`;

export default function AgentToolIcon({ activity }: { activity: AgentToolActivitySnapshot }) {
  const active = activity.status === 'preparing' || activity.status === 'running';
  const operation = OPERATION_ICONS[activity.call.name];
  let name: OutlineIconName;
  if (['failed', 'cancelled', 'interrupted'].includes(activity.status)) {
    name = 'alert';
  } else if (activity.status === 'awaiting_approval' || activity.status === 'awaiting_interaction') {
    name = 'help';
  } else if (activity.call.name === 'shell.run') {
    name = 'terminal';
  } else if (active && activity.toolMetadata?.risk !== 'read' && !['book', 'file', 'search'].includes(operation || '')) {
    name = 'loading';
  } else {
    name = operation || (activity.toolMetadata?.risk === 'read' ? 'book' : 'check');
  }
  const spinning = active && name === 'loading';

  return (
    <IconSlot
      className={spinning ? 'agent-activity-spinner' : undefined}
      data-status={activity.status}
      data-spinning={spinning}
      data-tool-icon={name}
    >
      <OutlineIcon name={name} />
    </IconSlot>
  );
}
