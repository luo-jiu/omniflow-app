import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import styled from 'styled-components';
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
  gap: 14px;
  color: var(--semi-color-text-0);

  .properties-hero {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .properties-name {
    font-size: 28px;
    line-height: 1.2;
    font-weight: 700;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-path {
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-fill-0);
  }

  .properties-path-label {
    font-size: 16px;
    line-height: 1.45;
    font-weight: 600;
    color: var(--semi-color-text-1);
    margin-bottom: 3px;
  }

  .properties-path-value {
    font-size: 16px;
    line-height: 1.45;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .properties-card {
    border-radius: 10px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
    padding: 14px 16px;
  }

  .properties-card-title {
    font-size: 20px;
    line-height: 1.3;
    font-weight: 700;
    color: var(--semi-color-text-0);
    margin-bottom: 10px;
  }

  .properties-fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .properties-field {
    display: grid;
    grid-template-columns: minmax(110px, 132px) minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }

  .properties-field-label {
    font-size: 16px;
    line-height: 1.45;
    color: var(--semi-color-text-2);
  }

  .properties-field-value {
    min-width: 0;
    font-size: 17px;
    line-height: 1.45;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-field-chip {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    max-width: 100%;
    padding: 2px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-primary) 10%, var(--semi-color-fill-0) 90%);
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 24%, var(--semi-color-border) 76%);
    color: var(--semi-color-primary);
    font-size: 16px;
    line-height: 1.45;
    font-weight: 600;
    word-break: break-word;
  }

  @media (max-width: 960px) {
    .properties-name {
      font-size: 24px;
    }

    .properties-field-value {
      font-size: 16px;
    }
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
    <Modal
      title={title}
      visible={visible}
      onCancel={onClose}
      onOk={onClose}
      okText="关闭"
      cancelButtonProps={{ style: { display: 'none' } }}
      centered
      width={720}
      maskClosable
      bodyStyle={{
        padding: '6px 24px 22px',
      }}
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
  );
};

export default NodePropertiesModal;
