import { css } from 'styled-components';

export type ThemeSurfaceRole = 'app' | 'panel' | 'elevated' | 'raised' | 'input' | 'popover' | 'sidebar';
export type ThemeTextTone = 'primary' | 'secondary' | 'muted' | 'disabled' | 'accent';
export type ThemeButtonVariant = 'primary' | 'secondary' | 'outline' | 'quiet' | 'danger';

const surfaceVariables: Record<ThemeSurfaceRole, string> = {
  app: '--app-bg',
  panel: '--app-panel',
  elevated: '--app-bg-elevated',
  raised: '--app-bg-raised',
  input: '--app-bg-input',
  popover: '--app-bg-popover',
  sidebar: '--app-bg-sidebar',
};

const textVariables: Record<ThemeTextTone, string> = {
  primary: '--app-text',
  secondary: '--app-text-secondary',
  muted: '--app-text-muted',
  disabled: '--app-text-disabled',
  accent: '--app-accent',
};

/** 只消费主题投影；表面的布局、边框和系统毛玻璃由实际容器决定。 */
export const surfaceStyles = (role: ThemeSurfaceRole) => css`
  background-color: var(${surfaceVariables[role]});
`;

export const textToneStyles = (tone: ThemeTextTone) => css`
  color: var(${textVariables[tone]});
`;

/** 内收 2px，保证滚动容器中的键盘焦点不被裁切，不制造额外布局。 */
export const focusVisibleStyles = css`
  &:focus-visible:not(:disabled):not([aria-disabled='true']) {
    outline: 2px solid var(--app-focus-border);
    outline-offset: -2px;
  }
`;

const disabledStyles = css`
  &:disabled,
  &[aria-disabled='true'] {
    color: var(--app-text-disabled);
    cursor: not-allowed;
  }
`;

/** 不设置静止背景或尺寸，可接到已有树行、菜单项、标签的选择状态入口。 */
export const interactiveItemStyles = css`
  &:not(:disabled):not([aria-disabled='true']) {
    &:hover {
      background-color: var(--app-hover-bg);
    }

    &:active {
      background-color: var(--app-active-bg);
    }
  }

  ${disabledStyles}
  ${focusVisibleStyles}
`;

export const selectedItemStyles = css`
  background-color: var(--app-control-selected-bg);

  &:not(:disabled):not([aria-disabled='true']):hover {
    background-color: var(--app-control-selected-hover-bg);
  }

  &:not(:disabled):not([aria-disabled='true']):active {
    background-color: var(--app-control-selected-active-bg);
  }

  ${disabledStyles}
  ${focusVisibleStyles}
`;

/**
 * data-selected 仅决定视觉；aria-selected / aria-pressed 由消费者按原生语义传入。
 * 不重设子元素颜色，归档等领域文字色可与选中背景独立组合。
 * aria-disabled 不会自动阻断事件；可原生禁用的控件应直接传 disabled。
 */
export const selectableItemStyles = css`
  background-color: transparent;
  ${interactiveItemStyles}

  &[data-selected='true'] {
    ${selectedItemStyles}
  }
`;

const buttonVariants = {
  primary: css`
    color: var(--app-accent-foreground);
    background-color: var(--app-accent);

    &:not(:disabled):not([aria-disabled='true']):hover {
      background-color: var(--app-accent-hover);
    }

    &:not(:disabled):not([aria-disabled='true']):active {
      background-color: var(--app-accent-active);
    }
  `,
  secondary: css`
    color: var(--app-text);
    background-color: var(--app-fill-default);

    &:not(:disabled):not([aria-disabled='true']):hover {
      background-color: var(--app-fill-strong);
    }

    &:not(:disabled):not([aria-disabled='true']):active {
      background-color: var(--app-fill-pressed);
    }
  `,
  quiet: css`
    color: var(--app-text);
    background-color: transparent;

    &:not(:disabled):not([aria-disabled='true']):hover {
      background-color: var(--app-hover-bg);
    }

    &:not(:disabled):not([aria-disabled='true']):active {
      background-color: var(--app-active-bg);
    }
  `,
  outline: css`
    color: var(--app-text);
    background-color: var(--app-bg);
    border-color: var(--app-border);

    &:not(:disabled):not([aria-disabled='true']):hover {
      color: var(--app-accent);
      border-color: var(--app-focus-border);
    }

    &:not(:disabled):not([aria-disabled='true']):active {
      color: var(--app-accent-active);
      border-color: var(--app-accent-active);
    }
  `,
  danger: css`
    color: var(--app-danger-text);
    background-color: var(--app-danger-bg);
    border-color: var(--app-danger-border);

    &:not(:disabled):not([aria-disabled='true']):hover {
      background-color: color-mix(in srgb, var(--app-danger-text) 8%, var(--app-danger-bg));
    }

    &:not(:disabled):not([aria-disabled='true']):active {
      background-color: color-mix(in srgb, var(--app-danger-text) 14%, var(--app-danger-bg));
    }
  `,
};

export const buttonStyles = (variant: ThemeButtonVariant) => css`
  font: inherit;
  border-color: transparent;
  ${buttonVariants[variant]}

  &:disabled,
  &[aria-disabled='true'] {
    background-color: var(--app-fill-subtle);
    border-color: transparent;
  }

  ${disabledStyles}
  ${focusVisibleStyles}
  ${variant === 'outline' ? css`
    &:disabled,
    &[aria-disabled='true'] {
      border-color: var(--app-border);
    }
  ` : ''}
  ${variant === 'primary' ? css`
    &:focus-visible:not(:disabled):not([aria-disabled='true']) {
      outline-color: var(--app-accent-foreground);
    }
  ` : ''}
`;

/** 外观与尺寸分离，供已有输入框/文本域保留密度和布局。 */
export const inputAppearanceStyles = css`
  border-color: var(--app-border);
  background-color: var(--app-bg-input);
  color: var(--app-text);

  &::placeholder {
    color: var(--app-text-muted);
    opacity: 1;
  }

  &:not(:disabled):not([aria-disabled='true']):hover {
    border-color: var(--app-border-strong);
  }

  &:not(:disabled):not([aria-disabled='true']):focus {
    border-color: var(--app-focus-border);
  }

  &:not(:disabled):not([aria-disabled='true'])[aria-invalid='true'] {
    border-color: var(--app-danger-text);
  }

  &:disabled,
  &[aria-disabled='true'] {
    background-color: var(--app-fill-subtle);
    border-color: var(--app-border);
  }

  ${disabledStyles}
  ${focusVisibleStyles}
`;

export const inputStyles = css`
  box-sizing: border-box;
  min-width: 0;
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-small);
  font: inherit;
  line-height: 1.4;
  ${inputAppearanceStyles}
`;
