import React from 'react';
import styled from 'styled-components';

interface DeleteConfirmModalProps {
  deleteCount: number;
  isFolder: boolean;
  nodeName: string;
  onCancel: () => void;
  onConfirm: () => void;
  visible: boolean;
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
  border: 1px solid var(--app-border-strong, rgba(255, 255, 255, 0.14));
  border-radius: 10px;
  background: var(--app-bg-elevated, var(--semi-color-bg-1, #2a2a2a));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  padding: 16px 18px 16px;

  .delete-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .delete-title {
    color: var(--semi-color-text-0);
    font-size: 18px;
    font-weight: 700;
    line-height: 1.25;
  }

  .delete-close {
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text, var(--semi-color-text-0));
    cursor: pointer;
    font-size: 24px;
    line-height: 1;
  }

  .delete-close:hover {
    background: color-mix(in srgb, var(--app-text, #e8e8e8) 8%, transparent);
  }

  .delete-desc {
    color: var(--semi-color-text-1);
    font-size: 12px;
    line-height: 1.5;
  }

  .delete-target {
    margin-top: 10px;
    border: 1px solid rgba(226, 72, 72, 0.32);
    border-radius: 8px;
    padding: 9px 10px;
    background: rgba(226, 72, 72, 0.1);
    color: var(--semi-color-text-0);
    font-size: 12px;
    line-height: 1.45;
    word-break: break-word;
  }

  body[theme-mode="dark"] & .delete-target {
    border-color: rgba(255, 120, 120, 0.36);
    background: rgba(255, 120, 120, 0.14);
  }

  .delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  .delete-action {
    min-width: 58px;
    height: 30px;
    border: 0;
    border-radius: 7px;
    padding: 0 12px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .delete-action-secondary {
    background: var(--semi-color-fill-2);
    color: var(--semi-color-text-0);
  }

  .delete-action-danger {
    min-width: 86px;
    background: #e24848;
    color: #fff;
  }
`;

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  deleteCount,
  isFolder,
  nodeName,
  onCancel,
  onConfirm,
  visible,
}) => {
  const isBatch = deleteCount > 1;
  const targetText = isBatch
    ? `选中的 ${deleteCount} 项`
    : `「${nodeName || (isFolder ? '文件夹' : '文件')}」`;

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
      <Panel role="dialog" aria-modal="true" aria-label="确认删除">
        <div className="delete-header">
          <div className="delete-title">确认删除</div>
          <button className="delete-close" type="button" aria-label="关闭" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="delete-desc">删除后内容会进入回收站，可以在回收站中恢复或彻底删除。</div>
        <div className="delete-target">{targetText}</div>
        <div className="delete-actions">
          <button className="delete-action delete-action-secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="delete-action delete-action-danger" type="button" onClick={onConfirm}>
            移入回收站
          </button>
        </div>
      </Panel>
    </Overlay>
  );
};

export default DeleteConfirmModal;
