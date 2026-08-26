import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { IconCrossStroked } from '@douyinfe/semi-icons';
import styled, { createGlobalStyle } from 'styled-components';
import {
  getDirectoryBuiltInIcon,
  getFileNodeIconByParentBuiltInType,
} from '@/features/file-explorer/utils/file-node-icon';
import type {
  NodePropertiesOverlayIcon,
  NodePropertiesOverlaySection,
} from '@/service/overlay/types';
import { DirectoryTreeCompactModalStyle } from './compact-modal-style';

interface NodePropertiesModalProps {
  fullName: string;
  icon: NodePropertiesOverlayIcon;
  sections: NodePropertiesOverlaySection[];
  title: string;
  visible: boolean;
  onClose: () => void;
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  color: var(--semi-color-text-0);

  .properties-hero {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
  }

  .properties-hero::after {
    position: absolute;
    right: 12px;
    bottom: 0;
    left: 12px;
    height: 1px;
    background: var(--semi-color-border);
    content: '';
  }

  .properties-name-icon {
    display: inline-flex;
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    align-items: center;
    justify-content: center;
  }

  .properties-name-icon .tree-file-type-icon {
    width: 18px;
    height: 18px;
    object-fit: contain;
  }

  .properties-name {
    min-width: 0;
    font-size: 17px;
    line-height: 1.25;
    font-weight: 700;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-grid {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .properties-card {
    position: relative;
    padding: 10px 12px;
  }

  .properties-card + .properties-card::before {
    position: absolute;
    top: 0;
    right: 12px;
    left: 12px;
    height: 1px;
    background: var(--semi-color-border);
    content: '';
  }

  .properties-card-title {
    font-size: 13px;
    line-height: 1.25;
    font-weight: 700;
    color: var(--semi-color-text-0);
    margin-bottom: 8px;
  }

  .properties-fields {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .properties-field {
    display: grid;
    grid-template-columns: minmax(72px, 92px) minmax(0, 1fr);
    gap: 10px;
    align-items: start;
  }

  .properties-field-label {
    font-size: 11px;
    line-height: 1.45;
    color: var(--semi-color-text-2);
  }

  .properties-field-value {
    min-width: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  @media (max-width: 960px) {
    .properties-name {
      font-size: 16px;
    }

    .properties-field-value {
      font-size: 12px;
    }
  }
`;

const ModalStyle = createGlobalStyle`
  .node-properties-modal .semi-modal-content {
    padding-right: 0;
    padding-left: 0;
    border-radius: 8px;
  }

  .node-properties-modal .semi-modal-header {
    min-height: 44px;
    margin: 0;
    padding: 14px 44px 8px 18px !important;
  }

  .node-properties-modal .semi-modal-title {
    font-size: 18px;
    line-height: 1.25;
    font-weight: 700;
  }

  .node-properties-modal .semi-modal-body {
    padding: 0 18px 9px !important;
  }

  .node-properties-modal .semi-modal-footer {
    display: none;
  }
`;

const NodePropertiesModal: React.FC<NodePropertiesModalProps> = ({
  fullName,
  icon,
  sections,
  title,
  visible,
  onClose,
}) => {
  const nodeIcon = icon.nodeType === 'dir'
    ? getDirectoryBuiltInIcon(icon.builtInType, icon.archiveMode, false)
    : getFileNodeIconByParentBuiltInType(
      icon.ext,
      icon.parentBuiltInType,
      icon.parentArchiveMode,
      icon.fileName,
      { mimeType: icon.mimeType },
    );

  return (
    <>
      <DirectoryTreeCompactModalStyle />
      <ModalStyle />
      <Modal
        className="directory-tree-compact-modal node-properties-modal"
        closeIcon={<IconCrossStroked size="small" />}
        title={title}
        visible={visible}
        onCancel={onClose}
        footer={null}
        centered
        width={520}
        maskClosable
      >
        <Content>
          <div className="properties-hero">
            <span className="properties-name-icon" aria-hidden="true">{nodeIcon}</span>
            <div className="properties-name">{fullName || '-'}</div>
          </div>

          <div className="properties-grid">
            {sections.map((section) => (
              <div key={section.title} className="properties-card">
                <div className="properties-card-title">{section.title}</div>
                <div className="properties-fields">
                  {section.items.map((item) => (
                    <div key={`${section.title}-${item.label}`} className="properties-field">
                      <div className="properties-field-label">{item.label}</div>
                      <div className="properties-field-value">
                        {item.value || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Content>
      </Modal>
    </>
  );
};

export default NodePropertiesModal;
