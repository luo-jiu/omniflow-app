import type { FC } from 'react';
import { systemWorkspaceMeta } from '../../registry';
import {
  SystemWorkspaceCard,
  SystemWorkspaceGrid,
} from '../../style';
import type { SystemWorkspaceViewProps } from '../../types';

const overviewItems = [
  'settings',
  'profile',
  'uploads',
  'recycle-bin',
] as const;

const OverviewWorkspace: FC<SystemWorkspaceViewProps> = ({ onOpenView }) => (
  <SystemWorkspaceGrid>
    {overviewItems.map((view) => {
      const meta = systemWorkspaceMeta[view];
      return (
        <SystemWorkspaceCard
          key={view}
          type="button"
          onClick={() => onOpenView(view)}
        >
          <span className="system-card-icon">{meta.icon}</span>
          <span className="system-card-main">
            <span className="system-card-title">{meta.title}</span>
            <span className="system-card-description">{meta.description}</span>
          </span>
        </SystemWorkspaceCard>
      );
    })}
  </SystemWorkspaceGrid>
);

export default OverviewWorkspace;
