import { Popover, Toast } from '@douyinfe/semi-ui';
import React from 'react';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/context-menu';
import EmbeddedBrowserResourceManifestTools from './EmbeddedBrowserResourceManifestTools';
import type { EmbeddedBrowserExternalToolOption } from '@/features/embedded-browser/external-tools/model/embedded-browser-external-tools';
import type {
  EmbeddedBrowserHlsDownloadPlan,
  EmbeddedBrowserHlsManifest,
} from '../model/embedded-browser-hls-manifest';
import type {
  EmbeddedBrowserMpdDownloadPlan,
  EmbeddedBrowserMpdManifest,
} from '../model/embedded-browser-mpd-manifest';
import {
  isMseCapturedResource,
  isPageContextManagedResource,
  isPreviewableResource,
} from '../model/embedded-browser-resource.presentation';
import {
  copyResourceCurl,
  copyResourceUrl,
  exportCapturedResource,
  formatBytes,
  formatCapturedAt,
  formatResourceOrigin,
  formatResourceTitle,
  openCapturedResource,
  openResourceUrl,
  previewResource,
} from '../services/embedded-browser-resource-panel-actions';
import { isHttpResource } from '../services/embedded-browser-resource-request';
import type { EmbeddedBrowserCapturedResource } from '../types';

type EmbeddedBrowserResourceCardProps = {
  externalToolOptions?: EmbeddedBrowserExternalToolOption[]
  expanded: boolean
  onDispatchExternalTool?: (
    toolKey: EmbeddedBrowserExternalToolOption['key'],
    resource: EmbeddedBrowserCapturedResource,
  ) => Promise<void>
  onOpenHlsDownloadWorkspace?: (
    resource: EmbeddedBrowserCapturedResource,
    manifest: EmbeddedBrowserHlsManifest,
    plan: EmbeddedBrowserHlsDownloadPlan,
  ) => void
  onOpenMpdDownloadWorkspace?: (
    resource: EmbeddedBrowserCapturedResource,
    manifest: EmbeddedBrowserMpdManifest,
    plan: EmbeddedBrowserMpdDownloadPlan,
  ) => void
  onToggleDetails: (resource: EmbeddedBrowserCapturedResource, expanded: boolean) => void
  onToggleSelection: (resource: EmbeddedBrowserCapturedResource) => void
  resource: EmbeddedBrowserCapturedResource
  resources: EmbeddedBrowserCapturedResource[]
  selected: boolean
}

const EmbeddedBrowserResourceCard: React.FC<EmbeddedBrowserResourceCardProps> = ({
  externalToolOptions = [],
  expanded,
  onDispatchExternalTool,
  onOpenHlsDownloadWorkspace,
  onOpenMpdDownloadWorkspace,
  onToggleDetails,
  onToggleSelection,
  resource,
  resources,
  selected,
}) => {
  const canSendToExternalTools = isHttpResource(resource) && externalToolOptions.length > 0 && Boolean(onDispatchExternalTool)

  const externalToolMenuItems = React.useMemo<ContextMenuItem[]>(() => (
    externalToolOptions.map((tool) => ({
      key: tool.key,
      label: tool.label,
      onClick: () => {
        if (!onDispatchExternalTool) {
          return
        }
        void onDispatchExternalTool(tool.key, resource).catch((error: any) => {
          Toast.error(error?.message || '发送到外部工具失败')
        })
      },
    }))
  ), [externalToolOptions, onDispatchExternalTool, resource])

  return (
    <div className={`resource-card ${selected ? 'is-selected' : ''}`}>
      <div className="resource-card-top">
        <label className="resource-card-check" title="选择这条资源">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => {
              onToggleSelection(resource);
            }}
          />
        </label>
        <div className="resource-card-main">
          <div className="resource-card-title-row">
            <div className="resource-card-title" title={resource.url}>
              {formatResourceTitle(resource)}
            </div>
            <span className="resource-card-size">{resource.contentLength ? formatBytes(resource.contentLength) : '未知大小'}</span>
          </div>
          <div className="resource-card-meta">
            <span className="resource-chip">{resource.kind}</span>
            {resource.streamType ? <span className="resource-chip">{resource.streamType}</span> : null}
            {isMseCapturedResource(resource) ? <span className="resource-chip">playable</span> : null}
            <span className="resource-chip">{resource.source}</span>
            {resource.ext ? <span className="resource-chip">.{resource.ext}</span> : null}
            {resource.statusCode ? <span className="resource-chip">{resource.statusCode}</span> : null}
            <span className="resource-chip">{formatCapturedAt(resource.capturedAt)}</span>
            <span className="resource-chip">{formatResourceOrigin(resource)}</span>
          </div>
        </div>
      </div>
      <details
        className="resource-card-details"
        open={expanded}
        onToggle={(event) => {
          onToggleDetails(resource, event.currentTarget.open);
        }}
      >
        <summary>详情</summary>
        <div className="resource-url">{resource.url}</div>
        {resource.context?.headerNames.length ? (
          <div className="resource-request-meta">
            请求上下文：{resource.context.headerNames.join(', ')}
          </div>
        ) : null}
      </details>
      <div className="resource-card-actions">
        {isPreviewableResource(resource) ? (
          <>
            <button
              type="button"
              className="resource-card-btn"
              onClick={() => {
                void previewResource(resource).catch((error: any) => {
                  Toast.error(error?.message || '预览失败');
                });
              }}
            >
              预览
            </button>
            {isPageContextManagedResource(resource) ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void exportCapturedResource(resource).catch((error: any) => {
                    Toast.error(error?.message || '导出失败');
                  });
                }}
              >
                页内导出
              </button>
            ) : (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void copyResourceCurl(resource);
                }}
              >
                复制 curl
              </button>
            )}
            {!isPageContextManagedResource(resource) ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void copyResourceUrl(resource.url);
                }}
              >
                复制链接
              </button>
            ) : null}
          </>
        ) : (
          <>
            {isPageContextManagedResource(resource) ? (
              <>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void openCapturedResource(resource).catch((error: any) => {
                      Toast.error(error?.message || '打开失败');
                    });
                  }}
                >
                  页内打开
                </button>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void exportCapturedResource(resource).catch((error: any) => {
                      Toast.error(error?.message || '导出失败');
                    });
                  }}
                >
                  页内导出
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void copyResourceUrl(resource.url);
                  }}
                >
                  复制链接
                </button>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void copyResourceCurl(resource);
                  }}
                >
                  复制 curl
                </button>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    openResourceUrl(resource.url);
                  }}
                >
                  打开
                </button>
              </>
            )}
          </>
        )}
        {canSendToExternalTools ? (
          <Popover
            trigger="click"
            showArrow={false}
            position="bottomLeft"
            content={(
              <ContextMenu
                items={externalToolMenuItems}
                className="directory-context-menu"
              />
            )}
          >
            <button
              type="button"
              className="resource-card-btn"
            >
              发送到外部工具
            </button>
          </Popover>
        ) : null}
      </div>
      <EmbeddedBrowserResourceManifestTools
        onOpenHlsDownloadWorkspace={onOpenHlsDownloadWorkspace}
        onOpenMpdDownloadWorkspace={onOpenMpdDownloadWorkspace}
        resource={resource}
        resources={resources}
      />
    </div>
  );
};

export default EmbeddedBrowserResourceCard;
