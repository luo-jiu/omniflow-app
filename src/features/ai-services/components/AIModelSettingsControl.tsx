import React from 'react';
import { IconChevronDown, IconChevronRight, IconTick } from '@douyinfe/semi-icons';
import { InputNumber, Popover } from '@douyinfe/semi-ui';
import styled from 'styled-components';

import {
  resolveOverlayPlacement,
  type ContextMenuPosition,
} from '@/components/ui/context-menu/overlay';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { getAppPopupContainer } from '@/utils/popup-container';
import type { AIServiceReasoningEffort } from '../ai-service.types';

const ModelSettingsTrigger = styled.button`
  min-width: 0;
  max-width: 260px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--app-radius-large);
  background: transparent;
  color: var(--app-text-muted);
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible:not(:disabled) {
    background: var(--semi-color-fill-0);
    color: var(--app-text);
  }

  &:focus-visible {
    outline: 2px solid var(--semi-color-primary-light-active);
    outline-offset: 0;
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .model-name {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reasoning-label {
    flex: none;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  svg {
    width: 12px;
    height: 12px;
    flex: none;
  }
`;

const SettingsPopover = styled.div`
  --settings-menu-row-height: 36px;

  width: 224px;
  color: var(--app-text);
`;

const SettingsPrimaryMenu = styled.div`
  width: 224px;
  flex: none;
  padding: 4px;
  border: 1px solid var(--app-border-strong);
  border-radius: 8px;
  background: var(--app-bg-elevated);
  box-shadow: var(--app-shadow);
  display: flex;
  flex-direction: column;
  gap: 2px;

  .settings-menu-anchor {
    width: 100%;
  }
`;

const SettingsMenuItem = styled.button`
  width: 100%;
  min-height: var(--settings-menu-row-height);
  padding: 0 8px;
  border: 0;
  border-radius: var(--app-radius-small);
  background: transparent;
  color: var(--app-text);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  text-align: left;

  &:hover,
  &:focus-visible,
  &[aria-expanded='true'] {
    background: var(--semi-color-fill-1);
  }

  &:focus-visible {
    outline: 2px solid var(--semi-color-primary-light-active);
    outline-offset: -2px;
  }

  .menu-label,
  .menu-value {
    font-size: 12px;
    line-height: 1.4;
  }

  .menu-label {
    font-weight: 650;
  }

  .menu-value {
    min-width: 0;
    overflow: hidden;
    color: var(--app-text-muted);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 14px;
    height: 14px;
    color: var(--app-text-muted);
  }
`;

const SettingsInlineField = styled.label`
  width: 100%;
  min-height: var(--settings-menu-row-height);
  padding: 0 8px;
  color: var(--app-text);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  cursor: text;

  .menu-label {
    flex: none;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.4;
  }

  .inline-value-zone {
    width: 100%;
    min-width: 0;
    min-height: 28px;
    border-radius: var(--app-radius-large);
    background: transparent;
    display: flex;
    align-items: center;
  }

  &:hover .inline-value-zone,
  &:focus-within .inline-value-zone {
    background: var(--semi-color-fill-1);
  }

  .semi-input-number,
  .semi-input-wrapper {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .semi-input-number:hover,
  .semi-input-number:focus-within,
  .semi-input-wrapper:hover,
  .semi-input-wrapper:focus-within {
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .semi-input {
    padding: 0 22px 0 8px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 12px;
    font-weight: 600;
    text-align: right;
  }
`;

const MODEL_SUBMENU_WIDTH = 280;
const MODEL_OPTIONS_MAX_HEIGHT = 160;

const SettingsSubmenu = styled.div`
  width: 224px;
  padding: 5px;
  border: 1px solid var(--app-border-strong);
  border-radius: 8px;
  background: var(--app-bg-elevated);
  box-shadow: var(--app-shadow);
  display: flex;
  flex-direction: column;
  gap: 2px;

  &[data-submenu='model'] {
    width: ${MODEL_SUBMENU_WIDTH}px;
  }

  .submenu-option {
    width: 100%;
    min-height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--app-radius-small);
    background: transparent;
    color: var(--app-text);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .submenu-option:hover,
  .submenu-option:focus-visible,
  .submenu-option.is-selected {
    background: var(--semi-color-fill-1);
  }

  .submenu-option:focus-visible {
    outline: 2px solid var(--semi-color-primary-light-active);
    outline-offset: -2px;
  }

  .submenu-option.is-selected {
    color: var(--semi-color-primary);
    font-weight: 700;
  }

  .submenu-option svg {
    width: 14px;
    height: 14px;
  }
`;

const ModelOptionsList = styled.div`
  max-height: ${MODEL_OPTIONS_MAX_HEIGHT}px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  ${workspaceScrollbarStyles}

  .model-option,
  .model-empty {
    min-height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--app-radius-small);
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
    text-align: left;
  }

  .model-option {
    cursor: pointer;
  }

  .model-option:hover,
  .model-option.is-selected {
    background: var(--semi-color-fill-1);
  }

  .model-option.is-selected {
    color: var(--semi-color-primary);
    font-weight: 700;
  }

  .model-empty {
    color: var(--app-text-muted);
    display: flex;
    align-items: center;
  }
`;

const REASONING_OPTIONS: Array<{ label: string; value: AIServiceReasoningEffort }> = [
  { label: '自动', value: 'auto' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
];

const REASONING_LABELS: Record<AIServiceReasoningEffort, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
};

type SettingsMenuKey = 'model' | 'reasoning';

type SettingsSubmenuAnchorProps = {
  activeMenu: SettingsMenuKey | null;
  children: React.ReactNode;
  menuKey: SettingsMenuKey;
  onActivate?: () => void;
  popupHeight: number;
  popupWidth: number;
  setActiveMenu: React.Dispatch<React.SetStateAction<SettingsMenuKey | null>>;
  submenu: React.ReactNode;
};

const SETTINGS_POPOVER_STYLE: React.CSSProperties = {
  backgroundColor: 'transparent',
  boxShadow: 'none',
};

const SettingsSubmenuAnchor: React.FC<SettingsSubmenuAnchorProps> = ({
  activeMenu,
  children,
  menuKey,
  onActivate,
  popupHeight,
  popupWidth,
  setActiveMenu,
  submenu,
}) => {
  const triggerRef = React.useRef<HTMLDivElement | null>(null);
  const resolveFrameRef = React.useRef<number | null>(null);
  const [position, setPosition] = React.useState<ContextMenuPosition>('leftTop');

  const resolvePosition = React.useCallback(() => {
    if (!triggerRef.current) return;
    const nextPosition = resolveOverlayPlacement(triggerRef.current.getBoundingClientRect(), {
      popupHeight,
      popupWidth,
      preferredHorizontal: 'left',
      preferredVertical: 'top',
    });
    setPosition((currentPosition) => (
      currentPosition === nextPosition ? currentPosition : nextPosition
    ));
  }, [popupHeight, popupWidth]);

  const scheduleResolvePosition = React.useCallback(() => {
    if (resolveFrameRef.current != null) {
      window.cancelAnimationFrame(resolveFrameRef.current);
    }
    resolveFrameRef.current = window.requestAnimationFrame(() => {
      resolveFrameRef.current = null;
      resolvePosition();
    });
  }, [resolvePosition]);

  React.useEffect(() => () => {
    if (resolveFrameRef.current != null) {
      window.cancelAnimationFrame(resolveFrameRef.current);
      resolveFrameRef.current = null;
    }
  }, []);

  const activate = React.useCallback(() => {
    setActiveMenu(menuKey);
    onActivate?.();
    scheduleResolvePosition();
  }, [menuKey, onActivate, scheduleResolvePosition, setActiveMenu]);

  return (
    <Popover
      autoAdjustOverflow
      disableFocusListener={false}
      getPopupContainer={getAppPopupContainer}
      motion={false}
      mouseEnterDelay={0}
      mouseLeaveDelay={100}
      position={position}
      rePosKey={`${menuKey}-${position}-${popupHeight}`}
      showArrow={false}
      spacing={4}
      stopPropagation
      style={SETTINGS_POPOVER_STYLE}
      trigger="hover"
      content={submenu}
      onVisibleChange={(visible) => {
        if (visible) {
          activate();
          return;
        }
        setActiveMenu((currentMenu) => currentMenu === menuKey ? null : currentMenu);
      }}
    >
      <div
        ref={triggerRef}
        className="settings-menu-anchor"
        data-active={activeMenu === menuKey ? 'true' : 'false'}
        onFocus={activate}
        onMouseEnter={activate}
        onMouseMove={scheduleResolvePosition}
      >
        {children}
      </div>
    </Popover>
  );
};

export interface AIModelSettingsControlProps {
  availableModels: string[];
  contextWindow?: {
    onChange: (value: number) => void;
    value: number;
  };
  disabled?: boolean;
  loadingModels: boolean;
  model: string;
  modelSourceKey: string;
  onLoadModels: () => Promise<boolean>;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: AIServiceReasoningEffort) => void;
  reasoningEffort: AIServiceReasoningEffort;
}

export default function AIModelSettingsControl({
  availableModels,
  contextWindow,
  disabled = false,
  loadingModels,
  model,
  modelSourceKey,
  onLoadModels,
  onModelChange,
  onReasoningEffortChange,
  reasoningEffort,
}: AIModelSettingsControlProps) {
  const [activeSettingsMenu, setActiveSettingsMenu] = React.useState<SettingsMenuKey | null>(null);
  const modelLoadStateRef = React.useRef<'idle' | 'loading' | 'loaded'>('idle');
  const modelOptions = React.useMemo(() => (
    [...availableModels].sort((left, right) => (
      right.localeCompare(left, 'en', { numeric: true, sensitivity: 'base' })
    ))
  ), [availableModels]);
  const modelSubmenuHeight = 10 + Math.min(
    MODEL_OPTIONS_MAX_HEIGHT,
    Math.max(32, modelOptions.length * 34 - 2),
  );

  React.useEffect(() => {
    modelLoadStateRef.current = 'idle';
    setActiveSettingsMenu(null);
  }, [modelSourceKey]);

  React.useEffect(() => {
    if (availableModels.length > 0) {
      modelLoadStateRef.current = 'loaded';
    }
  }, [availableModels.length]);

  const ensureModelsLoaded = React.useCallback(() => {
    if (modelLoadStateRef.current !== 'idle') return;
    modelLoadStateRef.current = 'loading';
    void onLoadModels().then((loaded) => {
      modelLoadStateRef.current = loaded ? 'loaded' : 'idle';
    }).catch(() => {
      modelLoadStateRef.current = 'idle';
    });
  }, [onLoadModels]);

  const modelSubmenu = (
    <SettingsSubmenu aria-label="模型选择" data-submenu="model" role="menu">
      <ModelOptionsList aria-label="可用模型" aria-live="polite">
        {loadingModels ? (
          <div className="model-empty">正在读取模型...</div>
        ) : modelOptions.length > 0 ? modelOptions.map((modelId) => (
          <button
            key={modelId}
            className={`model-option ${model === modelId ? 'is-selected' : ''}`}
            type="button"
            onClick={() => onModelChange(modelId)}
          >
            {modelId}
          </button>
        )) : (
          <div className="model-empty">当前服务未返回模型</div>
        )}
      </ModelOptionsList>
    </SettingsSubmenu>
  );

  const reasoningSubmenu = (
    <SettingsSubmenu aria-label="推理强度" data-submenu="reasoning" role="menu">
      {REASONING_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={`submenu-option ${reasoningEffort === option.value ? 'is-selected' : ''}`}
          aria-pressed={reasoningEffort === option.value}
          type="button"
          onClick={() => onReasoningEffortChange(option.value)}
        >
          <span>{option.label}</span>
          {reasoningEffort === option.value ? <IconTick /> : null}
        </button>
      ))}
    </SettingsSubmenu>
  );

  return (
    <Popover
      motion={false}
      trigger="click"
      position="topRight"
      showArrow={false}
      style={SETTINGS_POPOVER_STYLE}
      onVisibleChange={(visible) => {
        if (!visible) setActiveSettingsMenu(null);
      }}
      content={(
        <SettingsPopover>
          <SettingsPrimaryMenu>
            <SettingsSubmenuAnchor
              activeMenu={activeSettingsMenu}
              menuKey="model"
              onActivate={ensureModelsLoaded}
              popupHeight={modelSubmenuHeight}
              popupWidth={MODEL_SUBMENU_WIDTH}
              setActiveMenu={setActiveSettingsMenu}
              submenu={modelSubmenu}
            >
              <SettingsMenuItem
                aria-expanded={activeSettingsMenu === 'model'}
                aria-haspopup="menu"
                type="button"
                onClick={() => setActiveSettingsMenu('model')}
                onFocus={() => setActiveSettingsMenu('model')}
                onMouseEnter={() => setActiveSettingsMenu('model')}
              >
                <span className="menu-label">模型</span>
                <span className="menu-value">{model || '未选择'}</span>
                <IconChevronRight />
              </SettingsMenuItem>
            </SettingsSubmenuAnchor>
            <SettingsSubmenuAnchor
              activeMenu={activeSettingsMenu}
              menuKey="reasoning"
              popupHeight={140}
              popupWidth={224}
              setActiveMenu={setActiveSettingsMenu}
              submenu={reasoningSubmenu}
            >
              <SettingsMenuItem
                aria-expanded={activeSettingsMenu === 'reasoning'}
                aria-haspopup="menu"
                type="button"
                onClick={() => setActiveSettingsMenu('reasoning')}
                onFocus={() => setActiveSettingsMenu('reasoning')}
                onMouseEnter={() => setActiveSettingsMenu('reasoning')}
              >
                <span className="menu-label">推理强度</span>
                <span className="menu-value">{REASONING_LABELS[reasoningEffort]}</span>
                <IconChevronRight />
              </SettingsMenuItem>
            </SettingsSubmenuAnchor>
            {contextWindow ? (
              <SettingsInlineField>
                <span className="menu-label">上下文窗口</span>
                <span className="inline-value-zone">
                  <InputNumber
                    aria-label="上下文窗口"
                    hideButtons
                    max={10}
                    min={0}
                    precision={0}
                    value={contextWindow.value}
                    onNumberChange={(value) => contextWindow.onChange(Number(value) || 0)}
                  />
                </span>
              </SettingsInlineField>
            ) : null}
          </SettingsPrimaryMenu>
        </SettingsPopover>
      )}
    >
      <ModelSettingsTrigger disabled={disabled} type="button" title="选择模型与推理强度">
        <span className="model-name">{model || '选择模型'}</span>
        <span className="reasoning-label">{REASONING_LABELS[reasoningEffort]}</span>
        <IconChevronDown />
      </ModelSettingsTrigger>
    </Popover>
  );
}
