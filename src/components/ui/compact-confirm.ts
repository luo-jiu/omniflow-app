import { createElement } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { IconCrossStroked } from '@douyinfe/semi-icons';

type CompactConfirmOptions = Parameters<typeof Modal.confirm>[0];

const COMPACT_CONFIRM_CLASS_NAME = 'app-compact-confirm';
const DEFAULT_CLOSE_ICON = createElement(IconCrossStroked, { size: 'small' });

export function openCompactConfirm(options: CompactConfirmOptions) {
  const className = [COMPACT_CONFIRM_CLASS_NAME, options.className]
    .filter(Boolean)
    .join(' ');
  return Modal.confirm({
    icon: null,
    closeIcon: DEFAULT_CLOSE_ICON,
    ...options,
    className,
  });
}
