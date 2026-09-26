import { css } from 'styled-components';
import {
  focusVisibleStyles,
  surfaceStyles,
  textToneStyles,
} from '@/components/ui/theme-foundation-styles';

/** 归档页共用的应用外壳；封面、媒体徽章及封面上的遮罩文字由各 viewer 配对处理。 */
export const archiveViewerThemeStyles = css`
  ${textToneStyles('primary')}

  .table-surface,
  .gallery-archive-surface {
    ${surfaceStyles('app')}
  }

  .state-wrap {
    ${textToneStyles('secondary')}
  }

  .state-wrap.state-error {
    color: var(--app-danger-text);
  }
`;

/** 只管理卡片底色、文字和边框反馈，不覆盖封面或改变卡片几何尺寸。 */
export const archiveCardSurfaceStyles = css`
  ${surfaceStyles('panel')}
  ${textToneStyles('primary')}
  border-color: var(--app-border);

  &:not(:disabled):not([aria-disabled='true']):hover {
    border-color: var(--app-focus-border);
  }

  &:not(:disabled):not([aria-disabled='true']):active {
    border-color: var(--app-accent-active);
  }

  ${focusVisibleStyles}
`;
