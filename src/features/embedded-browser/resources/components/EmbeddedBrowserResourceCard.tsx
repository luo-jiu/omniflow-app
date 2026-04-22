import { Toast } from '@douyinfe/semi-ui';
import React from 'react';
import EmbeddedBrowserResourceManifestTools from './EmbeddedBrowserResourceManifestTools';
import type {
  EmbeddedBrowserHlsDownloadPlan,
  EmbeddedBrowserHlsManifest,
} from '../model/embedded-browser-hls-manifest';
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
import type { EmbeddedBrowserCapturedResource } from '../types';

type EmbeddedBrowserResourceCardProps = {
  expanded: boolean
  onOpenHlsDownloadWorkspace?: (
    resource: EmbeddedBrowserCapturedResource,
    manifest: EmbeddedBrowserHlsManifest,
    plan: EmbeddedBrowserHlsDownloadPlan,
  ) => void
  onToggleDetails: (resource: EmbeddedBrowserCapturedResource, expanded: boolean) => void
  onToggleSelection: (resource: EmbeddedBrowserCapturedResource) => void
  resource: EmbeddedBrowserCapturedResource
  resources: EmbeddedBrowserCapturedResource[]
  selected: boolean
}

const EmbeddedBrowserResourceCard: React.FC<EmbeddedBrowserResourceCardProps> = ({
  expanded,
  onOpenHlsDownloadWorkspace,
  onToggleDetails,
  onToggleSelection,
  resource,
  resources,
  selected,
}) => {
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
        {resource.pageUrl ? (
          <div className="resource-page-url">来源页面：{resource.pageUrl}</div>
        ) : null}
        {resource.referer ? (
          <div className="resource-request-meta">Referer：{resource.referer}</div>
        ) : null}
        {resource.requestHeaders && Object.keys(resource.requestHeaders).length ? (
          <div className="resource-request-meta">
            请求头：{Object.keys(resource.requestHeaders).join(', ')}
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
      </div>
      <EmbeddedBrowserResourceManifestTools
        onOpenHlsDownloadWorkspace={onOpenHlsDownloadWorkspace}
        resource={resource}
        resources={resources}
      />
    </div>
  );
};

export default EmbeddedBrowserResourceCard;
