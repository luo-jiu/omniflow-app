import { useContext } from 'react';
import OutlineIcon from '@/components/ui/outline-icon';
import { FloatingViewerDockButton } from '@/components/ui/floating-viewer-dock';
import { ViewerOptionsContext } from './viewer-options.context';

export default function ViewerOptionsButton() {
  const options = useContext(ViewerOptionsContext);
  if (!options) return null;
  const label = options.unavailable ? '查看器设置（已回退到内置查看器）' : '查看器设置';
  return <FloatingViewerDockButton onClick={options.open} title={label} aria-label={label} aria-haspopup="dialog">
    <OutlineIcon name={options.unavailable ? 'alert' : 'settings'} />
  </FloatingViewerDockButton>;
}
