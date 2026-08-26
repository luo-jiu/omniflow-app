import React from 'react';
import { Modal, Select } from '@douyinfe/semi-ui';
import {
  IconChevronDownStroked,
  IconCrossStroked,
  IconFile,
  IconFolder,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';
import { formatSize } from '@/utils/formatSize';
import { DirectoryTreeCompactModalStyle } from './compact-modal-style';
import { formatStorageProviderAlias } from './storage-provider-display';
import {
  StorageProviderHealthDot,
  StorageProviderDropdownStyle,
  StorageProviderOption,
} from './storage-provider-option';
import type {
  OverlayFileSummary,
  OverlayStorageProvider,
  OverlayTargetNode,
} from '@/service/overlay/types';

interface UploadConfirmModalProps {
  defaultProvider: string;
  visible: boolean;
  fileSummaries: OverlayFileSummary[];
  okText?: string;
  providers: OverlayStorageProvider[];
  taskLabel?: string;
  targetLabel?: string;
  targetNode: OverlayTargetNode | null;
  title?: string;
  loading?: boolean;
  onConfirm: (storageProvider: string) => void;
  onCancel: () => void;
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0;

  .upload-info-card {
    min-width: 0;
    padding: 0;
  }

  .upload-info-label {
    font-size: 11px;
    line-height: 1.35;
    color: var(--semi-color-text-2);
  }

  .upload-info-value {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.5;
    font-weight: 600;
    color: var(--semi-color-text-0);
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .provider-select {
    width: 100%;
    margin-top: 4px;
  }

  .provider-select.semi-select,
  .provider-select .semi-select {
    height: 30px;
    max-height: 30px !important;
    overflow: hidden !important;
  }

  .provider-select.semi-select::-webkit-scrollbar,
  .provider-select .semi-select::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .provider-select .semi-select-selection {
    height: 30px;
    min-height: 30px;
    max-height: 30px;
    align-items: center;
    overflow: hidden !important;
    padding-top: 0;
    padding-bottom: 0;
  }

  .provider-select .semi-select-selection-placeholder,
  .provider-select .semi-select-selection-rendered,
  .provider-select .semi-select-selection-text,
  .provider-select .semi-select-selection span {
    overflow: hidden !important;
  }

  .provider-select .semi-select-selection-text {
    max-height: none !important;
    overflow: hidden !important;
    white-space: nowrap;
    line-height: 1.25;
  }

  .provider-select .semi-select-selection-text::-webkit-scrollbar {
    display: none;
  }

  .provider-select .semi-select-arrow {
    display: inline-flex;
    width: 24px;
    flex: 0 0 24px;
    align-self: center;
    align-items: center;
    justify-content: center;
    color: var(--semi-color-text-1);
    font-size: 12px;
  }

  .provider-selected {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 7px;
    overflow: hidden;
    padding-right: 6px;
  }

  .provider-selected-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 1.25;
    font-weight: 600;
    color: var(--semi-color-text-0);
  }

  .file-list {
    max-height: 180px;
    overflow-y: auto;
    border: 0;
    padding: 0;
    background: transparent;
  }

  .file-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 28px;
    border-bottom: 1px solid var(--semi-color-border);
    font-size: 12px;
  }

  .file-row:last-child {
    border-bottom: 0;
  }

  .file-name {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    color: var(--semi-color-text-0);
  }

  .file-name .semi-icon {
    flex: 0 0 auto;
  }

  .file-name-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--semi-color-text-2);
    white-space: nowrap;
  }

  .upload-footer {
    font-size: 12px;
    line-height: 1.45;
    color: var(--semi-color-text-1);
  }

`;

const UploadConfirmModal: React.FC<UploadConfirmModalProps> = ({
  defaultProvider,
  visible,
  fileSummaries,
  okText,
  providers,
  taskLabel,
  targetLabel,
  targetNode,
  title,
  loading,
  onConfirm,
  onCancel,
}) => {
  const containsFolderStructure = fileSummaries.some(item => (item.relativePath || '').includes('/'));
  const modalTitle = title || (containsFolderStructure ? '上传文件夹' : '上传文件');
  const confirmText = okText || '确定';
  const directoryLabel = targetLabel || '上传目录';
  const summaryTaskLabel = taskLabel || '上传任务';
  const fallbackProvider = defaultProvider || providers[0]?.alias || '';
  const [selectedProvider, setSelectedProvider] = React.useState(fallbackProvider);

  React.useEffect(() => {
    setSelectedProvider(fallbackProvider);
  }, [fallbackProvider]);

  const summaryItems = React.useMemo(() => {
    const folderMap = new Map<string, { name: string; fileCount: number; totalBytes: number }>();
    const fileItems: Array<{ key: string; name: string; totalBytes: number }> = [];

    fileSummaries.forEach((item, index) => {
      const normalizedPath = String(item.relativePath || item.name || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean);
      const firstSegment = normalizedPath[0] || item.name || `file-${index + 1}`;
      const isFolderFile = normalizedPath.length > 1;
      if (isFolderFile) {
        const current = folderMap.get(firstSegment) || {
          name: firstSegment,
          fileCount: 0,
          totalBytes: 0,
        };
        current.fileCount += 1;
        current.totalBytes += Number(item.size || 0);
        folderMap.set(firstSegment, current);
        return;
      }
      fileItems.push({
        key: `${firstSegment}-${index}`,
        name: firstSegment,
        totalBytes: Number(item.size || 0),
      });
    });

    const folders = Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    const filesList = fileItems.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return {
      folders,
      files: filesList,
    };
  }, [fileSummaries]);

  const totalBytes = React.useMemo(
    () => fileSummaries.reduce((sum, item) => sum + Number(item.size || 0), 0),
    [fileSummaries],
  );
  const selectedProviderInfo = providers.find(provider => provider.alias === selectedProvider);
  const selectedProviderStatus = selectedProviderInfo?.healthStatus || 'unknown';
  const renderSelectedProvider = React.useCallback(() => {
    if (!selectedProviderInfo) {
      return selectedProvider || '选择存储桶';
    }
    return (
      <div className="provider-selected">
        <StorageProviderHealthDot status={selectedProviderStatus} />
        <div className="provider-selected-title">
          {formatStorageProviderAlias(selectedProviderInfo, defaultProvider)}
        </div>
      </div>
    );
  }, [defaultProvider, selectedProvider, selectedProviderInfo, selectedProviderStatus]);

  return (
    <>
      <DirectoryTreeCompactModalStyle />
      <StorageProviderDropdownStyle />
      <Modal
        className="directory-tree-compact-modal directory-tree-upload-modal"
        closeIcon={<IconCrossStroked size="small" />}
        title={modalTitle}
        visible={visible}
        onOk={() => onConfirm(selectedProvider)}
        onCancel={onCancel}
        confirmLoading={Boolean(loading)}
        okButtonProps={{ disabled: !selectedProvider }}
        okText={confirmText}
        cancelText="取消"
        maskClosable={false}
        centered
        width={420}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
      >
        {fileSummaries.length > 0 && targetNode && (
          <Content>
            <div className="file-list">
              {summaryItems.folders.map((folder) => (
                <div key={`folder-${folder.name}`} className="file-row">
                  <span className="file-name">
                    <IconFolder />
                    <span className="file-name-text">{folder.name}</span>
                  </span>
                  <span className="file-meta">
                    {folder.fileCount} 个文件 · {formatSize(folder.totalBytes)}
                  </span>
                </div>
              ))}
              {summaryItems.files.map((file) => (
                <div key={file.key} className="file-row">
                  <span className="file-name">
                    <IconFile />
                    <span className="file-name-text">{file.name}</span>
                  </span>
                  <span className="file-meta">
                    {formatSize(file.totalBytes)}
                  </span>
                </div>
              ))}
            </div>

            <div className="upload-info-card">
              <div className="upload-info-label">{directoryLabel}</div>
              <div className="upload-info-value">{targetNode.path}</div>
            </div>

            <div className="upload-info-card">
              <div id="directory-upload-storage-provider-label" className="upload-info-label">
                存储桶
              </div>
              <Select
                aria-labelledby="directory-upload-storage-provider-label"
                arrowIcon={<IconChevronDownStroked size="small" />}
                className="provider-select"
                dropdownClassName="directory-tree-storage-provider-dropdown"
                value={selectedProvider}
                disabled={providers.length === 0}
                placeholder="选择存储桶"
                size="small"
                dropdownStyle={{ maxHeight: 180, overflowY: 'auto' }}
                onChange={(value) => setSelectedProvider(String(value || ''))}
                renderSelectedItem={renderSelectedProvider}
              >
                {providers.map((provider) => (
                  <Select.Option key={provider.alias} value={provider.alias} showTick={false}>
                    <StorageProviderOption>
                      <StorageProviderHealthDot status={provider.healthStatus || 'unknown'} />
                      {formatStorageProviderAlias(provider, defaultProvider)}
                    </StorageProviderOption>
                  </Select.Option>
                ))}
              </Select>
            </div>

            {containsFolderStructure && (
              <div className="upload-footer">
                共 {summaryItems.folders.length} 个文件夹、{summaryItems.files.length} 个文件、{fileSummaries.length} 个{summaryTaskLabel}，
                总大小 {formatSize(totalBytes)}。
              </div>
            )}
          </Content>
        )}
      </Modal>
    </>
  );
};

export default UploadConfirmModal;
