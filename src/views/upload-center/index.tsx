import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, Empty, Progress, Tag, Typography, Toast } from '@douyinfe/semi-ui';
import { IconChevronDown, IconChevronLeft, IconChevronRight } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router-dom';
import { uploadManager } from '@/utils/uploadManager';
import type { UploadTask } from '@/modules/upload-center/model/upload-task.types';
import type { UploadTaskSummary } from '@/modules/upload-center/model/upload-task.store';
import OpaquePageContainer from '@/components/OpaquePageContainer';

const Page = styled.div`
  --page-heading-indent: 38px;

  width: 100%;
  height: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 38px 32px 27px;
  overflow: auto;
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-bottom: 13px;
  }

  .page-back-button {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-width: 28px;
    padding: 0;
    border-radius: 7px;
  }

  .page-title {
    margin: 0;
    font-size: 23px;
    font-weight: 700;
    line-height: 1.15;
  }

  .subtitle {
    margin-left: var(--page-heading-indent);
    margin-bottom: 15px;
    max-width: 480px;
    color: var(--semi-color-text-2);
    font-size: 11px;
    line-height: 1.55;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(80px, 1fr));
    gap: 9px;
    margin-bottom: 15px;
  }

  .summary-card {
    border: 1px solid var(--semi-color-border);
    border-radius: 8px;
    padding: 9px 11px;
    background: var(--semi-color-bg-0);
  }

  .summary-label {
    font-size: 10px;
    color: var(--semi-color-text-2);
  }

  .summary-value {
    margin-top: 4px;
    font-size: 17px;
    font-weight: 700;
  }

  .list {
    border: 1px solid var(--semi-color-border);
    border-radius: 9px;
    overflow: hidden;
    background: var(--semi-color-bg-0);
  }

  .group-row {
    padding: 12px 13px;
    border-bottom: 1px solid var(--semi-color-border-light);
  }

  .group-row:last-child {
    border-bottom: none;
  }

  .row-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .name-wrap {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-size: 11px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    margin-top: 7px;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--semi-color-text-2);
    font-size: 10px;
    align-items: center;
  }

  .row-actions {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
  }

  .row-action-button {
    height: 25px;
    min-height: 25px;
    padding: 0 7px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
  }

  .tree {
    margin-top: 9px;
    border: 1px solid var(--semi-color-border-light);
    border-radius: 7px;
    padding: 7px;
    background: var(--semi-color-fill-0);
  }

  .tree-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    min-height: 23px;
    border-radius: 4px;
    padding: 3px 5px;
  }

  .tree-row:hover {
    background: var(--semi-color-fill-1);
  }

  .tree-left {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    flex: 1;
  }

  .tree-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
  }

  .tree-meta {
    font-size: 9px;
    color: var(--semi-color-text-2);
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .tree-more {
    margin-left: 13px;
    margin-top: 3px;
  }

  .semi-tag {
    font-size: 10px;
    line-height: 16px;
  }

  .semi-progress-line {
    height: 4px;
  }

  .semi-button .semi-icon {
    font-size: 12px;
  }

  .name-wrap > .semi-button,
  .tree-left .semi-button {
    width: 18px;
    height: 18px;
    min-width: 18px;
    padding: 0 !important;
    border-radius: 4px;
  }

  .tree-more .semi-button,
  .group-row > .semi-button {
    height: 24px;
    min-height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
  }

  .empty-state {
    padding: 38px 16px;
  }

  .empty-state .semi-empty-description {
    font-size: 11px;
  }

  @media (max-width: 760px) {
    padding: 29px 13px 16px;

    .summary {
      grid-template-columns: repeat(2, minmax(100px, 1fr));
    }
  }
`;

const STATUS_LABEL: Record<UploadTask['status'], string> = {
  queued: '排队中',
  uploading: '上传中',
  success: '已完成',
  failed: '失败',
  canceled: '已取消',
  paused: '已暂停',
};

const STATUS_COLOR: Record<UploadTask['status'], 'grey' | 'green' | 'red' | 'blue' | 'orange'> = {
  queued: 'grey',
  uploading: 'blue',
  success: 'green',
  failed: 'red',
  canceled: 'grey',
  paused: 'orange',
};

const TREE_CHILDREN_STEP = 20;
const UI_SYNC_THROTTLE_MS = 320;
const GROUP_RENDER_STEP = 40;
const GROUP_TREE_REFRESH_INTERVAL_MS = 1200;
const MAX_EXPANDED_GROUPS = 4;
const MAX_EXPANDED_TREE_NODES_PER_GROUP = 24;

interface UploadGroupStats {
  fileCount: number;
  totalBytes: number;
  uploadedBytes: number;
  queued: number;
  uploading: number;
  paused: number;
  failed: number;
  success: number;
  canceled: number;
  latestAt: number;
}

interface UploadGroup extends UploadGroupStats {
  id: string;
  label: string;
  isFolder: boolean;
  taskIds: string[];
}

interface GroupTreeNode {
  key: string;
  name: string;
  parentKey: string | null;
  kind: 'folder' | 'file';
  children: string[];
  fileCount: number;
  totalBytes: number;
}

interface GroupTreeData {
  rootChildren: string[];
  nodes: Map<string, GroupTreeNode>;
}

function normalizePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function createEmptyStats(): UploadGroupStats {
  return {
    fileCount: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    queued: 0,
    uploading: 0,
    paused: 0,
    failed: 0,
    success: 0,
    canceled: 0,
    latestAt: 0,
  };
}

function createEmptyTreeNodeStats(): Pick<GroupTreeNode, 'fileCount' | 'totalBytes'> {
  return {
    fileCount: 0,
    totalBytes: 0,
  };
}

function applyTaskStats(target: UploadGroupStats, task: UploadTask): void {
  target.fileCount += 1;
  target.totalBytes += Number(task.progress.totalBytes || 0);
  target.uploadedBytes += Number(task.progress.uploadedBytes || 0);
  target.latestAt = Math.max(target.latestAt, Number(task.updatedAt || task.createdAt || 0));

  switch (task.status) {
    case 'queued':
      target.queued += 1;
      break;
    case 'uploading':
      target.uploading += 1;
      break;
    case 'paused':
      target.paused += 1;
      break;
    case 'failed':
      target.failed += 1;
      break;
    case 'success':
      target.success += 1;
      break;
    case 'canceled':
      target.canceled += 1;
      break;
    default:
      break;
  }
}

function getDominantStatus(stats: UploadGroupStats): UploadTask['status'] {
  if (stats.uploading > 0) return 'uploading';
  if (stats.failed > 0) return 'failed';
  if (stats.queued > 0) return 'queued';
  if (stats.paused > 0) return 'paused';
  if (stats.success > 0) return 'success';
  return 'canceled';
}

function getProgressPercent(stats: UploadGroupStats): number {
  const total = Math.max(0, Number(stats.totalBytes || 0));
  if (total <= 0) {
    return stats.success > 0 ? 100 : 0;
  }
  const uploaded = Math.max(0, Math.min(total, Number(stats.uploadedBytes || 0)));
  return Number(((uploaded / total) * 100).toFixed(1));
}

function getTaskRelativePath(task: UploadTask): string {
  return normalizePath(task.meta.relativePath || task.meta.fileName || '');
}

function buildGroupFromTask(task: UploadTask): { id: string; label: string; isFolder: boolean } {
  const relativePath = getTaskRelativePath(task);
  const segments = relativePath.split('/').filter(Boolean);
  const topName = segments[0] || task.meta.fileName;
  const folderGroupId = String(task.meta.folderGroupId || '').trim();
  const groupId = folderGroupId || `library-${task.meta.libraryId}:${topName}`;
  return {
    id: groupId,
    label: topName,
    isFolder: segments.length > 1,
  };
}

function sortNames(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

function buildUploadGroups(tasks: UploadTask[]): UploadGroup[] {
  const groupMap = new Map<string, UploadGroup>();

  tasks.forEach((task) => {
    const groupInfo = buildGroupFromTask(task);
    const group = groupMap.get(groupInfo.id) || {
      id: groupInfo.id,
      label: groupInfo.label,
      isFolder: groupInfo.isFolder,
      taskIds: [],
      ...createEmptyStats(),
    };

    group.taskIds.push(task.id);
    group.isFolder = group.isFolder || groupInfo.isFolder;
    applyTaskStats(group, task);
    groupMap.set(group.id, group);
  });

  return Array.from(groupMap.values()).sort((a, b) => {
    if (b.latestAt !== a.latestAt) return b.latestAt - a.latestAt;
    return sortNames(a.label, b.label);
  });
}

function buildGroupTree(group: UploadGroup, taskMap: Map<string, UploadTask>): GroupTreeData {
  const nodes = new Map<string, GroupTreeNode>();
  const rootChildren = new Set<string>();

  const ensureNode = (
    key: string,
    name: string,
    kind: 'folder' | 'file',
    parentKey: string | null,
  ): GroupTreeNode => {
    const existing = nodes.get(key);
    if (existing) {
      return existing;
    }
    const created: GroupTreeNode = {
      key,
      name,
      kind,
      parentKey,
      children: [],
      ...createEmptyTreeNodeStats(),
    };
    nodes.set(key, created);
    return created;
  };

  group.taskIds.forEach((taskId) => {
    const task = taskMap.get(taskId);
    if (!task) return;

    const normalized = getTaskRelativePath(task);
    let segments = normalized.split('/').filter(Boolean);

    if (group.isFolder && segments[0] === group.label) {
      segments = segments.slice(1);
    }
    if (segments.length === 0) {
      segments = [task.meta.fileName || 'unknown'];
    }

    let parentKey: string | null = null;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const currentKey = parentKey ? `${parentKey}/${segment}` : segment;
      const node = ensureNode(currentKey, segment, isLeaf ? 'file' : 'folder', parentKey);
      node.fileCount += 1;
      node.totalBytes += Number(task.progress.totalBytes || 0);

      if (parentKey) {
        const parentNode = nodes.get(parentKey);
        if (parentNode && !parentNode.children.includes(currentKey)) {
          parentNode.children.push(currentKey);
        }
      } else {
        rootChildren.add(currentKey);
      }

      parentKey = currentKey;
    });
  });

  return {
    rootChildren: Array.from(rootChildren),
    nodes,
  };
}

function getNodeChildren(tree: GroupTreeData, parentKey: string | null): string[] {
  const keys = parentKey ? (tree.nodes.get(parentKey)?.children || []) : tree.rootChildren;
  return [...keys].sort((a, b) => {
    const nodeA = tree.nodes.get(a);
    const nodeB = tree.nodes.get(b);
    if (!nodeA || !nodeB) return a.localeCompare(b);
    if (nodeA.kind !== nodeB.kind) {
      return nodeA.kind === 'folder' ? -1 : 1;
    }
    return sortNames(nodeA.name, nodeB.name);
  });
}

interface GroupTreeViewProps {
  group: UploadGroup;
  taskMap: Map<string, UploadTask>;
  expandedKeys: string[];
  onToggleKey: (nodeKey: string) => void;
}

const GroupTreeView: React.FC<GroupTreeViewProps> = ({ group, taskMap, expandedKeys, onToggleKey }) => {
  const structureKey = `${group.id}|${group.taskIds.length}|${group.taskIds[0] || ''}|${group.taskIds[group.taskIds.length - 1] || ''}`;
  const hasActiveFlow = group.uploading > 0 || group.queued > 0;
  const [effectiveStructureKey, setEffectiveStructureKey] = useState(structureKey);

  useEffect(() => {
    if (!hasActiveFlow) {
      setEffectiveStructureKey(structureKey);
      return;
    }
    const timer = window.setTimeout(() => {
      setEffectiveStructureKey(structureKey);
    }, GROUP_TREE_REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [hasActiveFlow, structureKey]);

  const treeCacheRef = useRef<{ key: string; tree: GroupTreeData } | null>(null);
  const tree = useMemo(() => {
    const cached = treeCacheRef.current;
    if (cached && cached.key === effectiveStructureKey) {
      return cached.tree;
    }
    const built = buildGroupTree(group, taskMap);
    treeCacheRef.current = { key: effectiveStructureKey, tree: built };
    return built;
  }, [effectiveStructureKey, group, taskMap]);
  const [visibleChildrenCount, setVisibleChildrenCount] = useState<Record<string, number>>({});

  useEffect(() => {
    setVisibleChildrenCount({});
  }, [effectiveStructureKey]);

  const getVisibleLimit = (nodeKey: string) => visibleChildrenCount[nodeKey] || TREE_CHILDREN_STEP;

  const renderNode = (nodeKey: string, depth: number): React.ReactNode => {
    const node = tree.nodes.get(nodeKey);
    if (!node) return null;

    const isFolder = node.kind === 'folder';
    const expanded = isFolder ? expandedKeys.includes(node.key) : false;
    const childKeys = isFolder ? getNodeChildren(tree, node.key) : [];
    const visibleLimit = getVisibleLimit(node.key);
    const visibleChildren = childKeys.slice(0, visibleLimit);
    const hasMoreChildren = childKeys.length > visibleLimit;

    return (
      <React.Fragment key={node.key}>
        <div className="tree-row" style={{ paddingLeft: `${depth * 12 + 4}px` }}>
          <div className="tree-left">
            {isFolder ? (
              <Button
                type="tertiary"
                theme="borderless"
                icon={expanded ? <IconChevronDown /> : <IconChevronRight />}
                style={{ padding: 1 }}
                onClick={() => onToggleKey(node.key)}
              />
            ) : (
              <span style={{ width: 15 }} />
            )}
            <span style={{ fontSize: 10 }}>{isFolder ? '📁' : '📄'}</span>
            <span className="tree-name" title={node.name}>{node.name}</span>
          </div>

          <div className="tree-meta">
            <span>{node.fileCount} 项</span>
            <span>{uploadManager.formatSize(node.totalBytes)}</span>
          </div>
        </div>

        {isFolder && expanded && (
          <>
            {visibleChildren.map((childKey) => renderNode(childKey, depth + 1))}
            {hasMoreChildren && (
              <div className="tree-more" style={{ paddingLeft: `${(depth + 1) * 12 + 5}px` }}>
                <Button
                  size="small"
                  theme="borderless"
                  onClick={() => {
                    setVisibleChildrenCount((prev) => ({
                      ...prev,
                      [node.key]: (prev[node.key] || TREE_CHILDREN_STEP) + TREE_CHILDREN_STEP,
                    }));
                  }}
                >
                  加载更多 ({childKeys.length - visibleLimit})
                </Button>
              </div>
            )}
          </>
        )}
      </React.Fragment>
    );
  };

  const rootChildren = getNodeChildren(tree, null);
  if (rootChildren.length === 0) {
    return <Empty image={null} description="目录为空" style={{ padding: '11px 0' }} />;
  }

  return <>{rootChildren.map((nodeKey) => renderNode(nodeKey, 0))}</>;
};

const UploadCenter: React.FC = () => {
  const navigate = useNavigate();
  const { Title } = Typography;

  const [tasks, setTasks] = useState<UploadTask[]>(() => uploadManager.getTasks());
  const [summary, setSummary] = useState<UploadTaskSummary>(() => uploadManager.getSummary());
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
  const [expandedTreeKeysByGroup, setExpandedTreeKeysByGroup] = useState<Record<string, string[]>>({});
  const [visibleGroupCount, setVisibleGroupCount] = useState<number>(GROUP_RENDER_STEP);
  const expandedGroupIdsRef = useRef<string[]>([]);
  const expandedTreeKeysByGroupRef = useRef<Record<string, string[]>>({});
  const treeExpandLimitNoticeAtRef = useRef<number>(0);
  const groupExpandLimitNoticeAtRef = useRef<number>(0);

  useEffect(() => {
    let timer: number | null = null;

    const sync = () => {
      setTasks(uploadManager.getTasks());
      setSummary(uploadManager.getSummary());
    };

    const scheduleSync = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        sync();
      }, UI_SYNC_THROTTLE_MS);
    };

    sync();
    const unsubscribe = uploadManager.subscribe(() => {
      scheduleSync();
    });

    return () => {
      unsubscribe();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    expandedGroupIdsRef.current = expandedGroupIds;
  }, [expandedGroupIds]);

  useEffect(() => {
    expandedTreeKeysByGroupRef.current = expandedTreeKeysByGroup;
  }, [expandedTreeKeysByGroup]);

  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  const groups = useMemo(() => buildUploadGroups(tasks), [tasks]);
  const visibleGroups = useMemo(
    () => groups.slice(0, visibleGroupCount),
    [groups, visibleGroupCount],
  );

  useEffect(() => {
    if (groups.length <= GROUP_RENDER_STEP) {
      setVisibleGroupCount(GROUP_RENDER_STEP);
      return;
    }
    if (visibleGroupCount > groups.length) {
      setVisibleGroupCount(Math.max(GROUP_RENDER_STEP, groups.length));
    }
  }, [groups.length, visibleGroupCount]);

  const toggleGroup = (groupId: string) => {
    const previous = expandedGroupIdsRef.current;
    let next = previous.includes(groupId)
      ? previous.filter(id => id !== groupId)
      : [...previous, groupId];
    let hitLimit = false;

    if (next.length > MAX_EXPANDED_GROUPS) {
      next = next.slice(next.length - MAX_EXPANDED_GROUPS);
      hitLimit = true;
    }

    expandedGroupIdsRef.current = next;
    setExpandedGroupIds(next);

    if (hitLimit) {
      const now = Date.now();
      if (now - groupExpandLimitNoticeAtRef.current > 2000) {
        groupExpandLimitNoticeAtRef.current = now;
        Toast.info(`最多同时展开 ${MAX_EXPANDED_GROUPS} 个上传分组，已自动折叠较早分组`);
      }
    }
  };

  const handleToggleTreeNode = (groupId: string, nodeKey: string) => {
    const previous = expandedTreeKeysByGroupRef.current;
    const keys = previous[groupId] || [];
    let nextKeys = keys.includes(nodeKey)
      ? keys.filter(key => key !== nodeKey)
      : [...keys, nodeKey];
    let hitLimit = false;

    if (nextKeys.length > MAX_EXPANDED_TREE_NODES_PER_GROUP) {
      nextKeys = nextKeys.slice(nextKeys.length - MAX_EXPANDED_TREE_NODES_PER_GROUP);
      hitLimit = true;
    }

    const next = {
      ...previous,
      [groupId]: nextKeys,
    };
    expandedTreeKeysByGroupRef.current = next;
    setExpandedTreeKeysByGroup(next);

    if (hitLimit) {
      const now = Date.now();
      if (now - treeExpandLimitNoticeAtRef.current > 2000) {
        treeExpandLimitNoticeAtRef.current = now;
        Toast.info(`单个分组最多同时展开 ${MAX_EXPANDED_TREE_NODES_PER_GROUP} 个目录，已自动折叠较早目录`);
      }
    }
  };

  const handleCancelGroup = (group: UploadGroup) => {
    let canceledCount = 0;
    group.taskIds.forEach((taskId) => {
      const task = taskMap.get(taskId);
      if (!task) return;
      if (task.status === 'queued' || task.status === 'uploading' || task.status === 'paused') {
        if (uploadManager.cancelTask(taskId)) {
          canceledCount += 1;
        }
      }
    });

    if (canceledCount === 0) {
      Toast.warning('当前分组没有可中断任务');
      return;
    }
    Toast.info(`已中断 ${canceledCount} 个任务`);
  };

  const handleRetryGroup = (group: UploadGroup) => {
    let retriedCount = 0;
    group.taskIds.forEach((taskId) => {
      const task = taskMap.get(taskId);
      if (!task || task.status !== 'failed') return;
      const retried = uploadManager.retryTask(taskId);
      if (retried) {
        retriedCount += 1;
      }
    });

    if (retriedCount === 0) {
      Toast.warning('当前分组没有可重试任务');
      return;
    }
    Toast.info(`已重试 ${retriedCount} 个任务`);
  };

  return (
    <OpaquePageContainer>
      <Page>
        <div className="header">
          <Button
            icon={<IconChevronLeft style={{ fontSize: 14 }} />}
            theme="borderless"
            onClick={() => navigate(-1)}
            className="page-back-button"
          />
          <Title heading={2} className="page-title">
            上传中心
          </Title>
        </div>

        <div className="subtitle">
          默认仅展示分组，展开后按目录层级逐步查看
        </div>

        <div className="summary">
          <div className="summary-card">
            <div className="summary-label">总任务</div>
            <div className="summary-value">{summary.total}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">进行中</div>
            <div className="summary-value">{summary.uploading}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">排队</div>
            <div className="summary-value">{summary.queued}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">失败</div>
            <div className="summary-value">{summary.failed}</div>
          </div>
        </div>

        <div className="list">
          {groups.length === 0 ? (
            <div className="empty-state">
              <Empty description="暂无上传任务" />
            </div>
          ) : (
            visibleGroups.map((group) => {
              const status = getDominantStatus(group);
              const percent = getProgressPercent(group);
              const expanded = expandedGroupIds.includes(group.id);

              return (
                <div key={group.id} className="group-row">
                  <div className="row-head">
                    <div className="name-wrap">
                      {group.isFolder ? (
                        <Button
                          icon={expanded ? <IconChevronDown /> : <IconChevronRight />}
                          size="small"
                          theme="borderless"
                          type="tertiary"
                          style={{ padding: 1 }}
                          onClick={() => toggleGroup(group.id)}
                        />
                      ) : (
                        <span style={{ width: 16 }} />
                      )}
                      <span style={{ fontSize: 11 }}>{group.isFolder ? '📁' : '📄'}</span>
                      <div className="name" title={group.label}>{group.label}</div>
                    </div>
                    <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>
                  </div>

                  <div style={{ marginTop: 7 }}>
                    <Progress
                      percent={percent}
                      showInfo={false}
                      stroke={status === 'failed' ? 'var(--semi-color-danger)' : undefined}
                    />
                  </div>

                  <div className="row-meta">
                    <span>{group.fileCount} 项</span>
                    <span>{uploadManager.formatSize(group.uploadedBytes)} / {uploadManager.formatSize(group.totalBytes)}</span>
                    <span>{percent.toFixed(1)}%</span>
                    <div className="row-actions">
                      {(group.uploading > 0 || group.queued > 0 || group.paused > 0) && (
                        <Button
                          size="default"
                          type="danger"
                          theme="borderless"
                          className="row-action-button"
                          onClick={() => handleCancelGroup(group)}
                        >
                          中断
                        </Button>
                      )}
                      {group.failed > 0 && (
                        <Button
                          size="default"
                          theme="borderless"
                          className="row-action-button"
                          onClick={() => handleRetryGroup(group)}
                        >
                          重试失败项
                        </Button>
                      )}
                    </div>
                  </div>

                  {group.isFolder && expanded && (
                    <div className="tree">
                      <GroupTreeView
                        group={group}
                        taskMap={taskMap}
                        expandedKeys={expandedTreeKeysByGroup[group.id] || []}
                        onToggleKey={(nodeKey) => handleToggleTreeNode(group.id, nodeKey)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
          {groups.length > visibleGroupCount && (
            <div className="group-row" style={{ textAlign: 'center' }}>
              <Button
                theme="borderless"
                onClick={() => {
                  setVisibleGroupCount(prev => Math.min(prev + GROUP_RENDER_STEP, groups.length));
                }}
              >
                加载更多分组（剩余 {groups.length - visibleGroupCount}）
              </Button>
            </div>
          )}
        </div>
      </Page>
    </OpaquePageContainer>
  );
};

export default UploadCenter;
