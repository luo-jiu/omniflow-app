import React from 'react';
import styled from 'styled-components';
import { Empty, Modal, Spin } from '@douyinfe/semi-ui';
import { IconFile, IconFolder } from '@douyinfe/semi-icons';

import {
  getChildrenByNodeId,
  getLibraryRootNodeId,
} from '@/features/file-explorer/services/file.api';

export type LibraryNodePickerDisplayMode = 'folders' | 'files' | 'all';

export type LibraryNodePickerNode = {
  ext?: string;
  id: number;
  libraryId: number;
  name: string;
  parentId: number;
  type: 'dir' | 'file';
};

export type LibraryNodePickerSelection = {
  breadcrumb: Array<{ id: number; name: string }>;
  node: LibraryNodePickerNode;
  pathLabel: string;
};

interface LibraryNodePickerModalProps {
  cancelText?: string;
  confirmText?: string;
  displayMode: LibraryNodePickerDisplayMode;
  libraryId: number;
  title?: string;
  visible: boolean;
  onCancel: () => void;
  onConfirm: (selection: LibraryNodePickerSelection) => void;
}

const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding-top: 4px;

  .breadcrumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .crumb-btn {
    height: 30px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 0 10px;
    background: color-mix(in srgb, var(--app-bg-elevated) 92%, transparent);
    color: var(--app-text);
    cursor: pointer;
    font-size: 12px;
  }

  .crumb-btn[data-current='true'] {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
    color: var(--semi-color-primary);
  }

  .crumb-sep {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .node-panel {
    min-height: 420px;
    max-height: 420px;
    overflow: auto;
    border: 1px solid var(--app-border);
    border-radius: 10px;
    background: var(--app-bg-elevated);
    padding: 10px;
  }

  .node-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .node-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
    padding: 10px 12px;
    text-align: left;
  }

  .node-row:hover {
    background: color-mix(in srgb, var(--app-bg) 80%, transparent);
  }

  .node-row[data-selected='true'] {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
  }

  .node-label {
    min-width: 0;
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .node-kind-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    color: var(--app-text-muted);
  }

  .node-kind-icon.is-dir {
    color: var(--semi-color-primary);
  }

  .node-name {
    min-width: 0;
    font-size: 14px;
    line-height: 1.4;
    word-break: break-all;
  }

  .node-action {
    flex-shrink: 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }
`;

function normalizePickerNode(input: any, libraryId: number): LibraryNodePickerNode | null {
  const id = Number(input?.id || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  const type = String(input?.type || '').trim().toLowerCase();
  const normalizedType = type === 'dir' || type === 'directory' || type === 'folder' || type === '0'
    ? 'dir'
    : 'file';
  const parentId = Number(input?.parentId ?? input?.parent_id ?? 0);
  const nodeLibraryId = Number(input?.libraryId ?? input?.library_id ?? libraryId);
  return {
    ext: input?.ext ? String(input.ext) : undefined,
    id,
    libraryId: Number.isFinite(nodeLibraryId) && nodeLibraryId > 0 ? nodeLibraryId : libraryId,
    name: String(input?.name || (normalizedType === 'dir' ? `目录 ${id}` : `文件 ${id}`)),
    parentId: Number.isFinite(parentId) ? parentId : 0,
    type: normalizedType,
  };
}

function sortPickerNodes(nodes: LibraryNodePickerNode[]) {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

function buildPickerPathLabel(
  breadcrumb: Array<{ id: number; name: string }>,
  targetNode: LibraryNodePickerNode,
) {
  const names = breadcrumb.map((item) => item.name);
  const currentCrumb = breadcrumb[breadcrumb.length - 1];
  if (!currentCrumb || currentCrumb.id !== targetNode.id) {
    names.push(targetNode.name);
  }
  const normalizedSegments = names
    .filter(Boolean)
    .filter((segment, index) => !(
      index === 0 && (segment === '/' || segment.toLowerCase() === 'root')
    ));
  if (normalizedSegments.length === 0) {
    return '/';
  }
  return `/${normalizedSegments.join('/')}`;
}

function matchDisplayMode(
  node: LibraryNodePickerNode,
  displayMode: LibraryNodePickerDisplayMode,
) {
  if (displayMode === 'all') {
    return true;
  }
  if (displayMode === 'folders') {
    return node.type === 'dir';
  }
  // In `files` mode we still keep folders visible for navigation, but folders remain non-selectable.
  return true;
}

function isSelectableNode(node: LibraryNodePickerNode, displayMode: LibraryNodePickerDisplayMode) {
  if (displayMode === 'all') {
    return true;
  }
  if (displayMode === 'folders') {
    return node.type === 'dir';
  }
  return node.type === 'file';
}

const LibraryNodePickerModal: React.FC<LibraryNodePickerModalProps> = ({
  cancelText = '取消',
  confirmText = '确定',
  displayMode,
  libraryId,
  onCancel,
  onConfirm,
  title = '选择节点',
  visible,
}) => {
  const [breadcrumbs, setBreadcrumbs] = React.useState<Array<{ id: number; name: string }>>([]);
  const [childrenMap, setChildrenMap] = React.useState<Record<number, LibraryNodePickerNode[]>>({});
  const [selectedNodeId, setSelectedNodeId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  const loadChildren = React.useCallback(async (folderId: number) => {
    const children = await getChildrenByNodeId(folderId, libraryId);
    const normalized = sortPickerNodes(
      children
        .map((item) => normalizePickerNode(item, libraryId))
        .filter((item): item is LibraryNodePickerNode => Boolean(item)),
    );
    setChildrenMap((prev) => ({
      ...prev,
      [folderId]: normalized,
    }));
  }, [libraryId]);

  React.useEffect(() => {
    if (!visible) {
      setBreadcrumbs([]);
      setChildrenMap({});
      setSelectedNodeId(null);
      setLoading(false);
      setErrorMessage('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    setSelectedNodeId(null);
    setChildrenMap({});

    void (async () => {
      try {
        const rootNodeId = await getLibraryRootNodeId(libraryId);
        if (!Number.isFinite(rootNodeId) || rootNodeId <= 0) {
          throw new Error('未找到仓库根目录');
        }
        const root: LibraryNodePickerNode = {
          id: Number(rootNodeId),
          libraryId,
          name: 'root',
          parentId: 0,
          type: 'dir',
        };
        if (cancelled) {
          return;
        }
        setBreadcrumbs([{ id: root.id, name: root.name }]);
        await loadChildren(root.id);
      } catch (error: any) {
        if (cancelled) {
          return;
        }
        setErrorMessage(error?.message || '目录加载失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [libraryId, loadChildren, visible]);

  const currentCrumb = breadcrumbs[breadcrumbs.length - 1] ?? null;
  const currentNodes = currentCrumb ? (childrenMap[currentCrumb.id] || []) : [];
  const visibleNodes = currentNodes.filter((node) => matchDisplayMode(node, displayMode));
  const selectedNode = currentNodes.find((node) => node.id === selectedNodeId) || null;

  const confirmNode = React.useMemo(() => {
    if (selectedNode && isSelectableNode(selectedNode, displayMode)) {
      return selectedNode;
    }
    if (displayMode === 'folders' && currentCrumb) {
      return {
        id: currentCrumb.id,
        libraryId,
        name: currentCrumb.name,
        parentId: breadcrumbs[breadcrumbs.length - 2]?.id || 0,
        type: 'dir' as const,
      };
    }
    return null;
  }, [breadcrumbs, currentCrumb, displayMode, libraryId, selectedNode]);

  const enterDirectory = React.useCallback(async (node: LibraryNodePickerNode) => {
    if (node.type !== 'dir') {
      return;
    }
    setSelectedNodeId(null);
    setBreadcrumbs((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === node.id);
      if (existingIndex >= 0) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, { id: node.id, name: node.name }];
    });
    if (childrenMap[node.id]) {
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await loadChildren(node.id);
    } catch (error: any) {
      setErrorMessage(error?.message || '目录加载失败');
    } finally {
      setLoading(false);
    }
  }, [childrenMap, loadChildren]);

  return (
    <Modal
      title={title}
      visible={visible}
      width={1080}
      centered
      style={{ maxWidth: 'calc(100vw - 48px)' }}
      bodyStyle={{ minHeight: 540, padding: '10px 20px 14px' }}
      okText={confirmText}
      cancelText={cancelText}
      okButtonProps={{ disabled: !confirmNode || loading }}
      onCancel={onCancel}
      onOk={() => {
        if (!confirmNode) {
          return;
        }
        const currentPath = [...breadcrumbs];
        if (!currentPath.length || currentPath[currentPath.length - 1]?.id !== confirmNode.id) {
          currentPath.push({ id: confirmNode.id, name: confirmNode.name });
        }
        onConfirm({
          breadcrumb: currentPath,
          node: confirmNode,
          pathLabel: buildPickerPathLabel(currentPath, confirmNode),
        });
      }}
    >
      <ModalBody>
        <div className="breadcrumbs">
          {breadcrumbs.map((crumb, index) => {
            const isCurrent = index === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.id}>
                <button
                  type="button"
                  className="crumb-btn"
                  data-current={isCurrent}
                  onClick={() => {
                    setSelectedNodeId(null);
                    setBreadcrumbs(breadcrumbs.slice(0, index + 1));
                  }}
                >
                  {crumb.name}
                </button>
                {!isCurrent ? <span className="crumb-sep">/</span> : null}
              </React.Fragment>
            );
          })}
        </div>

        <div className="node-panel">
          {loading ? (
            <Spin spinning />
          ) : errorMessage ? (
            <Empty
              image={<div />}
              title="目录加载失败"
              description={errorMessage}
            />
          ) : visibleNodes.length > 0 ? (
            <div className="node-list">
              {visibleNodes.map((node) => (
                <button
                  type="button"
                  key={node.id}
                  className="node-row"
                  data-selected={selectedNodeId === node.id}
                  onClick={() => {
                    if (!isSelectableNode(node, displayMode)) {
                      return;
                    }
                    setSelectedNodeId(node.id);
                  }}
                  onDoubleClick={() => {
                    if (node.type === 'dir') {
                      void enterDirectory(node);
                    }
                  }}
                >
                  <span className="node-label">
                    <span className={`node-kind-icon ${node.type === 'dir' ? 'is-dir' : ''}`}>
                      {node.type === 'dir' ? <IconFolder /> : <IconFile />}
                    </span>
                    <span className="node-name">
                      {node.type === 'file' && node.ext ? `${node.name}.${node.ext}` : node.name}
                    </span>
                  </span>
                  <span className="node-action">
                    {node.type === 'dir' ? '双击进入' : '可选择'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              image={<div />}
              title="当前目录没有可显示节点"
              description={displayMode === 'folders' ? '可以直接选择当前目录' : '请切换到其他目录继续查找'}
            />
          )}
        </div>
      </ModalBody>
    </Modal>
  );
};

export default LibraryNodePickerModal;
