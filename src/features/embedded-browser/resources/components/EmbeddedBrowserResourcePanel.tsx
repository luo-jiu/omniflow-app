import { Toast } from '@douyinfe/semi-ui';
import React from 'react';
import PanelShell from './EmbeddedBrowserResourcePanel.styles';
import EmbeddedBrowserCatchToolkitCard from './EmbeddedBrowserCatchToolkitCard';
import EmbeddedBrowserResourceBulkBar from './EmbeddedBrowserResourceBulkBar';
import EmbeddedBrowserResourceCard from './EmbeddedBrowserResourceCard';
import { useEmbeddedBrowserCatchToolkit } from '../hooks/useEmbeddedBrowserCatchToolkit';
import { useEmbeddedBrowserResources } from '../hooks/useEmbeddedBrowserResources';
import {
  createEmbeddedBrowserResourceSections,
  findMergeableResourcePair,
} from '../model/embedded-browser-resource.presentation';
import {
  createManualMergePair,
  downloadSelectedResources,
  formatMergeResourceLabel,
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
};

const RESOURCE_FILTER_STORAGE_KEY = 'embedded-browser:resource-filter-regex';
const DEFAULT_MEDIA_RESOURCE_REGEX = String.raw`(blob:|key|base64key|\.((m3u8|m3u|mpd|m4s|mp4|m4v|m4a|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp|vtt|srt))(?:$|[?#]))`;

function loadResourceFilterDraft() {
  const value = window.localStorage.getItem(RESOURCE_FILTER_STORAGE_KEY);
  return String(value || DEFAULT_MEDIA_RESOURCE_REGEX);
}

const EmbeddedBrowserResourcePanel: React.FC<EmbeddedBrowserResourcePanelProps> = ({
  activeTabId,
  className,
  currentPageUrl = '',
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
  const [actionLoading, setActionLoading] = React.useState<'start' | 'deep' | 'stop' | 'clear' | null>(null);
  const [filterDraft, setFilterDraft] = React.useState(loadResourceFilterDraft);
  const [extensionFilterIds, setExtensionFilterIds] = React.useState<string[]>([]);
  const [expandedResourceIds, setExpandedResourceIds] = React.useState<string[]>([]);
  const [manualMergeSelectedIds, setManualMergeSelectedIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    window.localStorage.setItem(RESOURCE_FILTER_STORAGE_KEY, filterDraft);
  }, [filterDraft]);

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

  const extensionOptions = React.useMemo(() => {
    const optionCounts = new Map<string, number>();
    regexFilteredResources.forEach((resource) => {
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
  }, [regexFilteredResources]);

  React.useEffect(() => {
    const availableKeys = new Set(extensionOptions.map((option) => option.key));
    setExtensionFilterIds((previous) => previous.filter((key) => availableKeys.has(key)));
  }, [extensionOptions]);

  const filteredResources = React.useMemo(() => {
    if (!extensionFilterIds.length) {
      return regexFilteredResources;
    }
    const enabledExtensions = new Set(extensionFilterIds);
    return regexFilteredResources.filter((resource) => (
      enabledExtensions.has(getResourceExtensionFilterKey(resource))
    ));
  }, [extensionFilterIds, regexFilteredResources]);

  const resourceSections = React.useMemo(
    () => createEmbeddedBrowserResourceSections(filteredResources),
    [filteredResources],
  );
  const mergeablePair = React.useMemo(
    () => findMergeableResourcePair(filteredResources),
    [filteredResources],
  );
  const manualMergeSelectedResources = React.useMemo(() => (
    manualMergeSelectedIds
      .map((resourceId) => filteredResources.find((resource) => resource.id === resourceId))
      .filter(Boolean) as EmbeddedBrowserCapturedResource[]
  ), [filteredResources, manualMergeSelectedIds]);
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
      previous.filter((resourceId) => filteredResources.some((resource) => resource.id === resourceId))
    ));
  }, [filteredResources]);

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
    setManualMergeSelectedIds(filteredResources.map((resource) => resource.id));
  }, [filteredResources]);

  const invertFilteredResourceSelection = React.useCallback(() => {
    setManualMergeSelectedIds((previous) => {
      const selectedIds = new Set(previous);
      const visibleIds = new Set(filteredResources.map((resource) => resource.id));
      const keptHiddenIds = previous.filter((resourceId) => !visibleIds.has(resourceId));
      const invertedVisibleIds = filteredResources
        .filter((resource) => !selectedIds.has(resource.id))
        .map((resource) => resource.id);
      return [...keptHiddenIds, ...invertedVisibleIds];
    });
  }, [filteredResources]);

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

  const expandAllFilteredResources = React.useCallback(() => {
    setExpandedResourceIds(filteredResources.map((resource) => resource.id));
  }, [filteredResources]);

  const collapseAllResourceDetails = React.useCallback(() => {
    setExpandedResourceIds([]);
  }, []);

  const runAction = React.useCallback(async (
    nextAction: 'start' | 'deep' | 'stop' | 'clear',
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

  const resourceExplorer = (
    <>
      <EmbeddedBrowserResourceBulkBar
        canMerge={Boolean(manualMergePair)}
        disabled={disabled || actionLoading !== null}
        hasExpandedResources={expandedResourceIds.length > 0}
        hasResources={filteredResources.length > 0}
        onClearSelection={() => {
          setManualMergeSelectedIds([]);
        }}
        onCollapseAll={collapseAllResourceDetails}
        onCopySelected={() => {
          void copySelectedResourceLinks();
        }}
        onDownloadSelected={() => {
          void downloadSelectedResources(manualMergeSelectedResources).catch((error: any) => {
            Toast.error(error?.message || '下载已选失败');
          });
        }}
        onExpandAll={expandAllFilteredResources}
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
        onSelectAll={selectAllFilteredResources}
        selectedCount={manualMergeSelectedResources.length}
        selectedMergeableCount={selectedMergeableCount}
      />
      {manualMergeSelectedResources.length > 0 ? (
        <div className="resource-merge-selection">
          <div>已勾选 {manualMergeSelectedResources.length} 条资源；合并需要正好 2 条可合并媒体。</div>
          {manualMergeSelectedResources.map((resource, index) => (
            <div key={resource.id}>
              {index + 1}：{formatMergeResourceLabel(resource)}
            </div>
          ))}
          {manualMergePair ? (
            <div>
              将按：视频 {formatMergeResourceLabel(manualMergePair.video)}；音频 {formatMergeResourceLabel(manualMergePair.audio)}
            </div>
          ) : null}
        </div>
      ) : null}
      {!activeTabId ? (
        <div className="resource-panel-empty">
          先打开一个内置浏览器标签页，再开始捕获。
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="resource-panel-empty">
          {filterError
            ? '当前正则无效，先修正过滤规则。'
            : captureEnabled
              ? '当前过滤条件下还没有命中资源。可以继续浏览页面，或者点“深度捕获”后刷新页面。'
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
                expanded={expandedResourceIds.includes(resource.id)}
                key={resource.id}
                onToggleDetails={toggleResourceDetails}
                onToggleSelection={toggleResourceSelection}
                resource={resource}
                resources={filteredResources}
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
            {loading ? '同步中...' : `显示 ${filteredResources.length} / ${resources.length} 条`}
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
              }}
              placeholder="输入正则，例如 m4s|m3u8|mpd"
            />
            <button
              type="button"
              className="resource-panel-filter-reset"
              onClick={() => {
                setFilterDraft(DEFAULT_MEDIA_RESOURCE_REGEX);
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
          {extensionOptions.length > 0 ? (
            <div className="resource-extension-filter">
              <button
                type="button"
                className={`resource-extension-chip ${extensionFilterIds.length === 0 ? 'is-active' : ''}`}
                onClick={() => {
                  setExtensionFilterIds([]);
                }}
              >
                全部 {regexFilteredResources.length}
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
              disabled={!filteredResources.length}
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
              }}
            >
              重置筛选
            </button>
          </div>
        </details>
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
              <span>{filteredResources.length} 条资源</span>
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
