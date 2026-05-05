import React from 'react';
import { Modal, Select } from '@douyinfe/semi-ui';
import { IconFile, IconFolder } from '@douyinfe/semi-icons';
import styled from 'styled-components';
import { formatSize } from '@/utils/formatSize';
import { DirectoryTreeCompactModalStyle } from './compact-modal-style';
import type {
  OverlayFileSummary,
  OverlayStorageProvider,
  OverlayTargetNode,
} from '@/service/overlay/types';

interface UploadConfirmModalProps {
  defaultProvider: string;
  visible: boolean;
  fileSummaries: OverlayFileSummary[];
  providers: OverlayStorageProvider[];
  targetNode: OverlayTargetNode | null;
  loading?: boolean;
  onConfirm: (storageProvider: string) => void;
  onCancel: () => void;
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 1px 0 2px;

  .upload-summary {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .upload-info-card {
    min-width: 0;
    border: 1px solid var(--semi-color-border);
    border-radius: 7px;
    padding: 9px 12px;
    background: var(--semi-color-fill-0);
  }

  .upload-info-label {
    font-size: 11px;
    line-height: 1.35;
    color: var(--semi-color-text-2);
  }

  .upload-info-value {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--semi-color-text-0);
    word-break: break-word;
  }

  .provider-select {
    width: 100%;
    margin-top: 8px;
  }

  .provider-select.semi-select,
  .provider-select .semi-select {
    height: 46px;
    max-height: 46px !important;
    overflow: hidden !important;
  }

  .provider-select.semi-select::-webkit-scrollbar,
  .provider-select .semi-select::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .provider-select .semi-select-selection {
    height: 46px;
    min-height: 46px;
    max-height: 46px;
    align-items: center;
    overflow: hidden !important;
    padding-top: 5px;
    padding-bottom: 5px;
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
    white-space: normal;
    line-height: 1.35;
  }

  .provider-select .semi-select-selection-text::-webkit-scrollbar {
    display: none;
  }

  .provider-select .semi-select-arrow {
    align-self: center;
  }

  .provider-option {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
    padding: 4px 0;
  }

  .provider-option-title {
    min-width: 0;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.35;
    color: var(--semi-color-text-0);
  }

  .provider-option-meta {
    min-width: 0;
    word-break: break-word;
    font-size: 11px;
    line-height: 1.35;
    color: var(--semi-color-text-2);
  }

  .provider-selected {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
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

  .provider-selected-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    line-height: 1.25;
    color: var(--semi-color-text-2);
  }

  .file-list {
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--semi-color-border);
    border-radius: 7px;
    padding: 4px 8px;
    background: var(--semi-color-bg-0);
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
    color: var(--semi-color-text-0);
  }

  .file-name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--semi-color-text-2);
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
  providers,
  targetNode,
  loading,
  onConfirm,
  onCancel,
}) => {
  const containsFolderStructure = fileSummaries.some(item => (item.relativePath || '').includes('/'));
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
  const renderSelectedProvider = React.useCallback(() => {
    if (!selectedProviderInfo) {
      return selectedProvider || '选择存储 Provider';
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

  return (
    <>
      <DirectoryTreeCompactModalStyle />
      <Modal
        className="directory-tree-compact-modal"
        title={containsFolderStructure ? '文件夹上传确认' : '文件上传确认'}
        visible={visible}
        onOk={() => onConfirm(selectedProvider)}
        onCancel={onCancel}
        confirmLoading={Boolean(loading)}
        okText="确定上传"
        cancelText="取消"
        maskClosable={false}
        centered
        width={560}
      >
        {fileSummaries.length > 0 && targetNode && (
          <Content>
            <div className="upload-summary">
              <div className="upload-info-card">
                <div className="upload-info-label">上传目录</div>
                <div className="upload-info-value">{targetNode.label}</div>
              </div>
              <div className="upload-info-card">
                <div className="upload-info-label">存储位置</div>
                <Select
                  className="provider-select"
                  value={selectedProvider}
                  disabled={providers.length === 0}
                  placeholder="选择存储 Provider"
                  size="small"
                  dropdownStyle={{ maxHeight: 180, overflowY: 'auto' }}
                  onChange={(value) => setSelectedProvider(String(value || ''))}
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
            </div>

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

            <div className="upload-footer">
              共 {summaryItems.folders.length} 个文件夹、{summaryItems.files.length} 个文件、{fileSummaries.length} 个上传任务，
              总大小 {formatSize(totalBytes)}。
            </div>
          </Content>
        )}
      </Modal>
    </>
  );
};

export default UploadConfirmModal;
