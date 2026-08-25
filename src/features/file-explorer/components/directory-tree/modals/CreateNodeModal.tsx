import React from 'react';
import { Input, Select } from '@douyinfe/semi-ui';
import { IconChevronDownStroked, IconCrossStroked } from '@douyinfe/semi-icons';
import styled from 'styled-components';
import type { OverlayStorageProvider } from '@/service/overlay/types';
import { formatStorageProviderAlias } from './storage-provider-display';
import {
  StorageProviderDropdownStyle,
  StorageProviderOption,
} from './storage-provider-option';

interface CreateNodeModalProps {
  visible: boolean;
  type: 'file' | 'dir' | null;
  name: string;
  loading: boolean;
  defaultProvider?: string;
  providers?: OverlayStorageProvider[];
  providerLoading?: boolean;
  selectedProvider?: string;
  onNameChange: (value: string) => void;
  onProviderChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.34);
`;

const Panel = styled.div`
  position: relative;
  width: 360px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  border: 1px solid var(--app-border-strong);
  border-radius: 10px;
  background: var(--app-bg-elevated);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  padding: 16px 18px 16px;

  .create-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 24px;
    margin-bottom: 16px;
  }

  &.create-panel-file {
    padding-top: 14px;
    padding-bottom: 14px;
  }

  &.create-panel-file .create-header {
    margin-bottom: 12px;
  }

  &.create-panel-file .create-fields {
    gap: 8px;
  }

  &.create-panel-file .create-actions {
    margin-top: 12px;
  }

  .create-title {
    color: var(--semi-color-text-0);
    font-size: 18px;
    font-weight: 700;
    line-height: 1.25;
  }

  .create-close {
    position: absolute;
    top: 9px;
    right: 10px;
    display: inline-flex;
    width: 24px;
    min-width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--app-radius-medium, 10px);
    background: transparent;
    padding: 0;
    color: var(--app-text-muted);
    cursor: pointer;
    line-height: 1;
  }

  .create-close:hover {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  .create-close:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--semi-color-primary) 45%, transparent);
    outline-offset: 1px;
  }

  .create-close .semi-icon {
    display: inline-flex;
    width: 12px;
    height: 12px;
    align-items: center;
    justify-content: center;
    font-size: 12px;
  }

  .semi-input-wrapper {
    width: 100%;
    height: 34px;
    min-height: 34px;
    border-radius: 7px;
    background: var(--semi-color-bg-1);
    border-color: var(--app-border-strong);
  }

  .semi-input,
  .semi-input-default {
    font-size: 13px;
  }

  .create-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .create-field {
    min-width: 0;
  }

  .create-field-label {
    margin-bottom: 5px;
    color: var(--semi-color-text-2);
    font-size: 11px;
    line-height: 1.35;
  }

  .provider-select {
    width: 100%;
  }

  .provider-select.semi-select,
  .provider-select .semi-select {
    height: 28px;
    max-height: 28px !important;
    overflow: hidden !important;
  }

  .provider-select .semi-select-selection {
    height: 28px;
    min-height: 28px;
    max-height: 28px;
    align-items: center;
    overflow: hidden !important;
    padding-top: 0;
    padding-bottom: 0;
  }

  .provider-selected {
    display: flex;
    min-width: 0;
    align-items: center;
  }

  .provider-selected-title {
    min-width: 0;
    overflow: hidden;
    color: var(--semi-color-text-0);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .provider-select .semi-select-arrow {
    display: inline-flex;
    width: 24px;
    flex: 0 0 24px;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-text-1);
    font-size: 12px;
  }

  .create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  .create-action {
    min-width: 58px;
    height: 30px;
    border: 0;
    border-radius: 7px;
    padding: 0 12px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .create-action:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .create-action-secondary {
    background: var(--semi-color-fill-2);
    color: var(--semi-color-text-0);
  }

  .create-action-primary {
    background: #4ea3ff;
    color: #fff;
  }
`;

const CreateNodeModal: React.FC<CreateNodeModalProps> = ({
  visible,
  type,
  name,
  loading,
  defaultProvider,
  providers = [],
  providerLoading,
  selectedProvider,
  onNameChange,
  onProviderChange,
  onConfirm,
  onCancel
}) => {
  const isFolder = type === 'dir';
  const selectedProviderInfo = providers.find(provider => provider.alias === selectedProvider);
  const renderSelectedProvider = React.useCallback(() => {
    if (!selectedProviderInfo) {
      return selectedProvider || '选择存储桶';
    }
    return (
      <div className="provider-selected">
        <div className="provider-selected-title">
          {formatStorageProviderAlias(selectedProviderInfo, defaultProvider)}
        </div>
      </div>
    );
  }, [defaultProvider, selectedProvider, selectedProviderInfo]);

  React.useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel, visible]);

  if (!visible) {
    return null;
  }

  return (
    <>
      <StorageProviderDropdownStyle />
      <Overlay role="presentation">
        <Panel
          className={isFolder ? 'create-panel-folder' : 'create-panel-file'}
          role="dialog"
          aria-modal="true"
          aria-label={isFolder ? '新建文件夹' : '新建文件'}
        >
          <div className="create-header">
            <div className="create-title">{isFolder ? '新建文件夹' : '新建文件'}</div>
            <button className="create-close" type="button" aria-label="关闭" onClick={onCancel}>
              <IconCrossStroked size="small" />
            </button>
          </div>
          <div className="create-fields">
            <div className="create-field">
              <div className="create-field-label">{isFolder ? '文件夹名称' : '文件名称'}</div>
              <Input
                placeholder={isFolder ? '请输入文件夹名称' : '请输入文件名称'}
                value={name}
                onChange={onNameChange}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onConfirm();
                  }
                }}
                autoFocus
              />
            </div>
            {!isFolder && (
              <div className="create-field">
                <div id="directory-create-storage-provider-label" className="create-field-label">
                  存储桶
                </div>
                <Select
                  aria-labelledby="directory-create-storage-provider-label"
                  arrowIcon={<IconChevronDownStroked size="small" />}
                  className="provider-select"
                  dropdownClassName="directory-tree-storage-provider-dropdown"
                  value={selectedProvider}
                  loading={providerLoading}
                  disabled={providerLoading || providers.length === 0}
                  placeholder={providerLoading ? '正在加载存储桶' : '选择存储桶'}
                  size="small"
                  dropdownStyle={{ maxHeight: 180, overflowY: 'auto' }}
                  onChange={(value) => onProviderChange?.(String(value || ''))}
                  renderSelectedItem={renderSelectedProvider}
                >
                  {providers.map((provider) => (
                    <Select.Option key={provider.alias} value={provider.alias} showTick={false}>
                      <StorageProviderOption>
                        {formatStorageProviderAlias(provider, defaultProvider)}
                      </StorageProviderOption>
                    </Select.Option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div className="create-actions">
            <button
              className="create-action create-action-secondary"
              type="button"
              disabled={loading}
              onClick={onCancel}
            >
              取消
            </button>
            <button
              className="create-action create-action-primary"
              type="button"
              disabled={loading || (!isFolder && providerLoading)}
              onClick={onConfirm}
            >
              确定
            </button>
          </div>
        </Panel>
      </Overlay>
    </>
  );
};

export default CreateNodeModal;
