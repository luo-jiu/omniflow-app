import React from 'react';
import { Input } from '@douyinfe/semi-ui';
import styled from 'styled-components';

interface CreateNodeModalProps {
  visible: boolean;
  type: 'file' | 'dir' | null;
  name: string;
  loading: boolean;
  onNameChange: (value: string) => void;
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
  onNameChange,
  onConfirm,
  onCancel
}) => {
  const isFolder = type === 'dir';

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
            disabled={loading}
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
