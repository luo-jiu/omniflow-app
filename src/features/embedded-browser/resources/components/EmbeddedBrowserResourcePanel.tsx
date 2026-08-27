import { Toast } from '@douyinfe/semi-ui';
import React from 'react';
import PanelShell from './EmbeddedBrowserResourcePanel.styles';
import EmbeddedBrowserCatchToolkitCard from './EmbeddedBrowserCatchToolkitCard';
import EmbeddedBrowserResourceBulkBar from './EmbeddedBrowserResourceBulkBar';
import EmbeddedBrowserResourceCard from './EmbeddedBrowserResourceCard';
import type { EmbeddedBrowserExternalToolOption } from '@/features/embedded-browser/external-tools/model/embedded-browser-external-tools';
import type {
  EmbeddedBrowserHlsDownloadPlan,
  EmbeddedBrowserHlsManifest,
} from '../model/embedded-browser-hls-manifest';
import type {
  EmbeddedBrowserMpdDownloadPlan,
  EmbeddedBrowserMpdManifest,
} from '../model/embedded-browser-mpd-manifest';
import { useEmbeddedBrowserCatchToolkit } from '../hooks/useEmbeddedBrowserCatchToolkit';
import { useEmbeddedBrowserResources } from '../hooks/useEmbeddedBrowserResources';
import {
  dispatchEmbeddedBrowserExternalTool,
  listEmbeddedBrowserEnabledExternalTools,
  subscribeEmbeddedBrowserExternalToolsUpdated,
} from '@/features/embedded-browser/external-tools/services/embedded-browser-external-tool.api';
import {
  clearEmbeddedBrowserCacheAndReload,
  resetEmbeddedBrowserPageStorageAndReload,
} from '../services/embedded-browser-resource.api';
import {
  createEmbeddedBrowserResourceSections,
  findMergeableResourcePair,
} from '../model/embedded-browser-resource.presentation';
import {
  createManualMergePair,
  downloadSelectedResources,
  formatResourceTitle,
  getResourceExtensionFilterKey,
  isManuallyMergeableResource,
  matchesResourceFilter,
  mergeCapturedResources,
} from '../services/embedded-browser-resource-panel-actions';
import type { EmbeddedBrowserCapturedResource } from '../types';

type EmbeddedBrowserResourcePanelProps = {
  activeTabId: string | null;
  className?: string;
  currentPageUrl?: string;
  onOpenHlsDownloadWorkspace?: (
    resource: EmbeddedBrowserCapturedResource,
    manifest: EmbeddedBrowserHlsManifest,
    plan: EmbeddedBrowserHlsDownloadPlan,
  ) => void;
  onOpenMpdDownloadWorkspace?: (
    resource: EmbeddedBrowserCapturedResource,
    manifest: EmbeddedBrowserMpdManifest,
    plan: EmbeddedBrowserMpdDownloadPlan,
  ) => void;
  onOpenMediaProcessing?: (resources: EmbeddedBrowserCapturedResource[]) => void;
};

type ResourceDisplayMode = 'all' | 'filtered';

const RESOURCE_FILTER_STORAGE_KEY = 'embedded-browser:resource-filter-regex';
const RESOURCE_DEDUPE_SAME_NAME_STORAGE_KEY = 'embedded-browser:resource-dedupe-same-name';
const LEGACY_DEFAULT_MEDIA_RESOURCE_REGEX = String.raw`(blob:|key|base64key|\.((m3u8|m3u|mpd|m4s|mp4|m4v|m4a|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp|vtt|srt))(?:$|[?#]))`;
const DEFAULT_MEDIA_RESOURCE_REGEX = String.raw`(blob:|key|base64key|\.((m3u8|m3u|mpd|m4s|mp4|m4v|m4a|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp|vtt|srt|ass|ssa|ttml|lrc|qrc|krc|yrc|trc|ksc|sbv|dfxp|smi|sami|scc|stl|sub|idx|sup|lyric|lyrics|webvtt))(?:$|[?#]))`;

function loadResourceFilterDraft() {
  const value = window.localStorage.getItem(RESOURCE_FILTER_STORAGE_KEY);
  if (value === LEGACY_DEFAULT_MEDIA_RESOURCE_REGEX) {
    window.localStorage.setItem(RESOURCE_FILTER_STORAGE_KEY, DEFAULT_MEDIA_RESOURCE_REGEX);
    return DEFAULT_MEDIA_RESOURCE_REGEX;
  }
  return String(value || DEFAULT_MEDIA_RESOURCE_REGEX);
}

function loadDedupeSameName() {
  return window.localStorage.getItem(RESOURCE_DEDUPE_SAME_NAME_STORAGE_KEY) !== 'false';
}

function getSameNameDedupeKey(resource: EmbeddedBrowserCapturedResource) {
  const size = resource.contentLength || 0;
  if (size <= 0) {
    return `${resource.source}::${resource.id}`;
  }
  return [
    resource.source,
    formatResourceTitle(resource).trim().toLowerCase(),
    String(size),
  ].join('::');
}

const EmbeddedBrowserResourcePanel: React.FC<EmbeddedBrowserResourcePanelProps> = ({
  activeTabId,
  className,
  currentPageUrl = '',
  onOpenHlsDownloadWorkspace,
  onOpenMpdDownloadWorkspace,
  onOpenMediaProcessing,
}) => {
  const {
    captureEnabled,
    clearResources,
    deepCaptureEnabled,
    loading,
    resources,
    startCapture,
    startDeepCapture,
    stopCapture,
  } = useEmbeddedBrowserResources(activeTabId);
  const catchToolkit = useEmbeddedBrowserCatchToolkit(activeTabId, deepCaptureEnabled);
  const [actionLoading, setActionLoading] = React.useState<'start' | 'deep' | 'stop' | 'clear' | 'cache' | 'reset' | null>(null);
  const [filterDraft, setFilterDraft] = React.useState(loadResourceFilterDraft);
  const [dedupeSameName, setDedupeSameName] = React.useState(loadDedupeSameName);
  const [resourceDisplayMode, setResourceDisplayMode] = React.useState<ResourceDisplayMode>('all');
  const [extensionFilterIds, setExtensionFilterIds] = React.useState<string[]>([]);
  const [expandedResourceIds, setExpandedResourceIds] = React.useState<string[]>([]);
  const [manualMergeSelectedIds, setManualMergeSelectedIds] = React.useState<string[]>([]);
  const [externalToolOptions, setExternalToolOptions] = React.useState<EmbeddedBrowserExternalToolOption[]>([])

  React.useEffect(() => {
    window.localStorage.setItem(RESOURCE_FILTER_STORAGE_KEY, filterDraft);
  }, [filterDraft]);

  React.useEffect(() => {
    window.localStorage.setItem(RESOURCE_DEDUPE_SAME_NAME_STORAGE_KEY, dedupeSameName ? 'true' : 'false');
  }, [dedupeSameName]);

  React.useEffect(() => {
    let cancelled = false
    const loadExternalToolOptions = async () => {
      try {
        const nextOptions = await listEmbeddedBrowserEnabledExternalTools()
        if (!cancelled) {
          setExternalToolOptions(nextOptions)
        }
      } catch {
        if (!cancelled) {
          setExternalToolOptions([])
        }
      }
    }
    void loadExternalToolOptions()
    const unsubscribe = subscribeEmbeddedBrowserExternalToolsUpdated(() => {
      void loadExternalToolOptions()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const filterPattern = React.useMemo(() => {
    try {
      return new RegExp(filterDraft, 'i');
    } catch {
      return null;
    }
  }, [filterDraft]);

  const filterError = React.useMemo(() => {
    try {
      new RegExp(filterDraft, 'i');
      return '';
    } catch (error: any) {
      return error?.message || '正则无效';
    }
  }, [filterDraft]);

  const regexFilteredResources = React.useMemo(() => {
    if (filterError) {
      return [];
    }
    return resources.filter((resource) => matchesResourceFilter(resource, filterPattern));
  }, [filterError, filterPattern, resources]);

  const dedupedResources = React.useMemo(() => {
    if (!dedupeSameName) {
      return regexFilteredResources;
    }
    const seenKeys = new Set<string>();
    return regexFilteredResources.filter((resource) => {
      const key = getSameNameDedupeKey(resource);
      if (seenKeys.has(key)) {
        return false;
      }
      seenKeys.add(key);
      return true;
    });
  }, [dedupeSameName, regexFilteredResources]);

  const sameNameHiddenCount = regexFilteredResources.length - dedupedResources.length;

  const extensionOptions = React.useMemo(() => {
    const optionCounts = new Map<string, number>();
    dedupedResources.forEach((resource) => {
      const key = getResourceExtensionFilterKey(resource);
      optionCounts.set(key, (optionCounts.get(key) || 0) + 1);
    });
    return Array.from(optionCounts.entries())
      .sort(([leftKey, leftCount], [rightKey, rightCount]) => {
        const countDelta = rightCount - leftCount;
        if (countDelta !== 0) {
          return countDelta;
        }
        return leftKey.localeCompare(rightKey);
      })
      .map(([key, count]) => ({ count, key }));
  }, [dedupedResources]);

  React.useEffect(() => {
    const availableKeys = new Set(extensionOptions.map((option) => option.key));
    setExtensionFilterIds((previous) => previous.filter((key) => availableKeys.has(key)));
  }, [extensionOptions]);

  const ruleFilteredResources = React.useMemo(() => {
    if (!extensionFilterIds.length) {
      return dedupedResources;
    }
    const enabledExtensions = new Set(extensionFilterIds);
    return dedupedResources.filter((resource) => (
      enabledExtensions.has(getResourceExtensionFilterKey(resource))
    ));
  }, [extensionFilterIds, dedupedResources]);

  const displayResources = resourceDisplayMode === 'all'
    ? resources
    : ruleFilteredResources;

  const resourceSections = React.useMemo(
    () => createEmbeddedBrowserResourceSections(displayResources),
    [displayResources],
  );
  const mergeablePair = React.useMemo(
    () => findMergeableResourcePair(displayResources),
    [displayResources],
  );
  const manualMergeSelectedResources = React.useMemo(() => (
    manualMergeSelectedIds
      .map((resourceId) => displayResources.find((resource) => resource.id === resourceId))
      .filter(Boolean) as EmbeddedBrowserCapturedResource[]
  ), [displayResources, manualMergeSelectedIds]);
  const manualMergePair = React.useMemo(
    () => createManualMergePair(manualMergeSelectedResources),
    [manualMergeSelectedResources],
  );
  const selectedMergeableCount = React.useMemo(
    () => manualMergeSelectedResources.filter(isManuallyMergeableResource).length,
    [manualMergeSelectedResources],
  );

  React.useEffect(() => {
    setManualMergeSelectedIds((previous) => (
      previous.filter((resourceId) => displayResources.some((resource) => resource.id === resourceId))
    ));
  }, [displayResources]);

  const toggleResourceSelection = React.useCallback((
    resource: EmbeddedBrowserCapturedResource,
  ) => {
    setManualMergeSelectedIds((previous) => {
      if (previous.includes(resource.id)) {
        return previous.filter((resourceId) => resourceId !== resource.id);
      }
      return [...previous, resource.id];
    });
  }, []);

  const selectAllFilteredResources = React.useCallback(() => {
    setManualMergeSelectedIds(displayResources.map((resource) => resource.id));
  }, [displayResources]);

  const invertFilteredResourceSelection = React.useCallback(() => {
    setManualMergeSelectedIds((previous) => {
      const selectedIds = new Set(previous);
      const visibleIds = new Set(displayResources.map((resource) => resource.id));
      const keptHiddenIds = previous.filter((resourceId) => !visibleIds.has(resourceId));
      const invertedVisibleIds = displayResources
        .filter((resource) => !selectedIds.has(resource.id))
        .map((resource) => resource.id);
      return [...keptHiddenIds, ...invertedVisibleIds];
    });
  }, [displayResources]);

  const copySelectedResourceLinks = React.useCallback(async () => {
    if (!manualMergeSelectedResources.length) {
      Toast.warning('先勾选要复制的资源');
      return;
    }
    await navigator.clipboard.writeText(manualMergeSelectedResources.map((resource) => resource.url).join('\n'));
    Toast.success('已复制勾选资源链接');
  }, [manualMergeSelectedResources]);

  const toggleExtensionFilter = React.useCallback((key: string) => {
    setExtensionFilterIds((previous) => {
      if (previous.includes(key)) {
        return previous.filter((value) => value !== key);
      }
      return [...previous, key];
    });
  }, []);

  const toggleResourceDetails = React.useCallback((
    resource: EmbeddedBrowserCapturedResource,
    expanded: boolean,
  ) => {
    setExpandedResourceIds((previous) => {
      if (expanded) {
        return previous.includes(resource.id) ? previous : [...previous, resource.id];
      }
      return previous.filter((resourceId) => resourceId !== resource.id);
    });
  }, []);

  const handleDispatchExternalTool = React.useCallback(async (
    toolKey: EmbeddedBrowserExternalToolOption['key'],
    resource: EmbeddedBrowserCapturedResource,
  ) => {
    await dispatchEmbeddedBrowserExternalTool(toolKey, {
      resourceId: resource.id,
      tabId: resource.tabId,
    })
    const option = externalToolOptions.find((item) => item.key === toolKey)
    Toast.success(`已发送到${option?.label || '外部工具'}`)
  }, [externalToolOptions])

  const expandAllFilteredResources = React.useCallback(() => {
    setExpandedResourceIds(displayResources.map((resource) => resource.id));
  }, [displayResources]);

  const collapseAllResourceDetails = React.useCallback(() => {
    setExpandedResourceIds([]);
  }, []);

  const runAction = React.useCallback(async (
    nextAction: 'start' | 'deep' | 'stop' | 'clear' | 'cache' | 'reset',
    runner: () => Promise<unknown>,
    successMessage?: string,
  ) => {
    setActionLoading(nextAction);
    try {
      await runner();
      if (successMessage) {
        Toast.success(successMessage);
      }
    } catch (error: any) {
      Toast.error(error?.message || '资源捕获操作失败');
    } finally {
      setActionLoading(null);
    }
  }, []);

  const disabled = !activeTabId;
  const recorderMode = Boolean(activeTabId && deepCaptureEnabled);

  const bulkBar = (
    <EmbeddedBrowserResourceBulkBar
      canMerge={Boolean(manualMergePair)}
      dedupeSameName={dedupeSameName}
      disabled={disabled || actionLoading !== null}
      hasExpandedResources={expandedResourceIds.length > 0}
      hasResources={displayResources.length > 0}
      onClearSelection={() => {
        setManualMergeSelectedIds([]);
      }}
      onCopySelected={() => {
        void copySelectedResourceLinks();
      }}
      onDownloadSelected={() => {
        void downloadSelectedResources(manualMergeSelectedResources).catch((error: any) => {
          Toast.error(error?.message || '下载已选失败');
        });
      }}
      onInvertSelection={invertFilteredResourceSelection}
      onMergeSelected={() => {
        if (!manualMergePair) {
          Toast.warning('勾选一条视频和一条音频后再合并');
          return;
        }
        void mergeCapturedResources(manualMergePair).catch((error: any) => {
          Toast.error(error?.message || '合并失败');
        });
      }}
      onProcessSelected={() => {
        if (!manualMergeSelectedResources.length) {
          Toast.warning('先勾选要处理的资源');
          return;
        }
        if (!onOpenMediaProcessing) {
          Toast.warning('当前没有可用的媒体处理工作区');
          return;
        }
        onOpenMediaProcessing(manualMergeSelectedResources);
      }}
      onSelectAll={selectAllFilteredResources}
      onToggleDedupeSameName={() => {
        setDedupeSameName((value) => !value);
        setResourceDisplayMode('filtered');
      }}
      onToggleExpandAll={() => {
        if (expandedResourceIds.length > 0) {
          collapseAllResourceDetails();
          return;
        }
        expandAllFilteredResources();
      }}
      sameNameHiddenCount={resourceDisplayMode === 'filtered' ? sameNameHiddenCount : 0}
      selectedCount={manualMergeSelectedResources.length}
      selectedMergeableCount={selectedMergeableCount}
    />
  );

  const resourceExplorer = (
    <>
      {!activeTabId ? (
        <div className="resource-panel-empty">
          先打开一个内置浏览器标签页，再开始捕获。
        </div>
      ) : displayResources.length === 0 ? (
        <div className="resource-panel-empty">
          {resourceDisplayMode === 'filtered' && filterError
            ? '当前正则无效，先修正过滤规则。'
            : captureEnabled
              ? resourceDisplayMode === 'filtered'
                ? '当前过滤条件下还没有命中资源。可以继续浏览页面，或者点“深度捕获”后刷新页面。'
                : '当前页面还没有捕获到资源。可以继续浏览页面，或者点“深度捕获”后刷新页面。'
              : '点击“开启捕获”后，网络层资源会开始进入这个面板。'}
        </div>
      ) : (
        resourceSections.map((section) => (
          <div key={section.key} className="resource-section">
            <div className="resource-section-header">
              <div className="resource-section-title-row">
                <div className="resource-section-title">{section.title}</div>
                <div className="resource-section-count">{section.items.length}</div>
              </div>
              <div className="resource-section-description">{section.description}</div>
            </div>
            {section.items.map((resource) => (
              <EmbeddedBrowserResourceCard
                externalToolOptions={externalToolOptions}
                expanded={expandedResourceIds.includes(resource.id)}
                key={resource.id}
                onDispatchExternalTool={handleDispatchExternalTool}
                onOpenHlsDownloadWorkspace={onOpenHlsDownloadWorkspace}
                onOpenMpdDownloadWorkspace={onOpenMpdDownloadWorkspace}
                onToggleDetails={toggleResourceDetails}
                onToggleSelection={toggleResourceSelection}
                resource={resource}
                resources={displayResources}
                selected={manualMergeSelectedIds.includes(resource.id)}
              />
            ))}
          </div>
        ))
      )}
    </>
  );

  return (
    <PanelShell className={className}>
      <div className="resource-panel-header">
        <div className="resource-panel-title-row">
          <h3 className="resource-panel-title">资源捕获</h3>
        </div>
        <p className="resource-panel-subtitle">
          {currentPageUrl
            ? `当前页面：${currentPageUrl}`
            : '选中一个浏览器标签后，可以在这里查看本页捕获到的资源。'}
        </p>
        <div className="resource-panel-badges">
          <span className={`resource-panel-badge ${captureEnabled ? 'is-active' : ''}`}>
            {captureEnabled ? '网络捕获已开启' : '网络捕获未开启'}
          </span>
          <span className={`resource-panel-badge ${deepCaptureEnabled ? 'is-active' : ''}`}>
            {deepCaptureEnabled ? '深度探测已开启' : '深度探测未开启'}
          </span>
          <span className="resource-panel-badge">
            {loading ? '同步中...' : `显示 ${displayResources.length} / ${resources.length} 条`}
          </span>
        </div>
        <div className="resource-panel-filter">
          <div className="resource-panel-filter-label">
            正则过滤，默认只保留媒体相关资源。
          </div>
          <div className="resource-panel-filter-row">
            <input
              className="resource-panel-filter-input"
              value={filterDraft}
              onChange={(event) => {
                setFilterDraft(event.target.value);
                setResourceDisplayMode('filtered');
              }}
              placeholder="输入正则，例如 m4s|m3u8|mpd"
            />
            <button
              type="button"
              className="resource-panel-filter-reset"
              onClick={() => {
                setFilterDraft(DEFAULT_MEDIA_RESOURCE_REGEX);
                setResourceDisplayMode('filtered');
              }}
            >
              重置
            </button>
          </div>
          {filterError ? (
            <div className="resource-panel-filter-error">
              正则解析失败：{filterError}
            </div>
          ) : null}
          <div className="resource-display-mode">
            <button
              type="button"
              className={`resource-extension-chip ${resourceDisplayMode === 'all' ? 'is-active' : ''}`}
              onClick={() => {
                setResourceDisplayMode('all');
              }}
            >
              全部 {resources.length}
            </button>
            <button
              type="button"
              className={`resource-extension-chip ${resourceDisplayMode === 'filtered' ? 'is-active' : ''}`}
              onClick={() => {
                setResourceDisplayMode('filtered');
              }}
            >
              筛选 {ruleFilteredResources.length}
            </button>
          </div>
          {resourceDisplayMode === 'filtered' && extensionOptions.length > 0 ? (
            <div className="resource-extension-filter">
              <button
                type="button"
                className={`resource-extension-chip ${extensionFilterIds.length === 0 ? 'is-active' : ''}`}
                onClick={() => {
                  setExtensionFilterIds([]);
                }}
              >
                不限后缀 {dedupedResources.length}
              </button>
              {extensionOptions.map((option) => {
                const active = extensionFilterIds.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`resource-extension-chip ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      toggleExtensionFilter(option.key);
                    }}
                  >
                    {option.key} {option.count}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="resource-panel-actions">
          <button
            type="button"
            className="resource-panel-btn primary"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('start', startCapture, '已开启资源捕获');
            }}
          >
            开启捕获
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('deep', startDeepCapture, '已刷新页面并开启深度探测');
            }}
          >
            深度捕获
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('stop', stopCapture, '已停止资源捕获');
            }}
          >
            停止捕获
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('clear', clearResources, '已清空资源列表');
            }}
          >
            清空列表
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('cache', async () => {
                if (!activeTabId) {
                  return false;
                }
                return clearEmbeddedBrowserCacheAndReload(activeTabId);
              }, '已清理浏览器缓存并重新加载');
            }}
          >
            清缓存重载
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('reset', async () => {
                if (!activeTabId) {
                  return false;
                }
                return resetEmbeddedBrowserPageStorageAndReload(activeTabId);
              }, '已重置网页缓存并重建页面');
            }}
          >
            重置网页
          </button>
          {mergeablePair ? (
            <button
              type="button"
              className="resource-panel-btn"
              disabled={disabled || actionLoading !== null}
              onClick={() => {
                void mergeCapturedResources(mergeablePair).catch((error: any) => {
                  Toast.error(error?.message || '合并失败');
                });
              }}
            >
              合并主音视频
            </button>
          ) : null}
        </div>
        <details className="resource-more-shell">
          <summary>更多功能</summary>
          <div className="resource-more-actions">
            <button
              type="button"
              className="resource-card-btn"
              disabled={disabled || actionLoading !== null}
              onClick={() => {
                void runAction('deep', startDeepCapture, '已刷新页面并开启深度探测');
              }}
            >
              深度搜索
            </button>
            <button
              type="button"
              className="resource-card-btn"
              disabled={disabled || actionLoading !== null}
              onClick={() => {
                void runAction('deep', startDeepCapture, '已打开缓存捕捉');
              }}
            >
              缓存捕捉
            </button>
            <button
              type="button"
              className="resource-card-btn"
              disabled={!displayResources.length}
              onClick={expandAllFilteredResources}
            >
              展开资源
            </button>
            <button
              type="button"
              className="resource-card-btn"
              disabled={!expandedResourceIds.length}
              onClick={collapseAllResourceDetails}
            >
              收起详情
            </button>
            <button
              type="button"
              className="resource-card-btn"
              onClick={() => {
                setFilterDraft(DEFAULT_MEDIA_RESOURCE_REGEX);
                setExtensionFilterIds([]);
                setResourceDisplayMode('filtered');
              }}
            >
              重置筛选
            </button>
          </div>
        </details>
      </div>
      <div className="resource-panel-bulk-shell">
        {bulkBar}
      </div>
      <div className="resource-panel-body">
        {recorderMode ? (
          <EmbeddedBrowserCatchToolkitCard
            disabled={disabled}
            loading={catchToolkit.loading}
            onClearCache={catchToolkit.clearCache}
            onMergeCapturedMedia={catchToolkit.mergeCapturedMedia}
            onRestartCapture={catchToolkit.restartCapture}
            onSaveCapturedMedia={catchToolkit.saveCapturedMedia}
            onUpdateState={catchToolkit.updateState}
            state={catchToolkit.state}
          />
        ) : null}
        {recorderMode ? (
          <details className="resource-debug-shell">
            <summary>
              <span>抓包明细</span>
              <span>{displayResources.length} 条资源</span>
            </summary>
            <div className="resource-debug-content">
              {resourceExplorer}
            </div>
          </details>
        ) : (
          resourceExplorer
        )}
      </div>
    </PanelShell>
  );
};

export default EmbeddedBrowserResourcePanel;
