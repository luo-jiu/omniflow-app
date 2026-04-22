import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import type { NodePropertiesOverlaySection } from '@/service/overlay/types';

interface NodePropertiesModalProps {
  chips: string[];
  fullName: string;
  path: string;
  sections: NodePropertiesOverlaySection[];
  subtitle: string;
  title: string;
  visible: boolean;
  onClose: () => void;
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-top: 6px;
  color: var(--semi-color-text-0);

  .properties-hero {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .properties-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .properties-chip {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 4px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-primary) 10%, var(--semi-color-fill-0) 90%);
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 24%, var(--semi-color-border) 76%);
    color: var(--semi-color-primary);
    font-size: 16px;
    line-height: 1.45;
    font-weight: 600;
  }

  .properties-name {
    font-size: 28px;
    line-height: 1.2;
    font-weight: 700;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-subtitle {
    font-size: 18px;
    line-height: 1.6;
    color: var(--semi-color-text-1);
  }

  .properties-path {
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-fill-0);
  }

  .properties-path-label {
    font-size: 16px;
    line-height: 1.45;
    font-weight: 600;
    color: var(--semi-color-text-1);
    margin-bottom: 6px;
  }

  .properties-path-value {
    font-size: 16px;
    line-height: 1.6;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .properties-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .properties-card {
    min-height: 180px;
    border-radius: 10px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
    padding: 18px;
  }

  .properties-card-title {
    font-size: 20px;
    line-height: 1.3;
    font-weight: 700;
    color: var(--semi-color-text-0);
    margin-bottom: 14px;
  }

  .properties-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .properties-field {
    display: grid;
    grid-template-columns: minmax(110px, 132px) minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }

  .properties-field-label {
    font-size: 16px;
    line-height: 1.6;
    color: var(--semi-color-text-2);
  }

  .properties-field-value {
    min-width: 0;
    font-size: 17px;
    line-height: 1.6;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  @media (max-width: 960px) {
    .properties-grid {
      grid-template-columns: 1fr;
    }

    .properties-name {
      font-size: 24px;
    }

    .properties-subtitle,
    .properties-field-value {
      font-size: 16px;
    }
  }
`;

const NodePropertiesModal: React.FC<NodePropertiesModalProps> = ({
  chips,
  fullName,
  path,
  sections,
  subtitle,
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
      width={820}
      maskClosable
      bodyStyle={{
        padding: '24px 28px 28px',
      }}
    >
      <Content>
        <div className="properties-hero">
          {chips.length > 0 ? (
            <div className="properties-chips">
              {chips.map((chip) => (
                <span key={chip} className="properties-chip">{chip}</span>
              ))}
            </div>
          ) : null}
          <div className="properties-name">{fullName || '-'}</div>
          <div className="properties-subtitle">{subtitle}</div>
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
                    <div className="properties-field-value">{item.value || '-'}</div>
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
