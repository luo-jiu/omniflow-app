import { useCallback, useEffect, useRef } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { openOverlaySession } from '@/service/overlay/overlay.api';
import type { CreateFileOverlayProps, CreateFileResult, OverlayStorageProvider } from '@/service/overlay/types';
import { fetchProviders } from '@/features/storage-config/services/storage-config.api';
import { resourceMonitorProbeRuntime } from '@/features/resource-monitor/services/resource-monitor-runtime';
import {
  ensureStorageProviderAvailable,
  findStorageProviderProbe,
  getStorageProviderProbeStatus,
  isStorageProviderProbeFresh,
} from '@/features/resource-monitor/services/storage-provider-health';
import { splitFileBaseNameAndExt } from '@/utils/fileTreeSettings';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { createNode, deleteNodeAndChildren, hardDeleteNodeAndChildren, updateNodeFileContent, type NodeDetailDTO } from '../services/file.api';

export function useCreateFileOverlay({ libraryId, accountScope }: {
  libraryId: number;
  accountScope: string | null;
}) {
  const busyRef = useRef(false);
  const scopeRef = useRef(0);
  const cancelSessionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    scopeRef.current += 1;
    return () => {
      scopeRef.current += 1;
      cancelSessionRef.current?.();
    };
  }, [accountScope, libraryId]);

  return useCallback(async (parentId: number) => {
    if (busyRef.current) return null;
    if (!Number.isFinite(parentId) || parentId <= 0) {
      Toast.warning('目录根节点初始化中，请稍后重试');
      return null;
    }
    busyRef.current = true;
    const scope = scopeRef.current;
    const isCurrent = () => scopeRef.current === scope;
    let initialName = '';
    let initialStorageProvider = '';
    let errorMessage: string | undefined;

    try {
      // Each resolved form owns one attempt; failures reopen with the submitted draft.
      // The overlay never imports the main renderer's probe runtime or performs writes.
      while (isCurrent()) {
        let providers: OverlayStorageProvider[] = [];
        let defaultProvider = '';
        let providerLoading = true;
        let loadError: string | undefined;
        let active = true;
        const buildProps = (): CreateFileOverlayProps => ({
          initialName,
          initialStorageProvider,
          defaultProvider,
          providerLoading,
          errorMessage: loadError || errorMessage,
          providers: providers.map(provider => ({
            ...provider,
            healthStatus: getStorageProviderProbeStatus(resourceMonitorProbeRuntime.getState().snapshot, provider.alias),
          })),
        });
        const session = openOverlaySession('create-file', buildProps());
        const updateProps = () => {
          if (!active || !isCurrent()) return;
          void session.updateProps(buildProps()).catch(error => {
            runtimeLogger.warn('新建文件弹框未能同步存储状态:', error);
          });
        };
        const unsubscribe = resourceMonitorProbeRuntime.subscribe(updateProps);
        const stopUpdates = () => {
          if (!active) return;
          active = false;
          unsubscribe();
        };
        const cancelSession = () => {
          stopUpdates();
          void session.cancel().catch(error => {
            runtimeLogger.warn('新建文件弹框未能随资料库退出关闭:', error);
          });
        };
        cancelSessionRef.current = cancelSession;
        let result: CreateFileResult;
        try {
          resourceMonitorProbeRuntime.start();
          void fetchProviders().then(data => {
            if (!active || !isCurrent()) return;
            defaultProvider = data.defaultProvider || '';
            providers = (data.providers || []).map(provider => ({
              alias: provider.alias,
              type: provider.type,
              endpoint: provider.endpoint,
              bucket: provider.bucket,
              label: provider.label,
              useSSL: provider.useSSL,
            }));
            providerLoading = false;
            if (!providers.length) loadError = '没有可用的存储桶，请先配置存储';
            updateProps();
            const snapshot = resourceMonitorProbeRuntime.getState().snapshot;
            if (providers.some(provider => !isStorageProviderProbeFresh(findStorageProviderProbe(snapshot, provider.alias)))) {
              void resourceMonitorProbeRuntime.refresh({ silent: true }).catch(error => {
                runtimeLogger.warn('新建文件存储探活失败:', error);
              });
            }
          }, error => {
            if (!active || !isCurrent()) return;
            runtimeLogger.warn('加载新建文件的存储桶失败:', error);
            providerLoading = false;
            loadError = '加载存储桶失败，请关闭弹框后重试';
            updateProps();
          });
          result = await session.result;
        } finally {
          stopUpdates();
          if (cancelSessionRef.current === cancelSession) cancelSessionRef.current = null;
        }
        if (!isCurrent() || result.type !== 'confirm') return null;
        initialName = result.name;
        initialStorageProvider = result.storageProvider;

        try {
          const nextName = splitFileBaseNameAndExt(initialName.trim());
          if (!nextName.name) {
            errorMessage = '名称不能为空';
            continue;
          }
          if (providerLoading || !providers.some(provider => provider.alias === initialStorageProvider)) {
            errorMessage = '请选择可用的存储桶';
            continue;
          }
          const availability = await ensureStorageProviderAvailable(initialStorageProvider);
          if (!isCurrent()) return null;
          if (!availability.available) {
            errorMessage = availability.message;
            continue;
          }
          const createdNode = await createNode({ ...nextName, parentId, libraryId, type: 'file' });
          // Requests already sent cannot be retracted. Never continue the old transaction
          // with credentials from a replacement account, including compensating deletes.
          if (!isCurrent()) return null;
          let newNode: NodeDetailDTO;
          try {
            newNode = await updateNodeFileContent({
              nodeId: Number(createdNode.id),
              libraryId,
              content: '',
              contentType: 'text/plain; charset=utf-8',
              storageProvider: initialStorageProvider,
            });
          } catch (error) {
            if (!isCurrent()) return null;
            const cleanupNodeId = Number(createdNode.id);
            await deleteNodeAndChildren(cleanupNodeId, libraryId).catch(deleteError => {
              runtimeLogger.warn('新建文件首次写入失败后清理节点失败:', deleteError);
            });
            if (!isCurrent()) return null;
            await hardDeleteNodeAndChildren(cleanupNodeId, libraryId).catch(deleteError => {
              runtimeLogger.warn('新建文件首次写入失败后彻底清理节点失败:', deleteError);
            });
            throw error;
          }
          if (!isCurrent()) return null;
          Toast.success('文件创建成功');
          return newNode;
        } catch (error) {
          runtimeLogger.error('创建文件失败:', error);
          errorMessage = error instanceof Error ? error.message : '创建失败，请重试';
        }
      }
    } catch (error) {
      runtimeLogger.error('新建文件弹框无法打开:', error);
      if (isCurrent()) Toast.error('新建文件弹框无法打开，请重试');
    } finally {
      busyRef.current = false;
    }
    return null;
  }, [libraryId]);
}
