import type { EmbeddedBrowserCapturedResource } from '../types';

const RESOURCE_DOWNLOAD_HEADER_BLOCKLIST = new Set([
  'accept-encoding',
  'connection',
  'host',
  'range',
]);

export function decodeBase64Text(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

export function isHttpResource(resource: EmbeddedBrowserCapturedResource) {
  return /^https?:\/\//i.test(resource.url);
}

export function withResourceRefererHeader(resource: EmbeddedBrowserCapturedResource) {
  const headers = {
    ...(resource.requestHeaders || {}),
  };
  const hasReferer = Object.keys(headers).some((key) => key.toLowerCase() === 'referer');
  if (resource.referer && !hasReferer) {
    headers.referer = resource.referer;
  }
  return headers;
}

export function withDownloadRequestHeaders(resource: EmbeddedBrowserCapturedResource) {
  const headers = withResourceRefererHeader(resource);
  return Object.fromEntries(
    Object.entries(headers).filter(([headerName, headerValue]) => (
      Boolean(headerValue)
      && !RESOURCE_DOWNLOAD_HEADER_BLOCKLIST.has(String(headerName || '').toLowerCase())
    )),
  );
}

export async function fetchResourceBinaryBase64(
  url: string,
  headers: Record<string, string>,
  maxBytes?: number,
) {
  const response = await window.electronAPI.fetchBinary(url, {
    headers,
    maxBytes,
  });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`二进制资源请求失败：HTTP ${response.status}`);
  }
  return response.base64;
}
