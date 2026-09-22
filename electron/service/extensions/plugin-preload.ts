import { contextBridge, ipcRenderer } from 'electron';

if (!process.sandboxed) throw new Error('Plugin renderer requires an OS sandbox');

// 首期不开放拖出文件或向 OS 交付任意 DownloadURL。
window.addEventListener('dragstart', event => event.preventDefault(), true);

let subscriptions = 0;
let start = 0; let count = 0; let heartbeatCount = 0;
contextBridge.exposeInMainWorld('omniflowTransport', Object.freeze({
  exchange: (request: unknown): Promise<string> => {
    if (typeof request !== 'string' || request.length > 34816 || new TextEncoder().encode(request).length > 34816) return Promise.reject(new Error('Request size limit'));
    const now = Date.now();
    if (now - start >= 1000) { start = now; count = 0; heartbeatCount = 0; }
    let priority = false;
    try { const method = JSON.parse(request).method; priority = method === 'lifecycle.pong'; if (method !== 'tool.complete' && new TextEncoder().encode(request).length > 16384) return Promise.reject(new Error('Request size limit')); } catch { /* main validates JSON */ }
    if (priority ? ++heartbeatCount > 2 : ++count > 64) return Promise.reject(new Error('Request rate limit'));
    return ipcRenderer.invoke('omniflow-plugin:rpc', request);
  },
  subscribe: (listener: (event: string) => void) => {
    if (subscriptions >= 8) throw new Error('Listener limit');
    if (typeof listener !== 'function') throw new Error('Listener required');
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => { if (typeof value === 'string' && value.length <= 131072) listener(value); };
    subscriptions += 1;
    ipcRenderer.on('omniflow-plugin:event', handler);
    let removed = false;
    return () => { if (removed) return; removed = true; subscriptions -= 1; ipcRenderer.removeListener('omniflow-plugin:event', handler); };
  },
}));
