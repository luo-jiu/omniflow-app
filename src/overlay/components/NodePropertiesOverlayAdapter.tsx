import React from 'react';
import NodePropertiesModal from '@/features/file-explorer/components/directory-tree/modals/NodePropertiesModal';
import type {
  NodePropertiesOverlayProps,
  NodePropertiesOverlayResult,
} from '@/service/overlay/types';
import type { OverlayComponentProps } from '../registry';

export const NodePropertiesOverlayAdapter: React.FC<
  OverlayComponentProps<NodePropertiesOverlayProps, NodePropertiesOverlayResult>
> = ({ props, onResolve }) => {
  return (
    <NodePropertiesModal
      visible
      fullName={props.fullName}
      icon={props.icon}
      sections={props.sections}
      title={props.title}
      onClose={() => onResolve({ type: 'close' })}
    />
  );
};
