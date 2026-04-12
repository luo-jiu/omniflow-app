import React from 'react';
import { Empty, Modal, Spin } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import { getChildrenByNodeId, getLibraryRootNodeId } from '@/features/file-explorer/services/file.api';
import type { EmbeddedBrowserDownloadEvent, LibraryFolderEntry } from '../types';

type FolderCrumb = LibraryFolderEntry;

interface EmbeddedBrowserDownloadImportModalProps {
  download: EmbeddedBrowserDownloadEvent | null;
  importLoading: boolean;
  savingLoading: boolean;
  libraryId: number;
  onCancel: () => void;
  onConfirm: (target: LibraryFolderEntry) => void;
  onSaveToDesktop: () => void;
}

const BrowserDownloadImportModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding-top: 2px;

  .download-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .download-file-name {
    color: var(--app-text);
    font-size: 16px;
    font-weight: 600;
    line-height: 1.4;
    word-break: break-all;
  }

  .download-file-desc {
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.5;
    word-break: break-all;
  }

  .folder-breadcrumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .crumb-btn {
    height: 28px;
    border: none;
    border-radius: 8px;
    padding: 0 10px;
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text-secondary);
    cursor: pointer;
    font-size: 12px;
  }

  .crumb-btn[data-current='true'] {
    background: rgba(var(--semi-blue-5), 0.12);
    color: var(--semi-color-primary);
  }

  .crumb-sep {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .folder-panel {
    min-height: 340px;
    max-height: 340px;
    overflow: auto;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    padding: 10px;
  }

  .folder-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .folder-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
    padding: 11px 12px;
    text-align: left;
  }

  .folder-row:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .folder-row-name {
    min-width: 0;
    flex: 1;
    font-size: 14px;
    line-height: 1.4;
    word-break: break-all;
  }

  .folder-row-arrow {
    color: var(--app-text-muted);
    font-size: 13px;
    flex-shrink: 0;
  }
`;

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPageSource(url?: string) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) {
    return '内置浏览器';
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./i, '') || '内置浏览器';
  } catch {
    return '内置浏览器';
  }
}

const EmbeddedBrowserDownloadImportModal: React.FC<EmbeddedBrowserDownloadImportModalProps> = ({
  download,
  importLoading,
  savingLoading,
  libraryId,
  onCancel,
  onConfirm,
  onSaveToDesktop,
}) => {
  const [rootFolder, setRootFolder] = React.useState<FolderCrumb | null>(null);
  const [folderStack, setFolderStack] = React.useState<FolderCrumb[]>([]);
  const [folderMap, setFolderMap] = React.useState<Record<number, FolderCrumb[]>>({});
  const [loading, setLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  const visible = Boolean(download);
  const currentFolder = folderStack[folderStack.length - 1] ?? rootFolder;
  const currentFolders = currentFolder ? (folderMap[currentFolder.id] || []) : [];

  const loadFolderChildren = React.useCallback(async (folderId: number) => {
    const children = await getChildrenByNodeId(folderId, libraryId);
    const nextFolders = children
      .filter((item) => item.type === 'dir')
      .map((item) => ({
        id: Number(item.id),
        name: String(item.name || '未命名文件夹'),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    setFolderMap((prev) => ({ ...prev, [folderId]: nextFolders }));
  }, [libraryId]);

  React.useEffect(() => {
    if (!visible) {
      setRootFolder(null);
      setFolderStack([]);
      setFolderMap({});
      setErrorMessage('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    setRootFolder(null);
    setFolderStack([]);
    setFolderMap({});

    void (async () => {
      try {
        const rootNodeId = await getLibraryRootNodeId(libraryId);
        if (!Number.isFinite(rootNodeId) || rootNodeId <= 0) {
          throw new Error('未找到仓库根目录');
        }
        if (cancelled) {
          return;
        }
        const root = { id: Number(rootNodeId), name: '根目录' };
        setRootFolder(root);
        setFolderStack([root]);
        await loadFolderChildren(root.id);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : '目录加载失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [libraryId, loadFolderChildren, visible]);

  const handleEnterFolder = React.useCallback(async (folder: FolderCrumb) => {
    setFolderStack((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === folder.id);
      if (existingIndex >= 0) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, folder];
    });
    if (folderMap[folder.id]) {
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await loadFolderChildren(folder.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '目录加载失败');
    } finally {
      setLoading(false);
    }
  }, [folderMap, loadFolderChildren]);

  return (
    <Modal
      title="导入浏览器下载"
      visible={visible}
      okText={importLoading ? '导入中...' : '导入这里'}
      cancelText="丢弃"
      width={1040}
      centered
      style={{ maxWidth: 'calc(100vw - 48px)' }}
      bodyStyle={{ padding: '8px 20px 10px', minHeight: 480 }}
      okButtonProps={{ disabled: !currentFolder || loading || importLoading }}
      cancelButtonProps={{ disabled: importLoading || savingLoading }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <button
            type="button"
            className="semi-button semi-button-tertiary"
            disabled={importLoading || savingLoading || !download?.tempPath}
            onClick={onSaveToDesktop}
          >
            {savingLoading ? '保存中...' : '保存到本地'}
          </button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              className="semi-button semi-button-tertiary"
              disabled={importLoading || savingLoading}
              onClick={onCancel}
            >
              丢弃
            </button>
            <button
              type="button"
              className="semi-button semi-button-primary"
              disabled={!currentFolder || loading || importLoading || savingLoading}
              onClick={() => {
                if (currentFolder) {
                  onConfirm(currentFolder);
                }
              }}
            >
              {importLoading ? '导入中...' : '导入这里'}
            </button>
          </div>
        </div>
      }
      onCancel={onCancel}
    >
      <BrowserDownloadImportModalBody>
        <div className="download-meta">
          <div className="download-file-name">{download?.fileName || '未命名下载'}</div>
          <div className="download-file-desc">
            {`来源：${formatPageSource(download?.pageUrl)}`}
            {download?.totalBytes ? ` · ${formatSize(download.totalBytes)}` : ''}
          </div>
        </div>

        <div className="folder-breadcrumbs">
          {folderStack.map((folder, index) => {
            const isCurrent = index === folderStack.length - 1;
            return (
              <React.Fragment key={folder.id}>
                <button
                  type="button"
                  className="crumb-btn"
                  data-current={isCurrent}
                  onClick={() => setFolderStack(folderStack.slice(0, index + 1))}
                >
                  {folder.name}
                </button>
                {!isCurrent ? <span className="crumb-sep">/</span> : null}
              </React.Fragment>
            );
          })}
        </div>

        <div className="folder-panel">
          {loading ? (
            <Spin spinning />
          ) : errorMessage ? (
            <Empty
              image={<div />}
              title="目录加载失败"
              description={errorMessage}
            />
          ) : currentFolders.length > 0 ? (
            <div className="folder-list">
              {currentFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="folder-row"
                  onClick={() => {
                    void handleEnterFolder(folder);
                  }}
                >
                  <span className="folder-row-name">{folder.name}</span>
                  <span className="folder-row-arrow">进入</span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              image={<div />}
              title="当前目录为空"
              description="可以直接导入到这里"
            />
          )}
        </div>

      </BrowserDownloadImportModalBody>
    </Modal>
  );
};

export default EmbeddedBrowserDownloadImportModal;
