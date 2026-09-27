import React from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { Empty, Modal, Spin } from '@douyinfe/semi-ui';
import OutlineIcon from '@/components/ui/outline-icon';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

import {
  fetchNodeDetailById,
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
  initialNodeId?: number | null;
  libraryId: number;
  title?: string;
  visible: boolean;
  onCancel: () => void;
  onConfirm: (selection: LibraryNodePickerSelection) => void;
}

const PickerModalStyle = createGlobalStyle`
  .library-node-picker-modal {
    width: min(620px, calc(100vw - 32px)) !important;
    max-width: calc(100vw - 32px) !important;
  }

  .library-node-picker-modal .semi-modal-content {
    width: 100%;
    box-sizing: border-box;
    padding: 0 !important;
    border: 1px solid var(--app-border-strong);
    border-radius: 10px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
    overflow: hidden;
  }

  .library-node-picker-modal .semi-modal-header {
    margin: 0;
    padding: 14px 16px 8px !important;
  }

  .library-node-picker-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .library-node-picker-modal .semi-modal-close {
    top: 13px;
    right: 14px;
    color: var(--app-text-muted);
  }

  .library-node-picker-modal .semi-modal-close:hover {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  .library-node-picker-modal .semi-modal-body {
    padding: 2px 16px 16px !important;
  }

  .library-node-picker-modal .semi-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0;
    padding: 0 16px 16px !important;
  }

  .library-node-picker-modal .semi-modal-footer .semi-button {
    height: 28px;
    min-width: 56px;
    margin: 0;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }
`;

const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;

  .breadcrumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }

  .crumb-btn {
    height: 26px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    padding: 0 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 92%, transparent);
    color: var(--app-text);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
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
    height: clamp(220px, 38vh, 318px);
    min-height: 0;
    overflow: auto;
    ${workspaceScrollbarStyles}
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    padding: 6px;
  }

  .node-panel.is-empty {
    height: 112px;
  }

  .node-panel .semi-empty {
    padding: 14px 8px;
  }

  .node-panel .semi-empty-title {
    font-size: 13px;
    line-height: 1.35;
  }

  .node-panel .semi-empty-description {
    font-size: 11px;
    line-height: 1.35;
  }

  .node-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .node-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
    min-height: 32px;
    padding: 5px 8px;
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
    gap: 6px;
  }

  .node-kind-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--app-text-muted);
  }

  .node-kind-icon.is-dir {
    color: var(--semi-color-primary);
  }

  .node-name {
    min-width: 0;
    font-size: 12px;
    line-height: 1.35;
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
  initialNodeId = null,
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
  const navigationRequestRef = React.useRef(0);

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
      navigationRequestRef.current += 1;
      setBreadcrumbs([]);
      setChildrenMap({});
      setSelectedNodeId(null);
      setLoading(false);
      setErrorMessage('');
      return;
    }

    let cancelled = false;
    const requestId = ++navigationRequestRef.current;
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
        if (cancelled || requestId !== navigationRequestRef.current) {
          return;
        }
        const requestedNodeId = Number(initialNodeId);
        if (!Number.isInteger(requestedNodeId) || requestedNodeId <= 0 || requestedNodeId === root.id) {
          setBreadcrumbs([{ id: root.id, name: root.name }]);
          await loadChildren(root.id);
          return;
        }
        const ancestry: LibraryNodePickerNode[] = [];
        const visited = new Set<number>();
        let cursorId = requestedNodeId;
        while (cursorId > 0 && cursorId !== root.id && !visited.has(cursorId) && ancestry.length < 64) {
          visited.add(cursorId);
          const detail = await fetchNodeDetailById(cursorId);
          if (cancelled || requestId !== navigationRequestRef.current) {
            return;
          }
          const node = normalizePickerNode(detail, libraryId);
          if (!node || node.type !== 'dir') break;
          ancestry.unshift(node);
          cursorId = node.parentId;
        }
        if (cursorId !== root.id || ancestry.length === 0) {
          if (cancelled || requestId !== navigationRequestRef.current) {
            return;
          }
          setBreadcrumbs([{ id: root.id, name: root.name }]);
          await loadChildren(root.id);
          return;
        }
        if (cancelled || requestId !== navigationRequestRef.current) {
          return;
        }
        const path = [{ id: root.id, name: root.name }, ...ancestry.map(node => ({ id: node.id, name: node.name }))];
        setBreadcrumbs(path);
        await loadChildren(ancestry[ancestry.length - 1].id);
      } catch (error: any) {
        if (cancelled || requestId !== navigationRequestRef.current) {
          return;
        }
        setErrorMessage(error?.message || '目录加载失败');
      } finally {
        if (!cancelled && requestId === navigationRequestRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialNodeId, libraryId, loadChildren, visible]);

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
    const requestId = ++navigationRequestRef.current;
    setSelectedNodeId(null);
    setBreadcrumbs((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === node.id);
      if (existingIndex >= 0) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, { id: node.id, name: node.name }];
    });
    if (childrenMap[node.id]) {
      setErrorMessage('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await loadChildren(node.id);
      if (requestId !== navigationRequestRef.current) {
        return;
      }
    } catch (error: any) {
      if (requestId === navigationRequestRef.current) {
        setErrorMessage(error?.message || '目录加载失败');
      }
    } finally {
      if (requestId === navigationRequestRef.current) {
        setLoading(false);
      }
    }
  }, [childrenMap, loadChildren]);

  const handleBreadcrumbClick = React.useCallback((crumb: { id: number; name: string }, index: number) => {
    const requestId = ++navigationRequestRef.current;
    setSelectedNodeId(null);
    setBreadcrumbs(prev => prev.slice(0, index + 1));
    if (childrenMap[crumb.id]) {
      setErrorMessage('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMessage('');
    void loadChildren(crumb.id)
      .catch((error: any) => {
        if (requestId === navigationRequestRef.current) {
          setErrorMessage(error?.message || '目录加载失败');
        }
      })
      .finally(() => {
        if (requestId === navigationRequestRef.current) {
          setLoading(false);
        }
      });
  }, [childrenMap, loadChildren]);

  return (
    <>
      <PickerModalStyle />
      <Modal
        className="library-node-picker-modal"
        title={title}
        visible={visible}
        width={620}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        centered
        bodyStyle={{ minHeight: 0 }}
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
                    onClick={() => handleBreadcrumbClick(crumb, index)}
                  >
                    {crumb.name}
                  </button>
                  {!isCurrent ? <span className="crumb-sep">/</span> : null}
                </React.Fragment>
              );
            })}
          </div>

          <div
            className={`node-panel${!loading && !errorMessage && visibleNodes.length === 0 ? ' is-empty' : ''}`}
          >
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
                        {node.type === 'dir' ? <OutlineIcon name="folder" /> : <OutlineIcon name="file" />}
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
    </>
  );
};

export default LibraryNodePickerModal;
