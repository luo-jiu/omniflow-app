import { Modal } from '@douyinfe/semi-ui';

type CompactConfirmOptions = Parameters<typeof Modal.confirm>[0];

const COMPACT_CONFIRM_CLASS_NAME = 'app-compact-confirm';

export function openCompactConfirm(options: CompactConfirmOptions) {
  const className = [COMPACT_CONFIRM_CLASS_NAME, options.className]
    .filter(Boolean)
    .join(' ');
  return Modal.confirm({ ...options, className });
}
