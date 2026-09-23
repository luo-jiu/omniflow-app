/** File bodies must bypass http:fetch's automatic JSON response parsing. */
export async function readTextResource(url: string): Promise<string> {
  const response = await window.electronAPI.fetchBinary(url, { method: 'GET' });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  if (response.truncated) throw new Error('文件正文读取不完整');
  if (typeof response.base64 !== 'string') throw new Error('未收到有效的文件正文');
  const bytes = Uint8Array.from(atob(response.base64), character => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
