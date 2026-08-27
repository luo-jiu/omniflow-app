import { Toast } from '@douyinfe/semi-ui';
import {
  isMseCapturedResource,
  isPageContextManagedResource,
} from '../model/embedded-browser-resource.presentation';
import { formatResourceTitle } from '../model/embedded-browser-resource-display';
import {
  exportEmbeddedBrowserCapturedResource,
  downloadEmbeddedBrowserCapturedResource,
  mergeEmbeddedBrowserCapturedMseResources,
  openEmbeddedBrowserCapturedResource,
  previewEmbeddedBrowserCapturedResource,
  transcodeEmbeddedBrowserCapturedResource,
} from './embedded-browser-resource.api';
import {
  isHttpResource,
} from './embedded-browser-resource-request';
import type { EmbeddedBrowserCapturedResource } from '../types';

function sanitizeDownloadFileName(input: string) {
  return String(input || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    || 'resource';
}

function getResourceDownloadFileName(resource: EmbeddedBrowserCapturedResource, index = 0) {
  const rawTitle = formatResourceTitle(resource);
  const hasExtension = /\.[a-z0-9]{2,8}(?:$|[?#])/i.test(rawTitle);
  const fallbackExtension = resource.ext || (resource.kind === 'manifest' ? 'm3u8' : 'bin');
  const fallbackName = hasExtension ? rawTitle : `${rawTitle}.${fallbackExtension}`;
  const prefix = index > 0 ? `${String(index + 1).padStart(2, '0')}-` : '';
  return sanitizeDownloadFileName(`${prefix}${fallbackName}`);
}

export async function copyResourceUrl(url: string) {
  await navigator.clipboard.writeText(url);
  Toast.success('链接已复制');
}

function shellEscape(value: string) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}

function buildResourceCurlCommand(resource: EmbeddedBrowserCapturedResource) {
  const lines = ['curl'];
  const method = String(resource.method || 'GET').trim().toUpperCase();
  if (method && method !== 'GET') {
    lines.push(`  -X ${method}`);
  }
  // Header values are intentionally unavailable in the renderer projection.
  lines.push(`  ${shellEscape(resource.url)}`);
  return lines.join(' \\\n');
}

export async function copyResourceCurl(resource: EmbeddedBrowserCapturedResource) {
  await navigator.clipboard.writeText(buildResourceCurlCommand(resource));
  Toast.success('curl 已复制');
}

export function openResourceUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function previewResource(resource: EmbeddedBrowserCapturedResource) {
  if (isMseCapturedResource(resource)) {
    await openCapturedResource(resource);
    return;
  }
  const previewed = await previewEmbeddedBrowserCapturedResource(resource.tabId, {
    mimeType: resource.mimeType,
    streamType: resource.streamType,
    title: resource.name || resource.url,
    url: resource.url,
  });
  if (!previewed) {
    throw new Error('页面内预览失败');
  }
}

export async function openCapturedResource(resource: EmbeddedBrowserCapturedResource) {
  if (!isPageContextManagedResource(resource)) {
    openResourceUrl(resource.url);
    return;
  }
  const opened = await openEmbeddedBrowserCapturedResource(resource.tabId, resource.id);
  if (!opened) {
    throw new Error('当前页面里的流还没有准备好，先继续播放几秒再试试');
  }
  Toast.success('已打开预览');
}

export async function exportCapturedResource(resource: EmbeddedBrowserCapturedResource) {
  if (!isPageContextManagedResource(resource)) {
    await copyResourceUrl(resource.url);
    return;
  }
  const exported = await exportEmbeddedBrowserCapturedResource(resource.tabId, resource.id);
  if (!exported) {
    throw new Error('当前页面里的流还没有准备好，先继续播放几秒再试试');
  }
  Toast.success('已触发导出');
}

export async function downloadSelectedResources(resources: EmbeddedBrowserCapturedResource[]) {
  if (!resources.length) {
    Toast.warning('先勾选要下载的资源');
    return;
  }
  const pageManagedResources = resources.filter((resource) => (
    isPageContextManagedResource(resource) && !isHttpResource(resource)
  ));
  const httpResources = resources.filter(isHttpResource);
  const unsupportedResources = resources.filter((resource) => (
    !isHttpResource(resource) && !isPageContextManagedResource(resource)
  ));

  for (const resource of pageManagedResources) {
    await exportCapturedResource(resource);
  }

  if (httpResources.length > 0) {
    if (!window.electronAPI?.pickDownloadDirectory) {
      throw new Error('当前环境不支持下载已选资源');
    }
    const pickResult = await window.electronAPI.pickDownloadDirectory();
    if (!pickResult || pickResult.canceled || !pickResult.directoryPath) {
      return;
    }
    for (const [index, resource] of httpResources.entries()) {
      const result = await downloadEmbeddedBrowserCapturedResource(resource.tabId, {
        outputDirectoryPath: pickResult.directoryPath,
        resourceId: resource.id,
        suggestedFileName: getResourceDownloadFileName(resource, httpResources.length > 1 ? index : 0),
        useSystemSaveDialog: false,
      });
      if (!result.ok && !result.cancelled) {
        throw new Error(result.error || '资源下载失败');
      }
    }
  }

  if (unsupportedResources.length > 0) {
    Toast.warning(`${unsupportedResources.length} 条资源暂时不能直接下载，已跳过`);
  }
  Toast.success(`已处理 ${resources.length - unsupportedResources.length} 条资源`);
}

type EmbeddedBrowserResourceOutputOptions = {
  outputDirectoryPath?: string;
  suppressSuccessToast?: boolean;
  useSystemSaveDialog?: boolean;
};

export async function mergeCapturedResources(resources: {
  audio: EmbeddedBrowserCapturedResource;
  video: EmbeddedBrowserCapturedResource;
}, options?: EmbeddedBrowserResourceOutputOptions) {
  const mergeResult = await mergeEmbeddedBrowserCapturedMseResources(resources.video.tabId, {
    audioResourceId: resources.audio.id,
    outputDirectoryPath: options?.outputDirectoryPath,
    videoResourceId: resources.video.id,
    useSystemSaveDialog: options?.useSystemSaveDialog,
  });
  if (mergeResult.cancelled) {
    return mergeResult;
  }
  if (!mergeResult.ok) {
    throw new Error(mergeResult.error || '合并失败');
  }
  if (!options?.suppressSuccessToast) {
    Toast.success('已完成音视频合并');
  }
  return mergeResult;
}

function normalizeTranscodeOutputFormat(input: string) {
  const normalized = String(input || '').trim().replace(/^\.+/, '').toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(normalized)) {
    throw new Error('请输入 1-12 位字母或数字格式，例如 mp3、m4a、mp4');
  }
  return normalized;
}

function deriveTranscodeSuggestedFileName(fileName: string, outputFormat: string) {
  const normalizedName = String(fileName || '').trim() || 'media';
  if (/\.[a-z0-9]{2,12}$/i.test(normalizedName)) {
    return normalizedName.replace(/\.[a-z0-9]{2,12}$/i, `.${outputFormat}`);
  }
  return `${normalizedName}.${outputFormat}`;
}

export async function transcodeCapturedResource(
  resource: EmbeddedBrowserCapturedResource,
  outputFormat: string,
  options?: EmbeddedBrowserResourceOutputOptions,
) {
  const normalizedFormat = normalizeTranscodeOutputFormat(outputFormat);
  const result = await transcodeEmbeddedBrowserCapturedResource(resource.tabId, {
    outputDirectoryPath: options?.outputDirectoryPath,
    outputFormat: normalizedFormat,
    resourceId: resource.id,
    suggestedFileName: deriveTranscodeSuggestedFileName(getResourceDownloadFileName(resource), normalizedFormat),
    useSystemSaveDialog: options?.useSystemSaveDialog,
  });
  if (result.cancelled) {
    return result;
  }
  if (!result.ok) {
    throw new Error(result.error || '转格式失败');
  }
  if (!options?.suppressSuccessToast) {
    Toast.success('已完成转格式');
  }
  return result;
}
