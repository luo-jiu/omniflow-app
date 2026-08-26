import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { IconCrossStroked } from '@douyinfe/semi-icons';

type CompactModalProps = React.ComponentProps<typeof Modal>;

const COMPACT_MODAL_CLASS_NAME = 'app-compact-modal';

export function CompactModal({
  className,
  closeIcon = <IconCrossStroked size="small" />,
  width = 360,
  ...props
}: CompactModalProps) {
  const mergedClassName = [COMPACT_MODAL_CLASS_NAME, className]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal
      {...props}
      className={mergedClassName}
      closeIcon={closeIcon}
      width={width}
    />
  );
}
