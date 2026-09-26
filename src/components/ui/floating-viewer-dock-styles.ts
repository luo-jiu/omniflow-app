import { css } from 'styled-components';

/** 只共享气泡材质，播放器等复杂控件可保留自己的尺寸和布局。 */
export const floatingViewerDockSurfaceStyles = css`
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-bg-popover) 70%, transparent);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;
