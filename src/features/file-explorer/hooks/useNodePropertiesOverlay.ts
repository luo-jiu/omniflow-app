import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import {
  fetchNodeDetailById,
  getAllDescendantsByNodeId,
  type NodeDetailDTO,
} from '@/features/file-explorer/services/file.api';
import { openOverlay, openOverlaySession } from '@/service/overlay/overlay.api';
import type { NodePropertiesOverlayProps } from '@/service/overlay/types';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  formatNodeFileSize,
  resolveFolderStatisticsValues,
  type FolderStatistics,
} from './node-properties-statistics';

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

function formatBuiltInTypeLabel(value: unknown): string {
  const normalized = String(value || 'DEF').trim().toUpperCase();
  if (normalized === 'COMIC') return '漫画';
  if (normalized === 'ASMR') return 'ASMR';
  if (normalized === 'VIDEO') return '视频';
  if (normalized === 'AUDIO') return '音频';
  if (normalized === 'GALLERY') return '图集';
  return '-';
}

function formatArchiveModeLabel(value: unknown): string {
  return Number(value ?? 0) === 1 ? '开启' : '-';
}

function formatTimestamp(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '-';
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) return '-';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${timestamp.getFullYear()}年${timestamp.getMonth() + 1}月${timestamp.getDate()} `
    + `${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}:${pad(timestamp.getSeconds())}`;
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
  const buildAncestorDetailPathByNodeId = useCallback(async (
    targetNodeId: number,
    targetDetail?: NodeDetailDTO,
  ): Promise<NodeDetailDTO[]> => {
    if (!Number.isFinite(Number(libraryId)) || Number(libraryId) <= 0) {
      throw new Error('当前库参数异常');
    }

    const path: NodeDetailDTO[] = [];
    const visited = new Set<number>();
    let currentId = Number(targetNodeId);

    while (Number.isFinite(currentId) && currentId > 0 && !visited.has(currentId)) {
      visited.add(currentId);
      let detail: NodeDetailDTO;
      if (targetDetail && currentId === Number(targetDetail.id)) {
        detail = targetDetail;
      } else {
        detail = await fetchNodeDetailById(currentId);
      }
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
    folderStatistics?: FolderStatistics;
    node: ShowNodePropertiesNode;
    pathDetails: NodeDetailDTO[];
  }): NodePropertiesOverlayProps => {
    const { detail, folderStatistics, node, pathDetails } = params;
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

    const folderStatisticsValues = resolveFolderStatisticsValues(Number(detail.id), folderStatistics);

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
    const parentDetail = pathDetails.length > 1
      ? pathDetails[pathDetails.length - 2]
      : null;
    const createdAt = formatTimestamp(detail.createdAt);
    const updatedAt = formatTimestamp(detail.updatedAt);

    const sections = isFile
      ? [
        {
          title: '基本信息',
          items: [
            { label: '位置', value: path },
            { label: '所属类型', value: '文件' },
            { label: '大小', value: formatNodeFileSize(detail.fileSize ?? node?.data?.fileSize ?? node?.fileSize) },
            { label: '后缀', value: ext || '-' },
            { label: 'MIME', value: mimeType || '-' },
            { label: '创建时间', value: createdAt },
            { label: '修改时间', value: updatedAt },
          ],
        },
        {
          title: '视图与模式',
          items: [
            { label: '内置类型', value: builtInTypeLabel },
            { label: '归档类型', value: archiveModeLabel },
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
          title: '基本信息',
          items: [
            { label: '位置', value: path },
            { label: '所属类型', value: '文件夹' },
            { label: '大小', value: folderStatisticsValues.size },
            { label: '文件数量', value: folderStatisticsValues.count },
            { label: '创建时间', value: createdAt },
            { label: '修改时间', value: updatedAt },
          ],
        },
        {
          title: '视图与模式',
          items: [
            { label: '内置类型', value: builtInTypeLabel },
            { label: '归档类型', value: archiveModeLabel },
            { label: '视图配置', value: viewMetaState },
          ],
        },
      ];

    return {
      fullName: fullName || '-',
      icon: {
        archiveMode: Number(detail.archiveMode ?? node?.archiveMode ?? 0) === 1 ? 1 : 0,
        builtInType: String(detail.builtInType ?? node?.builtInType ?? 'DEF'),
        ext,
        fileName: fullName || baseName,
        mimeType,
        nodeType: isFile ? 'file' : 'dir',
        parentArchiveMode: Number(parentDetail?.archiveMode ?? 0) === 1 ? 1 : 0,
        parentBuiltInType: String(parentDetail?.builtInType ?? 'DEF'),
      },
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
      const pathDetails = await buildAncestorDetailPathByNodeId(nodeId, detail);

      if (detail.type === 'dir') {
        const buildProps = (folderStatistics: FolderStatistics) => buildNodePropertiesOverlayProps({
          detail,
          folderStatistics,
          node,
          pathDetails,
        });
        const session = openOverlaySession('node-properties', buildProps({ status: 'loading' }));
        void getAllDescendantsByNodeId(nodeId, Number(libraryId)).then(
          (descendantsResult) => {
            void session.updateProps(buildProps({
              status: 'ready',
              descendants: Array.isArray(descendantsResult) ? descendantsResult : null,
            })).catch((error) => {
              runtimeLogger.warn('文件夹属性统计结果未能更新到弹框:', error);
            });
          },
          (error) => {
            runtimeLogger.warn('文件夹属性统计暂不可用:', error);
            void session.updateProps(buildProps({ status: 'error' })).catch((updateError) => {
              runtimeLogger.warn('文件夹属性统计失败状态未能更新到弹框:', updateError);
            });
          },
        );
        await session.result;
        return;
      }

      const props = buildNodePropertiesOverlayProps({
        detail,
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
