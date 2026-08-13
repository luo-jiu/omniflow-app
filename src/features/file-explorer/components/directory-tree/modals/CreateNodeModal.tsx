import React from 'react';
import { Input, Select } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import type { OverlayStorageProvider } from '@/service/overlay/types';

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
    margin-bottom: 16px;
  }

  .create-title {
    color: var(--semi-color-text-0);
    font-size: 18px;
    font-weight: 700;
    line-height: 1.25;
  }

  .create-close {
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
    font-size: 24px;
    line-height: 1;
  }

  .create-close:hover {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
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
    height: 42px;
    max-height: 42px !important;
    overflow: hidden !important;
  }

  .provider-select .semi-select-selection {
    height: 42px;
    min-height: 42px;
    max-height: 42px;
    align-items: center;
    overflow: hidden !important;
    padding-top: 4px;
    padding-bottom: 4px;
  }

  .provider-selected,
  .provider-option {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  .provider-selected-title,
  .provider-option-title {
    min-width: 0;
    overflow: hidden;
    color: var(--semi-color-text-0);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .provider-selected-meta,
  .provider-option-meta {
    min-width: 0;
    overflow: hidden;
    color: var(--semi-color-text-2);
    font-size: 10px;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
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
      return selectedProvider || '选择存储位置';
    }
    return (
      <div className="provider-selected">
        <div className="provider-selected-title">
          {selectedProviderInfo.label || selectedProviderInfo.alias}
          {selectedProviderInfo.alias === defaultProvider ? '（默认）' : ''}
        </div>
        <div className="provider-selected-meta">
          {selectedProviderInfo.alias} · {selectedProviderInfo.endpoint} · {selectedProviderInfo.bucket}
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
    <Overlay role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label={isFolder ? '新建文件夹' : '新建文件'}>
        <div className="create-header">
          <div className="create-title">{isFolder ? '新建文件夹' : '新建文件'}</div>
          <button className="create-close" type="button" aria-label="关闭" onClick={onCancel}>
            ×
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
            <>
              <div className="create-field">
                <div className="create-field-label">存储位置</div>
                <Select
                  className="provider-select"
                  value={selectedProvider}
                  loading={providerLoading}
                  disabled={providerLoading || providers.length === 0}
                  placeholder={providerLoading ? '正在加载存储位置' : '选择存储位置'}
                  size="small"
                  dropdownStyle={{ maxHeight: 180, overflowY: 'auto' }}
                  onChange={(value) => onProviderChange?.(String(value || ''))}
                  renderSelectedItem={renderSelectedProvider}
                >
                  {providers.map((provider) => (
                    <Select.Option key={provider.alias} value={provider.alias}>
                      <div className="provider-option">
                        <div className="provider-option-title">
                          {provider.label || provider.alias}
                          {provider.alias === defaultProvider ? '（默认）' : ''}
                        </div>
                        <div className="provider-option-meta">
                          {provider.alias} · {provider.endpoint} · {provider.bucket}
                        </div>
                      </div>
                    </Select.Option>
                  ))}
                </Select>
              </div>
            </>
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
  );
};

export default CreateNodeModal;
