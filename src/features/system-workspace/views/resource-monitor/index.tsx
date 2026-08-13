import React from 'react';
import { Spin } from '@douyinfe/semi-ui';
import type { SystemWorkspaceViewProps } from '../../types';

const ResourceMonitorWorkspace = React.lazy(() => (
  import('@/features/resource-monitor/components/ResourceMonitorWorkspace')
));

const ResourceMonitorSystemWorkspace: React.FC<SystemWorkspaceViewProps> = (props) => (
  <React.Suspense
    fallback={(
      <div className="system-workspace-lazy-state">
        <Spin />
      </div>
    )}
  >
    <ResourceMonitorWorkspace {...props} />
  </React.Suspense>
);

export default ResourceMonitorSystemWorkspace;
