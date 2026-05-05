import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import {
  fetchNodeDetailById,
  getAllDescendantsByNodeId,
  getChildrenByNodeId,
  type NodeDetailDTO,
} from '@/features/file-explorer/services/file.api';
import { resolveNodeType } from '@/features/file-explorer/components/directory-tree/utils/tree-node';
import { openOverlay } from '@/service/overlay/overlay.api';
import type { NodePropertiesOverlayProps } from '@/service/overlay/types';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface UseNodePropertiesOverlayParams {
  libraryId: number | null;
  rootNodeId?: number | null;
}

interface ShowNodePropertiesNode {
  data?: {
    fileSize?: number;
    mimeType?: string;
    rawExt?: string;
    rawName?: string;
  };
  ext?: string;
  fileSize?: number;
  id?: number;
  label?: string;
  mimeType?: string;
  name?: string;
  archiveMode?: number;
  builtInType?: string;
}

function formatFileSize(size: unknown): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  const precision = index <= 1 ? 0 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function formatBuiltInTypeLabel(value: unknown): string {
  const normalized = String(value || 'DEF').trim().toUpperCase();
  if (normalized === 'COMIC') return '漫画';
  if (normalized === 'ASMR') return 'ASMR';
  if (normalized === 'VIDEO') return '视频';
  if (normalized === 'AUDIO') return '音频';
  return '默认';
}

function formatArchiveModeLabel(value: unknown): string {
  return Number(value ?? 0) === 1 ? '开启' : '关闭';
}

function getNodeFullName(params: {
  baseName: string;
  ext?: string | null;
  isFile: boolean;
}): string {
  const normalizedExt = String(params.ext || '').replace(/^\./, '');
  return params.isFile ? buildFileFullName(params.baseName, normalizedExt) : params.baseName;
}

export function useNodePropertiesOverlay({
  libraryId,
  rootNodeId = null,
}: UseNodePropertiesOverlayParams) {
  const buildAncestorDetailPathByNodeId = useCallback(async (targetNodeId: number): Promise<NodeDetailDTO[]> => {
    if (!Number.isFinite(Number(libraryId)) || Number(libraryId) <= 0) {
      throw new Error('当前库参数异常');
    }

    const path: NodeDetailDTO[] = [];
    const visited = new Set<number>();
    let currentId = Number(targetNodeId);

    while (Number.isFinite(currentId) && currentId > 0 && !visited.has(currentId)) {
      visited.add(currentId);
      const detail = await fetchNodeDetailById(currentId);
      const detailLibraryId = Number(detail.libraryId);
      if (detailLibraryId !== Number(libraryId)) {
        throw new Error('节点不在当前资料库中');
      }
      path.push(detail);

      const parentId = Number(detail.parentId || 0);
      if (!(Number.isFinite(parentId) && parentId > 0) || parentId === currentId) {
        break;
      }
      currentId = parentId;
    }

    return path.reverse();
  }, [libraryId]);

  const buildNodePropertiesOverlayProps = useCallback((params: {
    detail: NodeDetailDTO;
    directChildren: any[];
    descendants: any[];
    node: ShowNodePropertiesNode;
    pathDetails: NodeDetailDTO[];
  }): NodePropertiesOverlayProps => {
    const { detail, directChildren, descendants, node, pathDetails } = params;
    const isFile = detail.type === 'file';
    const baseName = String(detail.name || node?.data?.rawName || node?.label || node?.name || '');
    const ext = String(detail.ext ?? node?.data?.rawExt ?? node?.ext ?? '').replace(/^\./, '');
    const fullName = getNodeFullName({ isFile, baseName, ext });
    const builtInTypeLabel = formatBuiltInTypeLabel(detail.builtInType ?? node?.builtInType);
    const archiveModeLabel = formatArchiveModeLabel(detail.archiveMode ?? node?.archiveMode);
    const mimeType = String(detail.mimeType || node?.data?.mimeType || node?.mimeType || '').trim();
    const viewMetaState = detail.viewMeta ? '已记录' : '未记录';
    const storageProvider = String(detail.storageProvider || '').trim();
    const storageProviderLabel = String(detail.storageProviderLabel || '').trim();
    const storageProviderType = String(detail.storageProviderType || '').trim();
    const storageEndpoint = String(detail.storageEndpoint || '').trim();
    const storageBucket = String(detail.storageBucket || '').trim();
    const storageKey = String(detail.storageKey || '').trim();
    const storageProviderDisplay = storageProviderLabel && storageProvider
      ? `${storageProviderLabel}（${storageProvider}）`
      : storageProviderLabel || storageProvider || '-';

    const directFileCount = directChildren.filter((item) => resolveNodeType(item) === 'file').length;
    const directDirCount = directChildren.filter((item) => resolveNodeType(item) === 'dir').length;
    const directFileBytes = directChildren.reduce((sum, item) => (
      resolveNodeType(item) === 'file' ? sum + Number(item?.fileSize || 0) : sum
    ), 0);
    const descendantsWithoutSelf = descendants.filter((item) => Number(item?.id) !== Number(detail.id));
    const totalFileCount = descendantsWithoutSelf.filter((item) => resolveNodeType(item) === 'file').length;
    const totalDirCount = descendantsWithoutSelf.filter((item) => resolveNodeType(item) === 'dir').length;
    const totalFileBytes = descendantsWithoutSelf.reduce((sum, item) => (
      resolveNodeType(item) === 'file' ? sum + Number(item?.fileSize || 0) : sum
    ), 0);

    const renderPathName = (item: NodeDetailDTO): string => {
      const itemBaseName = String(item.name || '').trim();
      const itemParentId = Number(item.parentId || 0);
      if (Number(item.id) === Number(rootNodeId) || !(Number.isFinite(itemParentId) && itemParentId > 0)) {
        return '';
      }
      return getNodeFullName({
        isFile: item.type === 'file',
        baseName: itemBaseName || '根目录',
        ext: item.ext,
      });
    };

    const pathSegments = pathDetails
      .filter((item) => Number(item.id) !== Number(detail.id))
      .map(renderPathName)
      .filter(Boolean);
    const path = pathSegments.length > 0 ? `/ ${pathSegments.join(' / ')}` : '/';

    const sections = isFile
      ? [
        {
          title: '基本信息',
          items: [
            { label: '文件大小', value: formatFileSize(detail.fileSize ?? node?.data?.fileSize ?? node?.fileSize) },
            { label: '后缀', value: ext || '-' },
            { label: 'MIME', value: mimeType || '-' },
          ],
        },
        {
          title: '视图与模式',
          items: [
            { label: '所属类型', value: '文件' },
            { label: '内置类型', value: builtInTypeLabel },
            { label: '归档模式', value: archiveModeLabel },
            { label: '视图配置', value: viewMetaState },
          ],
        },
        {
          title: '物理存储',
          items: [
            { label: 'Provider', value: storageProviderDisplay },
            { label: '类型', value: storageProviderType || '-' },
            { label: 'Endpoint', value: storageEndpoint || '-' },
            { label: 'Bucket', value: storageBucket || '-' },
            { label: 'Object Key', value: storageKey || '-' },
          ],
        },
      ]
      : [
        {
          title: '视图与模式',
          items: [
            { label: '所属类型', value: '文件夹' },
            { label: '内置类型', value: builtInTypeLabel },
            { label: '归档模式', value: archiveModeLabel },
            { label: '视图配置', value: viewMetaState },
          ],
        },
        {
          title: '内容统计',
          items: [
            { label: '直接子项', value: `${directChildren.length} 项` },
            { label: '其中文件', value: `${directFileCount} 个` },
            { label: '其中文件夹', value: `${directDirCount} 个` },
            { label: '直接文件大小', value: directFileCount > 0 ? formatFileSize(directFileBytes) : '-' },
            { label: '子树总项数', value: `${descendantsWithoutSelf.length} 项` },
            { label: '子树文件数', value: `${totalFileCount} 个` },
            { label: '子树文件夹数', value: `${totalDirCount} 个` },
            { label: '子树文件总大小', value: totalFileCount > 0 ? formatFileSize(totalFileBytes) : '-' },
          ],
        },
      ];

    return {
      chips: [],
      fullName: fullName || '-',
      path,
      sections,
      title: isFile ? '文件属性' : '文件夹属性',
    };
  }, [rootNodeId]);

  const showNodeProperties = useCallback(async (node: ShowNodePropertiesNode) => {
    const nodeId = Number(node?.id);
    if (!Number.isFinite(nodeId) || nodeId <= 0) {
      Toast.warning('当前节点暂时无法查看属性');
      return;
    }
    if (!Number.isFinite(Number(libraryId)) || Number(libraryId) <= 0) {
      Toast.error('当前库参数异常');
      return;
    }

    try {
      const detail = await fetchNodeDetailById(nodeId);
      const pathDetails = await buildAncestorDetailPathByNodeId(nodeId);
      let directChildren: any[] = [];
      let descendants: any[] = [detail];

      if (detail.type === 'dir') {
        const [directChildrenResult, descendantsResult] = await Promise.all([
          getChildrenByNodeId(nodeId, Number(libraryId)),
          getAllDescendantsByNodeId(nodeId, Number(libraryId)),
        ]);
        directChildren = Array.isArray(directChildrenResult) ? directChildrenResult : [];
        descendants = Array.isArray(descendantsResult) && descendantsResult.length > 0
          ? descendantsResult
          : [detail];
      }

      const props = buildNodePropertiesOverlayProps({
        detail,
        directChildren,
        descendants,
        node,
        pathDetails,
      });
      await openOverlay('node-properties', props);
    } catch (error: any) {
      runtimeLogger.error('加载节点属性失败:', error);
      Toast.error(error?.message || '加载属性失败');
    }
  }, [buildAncestorDetailPathByNodeId, buildNodePropertiesOverlayProps, libraryId]);

  return {
    showNodeProperties,
  };
}
