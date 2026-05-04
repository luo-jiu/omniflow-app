import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import styled, { createGlobalStyle } from 'styled-components';
import type { NodePropertiesOverlaySection } from '@/service/overlay/types';

interface NodePropertiesModalProps {
  chips: string[];
  fullName: string;
  path: string;
  sections: NodePropertiesOverlaySection[];
  title: string;
  visible: boolean;
  onClose: () => void;
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 9px;
  color: var(--semi-color-text-0);

  .properties-hero {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .properties-name {
    font-size: 17px;
    line-height: 1.25;
    font-weight: 700;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-path {
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-fill-0);
  }

  .properties-path-label {
    font-size: 11px;
    line-height: 1.35;
    font-weight: 600;
    color: var(--semi-color-text-1);
    margin-bottom: 2px;
  }

  .properties-path-value {
    font-size: 12px;
    line-height: 1.45;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .properties-card {
    border-radius: 7px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
    padding: 10px 12px;
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

  .properties-field-chip {
    display: inline-flex;
    align-items: center;
    min-height: 21px;
    max-width: 100%;
    padding: 1px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-primary) 10%, var(--semi-color-fill-0) 90%);
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 24%, var(--semi-color-border) 76%);
    color: var(--semi-color-primary);
    font-size: 11px;
    line-height: 1.35;
    font-weight: 600;
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
    border-radius: 8px;
  }

  .node-properties-modal .semi-modal-header {
    margin: 0;
    padding: 15px 18px 5px;
  }

  .node-properties-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.3;
    font-weight: 700;
  }

  .node-properties-modal .semi-modal-close {
    top: 12px;
    right: 13px;
  }

  .node-properties-modal .semi-modal-body {
    padding: 0 18px 13px !important;
  }

  .node-properties-modal .semi-modal-footer {
    margin: 0;
    padding: 0 18px 15px;
  }

  .node-properties-modal .semi-button {
    height: 28px;
    min-width: 64px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
  }
`;

const CHIP_FIELD_LABELS = new Set(['所属类型', '内置类型', '归档模式']);

const NodePropertiesModal: React.FC<NodePropertiesModalProps> = ({
  fullName,
  path,
  sections,
  title,
  visible,
  onClose,
}) => {
  return (
    <>
      <ModalStyle />
      <Modal
        className="node-properties-modal"
        title={title}
        visible={visible}
        onCancel={onClose}
        onOk={onClose}
        okText="关闭"
        cancelButtonProps={{ style: { display: 'none' } }}
        centered
        width={520}
        maskClosable
      >
        <Content>
          <div className="properties-hero">
            <div className="properties-name">{fullName || '-'}</div>
          </div>

          <div className="properties-path">
            <div className="properties-path-label">位置</div>
            <div className="properties-path-value">{path || '-'}</div>
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
                        {CHIP_FIELD_LABELS.has(item.label) ? (
                          <span className="properties-field-chip">{item.value || '-'}</span>
                        ) : (
                          item.value || '-'
                        )}
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
