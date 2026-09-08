import styled from 'styled-components';

import type {
  AgentOwnerScope,
  AgentPreparedActionPublic,
  AgentPresentationAction,
  AgentToolActivitySnapshot,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import type { AgentWorkflowProjection } from '../agent-workflow-projection';
import AgentToolActivityCard from './AgentToolActivityCard';
import AgentWorkflowCard from './AgentWorkflowCard';

const ActiveRunDock = styled.section`
  width: 100%;
  display: grid;
  gap: 7px;

  > article {
    width: 100%;
  }
`;

interface AgentActiveRunDockProps {
  approvalBusyIds: Set<string>;
  interactionBusyIds: Set<string>;
  libraryId: number;
  onAction?: (action: AgentPresentationAction) => void;
  onResolveApproval: (
    approval: AgentToolApprovalSnapshot,
    approved: boolean,
    preparedAction?: AgentPreparedActionPublic,
  ) => void;
  ownerScope: AgentOwnerScope | null;
  pendingActivity?: AgentToolActivitySnapshot;
  workflow: AgentWorkflowProjection;
}

export default function AgentActiveRunDock({
  approvalBusyIds,
  interactionBusyIds,
  libraryId,
  onAction,
  onResolveApproval,
  ownerScope,
  pendingActivity,
  workflow,
}: AgentActiveRunDockProps) {
  return (
    <ActiveRunDock aria-label="Agent 当前运行状态">
      <AgentWorkflowCard variant="dock" workflow={workflow} />
      {pendingActivity ? (
        <AgentToolActivityCard
          activity={pendingActivity}
          approvalBusy={Boolean(
            pendingActivity.approval
            && approvalBusyIds.has(pendingActivity.approval.approvalId)
          )}
          interactionBusy={Boolean(
            pendingActivity.interaction
            && interactionBusyIds.has(pendingActivity.interaction.interactionId)
          )}
          libraryId={libraryId}
          onAction={onAction}
          ownerScope={ownerScope}
          onResolveApproval={onResolveApproval}
        />
      ) : null}
    </ActiveRunDock>
  );
}
